/**
 * MCP (Model Context Protocol) configuration panel
 * Allows users to configure MCP servers and enable/disable tools
 */

import {
  mcpConfigStorage,
  type McpConfig,
  type McpServerConfig,
} from '@extension/storage';
import { useT } from '@extension/i18n';
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Separator,
  Switch,
  Textarea,
  Badge,
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@extension/ui';
import {
  ChevronDownIcon,
  ChevronRightIcon,
  PlugIcon,
  PlusIcon,
  RefreshCwIcon,
  ServerIcon,
  SettingsIcon,
  Trash2Icon,
  WrenchIcon,
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import type { McpToolDescriptor } from '@extension/storage';

type McpTransportType = 'streamable-http' | 'sse' | 'stdio';

interface ServerFormData {
  id: string;
  name: string;
  type: McpTransportType;
  url: string;
  command: string;
  args: string;
  env: string;
  cwd: string;
  headers: string;
}

const emptyServerForm: ServerFormData = {
  id: '',
  name: '',
  type: 'streamable-http',
  url: '',
  command: '',
  args: '',
  env: '',
  cwd: '',
  headers: '',
};

const parseKeyValuePairs = (input: string): Record<string, string> => {
  const result: Record<string, string> = {};
  if (!input.trim()) return result;
  const lines = input.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const colonIdx = trimmed.indexOf(':');
    const eqIdx = trimmed.indexOf('=');
    const sepIdx = colonIdx >= 0 && eqIdx >= 0
      ? Math.min(colonIdx, eqIdx)
      : Math.max(colonIdx, eqIdx);
    if (sepIdx > 0) {
      const key = trimmed.slice(0, sepIdx).trim();
      const value = trimmed.slice(sepIdx + 1).trim();
      if (key) result[key] = value;
    }
  }
  return result;
};

const formatKeyValuePairs = (obj: Record<string, string>): string => {
  return Object.entries(obj)
    .map(([k, v]) => `${k}: ${v}`)
    .join('\n');
};

const McpConfigPanel = () => {
  const t = useT();
  const [config, setConfig] = useState<McpConfig | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editForm, setEditForm] = useState<ServerFormData>(emptyServerForm);
  const [editingServerId, setEditingServerId] = useState<string | null>(null);
  const [expandedServers, setExpandedServers] = useState<Set<string>>(new Set());
  const [discovering, setDiscovering] = useState<Set<string>>(new Set());

  // Load config on mount
  useEffect(() => {
    mcpConfigStorage.get().then(c => {
      setConfig(c);
      setIsLoading(false);
    });
    const unsub = mcpConfigStorage.subscribe(() => {
      mcpConfigStorage.get().then(setConfig);
    });
    return unsub;
  }, []);

  const handleOpenAdd = useCallback(() => {
    setEditingServerId(null);
    setEditForm(emptyServerForm);
    setDialogOpen(true);
  }, []);

  const handleOpenEdit = useCallback((server: McpServerConfig) => {
    setEditingServerId(server.id);
    setEditForm({
      id: server.id,
      name: server.name,
      type: server.type,
      url: server.url || '',
      command: server.command || '',
      args: server.args?.join('\n') || '',
      env: formatKeyValuePairs(server.env || {}),
      cwd: server.cwd || '',
      headers: formatKeyValuePairs(server.headers || {}),
    });
    setDialogOpen(true);
  }, []);

  const handleFormChange = useCallback(<K extends keyof ServerFormData>(
    key: K,
    value: ServerFormData[K]
  ) => {
    setEditForm(prev => ({ ...prev, [key]: value }));
  }, []);

  const handleSave = useCallback(async () => {
    if (!editForm.name.trim()) return;
    if (!config) return;

    const serverId = editingServerId || `server-${Date.now()}`;
    const args = editForm.args
      .split('\n')
      .map(a => a.trim())
      .filter(Boolean);

    const newServer: McpServerConfig = {
      id: serverId,
      name: editForm.name.trim(),
      type: editForm.type,
      url: editForm.url.trim(),
      command: editForm.command.trim() || undefined,
      args: args.length > 0 ? args : undefined,
      env: parseKeyValuePairs(editForm.env),
      cwd: editForm.cwd.trim() || undefined,
      headers: parseKeyValuePairs(editForm.headers),
      enabledTools: editingServerId
        ? (config.servers.find(s => s.id === serverId)?.enabledTools ?? [])
        : [],
      tools: editingServerId
        ? (config.servers.find(s => s.id === serverId)?.tools ?? [])
        : [],
    };

    const updatedServers = editingServerId
      ? config.servers.map(s => (s.id === serverId ? newServer : s))
      : [...config.servers, newServer];

    const updated: McpConfig = {
      ...config,
      servers: updatedServers,
      updatedAt: Date.now(),
    };

    await mcpConfigStorage.set(updated);
    setConfig(updated);
    setDialogOpen(false);
  }, [config, editForm, editingServerId]);

  const handleDelete = useCallback(async (serverId: string) => {
    if (!config) return;
    const updated: McpConfig = {
      ...config,
      servers: config.servers.filter(s => s.id !== serverId),
      updatedAt: Date.now(),
    };
    await mcpConfigStorage.set(updated);
    setConfig(updated);
  }, [config]);

  const toggleServerExpanded = useCallback((serverId: string) => {
    setExpandedServers(prev => {
      const next = new Set(prev);
      if (next.has(serverId)) {
        next.delete(serverId);
      } else {
        next.add(serverId);
      }
      return next;
    });
  }, []);

  const handleToggleTool = useCallback(async (serverId: string, toolName: string, enabled: boolean) => {
    if (!config) return;
    const updated: McpConfig = {
      ...config,
      servers: config.servers.map(s => {
        if (s.id !== serverId) return s;
        const enabledTools = enabled
          ? [...s.enabledTools, toolName]
          : s.enabledTools.filter(t => t !== toolName);
        return { ...s, enabledTools: [...new Set(enabledTools)] };
      }),
      updatedAt: Date.now(),
    };
    await mcpConfigStorage.set(updated);
    setConfig(updated);
  }, [config]);

  const handleDiscoverTools = useCallback(async (server: McpServerConfig) => {
    if (!config) return;
    setDiscovering(prev => new Set(prev).add(server.id));

    try {
      // Send message to background to discover tools
      const response = await chrome.runtime.sendMessage({
        type: 'MCP_DISCOVER_TOOLS',
        serverId: server.id,
      });

      if (response?.ok && response.tools) {
        const updated: McpConfig = {
          ...config,
          servers: config.servers.map(s => {
            if (s.id !== server.id) return s;
            return {
              ...s,
              tools: response.tools as McpToolDescriptor[],
            };
          }),
          updatedAt: Date.now(),
        };
        await mcpConfigStorage.set(updated);
        setConfig(updated);
      }
    } catch (error) {
      console.error('Failed to discover tools:', error);
    } finally {
      setDiscovering(prev => {
        const next = new Set(prev);
        next.delete(server.id);
        return next;
      });
    }
  }, [config]);

  const handlePolicyChange = useCallback(async (key: keyof McpConfig['toolPolicy'], value: number) => {
    if (!config) return;
    const updated: McpConfig = {
      ...config,
      toolPolicy: { ...config.toolPolicy, [key]: value },
      updatedAt: Date.now(),
    };
    await mcpConfigStorage.set(updated);
    setConfig(updated);
  }, [config]);

  if (isLoading || !config) {
    return (
      <div className="flex h-40 items-center justify-center">
        <RefreshCwIcon className="text-muted-foreground size-6 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">MCP Servers</h2>
          <p className="text-muted-foreground text-sm">
            Configure Model Context Protocol servers to extend tool capabilities
          </p>
        </div>
        <Button onClick={handleOpenAdd} size="sm">
          <PlusIcon className="mr-1 size-4" />
          Add Server
        </Button>
      </div>

      {/* Server list */}
      <div className="space-y-3">
        {config.servers.length === 0 ? (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-8 text-center">
              <ServerIcon className="text-muted-foreground/50 mb-3 size-12" />
              <p className="text-muted-foreground">No MCP servers configured</p>
              <p className="text-muted-foreground mt-1 text-sm">
                Add a server to enable MCP tools
              </p>
            </CardContent>
          </Card>
        ) : (
          config.servers.map(server => (
            <Card key={server.id}>
              <Collapsible
                open={expandedServers.has(server.id)}
                onOpenChange={() => toggleServerExpanded(server.id)}>
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      <CollapsibleTrigger asChild>
                        <button className="flex items-center gap-2 hover:opacity-70">
                          {expandedServers.has(server.id) ? (
                            <ChevronDownIcon className="size-4" />
                          ) : (
                            <ChevronRightIcon className="size-4" />
                          )}
                          <PlugIcon className="size-5" />
                          <div className="text-left">
                            <CardTitle className="text-base">{server.name}</CardTitle>
                            <CardDescription className="text-xs">
                              {server.type} • {server.url || server.command || 'No endpoint'}
                            </CardDescription>
                          </div>
                        </button>
                      </CollapsibleTrigger>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleDiscoverTools(server)}
                        disabled={discovering.has(server.id)}>
                        <RefreshCwIcon className={`size-4 ${discovering.has(server.id) ? 'animate-spin' : ''}`} />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleOpenEdit(server)}>
                        <SettingsIcon className="size-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleDelete(server.id)}>
                        <Trash2Icon className="size-4" />
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CollapsibleContent>
                  <CardContent className="pt-0">
                    <Separator className="mb-4" />
                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <h4 className="text-sm font-medium flex items-center gap-2">
                          <WrenchIcon className="size-4" />
                          Available Tools
                          {server.tools.length > 0 && (
                            <Badge variant="secondary">{server.tools.length}</Badge>
                          )}
                        </h4>
                        {server.tools.length === 0 && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleDiscoverTools(server)}
                            disabled={discovering.has(server.id)}>
                            <RefreshCwIcon className={`mr-1 size-3 ${discovering.has(server.id) ? 'animate-spin' : ''}`} />
                            Discover
                          </Button>
                        )}
                      </div>
                      {server.tools.length === 0 ? (
                        <p className="text-muted-foreground py-4 text-center text-sm">
                          No tools discovered yet. Click Discover to fetch available tools.
                        </p>
                      ) : (
                        <div className="grid gap-2">
                          {server.tools.map(tool => {
                            const isEnabled = server.enabledTools.includes(tool.name);
                            return (
                              <div
                                key={tool.name}
                                className="flex items-center justify-between rounded-md border p-3">
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2">
                                    <span className="font-medium text-sm">{tool.name}</span>
                                    {isEnabled && (
                                      <Badge variant="default" className="text-[10px] px-1.5 py-0">Enabled</Badge>
                                    )}
                                  </div>
                                  {tool.description && (
                                    <p className="text-muted-foreground mt-0.5 truncate text-xs">
                                      {tool.description}
                                    </p>
                                  )}
                                </div>
                                <Switch
                                  checked={isEnabled}
                                  onCheckedChange={(checked) =>
                                    handleToggleTool(server.id, tool.name, checked)
                                  }
                                />
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </CardContent>
                </CollapsibleContent>
              </Collapsible>
            </Card>
          ))
        )}
      </div>

      {/* Tool Policy */}
      {config.servers.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <SettingsIcon className="size-4" />
              Tool Policy
            </CardTitle>
            <CardDescription>
              Configure global settings for MCP tool execution
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="max-retries">Max Retries</Label>
                <Input
                  id="max-retries"
                  type="number"
                  min={0}
                  max={20}
                  value={config.toolPolicy.maxRetries}
                  onChange={(e) => handlePolicyChange('maxRetries', parseInt(e.target.value, 10) || 0)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="timeout">Timeout (ms)</Label>
                <Input
                  id="timeout"
                  type="number"
                  min={5000}
                  max={600000}
                  step={1000}
                  value={config.toolPolicy.timeoutMs}
                  onChange={(e) => handlePolicyChange('timeoutMs', parseInt(e.target.value, 10) || 60000)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="max-chars">Max Result Chars (0 = unlimited)</Label>
                <Input
                  id="max-chars"
                  type="number"
                  min={0}
                  max={2000000}
                  value={config.toolPolicy.resultMaxChars}
                  onChange={(e) => handlePolicyChange('resultMaxChars', parseInt(e.target.value, 10) || 0)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="max-rounds">Max Auto Rounds (0 = unlimited)</Label>
                <Input
                  id="max-rounds"
                  type="number"
                  min={0}
                  max={1000}
                  value={config.toolPolicy.maxAutoRounds}
                  onChange={(e) => handlePolicyChange('maxAutoRounds', parseInt(e.target.value, 10) || 0)}
                />
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Add/Edit Server Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editingServerId ? 'Edit Server' : 'Add MCP Server'}</DialogTitle>
            <DialogDescription>
              Configure a Model Context Protocol server endpoint
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="server-name">Name</Label>
              <Input
                id="server-name"
                placeholder="My MCP Server"
                value={editForm.name}
                onChange={(e) => handleFormChange('name', e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="server-type">Transport Type</Label>
              <Select
                value={editForm.type}
                onValueChange={(v) => handleFormChange('type', v as McpTransportType)}>
                <SelectTrigger id="server-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="streamable-http">Streamable HTTP</SelectItem>
                  <SelectItem value="sse">Server-Sent Events (SSE)</SelectItem>
                  <SelectItem value="stdio">Stdio (Command)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {editForm.type !== 'stdio' ? (
              <div className="space-y-2">
                <Label htmlFor="server-url">URL</Label>
                <Input
                  id="server-url"
                  placeholder="https://example.com/mcp"
                  value={editForm.url}
                  onChange={(e) => handleFormChange('url', e.target.value)}
                />
              </div>
            ) : (
              <>
                <div className="space-y-2">
                  <Label htmlFor="server-command">Command</Label>
                  <Input
                    id="server-command"
                    placeholder="npx"
                    value={editForm.command}
                    onChange={(e) => handleFormChange('command', e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="server-args">
                    Arguments (one per line)
                  </Label>
                  <Textarea
                    id="server-args"
                    placeholder={`-y\n@modelcontextprotocol/server-filesystem\n/home/user/docs`}
                    value={editForm.args}
                    onChange={(e) => handleFormChange('args', e.target.value)}
                    rows={3}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="server-cwd">Working Directory</Label>
                  <Input
                    id="server-cwd"
                    placeholder="/home/user"
                    value={editForm.cwd}
                    onChange={(e) => handleFormChange('cwd', e.target.value)}
                  />
                </div>
              </>
            )}
            {editForm.type !== 'stdio' && (
              <div className="space-y-2">
                <Label htmlFor="server-headers">
                  Headers (one per line, format: Key: Value)
                </Label>
                <Textarea
                  id="server-headers"
                  placeholder={`Authorization: Bearer token\nX-Custom-Header: value`}
                  value={editForm.headers}
                  onChange={(e) => handleFormChange('headers', e.target.value)}
                  rows={3}
                />
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="server-env">
                Environment Variables (one per line, format: KEY=value)
              </Label>
              <Textarea
                id="server-env"
                placeholder={`API_KEY=secret\nDEBUG=true`}
                value={editForm.env}
                onChange={(e) => handleFormChange('env', e.target.value)}
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={!editForm.name.trim()}>
              {editingServerId ? 'Save Changes' : 'Add Server'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export { McpConfigPanel };
