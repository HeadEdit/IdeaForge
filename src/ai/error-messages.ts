import type { AiErrorKind } from './client';

const messages: Record<AiErrorKind, string> = {
  'search-unavailable': '联网搜索失败，请检查搜索服务、规划模型与 SearXNG 配置，或稍后重试',
  'search-no-results': '未检索到可用来源，请调整问题后重试',
  auth: 'API Key 无效或无权访问该模型',
  'network-or-cors': '网络或跨域请求失败，请检查 API 地址和 CORS 配置',
  'rate-limit': '请求过于频繁，请稍后重试',
  server: 'AI 服务暂时不可用，请稍后重试',
  'invalid-response': 'AI 服务返回了无效响应',
  unsupported: '联网搜索未配置 Tavily API Key，或当前服务不支持联网搜索',
  stopped: '已停止请求',
};

export function getAiErrorMessage(kind: AiErrorKind): string {
  return messages[kind];
}
