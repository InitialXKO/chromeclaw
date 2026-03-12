/**
 * Converts extension ChatModel to pi-mono Model<Api>,
 * along with resolved apiKey and headers for streaming.
 */

import { getModelContextLimit } from '@extension/shared';
import type { Api, Model } from '@mariozechner/pi-ai';
import type { ChatModel } from '@extension/shared';

interface ResolvedModel {
  model: Model<Api>;
  apiKey?: string;
}

const DEFAULT_BASE_URLS: Record<string, string> = {
  openai: 'https://api.openai.com/v1',
  anthropic: 'https://api.anthropic.com',
  google: 'https://generativelanguage.googleapis.com',
  openrouter: 'https://openrouter.ai/api/v1',
  cursor: 'https://api.cursor.com/v1',
};

export const chatModelToPiModel = (config: ChatModel): ResolvedModel => {
  let api: Api;
  let baseUrl: string;
  let provider: string;
  const apiKey = config.apiKey || undefined;

  switch (config.provider) {
    case 'openai':
      api = 'openai-completions';
      baseUrl = config.baseUrl || DEFAULT_BASE_URLS.openai;
      provider = 'openai';
      break;
    case 'anthropic':
      api = 'anthropic-messages';
      baseUrl = DEFAULT_BASE_URLS.anthropic;
      provider = 'anthropic';
      break;
    case 'google':
      api = 'google-generative-ai';
      baseUrl = DEFAULT_BASE_URLS.google;
      provider = 'google';
      break;
    case 'openrouter':
      api = 'openai-completions';
      baseUrl = DEFAULT_BASE_URLS.openrouter;
      provider = 'openrouter';
      break;
    case 'cursor':
      api = 'openai-completions';
      baseUrl = config.baseUrl || DEFAULT_BASE_URLS.cursor;
      provider = 'openai';
      break;
    case 'custom':
      api = 'openai-completions';
      baseUrl = config.baseUrl || DEFAULT_BASE_URLS.openai;
      provider = 'openai';
      break;
    case 'local':
      api = 'openai-completions'; // placeholder — not actually used for local
      baseUrl = '';
      provider = 'local';
      break;
    default:
      api = 'openai-completions';
      baseUrl = config.baseUrl || DEFAULT_BASE_URLS.openai;
      provider = config.provider;
  }

  // Resolve OpenAI-compatible API: explicit field > auto-detect > provider default
  if (config.api) {
    api = config.api;
  } else if (api === 'openai-completions' && config.provider === 'openai') {
    const id = config.id.toLowerCase();
    if (id.includes('codex')) {
      api = 'openai-codex-responses';
    } else if (/^(gpt-5|o[3-9]($|[^1-9])|o\d{2,})/.test(id)) {
      api = 'openai-responses';
    }
  }

  // Priority: explicit override > local default > table lookup
  const contextWindow = config.contextWindow
    ?? (config.provider === 'local' ? 4096 : getModelContextLimit(config.id));

  return {
    model: {
      id: config.id,
      name: config.name,
      api,
      provider,
      baseUrl,
      reasoning: config.supportsReasoning ?? false,
      input: ['text', 'image'],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow,
      maxTokens: Math.floor(contextWindow * 0.25),
    },
    apiKey,
  };
};

export type { ResolvedModel };
