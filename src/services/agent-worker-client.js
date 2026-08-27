import crypto from 'node:crypto';

export class AgentWorkerClient {
  constructor({ baseUrl = '', secret = '', timeoutMs = 120000 } = {}) {
    this.baseUrl = String(baseUrl || '').replace(/\/$/, '');
    this.secret = String(secret || '');
    this.timeoutMs = timeoutMs;
  }

  isConfigured() {
    return Boolean(this.baseUrl && this.secret.length >= 32);
  }

  async request(path, payload, { signal } = {}) {
    if (!this.isConfigured()) throw new Error('AGENT_WORKER_NOT_CONFIGURED');
    const timestamp = String(Date.now());
    const body = JSON.stringify(payload);
    const signature = crypto.createHmac('sha256', this.secret).update(`${timestamp}.${body}`).digest('hex');
    const timeoutSignal = AbortSignal.timeout(this.timeoutMs);
    const requestSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
    const response = await fetch(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Agent-Timestamp': timestamp, 'X-Agent-Signature': signature },
      body,
      signal: requestSignal
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(`Agent worker failed (${response.status}): ${result.error || 'unknown error'}`);
    return result;
  }

  prepareRepository(payload, options) {
    return this.request('/v1/prepare', payload, options);
  }

  writeFiles(payload, options) {
    return this.request('/v1/files', payload, options);
  }

  run(payload, options) {
    return this.request('/v1/run', payload, options);
  }

  cleanup(payload, options) {
    return this.request('/v1/cleanup', payload, options);
  }
}
