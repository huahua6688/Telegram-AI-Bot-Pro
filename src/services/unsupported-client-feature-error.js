export class UnsupportedClientFeatureError extends Error {
  constructor(provider, feature) {
    super(`当前 AI 提供商 ${provider} 暂不支持 ${feature}。请切换到支持该能力的平台。`);
    this.name = 'UnsupportedClientFeatureError';
  }
}
