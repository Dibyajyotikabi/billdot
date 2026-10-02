import fs from 'node:fs';
import path from 'node:path';
import { db, DATA_DIR } from './db.js';

const BACKUP_DIR = path.join(DATA_DIR, 'backups');
const KEEP = 14;
const EVERY_MS = 6 * 60 * 60 * 1000;

// VACUUM INTO writes a consistent copy even while the app is serving requests.
export function backupNow(date = new Date().toISOString().slice(0, 10)) {
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const target = path.join(BACKUP_DIR, `billdot-${date}.db`);
  if (fs.existsSync(target)) return target;
  const partial = `${target}.partial`;
  fs.rmSync(partial, { force: true });
  db.prepare('VACUUM INTO ?').run(partial);
  fs.renameSync(partial, target);
  const old = fs.readdirSync(BACKUP_DIR).filter((f) => /^billdot-.*\.db$/.test(f)).sort().slice(0, -KEEP);
  for (const file of old) fs.rmSync(path.join(BACKUP_DIR, file), { force: true });
  return target;
}

export function startBackups() {
  const run = () => {
    try { backupNow(); } catch (err) { console.error('[backup]', err); }
  };
  setTimeout(run, 30_000);
  setInterval(run, EVERY_MS).unref();
}
