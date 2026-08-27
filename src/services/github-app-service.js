import crypto from 'node:crypto';
import { SecretVault } from './secret-vault.js';

function hashState(state) {
  return crypto.createHash('sha256').update(String(state)).digest('hex');
}

function safeRepository(value) {
  const repository = String(value || '');
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) throw new Error('INVALID_REPOSITORY');
  return repository;
}

function safeRepositoryPath(value) {
  const filePath = String(value || '').replaceAll('\\', '/');
  const parts = filePath.split('/');
  if (
    !filePath || filePath.length > 1000 || filePath.startsWith('/') ||
    /[\u0000-\u001f\u007f]/.test(filePath) ||
    parts.some((part) => !part || part === '.' || part === '..')
  ) {
    throw new Error('INVALID_REPOSITORY_PATH');
  }
  return parts.map(encodeURIComponent).join('/');
}

function safeGitRef(value) {
  const ref = String(value || '');
  if (!ref || ref.length > 240 || ref.startsWith('-') || /[\s~^:?*\[\\]/.test(ref) || ref.includes('..')) {
    throw new Error('INVALID_GIT_REF');
  }
  return ref;
}

async function githubFetch(path, { token = '', method = 'GET', body, headers = {}, timeoutMs = 15000 } = {}) {
  const response = await fetch(`https://api.github.com${path}`, {
    method,
    headers: {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'Telegram-AI-Bot-Pro',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...headers
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs)
  });
  const text = await response.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = { message: text }; }
  if (!response.ok) {
    const error = new Error(`GitHub request failed (${response.status}): ${String(data.message || text).slice(0, 300)}`);
    error.status = response.status;
    throw error;
  }
  return data;
}

export class GitHubAppService {
  constructor({ config, db, logger }) {
    this.config = config;
    this.db = db;
    this.logger = logger;
    this.vault = config.githubTokenEncryptionKey ? new SecretVault(config.githubTokenEncryptionKey) : null;
  }

  isConfigured() {
    return Boolean(this.config.publicBaseUrl && this.config.githubAppClientId && this.config.githubAppClientSecret && this.vault);
  }

  createAuthorizationUrl(userId) {
    if (!this.isConfigured()) throw new Error('GITHUB_APP_NOT_CONFIGURED');
    const state = crypto.randomBytes(32).toString('base64url');
    this.db.createOauthState({
      stateHash: hashState(state),
      userId,
      provider: 'github',
      expiresAt: new Date(Date.now() + 10 * 60_000).toISOString()
    });
    const callback = `${this.config.publicBaseUrl}${this.config.githubAppCallbackPath}`;
    const url = new URL('https://github.com/login/oauth/authorize');
    url.searchParams.set('client_id', this.config.githubAppClientId);
    url.searchParams.set('redirect_uri', callback);
    url.searchParams.set('state', state);
    return url.toString();
  }

  getInstallationUrl() {
    const slug = String(this.config.githubAppSlug || '').trim();
    return /^[A-Za-z0-9-]+$/.test(slug)
      ? `https://github.com/apps/${slug}/installations/new`
      : '';
  }

  async completeAuthorization({ code, state }) {
    if (!this.isConfigured()) throw new Error('GITHUB_APP_NOT_CONFIGURED');
    const oauth = this.db.consumeOauthState({ stateHash: hashState(state), provider: 'github' });
    if (!oauth) throw new Error('GITHUB_OAUTH_STATE_INVALID');
    const response = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'User-Agent': 'Telegram-AI-Bot-Pro' },
      body: JSON.stringify({ client_id: this.config.githubAppClientId, client_secret: this.config.githubAppClientSecret, code }),
      signal: AbortSignal.timeout(15000)
    });
    const tokenPayload = await response.json();
    if (!response.ok || !tokenPayload.access_token) throw new Error(`GitHub OAuth failed: ${tokenPayload.error_description || tokenPayload.error || response.status}`);
    const profile = await githubFetch('/user', { token: tokenPayload.access_token });
    return this.db.saveGithubConnection({
      userId: oauth.userId,
      githubUserId: profile.id,
      githubLogin: profile.login,
      tokenEncrypted: this.vault.encrypt(tokenPayload.access_token, `github:${oauth.userId}`),
      refreshTokenEncrypted: tokenPayload.refresh_token
        ? this.vault.encrypt(tokenPayload.refresh_token, `github-refresh:${oauth.userId}`)
        : '',
      scope: tokenPayload.scope || '',
      expiresAt: tokenPayload.expires_in
        ? new Date(Date.now() + Number(tokenPayload.expires_in) * 1000).toISOString()
        : ''
    });
  }

  getConnection(userId) {
    const row = this.db.getGithubConnection(userId);
    if (!row) return null;
    return { ...row, tokenEncrypted: undefined, refreshTokenEncrypted: undefined, connected: true };
  }

  async getToken(userId) {
    const row = this.db.getGithubConnection(userId);
    if (!row) throw new Error('GITHUB_NOT_CONNECTED');
    if (!row.expiresAt || Date.parse(row.expiresAt) > Date.now() + 60_000) {
      return this.vault.decrypt(row.tokenEncrypted, `github:${userId}`);
    }
    if (!row.refreshTokenEncrypted) throw new Error('GITHUB_AUTH_EXPIRED');
    const refreshToken = this.vault.decrypt(row.refreshTokenEncrypted, `github-refresh:${userId}`);
    const response = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'User-Agent': 'Telegram-AI-Bot-Pro' },
      body: JSON.stringify({ client_id: this.config.githubAppClientId, client_secret: this.config.githubAppClientSecret, grant_type: 'refresh_token', refresh_token: refreshToken }),
      signal: AbortSignal.timeout(15000)
    });
    const refreshed = await response.json();
    if (!response.ok || !refreshed.access_token) throw new Error(`GitHub token refresh failed: ${refreshed.error_description || refreshed.error || response.status}`);
    this.db.saveGithubConnection({
      ...row,
      tokenEncrypted: this.vault.encrypt(refreshed.access_token, `github:${userId}`),
      refreshTokenEncrypted: refreshed.refresh_token
        ? this.vault.encrypt(refreshed.refresh_token, `github-refresh:${userId}`)
        : row.refreshTokenEncrypted,
      expiresAt: refreshed.expires_in ? new Date(Date.now() + Number(refreshed.expires_in) * 1000).toISOString() : ''
    });
    return refreshed.access_token;
  }

  disconnect(userId) {
    return this.db.deleteGithubConnection(userId);
  }

  async listRepositories(userId) {
    const data = await githubFetch('/user/repos?per_page=100&sort=updated&affiliation=owner,collaborator,organization_member', { token: await this.getToken(userId) });
    return data.map((repo) => ({ fullName: repo.full_name, private: repo.private, defaultBranch: repo.default_branch, permissions: repo.permissions || {} }));
  }

  async getFile(userId, repository, filePath, ref = '') {
    const query = ref ? `?ref=${encodeURIComponent(safeGitRef(ref))}` : '';
    return githubFetch(`/repos/${safeRepository(repository)}/contents/${safeRepositoryPath(filePath)}${query}`, { token: await this.getToken(userId) });
  }

  async createBranch(userId, repository, branch, fromRef = 'heads/main') {
    const token = await this.getToken(userId);
    const resolvedRepository = safeRepository(repository);
    const resolvedBranch = safeGitRef(branch);
    const source = await githubFetch(`/repos/${resolvedRepository}/git/ref/${safeGitRef(fromRef)}`, { token });
    return githubFetch(`/repos/${resolvedRepository}/git/refs`, { token, method: 'POST', body: { ref: `refs/heads/${resolvedBranch}`, sha: source.object.sha } });
  }

  async putFile(userId, repository, filePath, { branch, message, content, sha = '' }) {
    return githubFetch(`/repos/${safeRepository(repository)}/contents/${safeRepositoryPath(filePath)}`, {
      token: await this.getToken(userId), method: 'PUT',
      body: { message, content: Buffer.from(String(content)).toString('base64'), branch: safeGitRef(branch), ...(sha ? { sha } : {}) }
    });
  }

  async createPullRequest(userId, repository, { title, body = '', head, base }) {
    return githubFetch(`/repos/${safeRepository(repository)}/pulls`, {
      token: await this.getToken(userId),
      method: 'POST',
      body: { title, body, head: safeGitRef(head), base: safeGitRef(base) }
    });
  }
}

export const githubAppInternals = { hashState, githubFetch, safeRepository, safeRepositoryPath, safeGitRef };
