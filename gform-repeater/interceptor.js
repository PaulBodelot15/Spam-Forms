// Monde MAIN — s'exécute avant tout script de Google Forms.
// Monkey-patche window.fetch pour capturer le body exact de la soumission.
// Communication avec content.js (monde ISOLÉ) : uniquement via CustomEvent sur document.
// sessionStorage n'est PAS partagé entre MAIN et ISOLATED — on ne l'utilise pas.
(function () {
  const _fetch = window.fetch;

  window.fetch = function (input, init) {
    const url = typeof input === 'string' ? input : (input && input.url);

    if (url && url.includes('formResponse') && init && init.method?.toUpperCase() === 'POST') {
      let body = init.body;

      // Normalise vers une string URLencoded quelle que soit la forme originale
      if (body instanceof URLSearchParams) body = body.toString();
      if (body instanceof FormData) {
        const p = new URLSearchParams();
        body.forEach((v, k) => p.append(k, v));
        body = p.toString();
      }

      if (typeof body === 'string' && body) {
        // CustomEvent : seul pont fiable entre monde MAIN et monde ISOLÉ.
        // L'event est dispatché AVANT que Google reçoive la réponse fetch →
        // content.js crée la modale synchroniquement, visible avant toute mise à jour du DOM.
        document.dispatchEvent(new CustomEvent('__gfr_intercepted', {
          detail: { url, body },
        }));
      }
    }

    // Laisse Google Forms faire sa soumission normale.
    return _fetch.apply(this, arguments);
  };
})();
