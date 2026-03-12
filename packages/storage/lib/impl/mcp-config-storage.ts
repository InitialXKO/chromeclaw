import { createStorage, StorageEnum } from '../base/index.js';

/** MCP server transport types */
type McpTransportType = 'streamable-http' | 'sse' | 'stdio';

/** MCP tool descriptor */
interface McpToolDescriptor {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

/** MCP server configuration */
interface McpServerConfig {
  id: string;
  name: string;
  type: McpTransportType;
  url: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  headers?: Record<string, string>;
  enabledTools: string[];
  tools: McpToolDescriptor[];
}

/** MCP tool policy configuration */
interface McpToolPolicy {
  maxRetries: number;
  timeoutMs: number;
  resultMaxChars: number;
  maxAutoRounds: number;
}

/** MCP configuration stored in Chrome storage */
interface McpConfig {
  servers: McpServerConfig[];
  toolPolicy: McpToolPolicy;
  updatedAt: number;
}

const DEFAULT_TOOL_POLICY: McpToolPolicy = {
  maxRetries: 5,
  timeoutMs: 60 * 1000,
  resultMaxChars: 0,
  maxAutoRounds: 0,
};

const defaultMcpConfig: McpConfig = {
  servers: [],
  toolPolicy: { ...DEFAULT_TOOL_POLICY },
  updatedAt: 0,
};

const mcpConfigStorage = createStorage<McpConfig>('mcp-config', defaultMcpConfig, {
  storageEnum: StorageEnum.Local,
  liveUpdate: true,
});

/** Normalize MCP transport type */
const normalizeMcpTransport = (rawTransport: string, fallbackUrl = ''): McpTransportType => {
  const source = String(rawTransport ?? '').toLowerCase().trim();
  if (source === 'streamable-http' || source === 'streamable_http' || source === 'http') {
    return 'streamable-http';
  }
  if (source === 'sse') {
    return 'sse';
  }
  if (source === 'stdio') {
    return 'stdio';
  }
  const hintUrl = String(fallbackUrl ?? '').toLowerCase();
  if (hintUrl && /\/sse(?:$|[/?#])/i.test(hintUrl)) {
    return 'sse';
  }
  return 'streamable-http';
};

/** Normalize server configuration */
const normalizeServerConfig = (server: Partial<McpServerConfig>, index = 0): McpServerConfig => {
  const fallbackId = `server-${index + 1}`;
  const id = String(server?.id ?? '').trim() || fallbackId;
  const name = String(server?.name ?? '').trim() || id;
  const rawUrl = String(server?.url ?? '').trim();
  const url = (() => {
    try {
      const parsed = new URL(rawUrl);
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
        return parsed.href;
      }
    } catch {
      // invalid URL
    }
    return '';
  })();
  const command = String(server?.command ?? '').trim();
  const rawType = String(server?.type ?? '').trim();
  let type = normalizeMcpTransport(rawType, rawUrl);
  const args = Array.isArray(server?.args)
    ? server.args.map(a => String(a ?? '').trim()).filter(Boolean)
    : [];
  const env: Record<string, string> = {};
  if (server?.env && typeof server.env === 'object') {
    for (const [k, v] of Object.entries(server.env)) {
      const key = String(k ?? '').trim();
      const value = String(v ?? '').trim();
      if (key && value) env[key] = value;
    }
  }
  const cwd = String(server?.cwd ?? '').trim();
  const headers: Record<string, string> = {};
  if (server?.headers && typeof server.headers === 'object') {
    for (const [k, v] of Object.entries(server.headers)) {
      const key = String(k ?? '').trim();
      const value = String(v ?? '').trim();
      if (key && value) headers[key] = value;
    }
  }
  const enabledTools = Array.isArray(server?.enabledTools)
    ? [...new Set(server.enabledTools.map(t => String(t ?? '').trim()).filter(Boolean))]
    : [];
  const tools = Array.isArray(server?.tools)
    ? server.tools
        .filter(t => t && typeof t === 'object')
        .map(t => ({
          name: String((t as McpToolDescriptor).name ?? '').trim(),
          description: String((t as McpToolDescriptor).description ?? '').trim(),
          inputSchema:
            (t as McpToolDescriptor).inputSchema &&
            typeof (t as McpToolDescriptor).inputSchema === 'object'
              ? (t as McpToolDescriptor).inputSchema
              : {},
        }))
        .filter(t => t.name)
    : [];

  // Auto-detect stdio if command is provided without explicit type or URL
  if (!rawType && !url && command) {
    type = 'stdio';
  }

  return {
    id,
    name,
    type,
    url,
    command,
    args,
    env,
    cwd,
    headers,
    enabledTools,
    tools,
  };
};

/** Normalize tool policy */
const normalizeToolPolicy = (rawPolicy: Partial<McpToolPolicy>): McpToolPolicy => {
  const clampInt = (val: unknown, fallback: number, min: number, max: number): number => {
    const n = Number(val);
    if (!Number.isFinite(n)) return fallback;
    const int = Math.trunc(n);
    if (int < min) return min;
    if (int > max) return max;
    return int;
  };
  const source = rawPolicy && typeof rawPolicy === 'object' ? rawPolicy : {};
  return {
    maxRetries: clampInt(source.maxRetries, DEFAULT_TOOL_POLICY.maxRetries, 0, 20),
    timeoutMs: clampInt(source.timeoutMs, DEFAULT_TOOL_POLICY.timeoutMs, 5000, 10 * 60 * 1000),
    resultMaxChars: clampInt(
      source.resultMaxChars,
      DEFAULT_TOOL_POLICY.resultMaxChars,
      0,
      2 * 1000 * 1000,
    ),
    maxAutoRounds: clampInt(
      source.maxAutoRounds,
      DEFAULT_TOOL_POLICY.maxAutoRounds,
      0,
      1000,
    ),
  };
};

/** Normalize full MCP config */
const normalizeMcpConfig = (raw: Partial<McpConfig>): McpConfig => {
  const rawServers = Array.isArray(raw?.servers) ? raw.servers : [];
  const dedupedServers: McpServerConfig[] = [];
  const seenIds = new Set<string>();
  for (const s of rawServers) {
    const normalized = normalizeServerConfig(s as Partial<McpServerConfig>);
    if (!normalized.id || seenIds.has(normalized.id)) continue;
    seenIds.add(normalized.id);
    dedupedServers.push(normalized);
  }
  return {
    servers: dedupedServers,
    toolPolicy: normalizeToolPolicy(raw?.toolPolicy ?? {}),
    updatedAt: Number.isFinite(raw?.updatedAt) ? (raw?.updatedAt as number) : Date.now(),
  };
};

/** Wrapper with normalization */
const normalizedMcpConfigStorage = {
  get: async (): Promise<McpConfig> => {
    const stored = await mcpConfigStorage.get();
    return normalizeMcpConfig(stored);
  },
  set: async (value: McpConfig): Promise<void> => {
    const normalized = normalizeMcpConfig(value);
    await mcpConfigStorage.set(normalized);
  },
  getSnapshot: mcpConfigStorage.getSnapshot.bind(mcpConfigStorage),
  subscribe: mcpConfigStorage.subscribe.bind(mcpConfigStorage),
};

export type { McpConfig, McpServerConfig, McpToolDescriptor, McpToolPolicy, McpTransportType };
export { normalizedMcpConfigStorage as mcpConfigStorage, normalizeServerConfig, normalizeToolPolicy };
