'use strict';

const express = require('express');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const PORT = Number(process.env.PORT || 3000);

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '5mb' }));
app.use(express.static(path.join(__dirname, 'public')));

/**
 * Resolve base URL + API key for a request.
 * `x-user-key` and `x-base-url` headers (set from the UI profile manager)
 * override .env, so a new key/gateway can be used without restarting.
 * Không có default gateway: base URL phải đến từ .env (MUSE_BASE_URL)
 * hoặc từ hồ sơ trong giao diện (header x-base-url).
 */
function getConfig(req) {
  const headerBase = String(req.get('x-base-url') || '').trim();
  const baseUrl = (/^https?:\/\//i.test(headerBase)
    ? headerBase
    : String(process.env.MUSE_BASE_URL || '').trim()
  ).replace(/\/+$/, '');
  const apiKey = String(req.get('x-user-key') || process.env.MUSE_API_KEY || '').trim();
  return { baseUrl, apiKey };
}

function sendBaseUrlError(res) {
  return sendError(res, 400, 'Chưa cấu hình Base URL — đặt MUSE_BASE_URL trong .env hoặc thêm hồ sơ gateway trong ⚙️ Cài đặt.');
}


/**
 * Forward a request to the upstream gateway.
 * Aborts the upstream call if the browser disconnects first.
 */
async function callUpstream(req, res, method, upstreamPath, body) {
  const { baseUrl, apiKey } = getConfig(req);
  const ac = new AbortController();
  res.on('close', () => {
    if (!res.writableEnded) ac.abort();
  });
  const headers = { 'Content-Type': 'application/json' };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  return fetch(`${baseUrl}${upstreamPath}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: ac.signal,
  });
}

function sendError(res, status, message) {
  if (res.writableEnded || res.destroyed) return;
  res.status(status).json({ error: message });
}

/** Plain JSON proxy (used for images, videos and non-streaming chat). */
async function proxyJson(req, res, method, upstreamPath) {
  try {
    if (!getConfig(req).baseUrl) return sendBaseUrlError(res);
    const body = method === 'GET' ? undefined : req.body;
    const up = await callUpstream(req, res, method, upstreamPath, body);
    let text = await up.text();
    let ct = up.headers.get('content-type') || 'application/json';

    // Gateway có kiểu trả JSON trần + "data: [DONE]" — có thể kèm content-type
    // text/event-stream sai lệch. Chuẩn hóa về application/json để client parse được.
    if (ct.includes('event-stream')) {
      const m = text.match(/^\s*(\{[\s\S]*\})\s*(?:data:\s*\[DONE\])?\s*$/);
      if (m) {
        text = m[1];
        ct = 'application/json';
      }
    } else if (ct.includes('json')) {
      const cleaned = text.replace(/\s*data:\s*\[DONE\]\s*$/, '');
      if (cleaned !== text) text = cleaned;
    }

    if (res.writableEnded || res.destroyed) return;
    res.status(up.status).set('Content-Type', ct).send(text);
  } catch (err) {
    if (err.name === 'AbortError') return;
    sendError(res, 502, `Không kết nối được tới gateway: ${err.message}`);
  }
}

// ---------------------------------------------------------------------------
// Config (never exposes the key itself)
// ---------------------------------------------------------------------------
// Cập nhật theo danh sách model thật của gateway (kiểm tra 2025): bỏ 'muse' và
// 'muse-spark-laya' (đã bị gateway gỡ), thêm 'deepseek-v4.1-flash' và biến thể 'tsr/…'.
const STATIC_FALLBACK_MODELS = [
  { id: 'muse-spark-1.3', label: 'muse-spark-1.3 — Combo Muse Spark 1.3 (1M ctx)' },
  { id: 'muse-spark-1.2', label: 'muse-spark-1.2 — Combo Muse Spark 1.2 (1M ctx)' },
  { id: 'deepseek-v4.1-flash', label: 'deepseek-v4.1-flash — DeepSeek V4.1 Flash (1M ctx)' },
  { id: 'tsr/muse-spark-1.3', label: 'tsr/muse-spark-1.3 — Spark 1.3 qua TSR (1M ctx)' },
  { id: 'tsr/muse-spark-1.2', label: 'tsr/muse-spark-1.2 — Spark 1.2 qua TSR (1M ctx)' },
];
const STATIC_FALLBACK_IMAGE = [{ id: 'muse-image', label: 'muse-image' }];
const STATIC_FALLBACK_VIDEO = [{ id: 'muse-video', label: 'muse-video' }];

/** Lấy danh sách model CHAT/IMAGE/VIDEO thật từ gateway (null nếu không gọi được). */
async function fetchLiveModels(baseUrl, apiKey) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 6000);
  try {
    const headers = {};
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
    const up = await fetch(`${baseUrl}/models`, { headers, signal: ac.signal });
    if (!up.ok) return null;
    const j = await up.json();
    if (!Array.isArray(j.data) || !j.data.length) return null;

    const isId = (m) => Boolean(m && typeof m.id === 'string');
    const cap = (m, k) => Boolean(m.capabilities && m.capabilities[k] === true);
    // Ưu tiên `kind` nếu gateway cung cấp; fallback sang `capabilities.*Output`
    // rồi tới heuristic theo tên (muse-image / muse-video không set imageOutput).
    const isImage = (m) => (m.kind ? m.kind === 'image'
      : cap(m, 'imageOutput') || /image|dall-e|gpt-image/i.test(m.id));
    const isVideo = (m) => (m.kind ? m.kind === 'video'
      : cap(m, 'videoOutput') || /video|^sora$/i.test(m.id));
    const fmtCtx = (n) => (n >= 1e6 ? `${Math.round(n / 1e6)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}K` : String(n));
    const toOpt = (m) => {
      const parts = [];
      if (m.alias_of) parts.push(`→ ${m.alias_of}`);
      const ctx = m.contextWindow || m.context_length || m.capabilities?.contextWindow;
      if (ctx) parts.push(`${fmtCtx(ctx)} ctx`);
      return { id: m.id, label: parts.length ? `${m.id} (${parts.join(', ')})` : m.id };
    };

    const ids = j.data.filter(isId);
    const chat = ids.filter((m) => !isImage(m) && !isVideo(m)
      && !(m.kind && m.kind !== 'chat')).map(toOpt);
    const image = ids.filter(isImage).map(toOpt);
    const video = ids.filter(isVideo).map(toOpt);
    if (!chat.length && !image.length && !video.length) return null;
    return { chat, image, video };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

app.get('/api/config', async (req, res) => {
  const { baseUrl, apiKey } = getConfig(req);
  const live = await fetchLiveModels(baseUrl, apiKey);
  res.json({
    baseUrl,
    keyConfigured: Boolean(process.env.MUSE_API_KEY),
    overrideActive: Boolean(req.get('x-user-key')),
    models: live?.chat?.length ? live.chat : STATIC_FALLBACK_MODELS,
    imageModels: live?.image?.length ? live.image : STATIC_FALLBACK_IMAGE,
    videoModels: live?.video?.length ? live.video : STATIC_FALLBACK_VIDEO,
    modelsSource: live ? 'live' : 'fallback',
    media: { image: 'muse-image', video: 'muse-video' },
  });
});

// ---------------------------------------------------------------------------
// Key check — verifies a candidate key against any OpenAI-compatible gateway
// Always answers 200 with { ok, message } so the UI can show the result.
// ---------------------------------------------------------------------------
app.post('/api/key/test', async (req, res) => {
  const baseUrl = String(req.body?.baseUrl || process.env.MUSE_BASE_URL || '')
    .trim()
    .replace(/\/+$/, '');
  // Để trống key → kiểm tra key trong .env (như các endpoint khác)
  const key = String(req.body?.key || process.env.MUSE_API_KEY || '').trim();

  if (!/^https?:\/\//i.test(baseUrl)) {
    return res.json({ ok: false, message: 'Base URL phải bắt đầu bằng http:// hoặc https://' });
  }
  if (!key) {
    return res.json({ ok: false, message: 'Chưa có key để kiểm tra: hồ sơ để trống và .env cũng chưa có key.' });
  }

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 12000);
  try {
    const up = await fetch(`${baseUrl}/models`, {
      headers: { Authorization: `Bearer ${key}` },
      signal: ac.signal,
    });
    const text = await up.text();

    if (up.ok) {
      let count = null;
      try {
        const j = JSON.parse(text);
        if (Array.isArray(j.data)) count = j.data.length;
      } catch { /* không parse được thì bỏ qua */ }
      return res.json({
        ok: true,
        status: up.status,
        message: count != null ? `Key hợp lệ ✔ — ${count} model khả dụng` : 'Key hợp lệ ✔',
      });
    }

    let msg = text.slice(0, 300);
    try {
      const j = JSON.parse(text);
      msg = j.error?.message || j.error || msg;
    } catch { /* giữ nguyên text */ }
    msg = typeof msg === 'string' ? msg : JSON.stringify(msg);
    const rejected = /api key required|invalid.{0,12}api.{0,12}key|unauthorized|invalid api key/i.test(msg);
    return res.json({
      ok: false,
      status: up.status,
      message: `HTTP ${up.status}: ${msg}` +
        (rejected ? ' — Key bị từ chối (sai, đã thu hồi, tạm khóa hoặc hết hạn).' : ''),
    });
  } catch (err) {
    return res.json({
      ok: false,
      message: `Không kết nối được: ${err.name === 'AbortError' ? 'timeout 12s' : err.message}`,
    });
  } finally {
    clearTimeout(timer);
  }
});


// ---------------------------------------------------------------------------
// muse2api helper — trạng thái, khởi động gateway, mở muse.ai, import account.
// Admin key đọc từ muse2api/data/api_key, không bao giờ trả về trình duyệt.
// ---------------------------------------------------------------------------
const M2A_DIR = path.join(__dirname, 'muse2api');
const M2A_API = 'http://127.0.0.1:18610';
const M2A_CDP = 'http://127.0.0.1:19210';
const M2A_REQUIRED_COOKIES = ['hatch_sess', 'hatch_gw', 'hatch_vml', 'hatch_native_auth_device'];

function m2aAdminKey() {
  try {
    return fs.readFileSync(path.join(M2A_DIR, 'data', 'api_key'), 'utf8').trim();
  } catch {
    return '';
  }
}

function m2aHeaders() {
  const k = m2aAdminKey();
  return k ? { Authorization: `Bearer ${k}` } : {};
}

async function m2aGatewayUp() {
  try {
    const r = await fetch(`${M2A_API}/v1/models`, { signal: AbortSignal.timeout(1500) });
    return r.status === 200 || r.status === 401; // 401 = đang chạy, chỉ thiếu key
  } catch {
    return false;
  }
}

async function m2aChromeUp() {
  try {
    const r = await fetch(`${M2A_CDP}/json/version`, { signal: AbortSignal.timeout(1500) });
    return r.ok;
  } catch {
    return false;
  }
}

app.get('/api/m2a/status', async (req, res) => {
  const [gateway, chrome] = await Promise.all([m2aGatewayUp(), m2aChromeUp()]);
  const keyConfigured = Boolean(m2aAdminKey());
  let accountsList = [];
  if (gateway && keyConfigured) {
    try {
      const r = await fetch(`${M2A_API}/admin/accounts`, { headers: m2aHeaders(), signal: AbortSignal.timeout(3000) });
      if (r.ok) accountsList = ((await r.json()).data || [])
        .map((a) => ({ id: a.id, label: a.label, status: a.status, enabled: a.enabled }));
    } catch { /* gateway vừa tắt */ }
  }
  res.json({ gateway, chrome, keyConfigured, accounts: accountsList.length, accountsList });
});

app.post('/api/m2a/start', async (req, res) => {
  if (await m2aGatewayUp()) return res.json({ ok: true, message: 'Gateway đã chạy sẵn.' });
  const py = path.join(M2A_DIR, '.venv', 'Scripts', 'python.exe');
  if (!fs.existsSync(py)) {
    return res.json({ ok: false, message: 'Không thấy muse2api/.venv — cài đặt theo README gốc của muse2api.' });
  }
  const child = spawn(py, ['-m', 'muse2api'], { cwd: M2A_DIR, detached: true, stdio: 'ignore', windowsHide: true });
  child.unref();
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 500));
    if (await m2aGatewayUp()) {
      return res.json({ ok: true, message: `Đã khởi động gateway (PID ${child.pid}).` });
    }
  }
  res.json({ ok: false, message: 'Gateway chưa lên sau 10s — xem muse2api/server.err.log.' });
});

app.post('/api/m2a/open-muse', async (req, res) => {
  if (!(await m2aChromeUp())) {
    return res.json({ ok: false, message: 'Chrome CDP chưa chạy — bấm "Khởi động gateway" (với MUSE2API_HEADLESS=false) rồi thử lại.' });
  }
  try {
    const r = await fetch(`${M2A_CDP}/json/new?url=${encodeURIComponent('https://muse.ai')}`, {
      method: 'PUT',
      signal: AbortSignal.timeout(3000),
    });
    if (!r.ok) return res.json({ ok: false, message: `Chrome từ chối mở tab (HTTP ${r.status}).` });
    res.json({ ok: true, message: 'Đã mở https://muse.ai trong Chrome của muse2api — đăng nhập xong bấm "Thêm account".' });
  } catch (e) {
    res.json({ ok: false, message: 'Lỗi khi mở tab: ' + e.message });
  }
});

app.post('/api/m2a/import', async (req, res) => {
  if (!(await m2aChromeUp())) {
    return res.json({ ok: false, message: 'Chrome CDP chưa chạy — bấm "Khởi động gateway" trước.' });
  }
  if (!m2aAdminKey()) {
    return res.json({ ok: false, message: 'Không đọc được admin key (muse2api/data/api_key).' });
  }
  try {
    const ver = await (await fetch(`${M2A_CDP}/json/version`, { signal: AbortSignal.timeout(2000) })).json();
    const jar = await new Promise((resolve, reject) => {
      const ws = new WebSocket(ver.webSocketDebuggerUrl);
      const timer = setTimeout(() => {
        try { ws.close(); } catch { /* đã đóng */ }
        reject(new Error('timeout khi đọc cookie'));
      }, 5000);
      ws.onopen = () => ws.send(JSON.stringify({ id: 1, method: 'Storage.getCookies' }));
      ws.onmessage = (ev) => {
        const m = JSON.parse(ev.data);
        if (m.id !== 1) return;
        clearTimeout(timer);
        const out = {};
        for (const c of m.result?.cookies || []) {
          if ((c.domain || '').endsWith('muse.ai')) out[c.name] = c.value;
        }
        try { ws.close(); } catch { /* đã đóng */ }
        resolve(out);
      };
      ws.onerror = () => {
        clearTimeout(timer);
        reject(new Error('WebSocket tới Chrome lỗi'));
      };
    });
    if (!Object.keys(jar).length) {
      return res.json({ ok: false, message: 'Chưa thấy cookie muse.ai — hãy đăng nhập muse.ai trong Chrome của muse2api rồi thử lại.' });
    }
    const missing = M2A_REQUIRED_COOKIES.filter((n) => !jar[n]);
    if (missing.length) {
      return res.json({ ok: false, message: `Thiếu cookie: ${missing.join(', ')} — đăng nhập lại muse.ai rồi thử lại.` });
    }
    const label = 'acc-' + new Date().toISOString().slice(5, 16).replace('T', '-');
    const r = await fetch(`${M2A_API}/admin/accounts`, {
      method: 'POST',
      headers: { ...m2aHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ label, cookies: jar }),
      signal: AbortSignal.timeout(10000),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      return res.json({ ok: false, message: `POST /admin/accounts lỗi ${r.status}: ${JSON.stringify(j).slice(0, 200)}` });
    }
    res.json({
      ok: true,
      message: `Đã thêm account ${j.account?.id || label} (status: ${j.account?.status || '?'}).`,
      missing_cookies: j.missing_cookies || [],
    });
  } catch (e) {
    res.json({ ok: false, message: 'Lỗi import: ' + e.message });
  }
});

// ---------------------------------------------------------------------------
// Chat — streams Server-Sent Events straight through to the browser
// ---------------------------------------------------------------------------
app.post('/api/chat', async (req, res) => {
  const wantStream = Boolean(req.body && req.body.stream);
  if (!wantStream) return proxyJson(req, res, 'POST', '/chat/completions');

  try {
    if (!getConfig(req).baseUrl) return sendBaseUrlError(res);
    const up = await callUpstream(req, res, 'POST', '/chat/completions', req.body);
    const contentType = up.headers.get('content-type') || '';

    // Gateway answered with a plain error/completion — pass it along as JSON.
    if (!up.ok || !contentType.includes('text/event-stream')) {
      const text = await up.text();
      if (res.writableEnded || res.destroyed) return;
      res.status(up.status).set('Content-Type', contentType.includes('json') ? contentType : 'application/json').send(text);
      return;
    }

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    const reader = up.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (res.writableEnded) {
        await reader.cancel().catch(() => {});
        break;
      }
      res.write(Buffer.from(value));
    }
    res.end();
  } catch (err) {
    if (err.name === 'AbortError') return;
    sendError(res, 502, `Không kết nối được tới gateway: ${err.message}`);
  }
});

// ---------------------------------------------------------------------------
// Images & videos
// ---------------------------------------------------------------------------
/** Binary passthrough for generated media (GET /v1/media/:name). */
async function proxyMedia(req, res, name) {
  try {
    if (!getConfig(req).baseUrl) return sendBaseUrlError(res);
    const up = await callUpstream(req, res, 'GET', `/media/${encodeURIComponent(name)}`, undefined);
    const buf = Buffer.from(await up.arrayBuffer());
    if (res.writableEnded || res.destroyed) return;
    res.status(up.status)
      .set('Content-Type', up.headers.get('content-type') || 'application/octet-stream')
      .set('Cache-Control', 'public, max-age=86400')
      .send(buf);
  } catch (err) {
    if (err.name === 'AbortError') return;
    sendError(res, 502, `Không tải được media: ${err.message}`);
  }
}

app.post('/api/images', (req, res) => proxyJson(req, res, 'POST', '/images/generations'));
app.post('/api/videos', (req, res) => proxyJson(req, res, 'POST', '/videos'));
app.get('/v1/media/:name', (req, res) => proxyMedia(req, res, String(req.params.name)));
app.get('/api/videos/:id', (req, res) =>
  proxyJson(req, res, 'GET', `/videos/${encodeURIComponent(req.params.id)}`)
);

app.use('/api', (req, res) => res.status(404).json({ error: 'Endpoint không tồn tại' }));

// ---------------------------------------------------------------------------
app.listen(PORT, () => {
  const baseUrl = String(process.env.MUSE_BASE_URL || '').trim().replace(/\/+$/, '') || '(chưa cấu hình — dùng ⚙️ Cài đặt)';
  console.log('');
  console.log(`  🎪 Muse API Studio  →  http://localhost:${PORT}`);
  console.log(`  🔌 Gateway          →  ${baseUrl}`);
  console.log(`  🔑 API key          →  ${process.env.MUSE_API_KEY ? 'đọc từ .env' : 'CHƯA CÓ (dùng ⚙️ Cài đặt trong giao diện)'}`);
  console.log('');
});
