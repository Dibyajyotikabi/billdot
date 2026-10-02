// Server-sent events so every open tab updates when a client views or pays.

const listeners = new Set();

export function subscribe(req, res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write('retry: 4000\n\n');
  const ping = setInterval(() => res.write(': ping\n\n'), 25000);
  listeners.add(res);
  req.on('close', () => {
    clearInterval(ping);
    listeners.delete(res);
  });
}

export function emit(type, data = {}) {
  const payload = `event: change\ndata: ${JSON.stringify({ type, ...data })}\n\n`;
  for (const res of listeners) res.write(payload);
}
