import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..');

function read(relative) {
  return fs.readFileSync(path.join(root, relative), 'utf8');
}

function walk(relative) {
  const absolute = path.join(root, relative);
  return fs.readdirSync(absolute, { withFileTypes: true }).flatMap((entry) => {
    const child = path.join(relative, entry.name);
    return entry.isDirectory() ? walk(child) : [child];
  });
}

function assignedVariables(source) {
  return Array.from(source.matchAll(/^([A-Z][A-Z0-9_]*)=/gm), (match) => match[1]);
}

test('environment templates contain no duplicate assignments and document every listed variable', () => {
  const documentation = read('docs/ENVIRONMENT.md');

  for (const filename of ['.env.example', '.env.zeabur.example']) {
    const variables = assignedVariables(read(filename));
    const duplicates = variables.filter((name, index) => variables.indexOf(name) !== index);
    assert.deepEqual(duplicates, [], `${filename} contains duplicate variable assignments`);

    const undocumented = Array.from(new Set(variables)).filter((name) => !documentation.includes(name));
    assert.deepEqual(undocumented, [], `${filename} contains variables missing from docs/ENVIRONMENT.md`);
  }
});

test('the environment reference covers variables read directly by application, worker, and scripts', () => {
  const documentation = read('docs/ENVIRONMENT.md');
  const sourceFiles = ['src', 'agent-worker', 'scripts']
    .flatMap(walk)
    .filter((filename) => filename.endsWith('.js'));
  const variables = new Set();

  for (const filename of sourceFiles) {
    const source = read(filename);
    for (const match of source.matchAll(/process\.env\.([A-Z0-9_]+)/g)) variables.add(match[1]);
    for (const match of source.matchAll(/process\.env\[['"]([A-Z0-9_]+)['"]\]/g)) variables.add(match[1]);
  }

  const undocumented = Array.from(variables).sort().filter((name) => !documentation.includes(name));
  assert.deepEqual(undocumented, [], 'runtime variables are missing from docs/ENVIRONMENT.md');
});

test('both production templates include the required security and streaming settings', () => {
  const required = [
    'CHAT_ENCRYPTION_REQUIRED',
    'CHAT_ENCRYPTION_KEY',
    'LOG_PRIVACY_KEY',
    'ENABLE_NATIVE_DRAFT_STREAMING'
  ];

  for (const filename of ['.env.example', '.env.zeabur.example']) {
    const variables = new Set(assignedVariables(read(filename)));
    assert.deepEqual(required.filter((name) => !variables.has(name)), [], `${filename} is missing required settings`);
  }
});
