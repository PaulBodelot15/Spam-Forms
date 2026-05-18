// Service worker — reçoit le body exact capturé par interceptor.js et envoie N requêtes.
// Origine chrome-extension:// → cross-origin vers docs.google.com → aucun cookie Google
// envoyé par défaut → chaque POST est traité comme une nouvelle soumission anonyme.

chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg.type !== 'START') return true;

  const { formAction, rawBody, n, delay } = msg;
  const sourceTabId = sender.tab.id;

  async function run() {
    let success = 0;

    for (let i = 0; i < n; i++) {
      if (i > 0) await new Promise(r => setTimeout(r, delay));

      try {
        const res = await fetch(formAction, {
          method:  'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body:    rawBody, // copie exacte du body que Google Forms a construit
        });

        // Google répond 200 (ou redirige) quand la soumission est acceptée
        if (res.ok || res.redirected) success++;

      } catch (err) {
        console.warn('[GFR] erreur requête', i + 1, ':', err.message);
      }

      chrome.tabs.sendMessage(sourceTabId, {
        type: 'PROGRESS', current: i + 1, total: n,
      }).catch(() => {});
    }

    chrome.tabs.sendMessage(sourceTabId, {
      type: 'DONE', success, total: n,
    }).catch(() => {});
  }

  run();
  return true; // maintient le canal de message ouvert pour les sendMessage async
});
