import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

export const DATA_DIR = path.resolve(process.env.DATA_DIR || 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

export const db = new DatabaseSync(path.join(DATA_DIR, 'billdot.db'));

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  PRAGMA busy_timeout = 3000;

  CREATE TABLE IF NOT EXISTS kv (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    expires_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS clients (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    company TEXT NOT NULL DEFAULT '',
    email TEXT NOT NULL DEFAULT '',
    phone TEXT NOT NULL DEFAULT '',
    address TEXT NOT NULL DEFAULT '',
    tax_id TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS clients_name ON clients (name COLLATE NOCASE);

  CREATE TABLE IF NOT EXISTS items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE COLLATE NOCASE,
    description TEXT NOT NULL DEFAULT '',
    rate REAL NOT NULL DEFAULT 0,
    unit TEXT NOT NULL DEFAULT '',
    tax_rate REAL NOT NULL DEFAULT 0,
    usage_count INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS documents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL,
    number TEXT NOT NULL,
    token TEXT NOT NULL UNIQUE,
    client_id INTEGER REFERENCES clients (id) ON DELETE SET NULL,
    client TEXT NOT NULL DEFAULT '{}',
    status TEXT NOT NULL DEFAULT 'draft',
    format TEXT NOT NULL DEFAULT 'a4',
    issue_date TEXT NOT NULL,
    due_date TEXT,
    currency TEXT NOT NULL,
    subject TEXT NOT NULL DEFAULT '',
    reference TEXT NOT NULL DEFAULT '',
    items TEXT NOT NULL DEFAULT '[]',
    discount_type TEXT NOT NULL DEFAULT 'amount',
    discount_value REAL NOT NULL DEFAULT 0,
    shipping REAL NOT NULL DEFAULT 0,
    subtotal REAL NOT NULL DEFAULT 0,
    tax_total REAL NOT NULL DEFAULT 0,
    total REAL NOT NULL DEFAULT 0,
    amount_paid REAL NOT NULL DEFAULT 0,
    notes TEXT NOT NULL DEFAULT '',
    terms TEXT NOT NULL DEFAULT '',
    recurring TEXT,
    parent_id INTEGER,
    claim TEXT,
    sent_at TEXT,
    viewed_at TEXT,
    paid_at TEXT,
    reminders_sent INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE (type, number)
  );
  CREATE INDEX IF NOT EXISTS documents_client ON documents (client_id);
  CREATE INDEX IF NOT EXISTS documents_type_status ON documents (type, status);

  CREATE TABLE IF NOT EXISTS payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    document_id INTEGER NOT NULL REFERENCES documents (id) ON DELETE CASCADE,
    amount REAL NOT NULL,
    date TEXT NOT NULL,
    method TEXT NOT NULL DEFAULT '',
    reference TEXT NOT NULL DEFAULT '',
    note TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS payments_document ON payments (document_id);

  CREATE TABLE IF NOT EXISTS activity (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    document_id INTEGER REFERENCES documents (id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    message TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS activity_document ON activity (document_id);

  CREATE TABLE IF NOT EXISTS businesses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL DEFAULT '',
    profile TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS confirmations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    token TEXT NOT NULL UNIQUE,
    business_id INTEGER,
    document_id INTEGER REFERENCES documents (id) ON DELETE SET NULL,
    payment_id INTEGER REFERENCES payments (id) ON DELETE SET NULL,
    amount REAL NOT NULL,
    currency TEXT NOT NULL,
    payer TEXT NOT NULL DEFAULT '',
    method TEXT NOT NULL DEFAULT '',
    reference TEXT NOT NULL DEFAULT '',
    paid_on TEXT NOT NULL,
    note TEXT NOT NULL DEFAULT '',
    image TEXT,
    show_image INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS confirmations_document ON confirmations (document_id);
`);

// Columns added after the first release. SQLite has no ADD COLUMN IF NOT EXISTS.
const hasColumn = (table, column) => db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === column);
if (!hasColumn('documents', 'business_id')) db.exec('ALTER TABLE documents ADD COLUMN business_id INTEGER');
if (!hasColumn('confirmations', 'receiver')) db.exec("ALTER TABLE confirmations ADD COLUMN receiver TEXT NOT NULL DEFAULT ''");
if (!hasColumn('confirmations', 'visibility')) db.exec("ALTER TABLE confirmations ADD COLUMN visibility TEXT NOT NULL DEFAULT '{}'");
if (!hasColumn('confirmations', 'direction')) {
  db.exec("ALTER TABLE confirmations ADD COLUMN direction TEXT NOT NULL DEFAULT 'sent'");
  db.exec("UPDATE confirmations SET direction = 'received' WHERE payment_id IS NOT NULL");
}
if (!hasColumn('confirmations', 'icon_style')) db.exec("ALTER TABLE confirmations ADD COLUMN icon_style TEXT NOT NULL DEFAULT 'arrow'");
db.exec('CREATE INDEX IF NOT EXISTS documents_business ON documents (business_id)');

export function transaction(fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

export function kvGet(key, fallback = null) {
  const row = db.prepare('SELECT value FROM kv WHERE key = ?').get(key);
  if (!row) return fallback;
  try {
    return JSON.parse(row.value);
  } catch {
    return fallback;
  }
}

export function kvSet(key, value) {
  db.prepare('INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value')
    .run(key, JSON.stringify(value));
}
