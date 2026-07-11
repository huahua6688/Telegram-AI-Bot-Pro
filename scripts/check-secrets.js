import { execFileSync } from 'node:child_process';

const forbidden = /(^\.env$|^\.env\.|^data\/|\.db$|\.sqlite$|\.sqlite3$|\.db-journal$|\.sqlite-journal$|\.sqlite3-journal$)/;
const allowed = /^\.env\.(example|zeabur\.example)$/;

const tracked = execFileSync('git', ['ls-files'], { encoding: 'utf8' })
  .split(/\r?\n/)
  .filter(Boolean);

const badFiles = tracked.filter((file) => forbidden.test(file) && !allowed.test(file));

if (badFiles.length > 0) {
  console.error('Found tracked local secret/data files:');
  for (const file of badFiles) console.error(file);
  console.error('');
  console.error('Remove them from Git tracking with:');
  console.error('git rm --cached <file>');
  process.exit(1);
}

console.log('No forbidden local secret/data files are tracked.');
