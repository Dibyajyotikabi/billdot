// Versioned asset URLs. Cloudflare can tell browsers to keep JS and CSS for hours,
// so each build serves them under /v/<hash>/ and HTML pages point there.
// A new deploy changes the hash, which forces every browser to load fresh files.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';

const YEAR_SECONDS = 365 * 24 * 60 * 60;

function hashDir(hash, dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) hashDir(hash, file);
    else if (/\.(?:js|css)$/.test(entry.name)) hash.update(entry.name).update(fs.readFileSync(file));
  }
}

export function assetServer(publicDir) {
  const hash = crypto.createHash('sha256');
  hashDir(hash, path.join(publicDir, 'js'));
  hashDir(hash, path.join(publicDir, 'css'));
  const build = hash.digest('hex').slice(0, 12);
  const prefix = `/v/${build}`;
  const pages = new Map();

  // Relative imports inside the JS resolve under the same /v/<hash>/ prefix automatically.
  const page = (name) => {
    if (!pages.has(name)) {
      const html = fs.readFileSync(path.join(publicDir, name), 'utf8')
        .replace(/(href|src)="\/(js|css)\//g, `$1="${prefix}/$2/`);
      pages.set(name, html);
    }
    return pages.get(name);
  };
  const sendPage = (name) => (req, res) => {
    res.setHeader('Cache-Control', 'no-cache');
    res.type('html').send(page(name));
  };
  // Any hash is served from the current files, so an old tab still loads during a deploy.
  const versioned = express.static(publicDir, {
    index: false,
    setHeaders(res) { res.setHeader('Cache-Control', `public, max-age=${YEAR_SECONDS}, immutable`); },
  });
  return { build, sendPage, versioned };
}
