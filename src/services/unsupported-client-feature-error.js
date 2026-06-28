export class UnsupportedClientFeatureError extends Error {
  constructor(provider, feature) {
    super(`当前 AI 提供商 ${provider} 暂不支持 ${feature}。请切换到 openai-compatible 提供商。`);
    this.name = 'UnsupportedClientFeatureError';
  }
}
