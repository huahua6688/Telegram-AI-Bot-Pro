import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { AgentWorkerClient } from '../src/services/agent-worker-client.js';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function reservePort() {
  const server = net.createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = server.address().port;
  server.close();
  await once(server, 'close');
  return port;
}

async function waitForHealth(url, child, output) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (child.exitCode != null) throw new Error(`worker exited early: ${output.join('')}`);
    try {
      const response = await fetch(`${url}/health`);
      if (response.ok) return;
    } catch {
      // Worker is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`worker did not become healthy: ${output.join('')}`);
}

test('Agent Worker signs requests, isolates Docker, hides GitHub tokens and rejects traversal', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'telegram-agent-worker-'));
  const bin = path.join(root, 'bin');
  const workspaces = path.join(root, 'workspaces');
  const dockerLog = path.join(root, 'docker.log');
  await fs.mkdir(bin, { recursive: true });
  const fakeDocker = path.join(bin, 'docker');
  await fs.writeFile(fakeDocker, `#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(process.env.DOCKER_LOG, JSON.stringify(args) + '\\n');
const mount = args.find((value) => value.endsWith(':/workspace:rw'));
if (args.includes('clone') && mount) {
  const target = mount.slice(0, -':/workspace:rw'.length);
  fs.mkdirSync(target, { recursive: true });
  fs.writeFileSync(require('node:path').join(target, 'README.md'), '# cloned\\n');
}
process.stdout.write('sandbox-ok');
`, { mode: 0o700 });

  const port = await reservePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const secret = 'worker-secret-with-at-least-32-characters';
  const token = 'github-token-that-must-never-reach-docker-args';
  const output = [];
  const child = spawn(process.execPath, ['agent-worker/server.js'], {
    cwd: repositoryRoot,
    env: {
      ...process.env,
      PORT: String(port),
      AGENT_WORKER_SECRET: secret,
      WORKSPACE_ROOT: workspaces,
      WORKSPACE_HOST_ROOT: workspaces,
      SANDBOX_IMAGE: 'node:22-alpine',
      SANDBOX_ALLOWED_IMAGES: 'node:22-alpine',
      PATH: `${bin}:${process.env.PATH}`,
      DOCKER_LOG: dockerLog
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  child.stdout.on('data', (chunk) => output.push(chunk.toString()));
  child.stderr.on('data', (chunk) => output.push(chunk.toString()));
  t.after(async () => {
    if (child.exitCode == null) child.kill('SIGTERM');
    if (child.exitCode == null) await once(child, 'close');
    await fs.rm(root, { recursive: true, force: true });
  });

  await waitForHealth(baseUrl, child, output);
  const client = new AgentWorkerClient({ baseUrl, secret, timeoutMs: 5000 });
  const taskId = '12345678-1234-4123-8123-123456789abc';

  const unsigned = await fetch(`${baseUrl}/v1/cleanup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ taskId })
  });
  assert.equal(unsigned.status, 401);

  const prepared = await client.prepareRepository({
    taskId,
    repository: 'owner/repository',
    ref: 'ai/task-test',
    token,
    installDependencies: false
  });
  assert.equal(prepared.ok, true);
  assert.equal(await fs.readFile(path.join(workspaces, taskId, 'README.md'), 'utf8'), '# cloned\n');

  await client.writeFiles({ taskId, files: { 'src/new.js': 'console.log("ok");\n' } });
  assert.equal(await fs.readFile(path.join(workspaces, taskId, 'src/new.js'), 'utf8'), 'console.log("ok");\n');
  await assert.rejects(
    client.writeFiles({ taskId, files: { '../escape.txt': 'no' } }),
    /INVALID_FILE_PATH/
  );

  const run = await client.run({ taskId, command: ['node', '--version'] });
  assert.equal(run.ok, true);
  assert.equal(run.stdout, 'sandbox-ok');
  const dockerCalls = await fs.readFile(dockerLog, 'utf8');
  assert.equal(dockerCalls.includes(token), false);
  assert.equal(dockerCalls.includes(Buffer.from(`x-access-token:${token}`).toString('base64')), false);
  assert.match(dockerCalls, /"--network","none"/);
  assert.match(dockerCalls, /"--read-only"/);
  assert.match(dockerCalls, /"--cap-drop","ALL"/);
  assert.match(dockerCalls, /"no-new-privileges"/);
  assert.match(dockerCalls, /"--ulimit","nofile=256:256"/);

  await assert.rejects(
    client.run({ taskId, command: ['sh', '-c', 'echo unsafe'] }),
    /SHELL_COMMAND_DISABLED/
  );
  await assert.rejects(
    client.run({ taskId, command: ['node', 'bad\u0000argument'] }),
    /INVALID_COMMAND_ARGUMENT/
  );

  await client.cleanup({ taskId });
  await assert.rejects(fs.access(path.join(workspaces, taskId)));
});
