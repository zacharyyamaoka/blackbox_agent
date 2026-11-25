/* The site cache's switch (viewer/site/blackbox-sw.js, CONTRACT §18.5): the site bar registers the service worker that
   keeps a built site's files in the browser, so switching dashboards asks the server once (the build record) instead of
   for every file again.

   Off here, in the viewer's own source: Storybook, the demo and the viewer's own pages have no blackbox-sw.js to register.
   `blackbox build` rewrites the line below to 'on' in the copy it puts in a site (package/src/blackbox_agent/site.py,
   SITE_CACHE_LINE), and writes the worker at the site's root; this file sits at <site>/dashboard/viewer/src/core/, so the
   root is four folders up. */
export const SITE_CACHE = null;

/** Register the worker over the site's root; null (and nothing asked of the browser) when the flag is off or the browser
    has no service workers for this page (an old browser, an opaque sandboxed frame), a promise otherwise. Never throws. */
export function registerSiteCache(flag = SITE_CACHE, nav = typeof navigator === 'undefined' ? undefined : navigator) {
  if (!flag || !nav) return null;
  try {
    const sw = nav.serviceWorker;
    if (!sw || typeof sw.register !== 'function') return null;
    const root = new URL('../../../../', import.meta.url);
    return Promise.resolve(sw.register(new URL('blackbox-sw.js', root), { scope: root.href }))
      .catch((e) => { console.info('[site cache] not registered:', e && e.message || e); return null; });
  } catch (e) {
    return null;
  }
}
