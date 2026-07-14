#!/usr/bin/env node
import crypto from 'node:crypto';

const sessions = new Map();
let currentSessionId = null;
let buffer = '';
let processing = Promise.resolve();

function enqueue(fn) {
  processing = processing.then(fn, fn);
  return processing;
}

function write(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function ensureSession(sessionId) {
  let session = sessions.get(sessionId);
  if (!session) {
    session = { sessionId, lastAssistantMessage: '', transcript: [] };
    sessions.set(sessionId, session);
  }
  return session;
}

function splitForStreaming(text) {
  return text.split(/(\s+)/).filter(Boolean);
}

async function streamText(sessionId, text, kind = 'agent_message_chunk') {
  for (const part of splitForStreaming(text)) {
    write({
      jsonrpc: '2.0',
      method: 'session/update',
      params: {
        sessionId,
        update: {
          sessionUpdate: kind,
          content: { type: 'text', text: part },
        },
      },
    });
    await delay(5);
  }
}

async function streamThoughts(sessionId, parts) {
  for (const part of parts) {
    await streamText(sessionId, part, 'agent_thought_chunk');
  }
}

async function emitToolRun(sessionId, title, rawInput, output) {
  const toolCallId = crypto.randomUUID();
  write({
    jsonrpc: '2.0',
    method: 'session/update',
    params: {
      sessionId,
      update: {
        sessionUpdate: 'tool_call',
        toolCallId,
        title,
        kind: 'shell',
        status: 'pending',
        rawInput,
      },
    },
  });
  await delay(5);
  write({
    jsonrpc: '2.0',
    method: 'session/update',
    params: {
      sessionId,
      update: {
        sessionUpdate: 'tool_call_update',
        toolCallId,
        status: 'completed',
        rawInput,
        rawOutput: output,
      },
    },
  });
}

async function replayTranscript(sessionId, transcript) {
  for (const entry of transcript) {
    if (entry.role === 'user') {
      write({
        jsonrpc: '2.0',
        method: 'session/update',
        params: {
          sessionId,
          update: {
            sessionUpdate: 'user_message_chunk',
            content: { type: 'text', text: entry.text },
          },
        },
      });
      await delay(3);
    } else if (entry.role === 'thought') {
      await streamThoughts(sessionId, [entry.text]);
    } else if (entry.role === 'assistant') {
      await streamText(sessionId, entry.text, 'agent_message_chunk');
    } else if (entry.role === 'tool_call') {
      write({
        jsonrpc: '2.0',
        method: 'session/update',
        params: {
          sessionId,
          update: {
            sessionUpdate: 'tool_call',
            toolCallId: entry.toolCallId || crypto.randomUUID(),
            title: entry.title || 'Tool',
            kind: 'shell',
            status: 'completed',
            rawInput: entry.rawInput || {},
          },
        },
      });
      await delay(3);
    } else if (entry.role === 'tool_output') {
      write({
        jsonrpc: '2.0',
        method: 'session/update',
        params: {
          sessionId,
          update: {
            sessionUpdate: 'tool_call_update',
            toolCallId: entry.toolCallId || crypto.randomUUID(),
            status: 'completed',
            rawOutput: entry.text,
          },
        },
      });
      await delay(3);
    }
  }
}

function finish(id) {
  write({ jsonrpc: '2.0', id, result: { stopReason: 'end_turn' } });
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

process.stdin.on('data', (chunk) => {
  buffer += chunk.toString('utf8');
  while (true) {
    const idx = buffer.indexOf('\n');
    if (idx === -1) break;
    const line = buffer.slice(0, idx).trim();
    buffer = buffer.slice(idx + 1);
    if (!line) continue;
    const message = JSON.parse(line);
    void handleMessage(message);
  }
});

async function handleMessage(message) {
  if (message.method === 'initialize') {
    write({ jsonrpc: '2.0', id: message.id, result: { protocolVersion: 1, agentInfo: { name: 'mock-acp', title: 'Mock ACP' } } });
    return;
  }

  if (message.method === 'session/prompt') {
    enqueue(() => handlePrompt(message));
    return;
  }

  if (message.method === 'session/new') {
    const sessionId = crypto.randomUUID();
    ensureSession(sessionId);
    currentSessionId = sessionId;
    write({ jsonrpc: '2.0', id: message.id, result: { sessionId } });
    return;
  }

  if (message.method === 'session/load') {
    enqueue(() => handleLoad(message));
    return;
  }

  if (message.method === 'session/list') {
    write({ jsonrpc: '2.0', id: message.id, result: { sessions: [...sessions.values()].map((session) => ({ sessionId: session.sessionId, title: 'mock', updatedAt: new Date().toISOString() })) } });
    return;
  }

  if (message.method === 'session/close') {
    write({ jsonrpc: '2.0', id: message.id, result: { ok: true } });
    return;
  }

  if (message.id != null) {
    write({ jsonrpc: '2.0', id: message.id, error: { code: -32601, message: `Unknown method: ${message.method}` } });
  }
}

async function handleLoad(message) {
  const sessionId = message.params.sessionId;
  const session = ensureSession(sessionId);
  currentSessionId = sessionId;
  write({ jsonrpc: '2.0', id: message.id, result: { sessionId } });
  if (session.transcript.length > 0) {
    await replayTranscript(sessionId, session.transcript);
  }
}

async function handlePrompt(message) {
  const sessionId = message.params.sessionId || currentSessionId || crypto.randomUUID();
  const session = ensureSession(sessionId);
  currentSessionId = sessionId;
  const text = message.params.prompt?.map((part) => part.text).join(' ')?.trim() || '';
  const lower = text.toLowerCase();

  session.transcript.push({ role: 'user', text });

  if (lower === 'boom') {
    write({ jsonrpc: '2.0', id: message.id, error: { code: -32000, message: 'boom' } });
    return;
  }

  if (lower.includes('tell me a joke')) {
    session.transcript.push({ role: 'thought', text: 'Thinking of a deterministic mock joke.' });
    await streamThoughts(sessionId, ['Thinking of a deterministic mock joke.']);
    const response = 'Why did the mock agent cross the road? To satisfy the test harness.';
    session.lastAssistantMessage = response;
    session.transcript.push({ role: 'assistant', text: response });
    await streamText(sessionId, response);
    finish(message.id);
    return;
  }

  if (lower.includes('what was that you said')) {
    const response = session.lastAssistantMessage || 'I have not said anything yet.';
    session.transcript.push({ role: 'assistant', text: response });
    await streamText(sessionId, response);
    finish(message.id);
    return;
  }

  if (lower.includes('ls')) {
    session.transcript.push({ role: 'thought', text: 'Checking the working directory contents.' });
    session.transcript.push({ role: 'thought', text: 'Summarizing the directory after the tool returns.' });
    await streamThoughts(sessionId, ['Checking the working directory contents.', 'Summarizing the directory after the tool returns.']);
    const listing = 'README.md\nclients\nserver\nPRODUCT\nscripts';
    const toolCallId = crypto.randomUUID();
    session.transcript.push({ role: 'tool_call', toolCallId, title: 'ls', rawInput: { command: 'ls' } });
    session.transcript.push({ role: 'tool_output', toolCallId, text: listing });
    await emitToolRun(sessionId, 'ls', { command: 'ls' }, listing);
    const response = 'I listed the directory. It contains README.md, clients, server, PRODUCT, and scripts.';
    session.lastAssistantMessage = response;
    session.transcript.push({ role: 'assistant', text: response });
    await streamText(sessionId, response);
    finish(message.id);
    return;
  }

  if (lower.includes('think carefully')) {
    session.transcript.push({ role: 'thought', text: 'Checking divisibility by small primes.' });
    session.transcript.push({ role: 'thought', text: 'No small factors found; concluding.' });
    await streamThoughts(sessionId, ['Checking divisibility by small primes.', 'No small factors found; concluding.']);
    const response = '9973 is prime.';
    session.lastAssistantMessage = response;
    session.transcript.push({ role: 'assistant', text: response });
    await streamText(sessionId, response);
    finish(message.id);
    return;
  }

  if (lower.includes('say hi briefly')) {
    const response = 'Hi.';
    session.lastAssistantMessage = response;
    session.transcript.push({ role: 'assistant', text: response });
    await streamText(sessionId, response);
    finish(message.id);
    return;
  }

  const response = `echo:${text}`;
  session.lastAssistantMessage = response;
  session.transcript.push({ role: 'assistant', text: response });
  await streamText(sessionId, response);
  finish(message.id);
}
