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
      write({
        jsonrpc: '2.0',
        method: 'session/update',
        params: {
          sessionId: message.params.sessionId,
          update: {
            sessionUpdate: 'agent_message_chunk',
            content: { type: 'text', text: `echo:${message.params.prompt[0].text}` },
          },
        },
      });
      write({ jsonrpc: '2.0', id: message.id, result: { stopReason: 'end_turn' } });
      continue;
    }
  }
});
