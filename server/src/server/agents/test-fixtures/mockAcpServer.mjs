#!/usr/bin/env node
let sessionId = 'acp-session-1';

function write(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

let buffer = '';
process.stdin.on('data', (chunk) => {
  buffer += chunk.toString('utf8');
  while (true) {
    const idx = buffer.indexOf('\n');
    if (idx === -1) break;
    const line = buffer.slice(0, idx).trim();
    buffer = buffer.slice(idx + 1);
    if (!line) continue;
    const message = JSON.parse(line);
    if (message.method === 'initialize') {
      write({ jsonrpc: '2.0', id: message.id, result: { protocolVersion: 1, agentInfo: { name: 'mock-acp' } } });
      continue;
    }
    if (message.method === 'session/new') {
      write({ jsonrpc: '2.0', id: message.id, result: { sessionId } });
      continue;
    }
    if (message.method === 'session/load') {
      if (message.params.sessionId === 'missing-session') {
        write({ jsonrpc: '2.0', id: message.id, error: { code: -32602, message: `Resource not found: ${message.params.sessionId}` } });
        continue;
      }
      sessionId = message.params.sessionId;
      write({ jsonrpc: '2.0', id: message.id, result: { sessionId } });
      write({
        jsonrpc: '2.0',
        method: 'session/update',
        params: {
          sessionId,
          update: {
            sessionUpdate: 'agent_message_chunk',
            content: { type: 'text', text: '[reloaded]' },
          },
        },
      });
      continue;
    }
    if (message.method === 'session/prompt') {
      if (message.params.prompt[0].text === 'boom') {
        write({ jsonrpc: '2.0', id: message.id, error: { code: -32000, message: 'boom' } });
        continue;
      }
      if (message.params.prompt[0].text === 'slow') {
        void (async () => {
          await delay(40);
          write({
            jsonrpc: '2.0',
            method: 'session/update',
            params: {
              sessionId: message.params.sessionId,
              update: {
                sessionUpdate: 'agent_message_chunk',
                content: { type: 'text', text: 'echo:slow' },
              },
            },
          });
          write({ jsonrpc: '2.0', id: message.id, result: { stopReason: 'end_turn' } });
        })();
        continue;
      }
      // When an injected context block rides along, surface the FULL prompt (all parts,
      // in order) so tests can assert ordering/visibility.
      const parts = message.params.prompt.map((p) => p.text);
      const hasContext = parts.some((t) => typeof t === 'string' && t.startsWith('<context'));
      const echoText = hasContext ? `prompt:${parts.join('||')}` : `echo:${parts[0]}`;
      write({
        jsonrpc: '2.0',
        method: 'session/update',
        params: {
          sessionId: message.params.sessionId,
          update: {
            sessionUpdate: 'agent_message_chunk',
            content: { type: 'text', text: echoText },
          },
        },
      });
      write({ jsonrpc: '2.0', id: message.id, result: { stopReason: 'end_turn' } });
      continue;
    }
  }
});
