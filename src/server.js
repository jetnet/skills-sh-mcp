import readline from 'node:readline';
import { logDebug } from './util.js';
import { SERVER_NAME, SERVER_TITLE, VERSION } from './version.js';
import { TOOL_DEFINITIONS } from './tools.js';

const SUPPORTED_PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];

function jsonRpcResponse(id, result) {
  return { jsonrpc: '2.0', id, result };
}

function jsonRpcError(id, code, message, data) {
  const error = { code, message };
  if (data !== undefined) error.data = data;
  return { jsonrpc: '2.0', id: id ?? null, error };
}

function chooseProtocolVersion(requested) {
  if (SUPPORTED_PROTOCOL_VERSIONS.includes(requested)) {
    return requested;
  }
  return SUPPORTED_PROTOCOL_VERSIONS[0];
}

function encodeToolResult(payload, isError = false) {
  if (typeof payload === 'string') {
    return {
      content: [{ type: 'text', text: payload }],
      isError,
    };
  }

  return {
    content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }],
    structuredContent: payload,
    isError,
  };
}

export function createServer(options) {
  const handlers = options.handlers;
  const serverInfo = options.serverInfo || {
    name: SERVER_NAME,
    title: SERVER_TITLE,
    version: VERSION,
  };

  let initialized = false;

  async function handleRequest(message) {
    const id = message.id;
    const method = message.method;
    const params = message.params || {};

    if (method === 'initialize') {
      const protocolVersion = chooseProtocolVersion(params.protocolVersion);
      return jsonRpcResponse(id, {
        protocolVersion,
        capabilities: {
          tools: {
            listChanged: false,
          },
          resources: {
            listChanged: false,
          },
          prompts: {
            listChanged: false,
          },
        },
        serverInfo,
        instructions:
          'Use search_skills to rank candidate skills. load_skill will only auto-load a query-based result when the match is high confidence; otherwise it returns candidates for explicit selection.',
      });
    }

    if (method === 'notifications/initialized') {
      initialized = true;
      return null;
    }

    if (method === 'ping') {
      return jsonRpcResponse(id, {});
    }

    if (method === 'resources/list') {
      return jsonRpcResponse(id, { resources: [] });
    }

    if (method === 'prompts/list') {
      return jsonRpcResponse(id, { prompts: [] });
    }

    if (method === 'logging/setLevel') {
      return jsonRpcResponse(id, {});
    }

    if (method === 'tools/list') {
      return jsonRpcResponse(id, { tools: TOOL_DEFINITIONS });
    }

    if (method === 'tools/call') {
      const toolName = params.name;
      const handler = handlers[toolName];
      if (!handler) {
        return jsonRpcError(id, -32601, `Unknown tool: ${toolName}`);
      }

      try {
        const result = await handler(params.arguments || {});
        return jsonRpcResponse(id, encodeToolResult(result, false));
      } catch (error) {
        const messageText = error instanceof Error ? error.message : String(error);
        return jsonRpcResponse(
          id,
          encodeToolResult(
            {
              error: messageText,
            },
            true
          )
        );
      }
    }

    if (!initialized && method !== 'initialize') {
      logDebug('Request before initialized notification:', method);
    }

    return jsonRpcError(id, -32601, `Method not found: ${method}`);
  }

  async function handleMessage(message) {
    if (!message || typeof message !== 'object') {
      return jsonRpcError(null, -32600, 'Invalid Request');
    }

    if (message.jsonrpc !== '2.0') {
      return jsonRpcError(message.id ?? null, -32600, 'Invalid Request', {
        reason: 'jsonrpc must be 2.0',
      });
    }

    if (typeof message.method !== 'string') {
      return jsonRpcError(message.id ?? null, -32600, 'Invalid Request', {
        reason: 'method must be a string',
      });
    }

    const isNotification = message.id === undefined;
    const response = await handleRequest(message);
    return isNotification ? null : response;
  }

  return {
    handleMessage,
  };
}

export async function runStdioServer(server) {
  const rl = readline.createInterface({
    input: process.stdin,
    crlfDelay: Infinity,
  });

  let chain = Promise.resolve();

  async function processLine(line) {
    const trimmed = line.trim();
    if (!trimmed) return;

    let message;
    try {
      message = JSON.parse(trimmed);
    } catch (error) {
      const response = jsonRpcError(null, -32700, 'Parse error', {
        detail: error instanceof Error ? error.message : String(error),
      });
      process.stdout.write(`${JSON.stringify(response)}\n`);
      return;
    }

    const response = await server.handleMessage(message);
    if (response) {
      process.stdout.write(`${JSON.stringify(response)}\n`);
    }
  }

  rl.on('line', (line) => {
    chain = chain.then(() => processLine(line)).catch((error) => {
      logDebug('Unhandled server error', error instanceof Error ? error.message : String(error));
    });
  });

  await new Promise((resolve) => {
    rl.on('close', () => {
      resolve();
    });
  });
}
