/* The site cache's switch (viewer/site/blackbox-sw.js, CONTRACT §18.5): the site bar registers the service worker that
   keeps a built site's files in the browser, so a dashboard switch asks the server once (the build record) instead of for
   every file again.

   OPT-IN since 0.1.19. WHY: measured inside Vibe Tracks (its agent, a vt serve on six real boxes, a sidebar click to
   window.__dash.ready, three alternating rounds), a warm switch after a reload took median 763 ms on 0.1.12 and 1142 ms
   with the worker (0.1.18): on 127.0.0.1 the network is nearly free, so the worker's start-up, its Cache Storage reads
   and the uncached record only add time.

   Three values, the line below rewritten by `blackbox build` in the copy it puts in a site (package/src/blackbox_agent/
   site.py, SITE_CACHE_LINE):
     null   the viewer's own source (Storybook, the demo): nothing at all
     'off'  a default build: register nothing, and unregister this site's own worker, so a browser that installed 0.1.18's
            drops it on its next page load
     'on'   `blackbox build --site-cache`: register blackbox-sw.js, which the build writes at the site's root
   This file sits at <site>/dashboard/viewer/src/core/, so the site's root is four folders up. */
export const SITE_CACHE = null;

const WORKER = 'blackbox-sw.js';

/** Register (on) or remove (off) the worker over the site's root; null when there is nothing to do or the browser has no
    service workers for this page (an old browser, an opaque sandboxed frame), a promise otherwise. Never throws. */
export function registerSiteCache(flag = SITE_CACHE, nav = typeof navigator === 'undefined' ? undefined : navigator) {
  if (!flag || !nav) return null;
  try {
    const sw = nav.serviceWorker;
    if (!sw) return null;
    const root = new URL('../../../../', import.meta.url);
    if (flag === 'off') {
      if (typeof sw.getRegistrations !== 'function') return null;
      const mine = new URL(WORKER, root).href;
      return Promise.resolve(sw.getRegistrations())
        .then((all) => Promise.all(all.filter((r) => r.scope === root.href
          && [r.active, r.waiting, r.installing].some((w) => w && w.scriptURL === mine)).map((r) => r.unregister())))
        .catch(() => null);
    }
    if (flag !== 'on' || typeof sw.register !== 'function') return null;
    return Promise.resolve(sw.register(new URL(WORKER, root), { scope: root.href }))
      .catch((e) => { console.info('[site cache] not registered:', e && e.message || e); return null; });
  } catch (e) {
    return null;
  }
}
