const DELAY_MS = 500;
let isRunning = false;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// FormData seul ne suffit pas : React stocke les valeurs dans son état interne
// et ne les synchronise pas toujours vers les champs hidden avant le clic.
function captureEntries(form) {
  const entries = {};

  try {
    new FormData(form).forEach((v, k) => {
      if (!k) return;
      entries[k] = k in entries ? [].concat(entries[k], v) : v;
    });
  } catch (_) {}

  form.querySelectorAll('input[name], textarea[name], select[name]').forEach(el => {
    const k = el.name;
    if (!k || el.type === 'hidden')              return;
    if (el.type === 'radio'    && !el.checked)   return;
    if (el.type === 'checkbox' && !el.checked)   return;
    if (k in entries)  entries[k] = [].concat(entries[k], el.value);
    else if (el.value) entries[k] = el.value;
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
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      credentials: 'include',
      redirect: 'follow',
      signal: ctrl.signal,
    });
  } finally {
    clearTimeout(t);
  }
}

function askRepetitions() {
  return new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.id = '_gfr_overlay';
    overlay.style.cssText = [
      'position:fixed', 'inset:0', 'z-index:2147483647',
      'background:rgba(0,0,0,.45)',
      'display:flex', 'align-items:center', 'justify-content:center',
    ].join(';');

    const box = document.createElement('div');
    box.style.cssText = [
      'background:#fff', 'border-radius:8px', 'padding:28px 24px',
      'min-width:320px', 'box-shadow:0 8px 28px rgba(0,0,0,.25)',
      'font-family:Google Sans,Roboto,sans-serif',
    ].join(';');

    box.innerHTML = `
      <p style="margin:0 0 6px;font-size:16px;font-weight:500;color:#202124">GForm Repeater</p>
      <p style="margin:0 0 18px;font-size:14px;color:#5f6368">Combien de r&eacute;p&eacute;titions souhaitez-vous envoyer&nbsp;?</p>
      <input id="_gfr_n" type="number" min="1" value="5"
        style="width:100%;padding:8px 12px;border:1px solid #dadce0;border-radius:4px;font-size:14px;box-sizing:border-box;margin-bottom:18px;outline:none">
      <div style="display:flex;gap:8px;justify-content:flex-end">
        <button id="_gfr_cancel" style="padding:8px 20px;border:1px solid #dadce0;border-radius:4px;background:#fff;color:#5f6368;font-size:14px;cursor:pointer">Annuler</button>
        <button id="_gfr_ok" style="padding:8px 20px;border:none;border-radius:4px;background:#1a73e8;color:#fff;font-size:14px;font-weight:500;cursor:pointer">Envoyer</button>
      </div>
    `;

    overlay.appendChild(box);
    document.body.appendChild(overlay);

    const input = box.querySelector('#_gfr_n');
    input.focus();
    input.select();

    const confirm = () => {
      const n = parseInt(input.value, 10);
      if (!Number.isFinite(n) || n < 1) { input.style.borderColor = '#d93025'; return; }
      overlay.remove();
      resolve(n);
    };

    box.querySelector('#_gfr_ok').addEventListener('click', confirm);
    box.querySelector('#_gfr_cancel').addEventListener('click', () => { overlay.remove(); resolve(null); });
    input.addEventListener('keydown', e => { if (e.key === 'Enter') confirm(); });
  });
}

function getBanner() {
  let b = document.getElementById('_gfr_banner');
  if (!b) {
    b = document.createElement('div');
    b.id = '_gfr_banner';
    b.style.cssText = [
      'position:fixed', 'top:0', 'left:0', 'right:0', 'z-index:2147483646',
      'padding:12px 20px', 'font-family:Google Sans,Roboto,sans-serif',
      'font-size:14px', 'font-weight:500', 'color:#fff', 'text-align:center',
    ].join(';');
    document.body.appendChild(b);
  }
  return b;
}

function isSubmitButton(el) {
  if (el.closest('#_gfr_overlay')) return false;
  const btn = el.closest('[role="button"]') ?? el;
  return /envoyer|submit|soumettre/i.test(btn.textContent.trim());
}

async function handleGlobalClick(e) {
  if (isRunning) return;
  if (!isSubmitButton(e.target)) return;

  const form = document.querySelector('form[action*="formResponse"]');
  if (!form) return;

  // Court-circuite le gestionnaire interne de Google avant qu'il ne s'exécute.
  e.preventDefault();
  e.stopPropagation();

  // Capture au moment du clic, avant l'ouverture de la modale.
  const entries  = captureEntries(form);
  const submitEl = e.target.closest('[role="button"]') ?? e.target;

  const n = await askRepetitions();
  if (n === null) return; // annulé — on ne soumet pas

  const action = form.action.includes('formResponse')
    ? form.action
    : location.href.replace(/\/viewform.*$/, '/formResponse');

  const body   = buildBody(entries);
  const banner = getBanner();
  banner.style.background = '#1a73e8';
  banner.textContent = `Envoi en cours… 0 / ${n}`;
  isRunning = true;

  for (let i = 0; i < n; i++) {
    if (i > 0) await sleep(DELAY_MS);
    try {
      await postForm(action, body);
    } catch (err) {
      console.warn('[GFormRepeater] erreur:', err.name === 'AbortError' ? 'timeout' : err);
    }
    banner.textContent = `Envoi en cours… ${i + 1} / ${n}`;
  }

  banner.style.background = '#0f9d58';
  banner.textContent = `✓ ${n} réponses envoyées avec succès !`;
  isRunning = false;

  // Supprime notre intercepteur puis re-déclenche le bouton pour laisser Google
  // exécuter sa logique native et afficher la page de confirmation.
  await sleep(1000);
  document.removeEventListener('mousedown', handleGlobalClick, true);

  const opts = { bubbles: true, cancelable: true, view: window };
  submitEl.dispatchEvent(new MouseEvent('mousedown', opts));
  submitEl.dispatchEvent(new MouseEvent('mouseup', opts));
  submitEl.dispatchEvent(new MouseEvent('click', opts));
}

document.addEventListener('mousedown', handleGlobalClick, true);
