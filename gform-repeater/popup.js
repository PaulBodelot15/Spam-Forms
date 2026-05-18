const KEY = 'gformRepeater';

// ── DOM refs ─────────────────────────────────────────────────────────────────

const formSection     = document.getElementById('form-section');
const progressSection = document.getElementById('progress-section');
const progressLabel   = document.getElementById('progress-label');
const progressFill    = document.getElementById('progress-fill');
const statusEl        = document.getElementById('status');
const errorEl         = document.getElementById('error');
const launchBtn       = document.getElementById('launch-btn');
const stopBtn         = document.getElementById('stop-btn');

// ── helpers ──────────────────────────────────────────────────────────────────

async function getState() {
  return (await chrome.storage.local.get(KEY))[KEY] ?? null;
}

function showError(msg) {
  errorEl.textContent = msg;
}

function clearError() {
  errorEl.textContent = '';
}

function setProgress(submitted, total) {
  progressLabel.textContent = `${submitted} / ${total}`;
  const pct = total > 0 ? Math.round((submitted / total) * 100) : 0;
  progressFill.style.width = `${pct}%`;

  if (submitted >= total && total > 0) {
    statusEl.textContent = '✓ Terminé !';
    statusEl.className = 'done';
    stopBtn.disabled = true;
  } else {
    statusEl.textContent = 'En cours…';
    statusEl.className = '';
  }
}

function showProgressUI(submitted, total) {
  formSection.style.display = 'none';
  progressSection.style.display = 'block';
  setProgress(submitted, total);
}

function showFormUI() {
  formSection.style.display = 'block';
  progressSection.style.display = 'none';
}

// ── polling ──────────────────────────────────────────────────────────────────

let pollTimer = null;

function startPolling() {
  if (pollTimer) return;
  pollTimer = setInterval(async () => {
    const state = await getState();
    if (!state) { stopPolling(); showFormUI(); return; }
    setProgress(state.submitted, state.total);
    if (!state.active) stopPolling();
  }, 400);
}

function stopPolling() {
  if (!pollTimer) return;
  clearInterval(pollTimer);
  pollTimer = null;
}

// ── real-time messages from content script ───────────────────────────────────

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'PROGRESS') setProgress(msg.submitted, msg.total);
  if (msg.type === 'DONE')     setProgress(msg.total, msg.total);
});

// ── launch ───────────────────────────────────────────────────────────────────

launchBtn.addEventListener('click', async () => {
  clearError();

  const total = parseInt(document.getElementById('count').value, 10);
  const delay = parseInt(document.getElementById('delay').value, 10);

  if (!Number.isFinite(total) || total < 1)  return showError('Nombre invalide (min 1).');
  if (!Number.isFinite(delay) || delay < 0)  return showError('Délai invalide (min 0 ms).');

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  if (!tab?.url?.includes('docs.google.com/forms')) {
    return showError('Ouvrir un Google Form d\'abord.');
  }

  launchBtn.disabled = true;

  let resp;
  try {
    resp = await chrome.tabs.sendMessage(tab.id, { type: 'START', total, delay });
  } catch {
    launchBtn.disabled = false;
    return showError('Recharger la page du formulaire puis réessayer.');
  }

  launchBtn.disabled = false;

  if (!resp?.ok) return showError(resp?.error ?? 'Erreur inconnue.');

  showProgressUI(0, total);
  startPolling();
});

// ── stop ─────────────────────────────────────────────────────────────────────

stopBtn.addEventListener('click', async () => {
  // Tell content script to stop immediately (breaks the fetch loop)
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab) chrome.tabs.sendMessage(tab.id, { type: 'STOP' }).catch(() => {});
  await chrome.storage.local.remove(KEY);
  stopPolling();
  showFormUI();
});

// ── init: restore UI if a session is in progress ─────────────────────────────

(async () => {
  const state = await getState();
  if (!state) return;
  showProgressUI(state.submitted, state.total);
  if (state.active) startPolling();
})();
