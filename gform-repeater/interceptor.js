// Monde MAIN — s'exécute avant tout script de Google Forms.
// Monkey-patche window.fetch pour capturer le body exact de la soumission finale.
(function () {
  const _fetch = window.fetch;

  window.fetch = function (input, init) {
    const url = typeof input === 'string' ? input : (input && input.url);

    if (url && url.includes('formResponse') && init && init.method === 'POST') {
      // Normalise le body en string URLencoded quelle que soit sa forme originale
      let body = init.body;
      if (body instanceof URLSearchParams) body = body.toString();
      if (typeof body !== 'string' || !body) {
        return _fetch.apply(this, arguments);
      }

      // Communique avec content.js (monde isolé) via CustomEvent sur document.
      // window.__gfr* n'est PAS lisible depuis le monde isolé — seuls les events DOM
      // traversent la frontière MAIN ↔ ISOLATED.
      document.dispatchEvent(new CustomEvent('__gfr_intercepted', {
        detail: { url, body },
      }));

      // Retourne une réponse fictive 200 pour que le code de Google Forms
      // ne navigue pas vers la page de confirmation — on garde la main.
      return Promise.resolve(new Response('', { status: 200, statusText: 'OK' }));
    }

    return _fetch.apply(this, arguments);
  };
})();
