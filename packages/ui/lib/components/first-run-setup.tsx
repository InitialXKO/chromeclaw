import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './ui';
import { customModelsStorage } from '@extension/storage';
import { useT } from '@extension/i18n';
import { KeyIcon, Loader2Icon, RocketIcon, SettingsIcon } from 'lucide-react';
import { nanoid } from 'nanoid';
import { useCallback, useState } from 'react';

type FirstRunSetupProps = {
  onComplete: () => void;
};

const providers = [
  { value: 'openai', label: 'OpenAI', defaultModel: 'gpt-4o', defaultBase: '' },
  {
    value: 'anthropic',
    label: 'Anthropic',
    defaultModel: 'claude-sonnet-4-5-20250929',
    defaultBase: '',
  },
  { value: 'google', label: 'Google', defaultModel: 'gemini-2.0-flash', defaultBase: '' },
  {
    value: 'openrouter',
    label: 'OpenRouter',
    defaultModel: 'openai/gpt-4o',
    defaultBase: 'https://openrouter.ai/api/v1',
  },
  { value: 'custom', label: 'OpenAI Compatible', defaultModel: '', defaultBase: '' },
];

const FirstRunSetup = ({ onComplete }: FirstRunSetupProps) => {
  const t = useT();
  const [provider, setProvider] = useState('openai');
  const [apiKey, setApiKey] = useState('');
  const [modelId, setModelId] = useState('gpt-4o');
  const [baseUrl, setBaseUrl] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleProviderChange = useCallback((value: string) => {
    setProvider(value);
    const p = providers.find(p => p.value === value);
    if (p) {
      setModelId(p.defaultModel);
      setBaseUrl(p.defaultBase);
    }
    setError('');
  }, []);

  const handleStartChatting = useCallback(async () => {
    if (!apiKey.trim() && !baseUrl.trim()) {
      setError(t('firstRun_apiKeyRequired'));
      return;
    }
    if (!modelId.trim()) {
      setError(t('firstRun_modelIdRequired'));
      return;
    }

    setSaving(true);
    setError('');

    try {
      const p = providers.find(p => p.value === provider);
      await customModelsStorage.set([
        {
          id: nanoid(),
          modelId,
          name: p?.label ? `${p.label} ${modelId}` : modelId,
          provider,
          routingMode: 'direct',
          apiKey: apiKey || undefined,
          baseUrl: baseUrl || undefined,
          supportsTools: true,
          supportsReasoning: true,
        },
      ]);
      onComplete();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('firstRun_saveFailed'));
    } finally {
      setSaving(false);
    }
  }, [apiKey, modelId, provider, baseUrl, onComplete]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !saving) {
        handleStartChatting();
      }
    },
    [handleStartChatting, saving],
  );

  return (
    <div className="bg-background flex h-dvh items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle className="flex items-center justify-center gap-2 text-xl">
            <RocketIcon className="size-5" />
            {t('firstRun_welcome')}
          </CardTitle>
          <CardDescription>{t('firstRun_addApiKey')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {error && (
            <div className="bg-destructive/10 text-destructive rounded-md px-3 py-2 text-sm">
              {error}
            </div>
          )}

          <div className="grid gap-2">
            <Label htmlFor="setup-provider">{t('firstRun_provider')}</Label>
            <Select onValueChange={handleProviderChange} value={provider}>
              <SelectTrigger id="setup-provider">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {providers.map(p => (
                  <SelectItem key={p.value} value={p.value}>
                    {p.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="setup-apikey">{baseUrl ? t('firstRun_apiKeyOptional') : t('firstRun_apiKey')}</Label>
            <div className="relative">
              <KeyIcon className="text-muted-foreground absolute left-3 top-1/2 size-4 -translate-y-1/2" />
              <Input
                className="pl-9"
                data-testid="setup-api-key"
                id="setup-apikey"
                onChange={e => {
                  setApiKey(e.target.value);
                  setError('');
                }}
                onKeyDown={handleKeyDown}
                placeholder="sk-..."
                type="password"
                value={apiKey}
              />
            </div>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="setup-model">{t('firstRun_modelId')}</Label>
            <Input
              data-testid="setup-model-id"
              id="setup-model"
              onChange={e => {
                setModelId(e.target.value);
                setError('');
              }}
              onKeyDown={handleKeyDown}
              placeholder="gpt-4o"
              value={modelId}
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="setup-baseurl">{t('firstRun_baseUrl')}</Label>
            <Input
              data-testid="setup-base-url"
              id="setup-baseurl"
              onChange={e => {
                setBaseUrl(e.target.value);
                setError('');
              }}
              onKeyDown={handleKeyDown}
              placeholder="https://api.example.com/v1"
              type="url"
              value={baseUrl}
            />
            <p className="text-muted-foreground text-xs">
              {t('firstRun_baseUrlHint')}
            </p>
          </div>

          <Button
            className="w-full"
            data-testid="setup-start-button"
            disabled={saving}
            onClick={handleStartChatting}>
            {saving && <Loader2Icon className="mr-2 size-4 animate-spin" />}
            {t('firstRun_startChatting')}
          </Button>

          <div className="flex items-center justify-between pt-2">
            <button
              className="text-muted-foreground hover:text-foreground flex items-center gap-1 text-xs"
              onClick={() => chrome.runtime.openOptionsPage()}
              type="button">
              <SettingsIcon className="size-3" />
              {t('firstRun_advancedSetup')}
            </button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export { FirstRunSetup };
export type { FirstRunSetupProps };
