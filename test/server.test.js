import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../src/server.js';

function createTestServer() {
  return createServer({
    handlers: {
      echo_tool: async (args) => ({ args }),
    },
    serverInfo: {
      name: 'skills-sh-mcp',
      title: 'skills.sh MCP Server',
      version: '0.1.0',
    },
  });
}

test('server initialize negotiates protocol version', async () => {
  const server = createTestServer();
  const response = await server.handleMessage({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'test-client', version: '1.0.0' },
    },
  });

  assert.equal(response.result.protocolVersion, '2025-06-18');
  assert.equal(response.result.serverInfo.name, 'skills-sh-mcp');
});

test('server lists tools and dispatches tool calls', async () => {
  const server = createTestServer();

  const toolsResponse = await server.handleMessage({
    jsonrpc: '2.0',
    id: 2,
    method: 'tools/list',
    params: {},
  });
  assert.equal(Array.isArray(toolsResponse.result.tools), true);
  assert.ok(toolsResponse.result.tools.length >= 4);

  const callResponse = await server.handleMessage({
    jsonrpc: '2.0',
    id: 3,
    method: 'tools/call',
    params: {
      name: 'echo_tool',
      arguments: { hello: 'world' },
    },
  });

  assert.equal(callResponse.result.isError, false);
  assert.deepEqual(callResponse.result.structuredContent, { args: { hello: 'world' } });
});

test('server returns method-not-found for unknown tools', async () => {
  const server = createTestServer();
  const response = await server.handleMessage({
    jsonrpc: '2.0',
    id: 4,
    method: 'tools/call',
    params: {
      name: 'missing_tool',
      arguments: {},
    },
  });

  assert.equal(response.error.code, -32601);
});
