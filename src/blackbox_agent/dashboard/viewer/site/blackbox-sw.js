/* The site cache: a service worker over one built box site (viewer/CONTRACT.md §18.5), so switching dashboards does not
   re-download the site. `blackbox build` writes this file at the site's root (beside nav.json and blackbox-build.json);
   the site bar (bb-site-nav, src/core/site-cache.js) registers it with the site's root as its scope.

   WHY (Zach, 2026-11-25, on trajectory_tracking_agent's switcher in Vibe Tracks' Preview): "I don't like how long it
   takes to switch between workspaces.. can you not like cache the result or something?" Each dashboard is its own page,
   so a switch reloads the viewer: ~100 module files on the Black box. Vibe Tracks serves a box site `no-cache` and
   `blackbox serve` serves files built seconds ago (heuristic freshness ~0), so every one of those was asked of the server
   again on every switch (measured: 97 requests, ~1.9 s to ready on the Black box in Vibe Tracks; 0 requests and ~0.4 s
   once served from here). A host's headers are not this package's to set; the page's own cache works on every host
   (GitHub Pages, `blackbox serve`, Vibe Tracks' frame).

   Never stale: each page load (a navigation) first asks the server for blackbox-build.json, bypassing every cache. The
   build rewrites that record on every build, with a digest of every file it wrote, so its text names the build. The
   cache is named by that text's hash; a new build gets a new, empty cache and the old one is deleted. When the record
   cannot be read, nothing is served from the cache (the request goes to the server as if this file did not exist).
   Within one page load, every file it asks for is served from the build's cache, fetched once on first use.

   Left alone (the browser's own path): anything not a GET, outside this site's scope, a Range request (video, .rrd),
   a request that asks for no cache, the record itself, and a response that is not a plain 200 or is over MAX_BYTES (big datasets stay on the server). */
const SCOPE = self.registration ? self.registration.scope : new URL('./', self.location.href).href;
const RECORD = new URL('blackbox-build.json', SCOPE).href;
const PREFIX = `blackbox-site ${SCOPE} `;
const MAX_BYTES = 24 * 1024 * 1024;

/** FNV-1a over the record's text: a name for the build, not a security check (the server is the site's own). */
function hash(text) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, '0');
}

/** The cache for the build the server has now, its stale siblings deleted; rejects when the record cannot be read. */
async function verify() {
  const res = await fetch(RECORD, { cache: 'no-store' });
  if (!res.ok) throw new Error(`blackbox-build.json: HTTP ${res.status}`);
  const name = PREFIX + hash(await res.text());
  for (const old of await caches.keys()) if (old.startsWith(PREFIX) && old !== name) await caches.delete(old);
  return name;
}

let current = null; // the build check of the latest page load: Promise<cache name>

/** Whether this file serves a request at all (else the browser fetches it as usual). A page that asks for no cache
    (fetch(url, {cache: 'no-store'})) gets none. */
function handles(request) {
  if (request.method !== 'GET' || !request.url.startsWith(SCOPE)) return false;
  if (request.headers.has('range') || request.cache === 'no-store' || request.cache === 'reload') return false;
  return request.url.split('#')[0] !== RECORD;
}

async function respond(request, check) {
  let name;
  try { name = await check; } catch (e) {
    if (current === check) current = null; // ask again on the next request
    return fetch(request);
  }
  const cache = await caches.open(name);
  const hit = await cache.match(request, { ignoreVary: true });
  if (hit) return hit;
  const res = await fetch(request);
  const size = Number(res.headers.get('content-length') || 0);
  if (res.status === 200 && res.type === 'basic' && size <= MAX_BYTES) {
    await cache.put(request, res.clone()).catch(() => {}); // a full disk only means no cache
  }
  return res;
}

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (!handles(request)) return;
  // WHY a fresh check on every page load, and on the first request after this worker (re)started: the server is the only
  // one that knows whether a new build landed; one tiny request per switch instead of a hundred
  if (request.mode === 'navigate' || !current) current = verify();
  event.respondWith(respond(request, current));
});
