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

function validateProperty(schema, value, key) {
  const errors = [];
  if (!schema || typeof schema !== 'object') return errors;

  if (schema.type === 'string') {
    if (typeof value !== 'string') {
      errors.push(`property "${key}" must be a string`);
      return errors;
    }
    if (typeof schema.minLength === 'number' && value.length < schema.minLength) {
      errors.push(`property "${key}" must be at least ${schema.minLength} characters long`);
    }
    return errors;
  }

  if (schema.type === 'integer') {
    if (!Number.isInteger(value)) {
      errors.push(`property "${key}" must be an integer`);
      return errors;
    }
    if (typeof schema.minimum === 'number' && value < schema.minimum) {
      errors.push(`property "${key}" must be >= ${schema.minimum}`);
    }
    if (typeof schema.maximum === 'number' && value > schema.maximum) {
      errors.push(`property "${key}" must be <= ${schema.maximum}`);
    }
    return errors;
  }

  if (schema.type === 'boolean') {
    if (typeof value !== 'boolean') {
      errors.push(`property "${key}" must be a boolean`);
    }
  }

  return errors;
}

function validateToolArguments(schema, args) {
  const errors = [];
  if (!schema || typeof schema !== 'object') return errors;

  if (schema.type === 'object') {
    if (!args || typeof args !== 'object' || Array.isArray(args)) {
      return ['arguments must be an object'];
    }

    const properties = schema.properties || {};
    const required = Array.isArray(schema.required) ? schema.required : [];

    for (const key of required) {
      if (!Object.prototype.hasOwnProperty.call(args, key)) {
        errors.push(`missing required property "${key}"`);
      }
    }

    if (schema.additionalProperties === false) {
      for (const key of Object.keys(args)) {
        if (!Object.prototype.hasOwnProperty.call(properties, key)) {
          errors.push(`unexpected property "${key}"`);
        }
      }
    }

    for (const [key, propertySchema] of Object.entries(properties)) {
      if (!Object.prototype.hasOwnProperty.call(args, key)) continue;
      errors.push(...validateProperty(propertySchema, args[key], key));
    }

    if (Array.isArray(schema.anyOf) && schema.anyOf.length > 0) {
      const matched = schema.anyOf.some((variant) => {
        const variantRequired = Array.isArray(variant?.required) ? variant.required : [];
        return variantRequired.every((key) => Object.prototype.hasOwnProperty.call(args, key));
      });

      if (!matched) {
        errors.push('arguments do not satisfy anyOf required-property rules');
      }
    }
  }

  return errors;
}

function hasMissingRequiredProperty(validationErrors, propertyName) {
  const expected = `missing required property "${propertyName}"`;
  return validationErrors.some((item) => item === expected);
}

function validationHintForTool(toolName, validationErrors) {
  if (toolName === 'search_skills' && hasMissingRequiredProperty(validationErrors, 'query')) {
    return (
      'Hint: search_skills expects a top-level "query" argument. ' +
      'When called via lazy-mcp invoke_command, pass it as parameters.query.'
    );
  }

  return '';
}

export function createServer(options) {
  const handlers = options.handlers;
  const toolDefinitions = Array.isArray(options.toolDefinitions)
    ? options.toolDefinitions
    : TOOL_DEFINITIONS;
  const toolSchemas = new Map(
    toolDefinitions
      .filter((definition) => definition && typeof definition.name === 'string')
      .map((definition) => [definition.name, definition.inputSchema])
  );
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
      return jsonRpcResponse(id, { tools: toolDefinitions });
    }

    if (method === 'tools/call') {
      const toolName = params.name;
      const handler = handlers[toolName];
      if (!handler) {
        return jsonRpcError(id, -32601, `Unknown tool: ${toolName}`);
      }

      const args = params.arguments || {};
      const schema = toolSchemas.get(toolName);
      if (schema) {
        const validationErrors = validateToolArguments(schema, args);
        if (validationErrors.length > 0) {
          const hint = validationHintForTool(toolName, validationErrors);
          const errorMessage =
            hint.length > 0
              ? `Invalid arguments for ${toolName}: ${validationErrors.join('; ')}. ${hint}`
              : `Invalid arguments for ${toolName}: ${validationErrors.join('; ')}`;

          return jsonRpcResponse(
            id,
            encodeToolResult(
              {
                error: errorMessage,
              },
              true
            )
          );
        }
      }

      try {
        const result = await handler(args);
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
