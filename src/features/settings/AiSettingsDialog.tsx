import { Button, Input, Select, Switch } from 'antd';
import { useEffect, useState } from 'react';
import type { AiSettings } from '../../domain/model';
import { AppDialog } from '../../components/AppDialog';
import { AiClientError } from '../../ai/client';
import { getAiErrorMessage } from '../../ai/error-messages';
import {
  AI_PROVIDERS,
  applyAiProvider,
  aiProviderIdFromBaseUrl,
  type AiProviderId,
} from '../../ai/providers';

export interface AiSettingsDialogProps {
  open: boolean;
  initial?: AiSettings;
  onClose: () => void;
  onSave: (settings: AiSettings) => Promise<void>;
  onClearKey: () => Promise<void>;
  onTestConnection: (settings: AiSettings) => Promise<void>;
}

const empty: AiSettings = {
  baseUrl: '',
  apiKey: '',
  tavilyApiKey: '',
  searchProvider: 'tavily',
  searxngBaseUrl: '',
  model: '',
  thinkingEnabled: false,
};

function withProvider(settings: AiSettings, providerId = aiProviderIdFromBaseUrl(settings.baseUrl)): AiSettings {
  return applyAiProvider(settings, providerId);
}

export function AiSettingsDialog({ open, initial = empty, onClose, onSave, onClearKey, onTestConnection }: AiSettingsDialogProps) {
  const [settings, setSettings] = useState<AiSettings>(() => withProvider(initial));
  const [providerId, setProviderId] = useState<AiProviderId>(() => aiProviderIdFromBaseUrl(initial.baseUrl));
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) {
      const nextProviderId = aiProviderIdFromBaseUrl(initial.baseUrl);
      setProviderId(nextProviderId);
      setSettings(withProvider(initial, nextProviderId));
      setStatus('');
    }
  }, [open, initial]);
  const update = (key: 'apiKey' | 'tavilyApiKey' | 'model') => (event: React.ChangeEvent<HTMLInputElement>) => setSettings((current) => ({ ...current, [key]: event.target.value }));
  const provider = AI_PROVIDERS.find((item) => item.id === providerId) ?? AI_PROVIDERS[0];
  const run = async (operation: () => Promise<void>, success: string) => {
    setBusy(true); setStatus('');
    try { await operation(); setStatus(success); }
    catch (error) {
      const message = error instanceof AiClientError ? getAiErrorMessage(error.kind) : '操作失败，请检查配置后重试';
      setStatus(message);
    } finally { setBusy(false); }
  };
  return <AppDialog open={open} title="AI 设置" onClose={onClose}>
    <form className="settings-form" onSubmit={(event) => { event.preventDefault(); void run(() => onSave(settings), '设置已保存'); }}>
      <p className="settings-notice">DeepSeek 与 Tavily API Key 仅保存在当前浏览器的本地 IndexedDB 中，请勿在共享设备使用。</p>
      <label htmlFor="ai-provider">模型厂商</label>
      <Select
        id="ai-provider"
        aria-label="模型厂商"
        value={providerId}
        options={AI_PROVIDERS.map((item) => ({ value: item.id, label: item.label }))}
        onChange={(nextProviderId: AiProviderId) => {
          setProviderId(nextProviderId);
          setSettings((current) => applyAiProvider(current, nextProviderId));
        }}
      />
      <p className="settings-notice">接口地址：{provider.baseUrl}</p>
      <label htmlFor="ai-api-key">API Key</label>
      <Input.Password id="ai-api-key" value={settings.apiKey} onChange={update('apiKey')} autoComplete="off" required />
      <label htmlFor="tavily-api-key">Tavily API Key</label>
      <Input.Password id="tavily-api-key" value={settings.tavilyApiKey} onChange={update('tavilyApiKey')} autoComplete="off" />
      <label htmlFor="search-provider">搜索提供商</label>
      <Select id="search-provider" aria-label="搜索提供商" value={settings.searchProvider ?? 'tavily'} options={[{ value: 'tavily', label: 'Tavily' }, { value: 'searxng', label: 'SearXNG' }]} onChange={(searchProvider: NonNullable<AiSettings['searchProvider']>) => setSettings((current) => ({ ...current, searchProvider }))} />
      {settings.searchProvider === 'searxng' && <>
        <label htmlFor="searxng-base-url">SearXNG 地址</label>
        <Input id="searxng-base-url" value={settings.searxngBaseUrl} onChange={(event) => setSettings((current) => ({ ...current, searxngBaseUrl: event.target.value }))} placeholder="http://localhost:8080" />
      </>}
      <label htmlFor="ai-model">模型</label>
      <Input id="ai-model" value={settings.model} onChange={update('model')} placeholder="deepseek-flash" required />
      <div className="settings-toggle-row">
        <label htmlFor="ai-thinking-enabled">思考模式</label>
        <Switch
          id="ai-thinking-enabled"
          aria-label="思考模式"
          checked={settings.thinkingEnabled}
          onChange={(thinkingEnabled) => setSettings((current) => ({
            ...current,
            thinkingEnabled,
          }))}
        />
      </div>
      <div className="settings-actions">
        <Button aria-label="保存" type="primary" htmlType="submit" loading={busy}>保存</Button>
        <Button aria-label="清除 Key" type="default" disabled={busy} onClick={() => void run(async () => { await onClearKey(); setSettings((current) => ({ ...current, apiKey: '' })); }, 'API Key 已清除')}>清除 Key</Button>
        <Button aria-label="测试连接" disabled={busy} onClick={() => void run(() => onTestConnection(settings), '连接测试成功')}>测试连接</Button>
        <Button aria-label="关闭" onClick={onClose}>关闭</Button>
      </div>
      <div className="settings-status" role="status" aria-live="polite">{status}</div>
    </form>
  </AppDialog>;
}
