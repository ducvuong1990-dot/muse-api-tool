'use strict';

/**
 * Mock upstream gateway — used to validate server.js end-to-end
 * (auth header forwarding, SSE streaming, image + video polling)
 * without spending real quota.
 *
 *   npm run mock                                  # port 3999
 *   $env:MUSE_BASE_URL='http://127.0.0.1:3999/v1'; $env:MUSE_API_KEY='test'; $env:PORT='3210'; node server.js
 */

const http = require('http');

const PORT = Number(process.env.MOCK_PORT || 3999);
let videoPolls = 0;

function json(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(obj));
}

const server = http.createServer((req, res) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    const raw = Buffer.concat(chunks).toString('utf8');
    let body = {};
    try { body = raw ? JSON.parse(raw) : {}; } catch { /* ignore */ }

    // Mirror the real gateway's guard.
    const auth = req.headers.authorization || '';
    if (!auth.startsWith('Bearer ') || !auth.slice(7).trim()) {
      return json(res, 401, { error: 'API key required for remote API access' });
    }

    const url = req.url.split('?')[0];

    if (req.method === 'POST' && url === '/v1/chat/completions') {
      if (body.stream) {
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
        const pieces = ['Xin', ' chào', '!', ' Mình', ' là', ' Muse', ' mock', ' 🎪'];
        let i = 0;
        const timer = setInterval(() => {
          if (i < pieces.length) {
            res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: pieces[i] } }] })}\n\n`);
            i += 1;
          } else {
            res.write('data: [DONE]\n\n');
            clearInterval(timer);
            res.end();
          }
        }, 60);
        res.on('close', () => clearInterval(timer));
        return;
      }
      return json(res, 200, {
        choices: [{ message: { role: 'assistant', content: 'Xin chào từ mock (non-stream)!' } }],
        usage: { total_tokens: 12 },
      });
    }

    if (req.method === 'POST' && url === '/v1/images/generations') {
      return json(res, 200, {
        created: Math.floor(Date.now() / 1000),
        data: [{
          url: 'https://interactive-examples.mdn.mozilla.net/media/cc0-images/elephant-660-480.jpg',
        }],
      });
    }

    if (req.method === 'POST' && url === '/v1/videos') {
      videoPolls = 0;
      return json(res, 200, { task_id: 'task_mock_1', status: 'queued' });
    }

    if (req.method === 'GET' && url === '/v1/videos/task_mock_1') {
      videoPolls += 1;
      if (videoPolls < 2) {
        return json(res, 200, { task_id: 'task_mock_1', status: 'processing', progress: 50 });
      }
      return json(res, 200, {
        task_id: 'task_mock_1',
        status: 'completed',
        url: 'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4',
      });
    }

    if (req.method === 'GET' && url === '/v1/models') {
      return json(res, 200, { object: 'list', data: [{ id: 'muse' }] });
    }

    json(res, 404, { error: 'mock: unknown path ' + url });
  });
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`🧪 Mock upstream → http://127.0.0.1:${PORT}/v1`);
});
