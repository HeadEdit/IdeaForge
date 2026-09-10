import type { AiSettings } from '../domain/model';

export const AI_PROVIDERS = [
  {
    id: 'deepseek',
    label: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com',
  },
] as const;

export type AiProviderId = (typeof AI_PROVIDERS)[number]['id'];

export const DEFAULT_AI_PROVIDER_ID: AiProviderId = 'deepseek';

export function aiProviderById(id: string | undefined): (typeof AI_PROVIDERS)[number] {
  return AI_PROVIDERS.find((provider) => provider.id === id) ?? AI_PROVIDERS[0];
}

export function aiProviderIdFromBaseUrl(baseUrl: string): AiProviderId {
  const normalized = baseUrl.trim().replace(/\/+$/, '');
  const matched = AI_PROVIDERS.find((provider) => (
    normalized === provider.baseUrl || normalized === `${provider.baseUrl}/v1`
  ));
  return matched?.id ?? DEFAULT_AI_PROVIDER_ID;
}

export function applyAiProvider(settings: AiSettings, providerId: AiProviderId = DEFAULT_AI_PROVIDER_ID): AiSettings {
  return {
    ...settings,
    baseUrl: aiProviderById(providerId).baseUrl,
  };
}
