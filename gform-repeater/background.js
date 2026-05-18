function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── Attente du chargement complet d'un onglet ──────────────────────────────────

function waitForTabLoad(tabId) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      reject(new Error('timeout chargement onglet'));
    }, 25_000);

    function listener(id, info) {
      if (id !== tabId || info.status !== 'complete') return;
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(listener);
      resolve();
    }

    chrome.tabs.onUpdated.addListener(listener);

    // Résout immédiatement si l'onglet est déjà chargé (rare mais possible)
    chrome.tabs.get(tabId).then(tab => {
      if (tab.status === 'complete') {
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    }).catch(() => {});
  });
}

// ── Script injecté dans chaque onglet de formulaire ───────────────────────────
// Exécuté dans le monde isolé de l'extension, partage window avec content.js.

function fillAndSubmit(entries) {
  return new Promise(resolve => {

    function tryFill(attempt) {
      if (attempt > 30) { resolve('timeout'); return; }

      const form = document.querySelector('form[action*="formResponse"]');
      if (!form) { setTimeout(() => tryFill(attempt + 1), 300); return; }

      for (const [key, rawValue] of Object.entries(entries)) {
        const values = [].concat(rawValue);

        // ── Radio / Checkbox ───────────────────────────────────────────────────
        const toggles = form.querySelectorAll(
          `input[type="radio"][name="${key}"], input[type="checkbox"][name="${key}"]`
        );
        if (toggles.length > 0) {
          toggles.forEach(t => {
            if (values.includes(t.value) && !t.checked) t.click();
          });
          continue;
        }

        // ── Textarea ───────────────────────────────────────────────────────────
        const ta = form.querySelector(`textarea[name="${key}"]`);
        if (ta) {
          const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
          setter.call(ta, values[0] ?? '');
          ta.dispatchEvent(new Event('input',  { bubbles: true }));
          ta.dispatchEvent(new Event('change', { bubbles: true }));
          continue;
        }

        // ── Input texte (exclut hidden / radio / checkbox) ─────────────────────
        const inp = form.querySelector(
          `input[name="${key}"]:not([type="hidden"]):not([type="radio"]):not([type="checkbox"])`
        );
        if (inp) {
          const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
          setter.call(inp, values[0] ?? '');
          inp.dispatchEvent(new Event('input',  { bubbles: true }));
          inp.dispatchEvent(new Event('change', { bubbles: true }));
        }
      }

      // Drapeau partagé avec content.js (même monde isolé) :
      // empêche handleGlobalClick d'intercepter ce clic automatisé.
      window._gfrAutoSubmit = true;

      // Laisse React traiter les changements avant de cliquer
      setTimeout(() => {
        const btn = [...document.querySelectorAll('[role="button"]')]
          .find(b => /envoyer|submit|soumettre/i.test(b.textContent.trim()));

        if (btn) {
          const opts = { bubbles: true, cancelable: true, view: window };
          btn.dispatchEvent(new MouseEvent('mousedown', opts));
          btn.dispatchEvent(new MouseEvent('mouseup',   opts));
          btn.dispatchEvent(new MouseEvent('click',     opts));
        }

        resolve('submitted');
      }, 1500);
    }

    tryFill(0);
  });
}

// ── Listener principal ─────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg.type !== 'START') return;

  const { entries, formUrl, n, delay } = msg;
  const sourceTabId = sender.tab.id;

  (async () => {
    for (let i = 0; i < n; i++) {
      if (i > 0) await sleep(delay);

      let tabId;
      try {
        const tab = await chrome.tabs.create({ url: formUrl, active: false });
        tabId = tab.id;

        // Attendre le chargement complet (SPA incluse)
        await waitForTabLoad(tabId);
        await sleep(800); // extra : SPA Google Forms finit de rendre ses composants

        // Remplir et soumettre via DOM natif dans l'onglet
        await chrome.scripting.executeScript({
          target: { tabId },
          func:   fillAndSubmit,
          args:   [entries],
        });

        // Attendre que la navigation de confirmation soit terminée
        await sleep(3000);

      } catch (err) {
        console.warn(`[GFormRepeater] onglet ${i + 1} :`, err?.message ?? err);
      } finally {
        if (tabId) chrome.tabs.remove(tabId).catch(() => {});
      }

      // Notifier content.js de la progression
      chrome.tabs.sendMessage(sourceTabId, {
        type:    'PROGRESS',
        current: i + 1,
        total:   n,
      }).catch(() => {});
    }

    chrome.tabs.sendMessage(sourceTabId, { type: 'DONE', total: n }).catch(() => {});
  })();
});
