import { spawn } from 'node:child_process';
import { saveSettings } from './settings.js';
import { emit } from './events.js';

// Runs a Cloudflare quick tunnel so the app is reachable from any device.
const state = { running: false, url: '', error: '', startedAt: null };
let child = null;

export const tunnelStatus = () => ({ ...state });

export function startTunnel(port) {
  if (child) return Promise.resolve(tunnelStatus());
  return new Promise((resolve) => {
    state.error = '';
    try {
      child = spawn('cloudflared', ['tunnel', '--no-autoupdate', '--url', `http://localhost:${port}`], {
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (err) {
      state.error = err.message;
      return resolve(tunnelStatus());
    }
    const timer = setTimeout(() => {
      if (!state.url) state.error = 'cloudflared did not report a URL within 30 seconds.';
      resolve(tunnelStatus());
    }, 30000);

    const onData = (chunk) => {
      const match = String(chunk).match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
      if (match && !state.url) {
        Object.assign(state, { running: true, url: match[0], startedAt: new Date().toISOString() });
        saveSettings({ sharing: { publicUrl: match[0] } });
        emit('tunnel', { url: match[0] });
        clearTimeout(timer);
        resolve(tunnelStatus());
      }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('error', (err) => {
      state.error = err.code === 'ENOENT'
        ? 'cloudflared is not installed. Run: brew install cloudflared'
        : err.message;
      child = null;
      clearTimeout(timer);
      resolve(tunnelStatus());
    });
    child.on('exit', () => {
      Object.assign(state, { running: false, url: '', startedAt: null });
      saveSettings({ sharing: { publicUrl: '' } });
      child = null;
      emit('tunnel', { url: '' });
    });
  });
}

export function stopTunnel() {
  if (child) child.kill('SIGTERM');
  return tunnelStatus();
}

process.on('exit', () => child?.kill('SIGTERM'));
