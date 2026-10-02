import express from 'express';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { authRouter } from './routes/auth.js';
import { apiRouter } from './routes/api.js';
import { documentsRouter } from './routes/documents.js';
import { publicRouter } from './routes/public.js';
import { confirmationsRouter } from './routes/confirmations.js';
import { requireAuth, behindProxy } from './auth.js';
import { startScheduler } from './scheduler.js';
import { startBackups } from './backup.js';
import { startTunnel } from './tunnel.js';
import { saveSettings } from './settings.js';
import { PORT } from './sender.js';

const PUBLIC_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public');
const app = express();

app.disable('x-powered-by');
app.set('trust proxy', behindProxy ? 1 : 'loopback');

app.use((req, res, next) => {
  res.setHeader('Content-Security-Policy', [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self'",
    "img-src 'self' data: blob:",
    "connect-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
  ].join('; '));
  if (req.secure) res.setHeader('Strict-Transport-Security', 'max-age=31536000');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  next();
});

// Screenshots arrive as data URLs, so this route gets a bigger body limit,
// checked only after sign-in so strangers cannot push large bodies.
app.use('/api/confirmations', requireAuth, express.json({ limit: '7mb' }));
app.use(express.json({ limit: '2mb' }));

app.use('/api/auth', authRouter);
app.use('/api/public', publicRouter);
app.use('/api/documents', requireAuth, documentsRouter);
app.use('/api/confirmations', confirmationsRouter);
app.use('/api', requireAuth, apiRouter);
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found.' }));

app.get('/healthz', (req, res) => res.type('text').send('ok'));
app.get('/d/:token', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'doc.html')));
app.get('/p/:token', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'paid.html')));
app.use(express.static(PUBLIC_DIR, {
  setHeaders(res, file) {
    // Revalidate app files on every load so a deploy shows up at once, even behind Cloudflare.
    if (/\.(?:html|js|css|webmanifest)$/.test(file)) res.setHeader('Cache-Control', 'no-cache');
  },
}));

app.use((err, req, res, next) => {
  const status = err.status || (err.type === 'entity.too.large' ? 413 : 500);
  if (status >= 500) console.error(err);
  res.status(status).json({ error: status >= 500 && !err.status ? 'Something went wrong on the server.' : err.message });
});

function lanAddresses() {
  return Object.values(os.networkInterfaces()).flat()
    .filter((n) => n && n.family === 'IPv4' && !n.internal)
    .map((n) => `http://${n.address}:${PORT}`);
}

// A tunnel URL from a previous run is dead after a restart.
saveSettings({ sharing: { publicUrl: '' } });

app.listen(PORT, '0.0.0.0', async () => {
  console.log(`\n  Billdot is running\n`);
  console.log(`  This computer   http://localhost:${PORT}`);
  for (const url of lanAddresses()) console.log(`  Same Wi-Fi      ${url}`);
  startScheduler();
  startBackups();
  if (process.argv.includes('--share')) {
    console.log('\n  Opening a public link...');
    const status = await startTunnel(PORT);
    console.log(status.url ? `  Public link     ${status.url}\n` : `  Could not open a public link: ${status.error}\n`);
  } else {
    console.log('\n  Run "npm run share" or use Settings > Public link for a link that works anywhere.\n');
  }
});
