const KEY = 'gformRepeater';

async function setState(s) { await chrome.storage.local.set({ [KEY]: s }); }
async function getState()  { return (await chrome.storage.local.get(KEY))[KEY] ?? null; }

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// Capture all form entries via FormData + visible named inputs fallback.
function captureEntries(form) {
  const entries = {};

  try {
    new FormData(form).forEach((v, k) => {
      if (!k) return;
      if (k in entries) entries[k] = [].concat(entries[k], v);
      else entries[k] = v;
    });
  } catch (_) {}

  // Fallback: visible inputs React may not have synced to hidden fields yet.
  form.querySelectorAll('input[name], textarea[name], select[name]').forEach(el => {
    const k = el.name;
    if (!k) return;
    if (el.type === 'radio'    && !el.checked)  return;
    if (el.type === 'checkbox' && !el.checked)  return;
    if (el.type === 'hidden')                   return; // already got these via FormData
    if (k in entries)   entries[k] = [].concat(entries[k], el.value);
    else if (el.value)  entries[k] = el.value;
  });

  return entries;
}

function buildBody(entries) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(entries)) {
    [].concat(v).forEach(val => p.append(k, val));
  }
  return p.toString();
}

async function postForm(action, body) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 20_000);
  try {
    await fetch(action, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Referer': action.replace('formResponse', 'viewform'),
      },
      body,
      credentials: 'include',
      redirect: 'follow',
      signal: ctrl.signal,
    });
  } finally {
    clearTimeout(t);
  }
}

function notifyPopup(msg) {
  chrome.runtime.sendMessage(msg).catch(() => {});
}

let running = false;

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {

  // ── STOP ──────────────────────────────────────────────────────────────────
  if (msg.type === 'STOP') {
    running = false;
    chrome.storage.local.remove(KEY);
    sendResponse({ ok: true });
    return true;
  }

  // ── START ─────────────────────────────────────────────────────────────────
  if (msg.type !== 'START') return;

  (async () => {
    if (running) {
      sendResponse({ ok: false, error: 'Déjà en cours.' });
      return;
    }

    const form = document.querySelector('form[action*="formResponse"]');
    if (!form) {
      sendResponse({ ok: false, error: 'Formulaire Google non trouvé sur cette page.' });
      return;
    }

    const entries = captureEntries(form);
    const entryKeys = Object.keys(entries).filter(k => k.startsWith('entry.'));

    console.log('[GFormRepeater] captured entries:', entries);

    if (!entryKeys.length) {
      sendResponse({ ok: false, error: 'Aucun champ entry.* capturé — remplissez le formulaire d\'abord.' });
      return;
    }

    const action = form.action.includes('formResponse')
      ? form.action
      : location.href.replace(/\/viewform.*$/, '/formResponse');

    const body = buildBody(entries);
    const { total, delay } = msg;

    sendResponse({ ok: true });
    running = true;
    await setState({ active: true, total, submitted: 0, delay });

    let submitted = 0;

    for (let i = 0; i < total; i++) {
      if (!running) break;
      if (i > 0) await sleep(delay);
      if (!running) break;

      try {
        await postForm(action, body);
      } catch (e) {
        console.warn('[GFormRepeater] submit error:', e.name === 'AbortError' ? 'timeout' : e);
      }

      submitted = i + 1;
      await setState({ active: submitted < total, total, submitted, delay });
      notifyPopup({ type: 'PROGRESS', submitted, total });
    }

    running = false;
    await setState({ active: false, total, submitted, delay });
    if (submitted >= total) notifyPopup({ type: 'DONE', total });
  })();

  return true; // keep channel open for async sendResponse
});
