import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';

const port = Math.max(1, Number(process.env.PORT || 8080));
const secret = String(process.env.AGENT_WORKER_SECRET || '');
const sandboxImage = String(process.env.SANDBOX_IMAGE || 'node:22-alpine');
const gitImage = String(process.env.SANDBOX_GIT_IMAGE || 'alpine/git:v2.47.2');
const workspaceRoot = path.resolve(process.env.WORKSPACE_ROOT || '/workspaces');
const workspaceHostRoot = path.resolve(process.env.WORKSPACE_HOST_ROOT || workspaceRoot);
const allowedImages = new Set(
  String(process.env.SANDBOX_ALLOWED_IMAGES || 'node:22-alpine,python:3.13-alpine')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
);
const allowedCommands = new Set(
  String(process.env.SANDBOX_ALLOWED_COMMANDS || 'node,npm,npx,python,python3,pytest,sh')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
);
const maxBodyBytes = Math.max(64 * 1024, Number(process.env.WORKER_MAX_BODY_BYTES || 4 * 1024 * 1024));
const maxWorkspaceBytes = Math.max(10 * 1024 * 1024, Number(process.env.SANDBOX_MAX_WORKSPACE_BYTES || 512 * 1024 * 1024));
const maxConcurrentRuns = Math.max(1, Math.min(16, Number(process.env.SANDBOX_MAX_CONCURRENT_RUNS || 2)));
const runTimeoutMs = Math.max(10_000, Number(process.env.SANDBOX_RUN_TIMEOUT_MS || 120_000));
const prepareTimeoutMs = Math.max(30_000, Number(process.env.SANDBOX_PREPARE_TIMEOUT_MS || 300_000));
const activeTasks = new Set();
let activeRuns = 0;

function reply(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}

async function readBody(req) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > maxBodyBytes) throw new Error('REQUEST_TOO_LARGE');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function validSignature(req, body) {
  if (secret.length < 32) return false;
  const timestamp = String(req.headers['x-agent-timestamp'] || '');
  if (!/^\d+$/.test(timestamp) || Math.abs(Date.now() - Number(timestamp)) > 5 * 60_000) return false;
  const expected = crypto.createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
  const supplied = String(req.headers['x-agent-signature'] || '');
  return supplied.length === expected.length && crypto.timingSafeEqual(Buffer.from(supplied), Buffer.from(expected));
}

function safeTaskId(value) {
  const taskId = String(value || '');
  if (!/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(taskId)) throw new Error('INVALID_TASK_ID');
  return taskId;
}

function safeRepository(value) {
  const repository = String(value || '');
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) throw new Error('INVALID_REPOSITORY');
  return repository;
}

function safeGitRef(value) {
  const ref = String(value || '');
  if (!ref || ref.length > 240 || ref.startsWith('-') || /[\s~^:?*\[\\]/.test(ref) || ref.includes('..')) {
    throw new Error('INVALID_GIT_REF');
  }
  return ref;
}

function safeRelativePath(value) {
  const normalized = path.posix.normalize(String(value || '').replaceAll('\\', '/'));
  if (!normalized || normalized === '.' || normalized.startsWith('../') || normalized.startsWith('/') || normalized.includes('/../')) {
    throw new Error('INVALID_FILE_PATH');
  }
  return normalized;
}

function workspacePaths(taskId) {
  const safeId = safeTaskId(taskId);
  return {
    containerPath: path.join(workspaceRoot, safeId),
    hostPath: path.join(workspaceHostRoot, safeId)
  };
}

async function assertSafeFileTarget(root, relative) {
  const parts = safeRelativePath(relative).split('/');
  let current = root;
  for (const part of parts) {
    current = path.join(current, part);
    try {
      const stat = await fs.lstat(current);
      if (stat.isSymbolicLink()) throw new Error('SYMLINK_FILE_PATH_NOT_ALLOWED');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
  return current;
}

async function writeFiles(root, filesObject = {}) {
  const files = Object.entries(filesObject || {});
  if (files.length > 200) throw new Error('TOO_MANY_FILES');
  let totalBytes = 0;
  for (const [name, content] of files) {
    const value = String(content);
    totalBytes += Buffer.byteLength(value);
    if (totalBytes > maxBodyBytes) throw new Error('FILES_TOO_LARGE');
    const target = await assertSafeFileTarget(root, name);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, value, { encoding: 'utf8', mode: 0o600 });
  }
  return files.length;
}

async function directorySize(root) {
  let total = 0;
  const pending = [root];
  while (pending.length > 0) {
    const current = pending.pop();
    for (const entry of await fs.readdir(current, { withFileTypes: true })) {
      const target = path.join(current, entry.name);
      if (entry.isDirectory()) pending.push(target);
      else if (entry.isFile()) total += (await fs.stat(target)).size;
      if (total > maxWorkspaceBytes) return total;
    }
  }
  return total;
}

function scrubOutput(text, secrets = []) {
  let result = String(text || '');
  for (const value of secrets.filter(Boolean)) result = result.split(String(value)).join('[redacted]');
  return result.slice(-200_000);
}

async function spawnDocker(args, { timeoutMs = runTimeoutMs, secrets = [] } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn('docker', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout = (stdout + chunk.toString('utf8')).slice(-200_000); });
    child.stderr.on('data', (chunk) => { stderr = (stderr + chunk.toString('utf8')).slice(-200_000); });
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.once('error', reject);
    child.once('close', (code, signal) => {
      clearTimeout(timer);
      resolve({
        exitCode: Number.isInteger(code) ? code : -1,
        signal: signal || '',
        stdout: scrubOutput(stdout, secrets),
        stderr: scrubOutput(stderr, secrets)
      });
    });
  });
}

function baseDockerArgs({ network = 'none', memory = '512m', cpus = '1', pids = '128' } = {}) {
  return [
    'run', '--rm', '--network', network, '--read-only', '--cap-drop', 'ALL',
    '--security-opt', 'no-new-privileges', '--memory', memory, '--cpus', cpus, '--pids-limit', pids,
    '--tmpfs', '/tmp:rw,noexec,nosuid,size=128m'
  ];
}

async function prepareRepository(payload) {
  const taskId = safeTaskId(payload.taskId);
  const repository = safeRepository(payload.repository);
  const ref = safeGitRef(payload.ref);
  const token = String(payload.token || '');
  if (token.length < 16) throw new Error('GITHUB_TOKEN_REQUIRED');
  const paths = workspacePaths(taskId);
  await fs.rm(paths.containerPath, { recursive: true, force: true });
  await fs.mkdir(paths.containerPath, { recursive: true, mode: 0o700 });
  const basic = Buffer.from(`x-access-token:${token}`).toString('base64');
  const authName = `.git-auth-${taskId}-${crypto.randomBytes(8).toString('hex')}`;
  const authContainerPath = path.join(workspaceRoot, authName);
  const authHostPath = path.join(workspaceHostRoot, authName);
  await fs.writeFile(
    authContainerPath,
    `[http "https://github.com/"]\n\textraHeader = AUTHORIZATION: basic ${basic}\n`,
    { encoding: 'utf8', mode: 0o600 }
  );
  let clone;
  try {
    clone = await spawnDocker([
      ...baseDockerArgs({ network: 'bridge' }),
      '-v', `${paths.hostPath}:/workspace:rw`,
      '-v', `${authHostPath}:/root/.gitconfig:ro`,
      gitImage, 'clone', '--depth', '1', '--branch', ref, '--single-branch',
      `https://github.com/${repository}.git`, '/workspace'
    ], { timeoutMs: prepareTimeoutMs, secrets: [token, basic] });
  } finally {
    await fs.rm(authContainerPath, { force: true });
  }
  if (clone.exitCode !== 0) {
    await fs.rm(paths.containerPath, { recursive: true, force: true });
    throw new Error(`GIT_CLONE_FAILED:${clone.stderr || clone.stdout || clone.exitCode}`);
  }
  const sizeBytes = await directorySize(paths.containerPath);
  if (sizeBytes > maxWorkspaceBytes) {
    await fs.rm(paths.containerPath, { recursive: true, force: true });
    throw new Error('WORKSPACE_TOO_LARGE');
  }
  let install = { skipped: true, reason: 'not_requested' };
  if (payload.installDependencies !== false) {
    try {
      await fs.access(path.join(paths.containerPath, 'package-lock.json'));
      install = await spawnDocker([
        ...baseDockerArgs({ network: 'bridge', memory: '1g', pids: '256' }),
        '-v', `${paths.hostPath}:/workspace:rw`, '-w', '/workspace', sandboxImage,
        'npm', 'ci', '--ignore-scripts', '--no-audit', '--no-fund'
      ], { timeoutMs: prepareTimeoutMs });
      install.skipped = false;
      if (install.exitCode !== 0) throw new Error(`DEPENDENCY_INSTALL_FAILED:${install.stderr || install.stdout}`);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      install = { skipped: true, reason: 'no_package_lock' };
    }
  }
  return { ok: true, taskId, repository, ref, sizeBytes, install };
}

async function runInWorkspace(payload) {
  const taskId = safeTaskId(payload.taskId);
  const command = payload.command;
  if (!Array.isArray(command) || command.length === 0 || command.length > 32) throw new Error('INVALID_COMMAND');
  const executable = path.posix.basename(String(command[0] || ''));
  if (!allowedCommands.has(executable)) throw new Error('COMMAND_NOT_ALLOWED');
  if (!allowedImages.has(sandboxImage)) throw new Error('IMAGE_NOT_ALLOWED');
  const paths = workspacePaths(taskId);
  await fs.access(paths.containerPath);
  await writeFiles(paths.containerPath, payload.files || {});
  return spawnDocker([
    ...baseDockerArgs(),
    '-v', `${paths.hostPath}:/workspace:rw`, '-w', '/workspace', sandboxImage,
    ...command.map(String)
  ]);
}

async function handleRequest(req, res) {
  if (req.method === 'GET' && req.url === '/health') return reply(res, 200, { ok: true, activeRuns });
  if (req.method !== 'POST' || !['/v1/prepare', '/v1/files', '/v1/run', '/v1/cleanup'].includes(req.url)) {
    return reply(res, 404, { error: 'NOT_FOUND' });
  }
  const rawBody = await readBody(req);
  if (!validSignature(req, rawBody)) return reply(res, 401, { error: 'INVALID_SIGNATURE' });
  const payload = JSON.parse(rawBody);
  const taskId = safeTaskId(payload.taskId);
  if (activeRuns >= maxConcurrentRuns || activeTasks.has(taskId)) return reply(res, 429, { error: 'WORKER_BUSY' });
  activeRuns += 1;
  activeTasks.add(taskId);
  try {
    if (req.url === '/v1/prepare') return reply(res, 200, await prepareRepository(payload));
    if (req.url === '/v1/files') {
      const paths = workspacePaths(taskId);
      await fs.access(paths.containerPath);
      return reply(res, 200, { ok: true, written: await writeFiles(paths.containerPath, payload.files || {}) });
    }
    if (req.url === '/v1/run') return reply(res, 200, { ok: true, ...(await runInWorkspace(payload)) });
    const paths = workspacePaths(taskId);
    await fs.rm(paths.containerPath, { recursive: true, force: true });
    return reply(res, 200, { ok: true, removed: true });
  } finally {
    activeRuns = Math.max(0, activeRuns - 1);
    activeTasks.delete(taskId);
  }
}

if (workspaceRoot === path.parse(workspaceRoot).root || workspaceHostRoot === path.parse(workspaceHostRoot).root) {
  throw new Error('WORKSPACE_ROOT_MUST_NOT_BE_FILESYSTEM_ROOT');
}
await fs.mkdir(workspaceRoot, { recursive: true, mode: 0o700 });

const server = http.createServer((req, res) => {
  handleRequest(req, res).catch((error) => reply(res, 400, { error: String(error.message || error) }));
});

server.listen(port, '0.0.0.0', () => console.log(`Agent worker listening on :${port}`));
