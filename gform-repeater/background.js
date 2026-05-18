chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg.type !== 'START') return true;

  const { entries, formAction, n, delay } = msg;
  const sourceTabId = sender.tab.id;

  async function run() {
    let success = 0;

    for (let i = 0; i < n; i++) {
      if (i > 0) await new Promise(r => setTimeout(r, delay));

      try {
        // Le service worker n'a pas de session navigateur : aucun cookie Google
        // n'est attaché → chaque requête apparaît comme une soumission indépendante.
        const body = new URLSearchParams(entries).toString();

        const res = await fetch(formAction, {
          method:  'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body,
        });

        // Google répond 200 (avec redirect suivi) ou la réponse est marquée redirected
        if (res.ok || res.redirected) success++;

      } catch (err) {
        console.warn('[GFR] erreur requête', i + 1, err.message);
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
  return true; // maintient le canal ouvert pour les sendMessage asynchrones
});
