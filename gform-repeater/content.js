// Monde ISOLÉ — reçoit les données via CustomEvent depuis interceptor.js (monde MAIN),
// affiche la modale, délègue les N envois au service worker background.

let isRunning = false;
let activeOverlay = null; // référence à la modale active pour la MutationObserver

// ── Modale ─────────────────────────────────────────────────────────────────────
// Retourne une Promise qui résout avec N (entier) ou null (annulation).
// La modale est créée synchroniquement et attachée à <html> (documentElement),
// pas à <body> : Google Forms peut remplacer le contenu de <body> lors de l'affichage
// de la page de confirmation SPA — documentElement lui n'est jamais recréé.

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

    // Attacher à <html>, pas à <body> — survit aux remplacements de body par la SPA
    document.documentElement.appendChild(overlay);
    activeOverlay = overlay;

    const input = box.querySelector('#_gfr_n');
    input.focus();
    input.select();

    const done = (value) => {
      overlay.remove();
      activeOverlay = null;
      resolve(value);
    };

    const confirm = () => {
      const n = parseInt(input.value, 10);
      if (!Number.isFinite(n) || n < 1) { input.style.borderColor = '#d93025'; return; }
      done(n);
    };

    box.querySelector('#_gfr_ok').addEventListener('click', confirm);
    box.querySelector('#_gfr_cancel').addEventListener('click', () => done(null));
    input.addEventListener('keydown', e => { if (e.key === 'Enter') confirm(); });
  });
}

// ── Bannière de progression ────────────────────────────────────────────────────
// Également attachée à documentElement pour la même raison.

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
    document.documentElement.appendChild(b);
  }
  return b;
}

// ── MutationObserver : ré-ancrage de la modale si Google remplace body ─────────
// Si Google Forms vide document.body lors de la transition vers la confirmation,
// l'overlay (attaché à html) survit. Mais si html lui-même était modifié (très rare),
// cet observer le ré-insère.

const domGuard = new MutationObserver(() => {
  if (activeOverlay && !document.documentElement.contains(activeOverlay)) {
    document.documentElement.appendChild(activeOverlay);
  }
});
domGuard.observe(document.documentElement, { childList: true });

// ── Interception du fetch Google Forms ─────────────────────────────────────────
// interceptor.js (monde MAIN) dispatche '__gfr_intercepted' sur document
// au moment où Google Forms appelle fetch() vers formResponse.
// Ce listener (monde ISOLÉ) le reçoit car les CustomEvents traversent la frontière
// MAIN ↔ ISOLATED via le DOM partagé.

document.addEventListener('__gfr_intercepted', async (e) => {
  if (isRunning) return;
  isRunning = true;

  const { url: formAction, body: rawBody } = e.detail;

  // La modale est créée ici synchroniquement (avant tout await) →
  // elle est dans le DOM avant que Google mette à jour la page.
  const n = await askRepetitions();

  if (n === null) {
    isRunning = false;
    return; // annulé
  }

  const banner = getBanner();
  banner.style.background = '#1a73e8';
  banner.textContent = `Envoi en cours… 0 / ${n}`;

  // Le service worker n'a pas de session Google (origine chrome-extension://)
  // → requêtes cross-origin → aucun cookie Google envoyé → pas de déduplication.
  chrome.runtime.sendMessage({
    type:       'START',
    formAction,
    rawBody,
    n,
    delay:      1000,
  });
});

// ── Messages de progression depuis background.js ───────────────────────────────

chrome.runtime.onMessage.addListener((msg) => {
  const banner = getBanner();
  if (msg.type === 'PROGRESS') {
    banner.style.background = '#1a73e8';
    banner.textContent = `Envoi en cours… ${msg.current} / ${msg.total}`;
  }
  if (msg.type === 'DONE') {
    banner.style.background = msg.success === msg.total ? '#0f9d58' : '#f29900';
    banner.textContent = `✓ ${msg.success} / ${msg.total} réponses envoyées avec succès.`;
    isRunning = false;
    setTimeout(() => banner.remove(), 6000);
  }
});
