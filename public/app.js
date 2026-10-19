'use strict';

/* ============================ helpers ============================ */
const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);

let cfg = { baseUrl: '', models: [], media: { image: 'muse-image', video: 'muse-video' } };

/* ---------------- hồ sơ kết nối (lưu trong localStorage) ---------------- */
let profiles = [];   // [{ id, label, base, key }]
let activeId = '';   // id hồ sơ đang dùng ('' = dùng .env)
let editingId = null; // id đang sửa trong modal (null = thêm mới)

function loadProfiles() {
  try {
    const v = JSON.parse(localStorage.getItem('muse_profiles') || '[]');
    return Array.isArray(v) ? v : [];
  } catch { return []; }
}
function saveProfiles() {
  localStorage.setItem('muse_profiles', JSON.stringify(profiles));
  localStorage.setItem('muse_active_profile', activeId);
}
function activeProfile() { return profiles.find((p) => p.id === activeId) || null; }
function newId() { return 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

/** Header xác thực + base URL cho mọi request đi qua server. */
function authHeaders() {
  const p = activeProfile();
  return {
    ...(p && p.key ? { 'x-user-key': p.key } : {}),
    ...(p && p.base ? { 'x-base-url': p.base } : {}),
  };
}

// Chuyển key cũ (bản 1) sang định dạng hồ sơ mới.
(function migrateLegacyKey() {
  profiles = loadProfiles();
  activeId = localStorage.getItem('muse_active_profile') || '';
  if (!profiles.some((p) => p.id === activeId)) activeId = profiles[0] ? profiles[0].id : '';
  const legacy = localStorage.getItem('muse_user_key');
  if (legacy && !profiles.some((p) => p.key === legacy)) {
    const p = { id: newId(), label: 'Key đã lưu (bản cũ)', base: '', key: legacy };
    profiles.push(p);
    if (!activeId) activeId = p.id;
    localStorage.removeItem('muse_user_key');
    saveProfiles();
  }
})();


function toast(msg, ok = false) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.toggle('info', ok);
  el.classList.remove('hidden');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.add('hidden'), ok ? 3500 : 8000);
}

function friendlyError(msg) {
  if (/API key required for remote API access/i.test(msg)) {
    return 'Gateway từ chối API key (401).\n→ Hãy kiểm tra key lại trong ⚙️ Cài đặt hoặc file .env (key có thể đã bị thu hồi, tạm khóa hoặc sai).';
  }
  return msg;
}

function errText(e) {
  if (e == null) return null;
  if (typeof e === 'string' && e) return e;
  if (typeof e.message === 'string' && e.message) return e.message;
  return JSON.stringify(e);
}

async function api(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders(),
      ...(options.headers || {}),
    },
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
  if (!res.ok) {
    const msg = errText(data && (data.error?.message || data.error || data.message)) || data?.raw || `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return data;
}

function gatewayRoot() {
  return (cfg.baseUrl || '').replace(/\/v1$/, '');
}

function absUrl(u) {
  if (!u) return u;
  if (/^https?:\/\//i.test(u)) return u;
  if (u.startsWith('/')) return gatewayRoot() + u;
  return gatewayRoot() + '/' + u;
}

function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ============================ tabs ============================ */
$('#tabBar').addEventListener('click', (ev) => {
  const btn = ev.target.closest('.tab-btn');
  if (!btn) return;
  $$('.tab-btn').forEach((b) => {
    b.classList.toggle('active', b === btn);
    b.setAttribute('aria-selected', String(b === btn));
    b.tabIndex = b === btn ? 0 : -1;
  });
  $$('.tab').forEach((t) => t.classList.toggle('active', t.id === 'tab-' + btn.dataset.tab));
});

// Điều hướng tab bằng bàn phím (mũi tên / Home / End) theo pattern ARIA tabs.
// Sidebar dọc → Up/Down; mobile thành hàng ngang → vẫn nhận Left/Right.
$('#tabBar').addEventListener('keydown', (ev) => {
  const btns = [...$$('.tab-btn')];
  const i = btns.indexOf(document.activeElement);
  if (i < 0) return;
  let j = null;
  if (ev.key === 'ArrowRight' || ev.key === 'ArrowDown') j = (i + 1) % btns.length;
  else if (ev.key === 'ArrowLeft' || ev.key === 'ArrowUp') j = (i - 1 + btns.length) % btns.length;
  else if (ev.key === 'Home') j = 0;
  else if (ev.key === 'End') j = btns.length - 1;
  if (j == null) return;
  ev.preventDefault();
  btns[j].focus();
  btns[j].click();
});

/* ============================ settings ============================ */
const modal = $('#settingsModal');

function renderProfileSelect(selectedId) {
  const sel = $('#profileSelect');
  sel.innerHTML = '';
  const oEnv = document.createElement('option');
  oEnv.value = '';
  oEnv.textContent = 'Dùng cấu hình .env' + (cfg.keyConfigured ? ' (đã có key)' : ' (chưa có key)');
  sel.appendChild(oEnv);
  profiles.forEach((p) => {
    const o = document.createElement('option');
    o.value = p.id;
    o.textContent = `${p.label || 'Hồ sơ'} — ${p.base || 'base .env'}${p.key ? '' : ' ⚠️không key'}`;
    sel.appendChild(o);
  });
  if (selectedId === '__new__') {
    const o = document.createElement('option');
    o.value = '__new__';
    o.textContent = '➕ Hồ sơ mới (chưa lưu)';
    sel.appendChild(o);
    sel.value = '__new__';
  } else {
    sel.value = selectedId || '';
  }
}

function fillFields(p) {
  $('#profLabel').value = p?.label || '';
  $('#profBase').value = p?.base || '';
  $('#profKey').value = p?.key || '';
}

$('#settingsBtn').addEventListener('click', () => {
  editingId = activeId || null;
  renderProfileSelect(activeId);
  fillFields(activeProfile());
  $('#testResult').classList.add('hidden');
  modal.classList.remove('hidden');
  $('#profileSelect').focus();
});

function closeSettings() {
  modal.classList.add('hidden');
  $('#settingsBtn').focus();
}
$('#keyCancel').addEventListener('click', closeSettings);
$('#modalClose').addEventListener('click', closeSettings);
modal.addEventListener('click', (e) => { if (e.target === modal) closeSettings(); });
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !modal.classList.contains('hidden')) closeSettings();
});

$('#profileSelect').addEventListener('change', () => {
  const v = $('#profileSelect').value;
  if (v === '__new__') { editingId = null; fillFields(null); return; }
  editingId = v || null;
  fillFields(profiles.find((p) => p.id === v) || null);
});

$('#profNew').addEventListener('click', () => {
  editingId = null;
  fillFields(null);
  renderProfileSelect('__new__');
  $('#profLabel').focus();
});

/* Mẫu base URL cho các gateway phổ biến — chỉ điền ô Base URL, không đụng key. */
const PRESETS = {
  presetLocal: { label: 'muse2api local', base: 'http://127.0.0.1:18610/v1' },
  presetLlama: { label: 'Meta Llama API', base: 'https://api.llama.com/compat/v1' },
};
Object.entries(PRESETS).forEach(([btnId, p]) => {
  document.getElementById(btnId)?.addEventListener('click', () => {
    if (!$('#profLabel').value.trim()) $('#profLabel').value = p.label;
    $('#profBase').value = p.base;
  });
});

$('#profDel').addEventListener('click', () => {
  if (!editingId) { toast('Hồ sơ .env hoặc hồ sơ mới chưa lưu thì không cần xóa.'); return; }
  const p = profiles.find((x) => x.id === editingId);
  profiles = profiles.filter((x) => x.id !== editingId);
  if (activeId === editingId) activeId = '';
  editingId = activeId || null;
  saveProfiles();
  updateBadge();
  renderProfileSelect(activeId);
  fillFields(activeProfile());
  toast(`Đã xóa “${p?.label || 'hồ sơ'}”`, true);
});

$('#profTest').addEventListener('click', async () => {
  const st = $('#testResult');
  st.classList.remove('hidden', 'error');
  st.textContent = '🩺 Đang kiểm tra key…';
  $('#profTest').disabled = true;
  try {
    const r = await fetch('/api/key/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ baseUrl: $('#profBase').value.trim(), key: $('#profKey').value.trim() }),
    });
    const j = await r.json();
    st.classList.toggle('error', !j.ok);
    st.textContent = (j.ok ? '✅ ' : '❌ ') + (j.message || 'Không có thông báo từ server');
  } catch (e) {
    st.classList.add('error');
    st.textContent = 'Lỗi khi kiểm tra: ' + e.message;
  } finally {
    $('#profTest').disabled = false;
  }
});

$('#keySave').addEventListener('click', async () => {
  const label = $('#profLabel').value.trim();
  const base = $('#profBase').value.trim().replace(/\/+$/, '');
  const key = $('#profKey').value.trim();

  if (editingId) {
    const p = profiles.find((x) => x.id === editingId);
    if (p) {
      if (label) p.label = label;
      p.base = base;
      p.key = key;
    }
    activeId = editingId;
  } else if (label || base || key) {
    const p = { id: newId(), label: label || 'Hồ sơ mới', base, key };
    profiles.push(p);
    activeId = p.id;
    editingId = p.id;
  } else {
    activeId = ''; // không có gì nhập → quay về .env
  }
  saveProfiles();
  modal.classList.add('hidden');
  await refreshConfig(); // nạp lại danh sách model thật của hồ sơ vừa chọn
  toast(activeId ? `Đang dùng hồ sơ: ${activeProfile()?.label}` : 'Đang dùng cấu hình .env', true);
});

function updateBadge() {
  const el = $('#keyBadge');
  const p = activeProfile();
  if (p) {
    el.textContent = `🔑 ${p.label || 'hồ sơ'}`;
    el.className = 'badge ok';
    el.title = `Base: ${p.base || '(theo .env)'} — key: ${p.key ? p.key.slice(0, 8) + '…' : '(theo .env)'}`;
  } else if (cfg.keyConfigured) {
    el.textContent = '🔑 key: .env';
    el.className = 'badge ok';
    el.title = 'Dùng API key trong file .env của server';
  } else {
    el.textContent = '⚠️ chưa có key';
    el.className = 'badge warn';
    el.title = 'Chưa có key — mở ⚙️ Cài đặt để nhập';
  }
}


/* ============================ init ============================ */
/** Điền dropdown model từ config (gọi lại được khi đổi hồ sơ). */
function fillSelect(sel, list, fallbackLabel) {
  sel.innerHTML = '';
  (list && list.length ? list : [{ id: '', label: fallbackLabel }]).forEach((m) => {
    const o = document.createElement('option');
    o.value = m.id;
    o.textContent = m.label;
    sel.appendChild(o);
  });
}

/** Tải lại /api/config theo hồ sơ đang chọn (dùng sau khi lưu hồ sơ mới). */
async function refreshConfig() {
  try {
    cfg = await api('/api/config');
    applyConfig();
  } catch (e) {
    toast('Không tải lại được cấu hình: ' + e.message);
  }
  updateBadge();
}

function applyConfig() {
  populateModelSelects();
  const src = $('#modelSource');
  if (src) {
    const n = (cfg.models || []).length;
    src.textContent = cfg.modelsSource === 'live'
      ? `● ${n} model từ gateway (live)`
      : '● danh sách dự phòng — không gọi được gateway';
  }
}

function populateModelSelects() {
  fillSelect($('#chatModel'), cfg.models, 'muse');
  fillSelect($('#imgModel'), cfg.imageModels, cfg.media?.image || 'muse-image');
  fillSelect($('#vidModel'), cfg.videoModels, cfg.media?.video || 'muse-video');
}

(async function init() {
  try {
    cfg = await api('/api/config');
  } catch (e) {
    toast('Không tải được cấu hình: ' + e.message);
  }
  populateModelSelects();
  updateBadge();
  restoreGallery();
})();

const messagesEl = $('#messages');
let messages = []; // { role, content, error? }
let busy = false;
let abortCtrl = null;

function mdLite(src) {
  let text = escapeHtml(src);
  text = text.replace(/```[\w-]*\n?([\s\S]*?)```/g, (m, code) => `<pre><code>${code}</code></pre>`);
  text = text.replace(/`([^`\n]+)`/g, '<code>$1</code>');
  text = text.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
  text = text.replace(/(^|[^*\w])\*([^*\n]+)\*/g, '$1<i>$2</i>');
  // Ảnh/video do muse tạo trong chat: ![image](/v1/media/…) / ![video](…)
  text = text.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (m, alt, src) => {
    if (!/^(https?:\/\/|\/|data:image\/)/i.test(src) || src.includes('"') || src.includes('<')) return m;
    const url = absUrl(src);
    if (alt === 'video' || /\.(mp4|webm|mov|m4v)(\?|$)/i.test(url)) {
      return `<video controls preload="metadata" src="${url}"></video>`;
    }
    return `<img src="${url}" alt="${alt}" loading="lazy" decoding="async">`;
  });
  text = text.replace(/([^"'=>\w])((?:https?:\/\/)[^\s<]+)/g, '$1<a href="$2" target="_blank" rel="noopener">$2</a>');
  return text
    .split(/(<pre>[\s\S]*?<\/pre>)/g)
    .map((part) => (part.startsWith('<pre>') ? part : part.replace(/\n/g, '<br>')))
    .join('');
}

function bubble(m) {
  const div = document.createElement('div');
  div.className = 'msg ' + (m.error ? 'assistant error' : m.role);
  const label = m.role === 'user' ? 'Bạn' : 'Muse';
  const imgs = (m.images || []).length
    ? `<div class="msg-imgs">${m.images.map((u, i) =>
        `<img src="${u}" alt="Ảnh đính kèm ${i + 1}" width="120" height="120" loading="lazy" decoding="async">`).join('')}</div>`
    : '';
  div.innerHTML = `<div class="role">${label}</div>${imgs}<div class="body">${mdLite(m.content)}</div>`;
  if (!m.error && m.content) {
    const copy = document.createElement('button');
    copy.className = 'copy-btn';
    copy.type = 'button';
    copy.textContent = '📋 Copy';
    copy.addEventListener('click', () =>
      navigator.clipboard.writeText(m.content).then(() => toast('Đã copy ✔', true))
    );
    div.appendChild(copy);
  }
  return div;
}

function renderMessages() {
  messagesEl.innerHTML = '';
  if (!messages.length) {
    messagesEl.innerHTML = '<div class="empty">Bắt đầu cuộc trò chuyện với <b>Muse</b>…</div>';
    return;
  }
  messages.forEach((m) => messagesEl.appendChild(bubble(m)));
  scrollDown();
}

function scrollDown() {
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function setBusy(b) {
  busy = b;
  $('#sendBtn').disabled = b;
  $('#stopBtn').classList.toggle('hidden', !b);
  $('#clearChat').disabled = b;
}

async function sendChat() {
  const text = $('#chatText').value.trim();
  if ((!text && !pendingFiles.length) || busy) return;
  $('#chatText').value = '';
  chatText.style.height = 'auto';
  const imageUrls = pendingFiles.map((f) => f.dataUrl);
  pendingFiles = [];
  renderChips();
  messages.push({ role: 'user', content: text, images: imageUrls });
  messages.push({ role: 'assistant', content: '' });
  renderMessages();
  setBusy(true);

  // message → wire format: ảnh đính kèm thành content parts (chuẩn OpenAI vision)
  const toWire = (m) => {
    if (!(m.images || []).length) return { role: m.role, content: m.content };
    const parts = [];
    if (m.content) parts.push({ type: 'text', text: m.content });
    for (const url of m.images) parts.push({ type: 'image_url', image_url: { url } });
    return { role: m.role, content: parts };
  };

  const payload = {
    model: $('#chatModel').value,
    temperature: Number($('#temp').value),
    stream: true,
    messages: messages.slice(0, -1).map(toWire),
  };
  const maxTokens = Number($('#maxTokens').value);
  if (maxTokens > 0) payload.max_tokens = maxTokens;

  abortCtrl = new AbortController();
  const liveDiv = messagesEl.lastElementChild;
  const bodyEl = liveDiv.querySelector('.body');
  let acc = '';

  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      signal: abortCtrl.signal,
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify(payload),
    });
    const ct = res.headers.get('content-type') || '';

    if (!res.ok || ct.includes('application/json')) {
      const data = await res.json().catch(() => null);
      throw new Error(errText(data && (data.error?.message || data.error)) || `HTTP ${res.status}`);
    }

    if (ct.includes('text/event-stream')) {
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop();
        for (const line of lines) {
          const t = line.trim();
          if (!t) continue;
          // Chấp nhận "data: {...}" chuẩn hoặc JSON trần (gateway lạ content-type)
          const data = t.startsWith('data:') ? t.slice(5).trim()
            : t.startsWith('{') ? t
            : null;
          if (!data || data === '[DONE]') continue;
          try {
            const j = JSON.parse(data);
            const d = j.choices?.[0]?.delta || {};
            const piece = d.content ?? j.choices?.[0]?.message?.content ?? '';
            if (piece) {
              acc += piece;
              bodyEl.innerHTML = mdLite(acc);
              scrollDown();
            }
          } catch { /* bỏ qua dòng không phải JSON */ }
        }
      }
    } else {
      const j = await res.json();
      acc = j.choices?.[0]?.message?.content ?? j.output_text ?? JSON.stringify(j, null, 2);
      bodyEl.innerHTML = mdLite(acc);
      scrollDown();
    }

    messages[messages.length - 1] = { role: 'assistant', content: acc || '(trống)' };
    // Ảnh muse vừa tạo trong chat → thêm vào gallery chung (kèm chống trùng)
    const chatImgs = (acc.match(/!\[[^\]]*\]\(([^)\s]+)\)/g) || [])
      .map((m) => m.slice(m.indexOf('(') + 1, -1))
      .filter((u) => /^data:image\/|\/v1\/media\/|^https?:\/\//i.test(u) && !/\.(mp4|webm|mov|m4v)(\?|$)/i.test(u));
    if (chatImgs.length) {
      const n = addGalleryItems(chatImgs.map((u) => ({
        url: absUrl(u), prompt: text || 'Ảnh tạo từ chat', src: 'chat',
      })));
      if (n) toast(`🖼 ${n} ảnh từ chat đã vào gallery`, true);
    }
  } catch (err) {
    if (err.name === 'AbortError') {
      messages[messages.length - 1] = { role: 'assistant', content: acc || '(đã dừng)' };
      if (!acc) bodyEl.textContent = '(đã dừng)';
    } else {
      const friendly = friendlyError(err.message);
      messages[messages.length - 1] = { role: 'assistant', content: friendly, error: true };
      bodyEl.textContent = friendly;
      liveDiv.classList.add('error');
      toast(friendly);
    }
  } finally {
    abortCtrl = null;
    setBusy(false);
    scrollDown();
    renderMessages();
  }
}

$('#chatForm').addEventListener('submit', (e) => {
  e.preventDefault();
  sendChat();
});

// Textarea tự giãn theo nội dung (giới hạn max-height do CSS giữ).
const chatText = $('#chatText');
chatText.addEventListener('input', () => {
  chatText.style.height = 'auto';
  chatText.style.height = Math.min(chatText.scrollHeight, 180) + 'px';
});
chatText.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    sendChat();
  }
});

// ---------- Đính kèm ảnh ----------
const MAX_ATTACH = 4;
const MAX_FILE_BYTES = 8 * 1024 * 1024;
let pendingFiles = []; // { name, dataUrl }
const chipsEl = $('#attachChips');
const fileInput = $('#fileInput');

function renderChips() {
  chipsEl.hidden = !pendingFiles.length;
  chipsEl.innerHTML = '';
  pendingFiles.forEach((f, i) => {
    const chip = document.createElement('span');
    chip.className = 'chip';
    const img = document.createElement('img');
    img.src = f.dataUrl; img.alt = ''; img.width = 34; img.height = 34;
    const name = document.createElement('span');
    name.className = 'chip-name';
    name.title = f.name;
    name.textContent = f.name;
    const x = document.createElement('button');
    x.type = 'button';
    x.className = 'chip-x';
    x.setAttribute('aria-label', `Bỏ đính kèm ${f.name}`);
    x.textContent = '✕';
    x.addEventListener('click', () => { pendingFiles.splice(i, 1); renderChips(); });
    chip.append(img, name, x);
    chipsEl.appendChild(chip);
  });
}

function addFiles(list) {
  for (const file of [...list]) {
    if (!file.type.startsWith('image/')) { toast(`${file.name}: chỉ hỗ trợ ảnh`, false); continue; }
    if (file.size > MAX_FILE_BYTES) { toast(`${file.name}: quá 8 MB`, false); continue; }
    if (pendingFiles.length >= MAX_ATTACH) { toast(`Tối đa ${MAX_ATTACH} ảnh một tin nhắn`, false); break; }
    const reader = new FileReader();
    reader.onload = () => { pendingFiles.push({ name: file.name, dataUrl: reader.result }); renderChips(); };
    reader.readAsDataURL(file);
  }
}

$('#attachBtn').addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', () => { addFiles(fileInput.files); fileInput.value = ''; });

// Dán ảnh từ clipboard vào ô chat
chatText.addEventListener('paste', (e) => {
  const files = [...(e.clipboardData?.files || [])].filter((f) => f.type.startsWith('image/'));
  if (files.length) { e.preventDefault(); addFiles(files); }
});
$('#stopBtn').addEventListener('click', () => abortCtrl && abortCtrl.abort());
$('#temp').addEventListener('input', () => { $('#tempVal').textContent = $('#temp').value; });
$('#clearChat').addEventListener('click', () => {
  messages = [];
  renderMessages();
});
$('#exportChat').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(messages, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `muse-chat-${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
});

// ---------- Đính kèm ảnh tham chiếu (dùng chung cho tab Ảnh / Video) ----------
function setupRefAttach(chipsId, btnId, inputId, max) {
  let files = []; // { name, dataUrl }
  const chips = $(chipsId);
  const input = $(inputId);
  const render = () => {
    chips.hidden = !files.length;
    chips.innerHTML = '';
    files.forEach((f, i) => {
      const chip = document.createElement('span');
      chip.className = 'chip';
      const img = document.createElement('img');
      img.src = f.dataUrl; img.alt = ''; img.width = 34; img.height = 34;
      const name = document.createElement('span');
      name.className = 'chip-name';
      name.title = f.name;
      name.textContent = f.name;
      const x = document.createElement('button');
      x.type = 'button';
      x.className = 'chip-x';
      x.setAttribute('aria-label', `Bỏ đính kèm ${f.name}`);
      x.textContent = '✕';
      x.addEventListener('click', () => { files.splice(i, 1); render(); });
      chip.append(img, name, x);
      chips.appendChild(chip);
    });
  };
  const add = (list) => {
    for (const file of [...list]) {
      if (!file.type.startsWith('image/')) { toast(`${file.name}: chỉ hỗ trợ ảnh`, false); continue; }
      if (file.size > MAX_FILE_BYTES) { toast(`${file.name}: quá 8 MB`, false); continue; }
      if (files.length >= max) { toast(`Tối đa ${max} ảnh`, false); break; }
      const reader = new FileReader();
      reader.onload = () => { files.push({ name: file.name, dataUrl: reader.result }); render(); };
      reader.readAsDataURL(file);
    }
  };
  $(btnId).addEventListener('click', () => input.click());
  input.addEventListener('change', () => { add(input.files); input.value = ''; });
  return {
    get urls() { return files.map((f) => f.dataUrl); },
    clear() { files = []; render(); },
  };
}
const imgRefs = setupRefAttach('#imgChips', '#imgAttachBtn', '#imgFile', 4);
const vidRefs = setupRefAttach('#vidChips', '#vidAttachBtn', '#vidFile', 1);

/* ------------------------------ gallery chung ------------------------------ */
// Mọi ảnh tạo ra (tab Ảnh lẫn chat) đều vào đây; lưu localStorage để giữ lại sau reload.
const GAL_KEY = 'muse_gallery_v1';
const GAL_MAX = 60;
let galleryItems = []; // { url, prompt, size, src: 'image'|'chat', ts }

function loadGalleryStore() {
  try { return JSON.parse(localStorage.getItem(GAL_KEY)) || []; } catch { return []; }
}

function persistGallery() {
  try {
    // data URL lớn (b64) không lưu được — chỉ giữ URL thật, cái quá lớn bỏ qua
    const storable = galleryItems.filter((it) => !it.url.startsWith('data:') || it.url.length < 300000);
    localStorage.setItem(GAL_KEY, JSON.stringify(storable.slice(0, GAL_MAX)));
  } catch { /* hết quota localStorage — vẫn hiển thị trong phiên */ }
}

function addGalleryItems(items) {
  const gal = $('#imgGallery');
  let added = 0;
  for (const it of items) {
    if (!it.url) continue;
    if (galleryItems.some((g) => g.url === it.url)) continue; // chống trùng lặp
    const entry = { ...it, ts: Date.now() };
    galleryItems.unshift(entry);
    gal.prepend(imageItem(entry.url, entry.prompt || 'Ảnh muse', entry.size, entry.src));
    added++;
  }
  galleryItems = galleryItems.slice(0, GAL_MAX);
  if (added) persistGallery();
  return added;
}

function restoreGallery() {
  galleryItems = loadGalleryStore();
  const gal = $('#imgGallery');
  for (const it of galleryItems.slice().reverse()) {
    gal.prepend(imageItem(it.url, it.prompt || 'Ảnh muse', it.size, it.src));
  }
}

/* ------------------------------ image ------------------------------ */
$('#imageForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const prompt = $('#imgPrompt').value.trim();
  if (!prompt) return;
  const btn = $('#imgBtn');
  const st = $('#imgStatus');
  btn.disabled = true;
  st.classList.remove('hidden', 'error');
  st.textContent = '🎨 Đang tạo ảnh…';
  try {
    const body = {
      model: $('#imgModel').value || cfg.media.image || 'muse-image',
      prompt,
      size: $('#imgSize').value,
      n: Math.max(1, Math.min(4, Number($('#imgN').value) || 1)),
    };
    if (imgRefs.urls.length) body.image = imgRefs.urls;
    const data = await api('/api/images', { method: 'POST', body: JSON.stringify(body) });
    const items = (data.data || [])
      .map((d) => (d.b64_json ? `data:image/png;base64,${d.b64_json}` : absUrl(d.url)))
      .filter(Boolean);
    if (!items.length) throw new Error('Gateway không trả về ảnh nào: ' + JSON.stringify(data).slice(0, 300));
    addGalleryItems(items.map((u) => ({ url: u, prompt, size: $('#imgSize').value, src: 'image' })));
    st.textContent = `✅ Đã tạo ${items.length} ảnh`;
    imgRefs.clear();
    setTimeout(() => st.classList.add('hidden'), 2500);
  } catch (err) {
    st.classList.add('error');
    st.textContent = friendlyError(err.message);
    toast(friendlyError(err.message));
  } finally {
    btn.disabled = false;
  }
});

function imageItem(url, prompt, size, src) {
  const div = document.createElement('div');
  div.className = 'gallery-item' + (src === 'chat' ? ' from-chat' : '');
  const short = escapeHtml(prompt.length > 40 ? prompt.slice(0, 40) + '…' : prompt);
  // Đặt width/height + aspect-ratio để tránh layout shift khi ảnh tải.
  const dims = (size || ($('#imgSize') ? $('#imgSize').value : '') || '1024x1024').split('x');
  const tag = src === 'chat' ? '<b class="src-tag" title="Tạo từ chat">🗨</b> ' : '';
  div.innerHTML =
    `<img src="${url}" alt="${short}" loading="lazy" decoding="async" width="${escapeHtml(dims[0])}" height="${escapeHtml(dims[1] || '1024')}">` +
    `<div class="cap"><span title="${escapeHtml(prompt)}">${tag}${short}</span>` +
    `<span class="cap-actions"><a href="${url}" target="_blank" rel="noopener">Mở ↗</a>` +
    `<a href="${url}" download>⬇ Tải</a></span></div>`;
  return div;
}

/* ------------------------------ video ------------------------------ */
const DONE_STATUSES = ['completed', 'complete', 'succeeded', 'success', 'ready', 'done', 'finished'];
const FAIL_STATUSES = ['failed', 'error', 'cancelled', 'canceled', 'expired'];

function extractTaskId(d) {
  return d?.task_id || d?.id || d?.data?.task_id || d?.data?.id || d?.task?.id || d?.data?.task?.id || null;
}

function statusOf(d) {
  const s = d?.status || d?.state || d?.data?.status || d?.data?.state || d?.task?.status || '';
  return String(s).toLowerCase().trim();
}

function deepMp4(obj, depth = 0) {
  if (!obj || depth > 6) return null;
  if (typeof obj === 'string') return /\.mp4(\?|$)/i.test(obj) || obj.includes('/v1/media/') ? obj : null;
  if (Array.isArray(obj)) {
    for (const v of obj) {
      const r = deepMp4(v, depth + 1);
      if (r) return r;
    }
    return null;
  }
  if (typeof obj === 'object') {
    for (const v of Object.values(obj)) {
      const r = deepMp4(v, depth + 1);
      if (r) return r;
    }
  }
  return null;
}

function extractVideoUrl(d) {
  const cands = [
    d?.url, d?.video_url, d?.videoUrl, d?.link, d?.mp4_url,
    d?.data?.url, d?.data?.video_url, d?.data?.link, d?.data?.videoUrl,
    d?.task?.url, d?.result?.url,
  ];
  const found = cands.find((u) => typeof u === 'string' && u);
  if (found) return found;
  const deep = deepMp4(d);
  if (deep) return deep;
  const mediaId = d?.media_id || d?.file_id || d?.video_id || d?.data?.media_id || d?.data?.file_id;
  if (mediaId) return `/v1/media/${mediaId}.mp4`;
  return null;
}

function createVideoCard(prompt) {
  const card = document.createElement('div');
  card.className = 'video-card';
  card.innerHTML =
    `<div class="vhead"><div class="vprompt">${escapeHtml(prompt)}</div>` +
    `<span class="pill run">⏳ đang xử lý…</span></div>` +
    `<div class="vbody muted">Chờ kết quả…</div>` +
    `<details class="hidden"><summary>JSON thô</summary><pre></pre></details>`;
  $('#vidResults').prepend(card);
  return card;
}

$('#videoForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const prompt = $('#vidPrompt').value.trim();
  if (!prompt) return;
  const btn = $('#vidBtn');
  const st = $('#vidStatus');
  btn.disabled = true;
  st.classList.remove('hidden', 'error');
  st.textContent = '🎬 Đang gửi yêu cầu tạo video…';
  try {
    const body = {
      model: $('#vidModel').value || cfg.media.video || 'muse-video',
      prompt,
      duration: Number($('#vidDuration').value),
      aspect_ratio: $('#vidRatio').value,
    };
    if (vidRefs.urls.length) body.image = vidRefs.urls[0];
    const data = await api('/api/videos', { method: 'POST', body: JSON.stringify(body) });
    st.classList.add('hidden');
    vidRefs.clear();
    await startVideoJob(prompt, data);
  } catch (err) {
    st.classList.add('error');
    st.textContent = friendlyError(err.message);
    toast(friendlyError(err.message));
  } finally {
    btn.disabled = false;
  }
});

async function startVideoJob(prompt, initial) {
  const card = createVideoCard(prompt);
  const pill = card.querySelector('.pill');
  const body = card.querySelector('.vbody');
  const details = card.querySelector('details');
  const pre = details.querySelector('pre');
  const showRaw = (d) => {
    details.classList.remove('hidden');
    pre.textContent = JSON.stringify(d, null, 2);
  };

  let current = initial;
  pre.textContent = JSON.stringify(initial, null, 2);

  const url0 = extractVideoUrl(initial);
  if (url0) {
    finishVideo(body, pill, absUrl(url0));
    return;
  }

  const tid = extractTaskId(initial);
  if (!tid) {
    pill.className = 'pill fail';
    pill.textContent = '❌ thiếu task_id';
    body.textContent = 'Không tìm thấy task_id trong phản hồi — xem JSON thô bên dưới.';
    showRaw(initial);
    return;
  }

  for (let i = 0; i < 300; i++) {
    await sleep(3000);
    try {
      current = await api('/api/videos/' + encodeURIComponent(tid));
    } catch (err) {
      body.textContent = `⚠️ Lỗi khi kiểm tra tiến độ: ${err.message} (thử lại… #${i + 1})`;
      continue;
    }
    pre.textContent = JSON.stringify(current, null, 2);
    const st = statusOf(current);
    body.className = 'vbody muted';
    body.textContent = `Trạng thái: ${st || 'không rõ'} — lần thử ${i + 1}`;

    if (DONE_STATUSES.includes(st)) {
      const u = extractVideoUrl(current);
      if (u) return finishVideo(body, pill, absUrl(u));
      pill.className = 'pill fail';
      pill.textContent = '❌ thiếu URL';
      body.textContent = 'Task hoàn tất nhưng không tìm thấy URL video — xem JSON thô.';
      showRaw(current);
      return;
    }
    if (FAIL_STATUSES.includes(st)) {
      pill.className = 'pill fail';
      pill.textContent = '❌ thất bại';
      const msg = errText(current?.error?.message || current?.error || current?.message) || 'Task thất bại.';
      body.textContent = msg;
      showRaw(current);
      toast(friendlyError(msg));
      return;
    }
  }
  pill.className = 'pill fail';
  pill.textContent = '❌ hết thời gian chờ';
  body.textContent = 'Không nhận được kết quả sau 15 phút.';
}

function finishVideo(body, pill, url) {
  pill.className = 'pill done';
  pill.textContent = '✅ hoàn tất';
  body.className = 'vbody';
  body.innerHTML =
    `<video controls autoplay loop muted src="${url}"></video>` +
    `<div style="margin-top:8px"><a href="${url}" target="_blank" rel="noopener">🔗 Mở video / tải về ↗</a></div>`;
}


/* ---------------- muse2api assistant (tab API) ---------------- */
const m2aStatusEl = $('#m2aStatus');
const m2aResultEl = $('#m2aResult');

function m2aShow(el, msg, ok = false) {
  el.classList.remove('hidden');
  el.classList.toggle('error', !ok);
  el.textContent = msg;
}

async function m2aCall(path, method = 'POST') {
  const r = await fetch(path, { method, headers: authHeaders() });
  const j = await r.json().catch(() => ({}));
  return { ok: r.ok && j.ok !== false, ...j };
}

$('#m2aCheck').addEventListener('click', async () => {
  const btn = $('#m2aCheck');
  btn.disabled = true;
  m2aShow(m2aStatusEl, '🔄 Đang kiểm tra…');
  try {
    const s = await m2aCall('/api/m2a/status', 'GET');
    const list = (s.accountsList || [])
      .map((a) => `${a.label || a.id} (${a.status}${a.enabled ? '' : ', tắt'})`)
      .join(', ');
    m2aShow(
      m2aStatusEl,
      `Gateway: ${s.gateway ? '✅ đang chạy' : '❌ tắt'} · Chrome CDP: ${s.chrome ? '✅' : '❌'}` +
      ` · Admin key: ${s.keyConfigured ? '✅' : '❌'} · Accounts: ${s.accounts ?? '—'}${list ? ' — ' + list : ''}`,
      s.gateway && s.chrome,
    );
  } catch (e) {
    m2aShow(m2aStatusEl, 'Lỗi: ' + e.message);
  } finally {
    btn.disabled = false;
  }
});

$('#m2aStart').addEventListener('click', async () => {
  const btn = $('#m2aStart');
  btn.disabled = true;
  m2aShow(m2aStatusEl, '⏳ Đang khởi động gateway…');
  try {
    const j = await m2aCall('/api/m2a/start');
    m2aShow(m2aStatusEl, (j.ok ? '✅ ' : '❌ ') + (j.message || ''), j.ok);
  } catch (e) {
    m2aShow(m2aStatusEl, 'Lỗi: ' + e.message);
  } finally {
    btn.disabled = false;
  }
});

$('#m2aOpen').addEventListener('click', async () => {
  const btn = $('#m2aOpen');
  btn.disabled = true;
  try {
    const j = await m2aCall('/api/m2a/open-muse');
    m2aShow(m2aResultEl, (j.ok ? '🌐 ' : '❌ ') + (j.message || ''), j.ok);
  } catch (e) {
    m2aShow(m2aResultEl, 'Lỗi: ' + e.message);
  } finally {
    btn.disabled = false;
  }
});

$('#m2aImport').addEventListener('click', async () => {
  const btn = $('#m2aImport');
  btn.disabled = true;
  m2aShow(m2aResultEl, '🧲 Đang đọc cookie muse.ai từ Chrome và thêm account…');
  try {
    const j = await m2aCall('/api/m2a/import');
    m2aShow(m2aResultEl, (j.ok ? '✅ ' : '❌ ') + (j.message || ''), j.ok);
  } catch (e) {
    m2aShow(m2aResultEl, 'Lỗi: ' + e.message);
  } finally {
    btn.disabled = false;
    $('#m2aCheck').click();
  }
});



