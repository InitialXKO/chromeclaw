/**
 * MCP (Model Context Protocol) tool integration
 * Enables connecting to MCP servers and executing tools via the MCP SDK.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { Type } from '@sinclair/typebox';
import { createLogger } from '../logging/logger-buffer.js';
import type { McpConfig, McpServerConfig } from '@extension/storage';

const mcpLog = createLogger('mcp');

/** Connection pool for MCP clients */
const connectionPool = new Map<string, { client: Client; transport: unknown; lastUsed: number }>();

const CONNECTION_IDLE_TTL_MS = 5 * 60 * 1000; // 5 minutes

/** Tool result with content blocks */
interface McpToolResult {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}

/** Light-weight JSON schema validator for MCP tool inputs */
const validateBySchema = (
  input: unknown,
  schema: Record<string, unknown>,
  path = '$',
  depth = 0,
): { valid: boolean; errorMessage: string } => {
  const MAX_DEPTH = 8;
  if (!schema || typeof schema !== 'object') {
    return { valid: true, errorMessage: '' };
  }
  if (depth > MAX_DEPTH) {
    return { valid: true, errorMessage: '' };
  }

  const buildPath = (base: string, segment: string | number) => {
    if (!base) return String(segment);
    if (typeof segment === 'number') return `${base}[${segment}]`;
    return `${base}.${segment}`;
  };

  const validatePrimitive = (value: unknown, type: string): boolean => {
    if (type === 'string') return typeof value === 'string';
    if (type === 'number') return typeof value === 'number' && Number.isFinite(value);
    if (type === 'integer') return Number.isInteger(value);
    if (type === 'boolean') return typeof value === 'boolean';
    if (type === 'null') return value === null;
    if (type === 'array') return Array.isArray(value);
    if (type === 'object') return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
    return true;
  };

  // Handle anyOf
  if (Array.isArray(schema.anyOf) && schema.anyOf.length > 0) {
    for (const subSchema of schema.anyOf) {
      const subResult = validateBySchema(input, subSchema as Record<string, unknown>, path, depth + 1);
      if (subResult.valid) return { valid: true, errorMessage: '' };
    }
    return { valid: false, errorMessage: `${path} does not match any schema in anyOf` };
  }

  // Handle oneOf
  if (Array.isArray(schema.oneOf) && schema.oneOf.length > 0) {
    let passCount = 0;
    for (const subSchema of schema.oneOf) {
      const subResult = validateBySchema(input, subSchema as Record<string, unknown>, path, depth + 1);
      if (subResult.valid) passCount += 1;
      if (passCount > 1) break;
    }
    if (passCount !== 1) {
      return { valid: false, errorMessage: `${path} must match exactly one schema in oneOf` };
    }
    return { valid: true, errorMessage: '' };
  }

  // Type validation
  const typeList = Array.isArray(schema.type)
    ? (schema.type as string[]).filter(t => typeof t === 'string')
    : typeof schema.type === 'string'
      ? [schema.type]
      : [];

  if (typeList.length > 0) {
    const matched = typeList.some(t => validatePrimitive(input, t));
    if (!matched) {
      return {
        valid: false,
        errorMessage: `${path} type mismatch, expected ${typeList.join(' | ')}`,
      };
    }
  }

  // Object validation
  if (
    (typeList.includes('object') || (!schema.type && schema.properties)) &&
    input &&
    typeof input === 'object' &&
    !Array.isArray(input)
  ) {
    const objValue = input as Record<string, unknown>;
    const requiredFields = Array.isArray(schema.required) ? (schema.required as string[]) : [];
    for (const fieldName of requiredFields) {
      if (!(fieldName in objValue)) {
        return { valid: false, errorMessage: `${buildPath(path, fieldName)} is required` };
      }
    }

    if (schema.properties && typeof schema.properties === 'object') {
      for (const [fieldName, fieldSchema] of Object.entries(schema.properties)) {
        if (!(fieldName in objValue)) continue;
        const childResult = validateBySchema(
          objValue[fieldName],
          fieldSchema as Record<string, unknown>,
          buildPath(path, fieldName),
          depth + 1,
        );
        if (!childResult.valid) return childResult;
      }
    }
  }

  // Array validation
  if (
    (typeList.includes('array') || (!schema.type && schema.items)) &&
    Array.isArray(input) &&
    schema.items &&
    typeof schema.items === 'object'
  ) {
    for (let i = 0; i < input.length; i += 1) {
      const childResult = validateBySchema(
        input[i],
        schema.items as Record<string, unknown>,
        buildPath(path, i),
        depth + 1,
      );
      if (!childResult.valid) return childResult;
    }
  }

  return { valid: true, errorMessage: '' };
};

/** Build MCP client transport based on server configuration */
const buildTransport = (server: McpServerConfig) => {
  const headers: Record<string, string> = {};
  if (server.headers && typeof server.headers === 'object') {
    for (const [k, v] of Object.entries(server.headers)) {
      const key = String(k ?? '').trim();
      const value = String(v ?? '').trim();
      if (key && value) headers[key] = value;
    }
  }

  if (server.type === 'stdio') {
    throw new Error('stdio transport type is not supported in browser extension');
  }

  if (!server.url) {
    throw new Error(`Invalid URL for MCP server: ${server.id}`);
  }

  if (server.type === 'sse') {
    return new SSEClientTransport(new URL(server.url), {
      requestInit: { headers },
      eventSourceInit: { headers },
    });
  }

  // Default to streamable-http
  return new StreamableHTTPClientTransport(new URL(server.url), {
    requestInit: { headers },
  });
};

/** Get or create MCP client connection */
const getOrCreateConnection = async (server: McpServerConfig) => {
  const poolKey = server.id;
  const existing = connectionPool.get(poolKey);

  if (existing) {
    existing.lastUsed = Date.now();
    return existing;
  }

  mcpLog.info(`Creating new MCP connection for server: ${server.id}`);

  const transport = buildTransport(server);
  const client = new Client({ name: 'chromeclaw', version: '1.0.0' });

  await client.connect(transport);

  const connection = { client, transport, lastUsed: Date.now() };
  connectionPool.set(poolKey, connection);

  return connection;
};

/** Close idle connections */
const sweepIdleConnections = () => {
  const now = Date.now();
  for (const [key, conn] of connectionPool.entries()) {
    if (now - conn.lastUsed > CONNECTION_IDLE_TTL_MS) {
      mcpLog.info(`Closing idle MCP connection: ${key}`);
      conn.client.close().catch(() => {
        // ignore close errors
      });
      connectionPool.delete(key);
    }
  }
};

// Start connection sweeper
setInterval(sweepIdleConnections, 45 * 1000);

/** List available tools from an MCP server */
const listTools = async (server: McpServerConfig) => {
  try {
    const { client } = await getOrCreateConnection(server);
    const toolsResult = await client.listTools();
    return toolsResult.tools || [];
  } catch (error) {
    mcpLog.error(`Failed to list tools from server ${server.id}:`, error);
    throw error;
  }
};

/** Execute an MCP tool */
const executeTool = async (
  server: McpServerConfig,
  toolName: string,
  args: Record<string, unknown>,
): Promise<McpToolResult> => {
  try {
    // Validate input against schema if available
    const toolDef = server.tools.find(t => t.name === toolName);
    if (toolDef?.inputSchema && typeof toolDef.inputSchema === 'object') {
      const validation = validateBySchema(args, toolDef.inputSchema);
      if (!validation.valid) {
        return {
          content: [{ type: 'text', text: `Validation error: ${validation.errorMessage}` }],
          isError: true,
        };
      }
    }

    const { client } = await getOrCreateConnection(server);

    mcpLog.info(`Executing MCP tool: ${toolName} on server: ${server.id}`);

    const result = await client.callTool({ name: toolName, arguments: args });

    // Convert result to content blocks
    const content: Array<{ type: 'text'; text: string }> = [];

    if (result.content && Array.isArray(result.content)) {
      for (const item of result.content) {
        if (typeof item === 'object' && item !== null) {
          if (item.type === 'text' && typeof item.text === 'string') {
            content.push({ type: 'text', text: item.text });
          } else {
            content.push({ type: 'text', text: JSON.stringify(item) });
          }
        } else if (typeof item === 'string') {
          content.push({ type: 'text', text: item });
        }
      }
    }

    // If no content extracted, stringify the whole result
    if (content.length === 0) {
      content.push({ type: 'text', text: JSON.stringify(result) });
    }

    return { content, isError: result.isError ?? false };
  } catch (error) {
    mcpLog.error(`Failed to execute MCP tool ${toolName} on server ${server.id}:`, error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      content: [{ type: 'text', text: `Error executing tool: ${errorMessage}` }],
      isError: true,
    };
  }
};

/** MCP tool call parameters */
interface McpToolCallParams {
  server: string;
  tool: string;
  args?: Record<string, unknown>;
}

/** MCP tool schema */
const mcpToolSchema = Type.Object({
  server: Type.String({ description: 'MCP server ID' }),
  tool: Type.String({ description: 'Tool name to execute' }),
  args: Type.Optional(Type.Object({}, { additionalProperties: true, description: 'Tool arguments' })),
});

/** Execute MCP tool wrapper */
const executeMcpTool = async (params: McpToolCallParams): Promise<McpToolResult> => {
  const { mcpConfigStorage } = await import('@extension/storage');
  const config = await mcpConfigStorage.get();

  const server = config.servers.find(s => s.id === params.server);
  if (!server) {
    return {
      content: [{ type: 'text', text: `MCP server not found: ${params.server}` }],
      isError: true,
    };
  }

  if (!server.enabledTools.includes(params.tool)) {
    return {
      content: [
        {
          type: 'text',
          text: `Tool "${params.tool}" is not enabled for server "${server.name}". Enabled tools: ${server.enabledTools.join(', ')}`,
        },
      ],
      isError: true,
    };
  }

  const args = params.args ?? {};

  // Apply result max chars limit if configured
  const result = await executeTool(server, params.tool, args);

  const resultMaxChars = config.toolPolicy?.resultMaxChars ?? 0;
  if (resultMaxChars > 0) {
    for (const block of result.content) {
      if (block.text.length > resultMaxChars) {
        block.text = block.text.slice(0, resultMaxChars) + '\n... (truncated)';
      }
    }
  }

  return result;
};

/** Discover tools from all configured MCP servers */
const discoverAllTools = async (config: McpConfig) => {
  const discovered: Record<string, { name: string; description: string; inputSchema: Record<string, unknown> }[]> = {};

  for (const server of config.servers) {
    try {
      const tools = await listTools(server);
      discovered[server.id] = tools.map(t => ({
        name: t.name,
        description: t.description || '',
        inputSchema: t.inputSchema || {},
      }));
    } catch (error) {
      mcpLog.error(`Failed to discover tools from server ${server.id}:`, error);
      discovered[server.id] = [];
    }
  }

  return discovered;
};

/** Close all MCP connections */
const closeAllConnections = async () => {
  for (const [key, conn] of connectionPool.entries()) {
    try {
      await conn.client.close();
    } catch {
      // ignore close errors
    }
    connectionPool.delete(key);
  }
};

export type { McpToolResult, McpToolCallParams };
export {
  mcpToolSchema,
  executeMcpTool,
  listTools,
  discoverAllTools,
  closeAllConnections,
  validateBySchema,
};
