import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const packageJson = require('../../package.json');

const PROCESS_STARTED_AT = new Date(
  Date.now() - Math.max(0, Number(process.uptime()) || 0) * 1000
).toISOString();

function firstNonEmpty(...values) {
  return values
    .map((value) => String(value ?? '').trim())
    .find(Boolean) || '';
}

function normalizeDate(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return '';

  const numeric = Number(raw);
  const date = Number.isFinite(numeric) && /^\d+(?:\.\d+)?$/.test(raw)
    ? new Date(numeric < 10_000_000_000 ? numeric * 1000 : numeric)
    : new Date(raw);

  return Number.isNaN(date.getTime()) ? '' : date.toISOString();
}

function resolveGitDirectory(cwd, fsImpl) {
  const dotGit = path.resolve(cwd, '.git');
  const stat = fsImpl.statSync(dotGit);
  if (stat.isDirectory()) return dotGit;
  if (!stat.isFile()) return '';

  const pointer = fsImpl.readFileSync(dotGit, 'utf8').trim();
  const match = pointer.match(/^gitdir:\s*(.+)$/i);
  return match ? path.resolve(cwd, match[1].trim()) : '';
}

function readPackedRef(gitDirectory, refName, fsImpl) {
  const packedRefs = fsImpl.readFileSync(path.join(gitDirectory, 'packed-refs'), 'utf8');
  for (const line of packedRefs.split(/\r?\n/)) {
    if (!line || line.startsWith('#') || line.startsWith('^')) continue;
    const [revision, name] = line.trim().split(/\s+/, 2);
    if (name === refName) return revision || '';
  }
  return '';
}

export function readGitInfo({ cwd = process.cwd(), fsImpl = fs } = {}) {
  try {
    const gitDirectory = resolveGitDirectory(cwd, fsImpl);
    if (!gitDirectory) return { revision: '', branch: '' };

    const head = fsImpl.readFileSync(path.join(gitDirectory, 'HEAD'), 'utf8').trim();
    if (!head.startsWith('ref:')) {
      return { revision: head, branch: '' };
    }

    const refName = head.slice(4).trim();
    let revision = '';
    try {
      revision = fsImpl.readFileSync(path.join(gitDirectory, ...refName.split('/')), 'utf8').trim();
    } catch {
      revision = readPackedRef(gitDirectory, refName, fsImpl);
    }

    return {
      revision,
      branch: refName.startsWith('refs/heads/') ? refName.slice('refs/heads/'.length) : ''
    };
  } catch {
    return { revision: '', branch: '' };
  }
}

export function getBuildInfo({
  env = process.env,
  cwd = process.cwd(),
  fsImpl = fs,
  packageVersion = packageJson.version,
  nodeVersion = process.version,
  startedAt = PROCESS_STARTED_AT
} = {}) {
  const localGit = readGitInfo({ cwd, fsImpl });
  const revision = firstNonEmpty(
    env.GIT_COMMIT_SHA,
    env.ZEABUR_GIT_COMMIT_SHA,
    env.RAILWAY_GIT_COMMIT_SHA,
    env.RENDER_GIT_COMMIT,
    env.VERCEL_GIT_COMMIT_SHA,
    env.SOURCE_VERSION,
    env.SOURCE_COMMIT,
    env.COMMIT_SHA,
    localGit.revision
  );
  const deployedAt = normalizeDate(firstNonEmpty(
    env.APP_DEPLOYED_AT,
    env.DEPLOYED_AT,
    env.DEPLOY_TIME,
    env.BUILD_TIME,
    env.SOURCE_DATE_EPOCH
  ));

  return Object.freeze({
    version: firstNonEmpty(env.APP_VERSION, env.npm_package_version, packageVersion, 'unknown'),
    revision,
    shortRevision: revision ? revision.slice(0, 12) : '',
    branch: firstNonEmpty(
      env.GIT_BRANCH,
      env.ZEABUR_GIT_BRANCH,
      env.RAILWAY_GIT_BRANCH,
      env.RENDER_GIT_BRANCH,
      env.BRANCH,
      localGit.branch
    ),
    nodeVersion: firstNonEmpty(nodeVersion, 'unknown'),
    environment: firstNonEmpty(env.NODE_ENV, 'development'),
    deployedAt,
    startedAt: normalizeDate(startedAt) || String(startedAt || '')
  });
}

export { PROCESS_STARTED_AT };
