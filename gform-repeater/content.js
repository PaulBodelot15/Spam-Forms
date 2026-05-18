let isRunning = false;

// ── Capture des entry.* ────────────────────────────────────────────────────────

function captureEntries(form) {
  const entries = {};

  // Méthode principale : FormData (fonctionne si les hidden inputs sont à jour)
  try {
    new FormData(form).forEach((v, k) => {
      if (k.startsWith('entry.')) entries[k] = v;
    });
  } catch (_) {}

  // Fallback : interroger directement les éléments nommés entry.*
  // (nécessaire quand React n'a pas encore synchronisé son état vers les hidden inputs)
  if (Object.keys(entries).length === 0) {
    form.querySelectorAll('[name^="entry."]').forEach(el => {
      if (el.type === 'radio' || el.type === 'checkbox') {
        if (el.checked) entries[el.name] = el.value;
      } else if (el.value) {
        entries[el.name] = el.value;
      }
    });
  }

  return entries;
}

// ── Modale ─────────────────────────────────────────────────────────────────────

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

// ── Bannière de progression ────────────────────────────────────────────────────

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

// ── Écoute de la progression renvoyée par le background ───────────────────────

chrome.runtime.onMessage.addListener((msg) => {
  const banner = getBanner();
  if (msg.type === 'PROGRESS') {
    banner.style.background = '#1a73e8';
    banner.textContent = `Envoi en cours… ${msg.current} / ${msg.total}`;
  }
  if (msg.type === 'DONE') {
    banner.style.background = msg.success === msg.total ? '#0f9d58' : '#f29900';
    banner.textContent = `✓ ${msg.success} / ${msg.total} réponses envoyées.`;
    isRunning = false;
    setTimeout(() => banner.remove(), 6000);
  }
});

// ── Interception du clic natif ─────────────────────────────────────────────────

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

  e.preventDefault();
  e.stopPropagation();

  const entries = captureEntries(form);

  if (Object.keys(entries).length === 0) {
    alert('[GForm Repeater] Aucun champ entry.* trouvé. Remplissez le formulaire avant d\'envoyer.');
    return;
  }

  const n = await askRepetitions();
  if (n === null) return;

  isRunning = true;
  const banner = getBanner();
  banner.style.background = '#1a73e8';
  banner.textContent = `Envoi en cours… 0 / ${n}`;

  chrome.runtime.sendMessage({
    type:       'START',
    entries,
    formAction: form.action,  // URL formResponse exacte (attribut action du <form>)
    n,
    delay:      800,
  });
}

document.addEventListener('mousedown', handleGlobalClick, true);
