// Service worker: guarda la app en el celular para que abra al instante y sin conexión.
// Todo sale del caché; cada versión nueva (VERSION) baja la app completa de una vez y reemplaza la anterior,
// así nunca se mezclan archivos viejos y nuevos. Una actualización se ve a partir de la apertura siguiente.
const VERSION = 'teambull-bio-v30';
// Modelos y motor de la pose (unos 20 MB): no cambian entre versiones, quedan en un caché aparte.
const MODELS = 'teambull-bio-modelos';
const SHELL = ['./', 'index.html', 'styles.css', 'teambull.css', 'manifest.webmanifest', 'icons/icon-192.png',
  'js/app.js', 'js/analysis.js', 'js/athletes.js', 'js/audio.js', 'js/auth.js', 'js/config.js', 'js/pose.js',
  'js/race.js', 'js/race-ui.js', 'js/clip.js', 'js/subject.js', 'js/track.js', 'js/reports.js', 'js/records.js', 'js/records-data.js', 'js/records-ui.js', 'js/evolution.js', 'js/ask.js', 'js/speed.js', 'js/moments.js', 'js/draw.js', 'js/flight.js', 'js/starts.js', 'js/target.js', 'js/autostart.js', 'js/live.js', 'js/homography.js', 'js/phases.js', 'js/refine.js', 'js/camera.js', 'js/change.js', 'js/certificate.js', 'js/review.js', 'js/cyclecmp.js', 'js/fatigue.js', 'js/drills.js', 'js/faults.js', 'js/faults-ui.js', 'js/velocity.js', 'js/dualcam.js', 'js/gym.js', 'js/gym-ui.js', 'js/jumpauto.js', 'js/gym-link.js', 'js/gym-screen.js', 'js/fpsguide.js', 'js/filmguide.js', 'js/beep.js', 'js/voice.js', 'js/videobar.js', 'js/xlsx.js', 'js/exports.js', 'js/accuracy.js', 'js/race-report.js', 'js/report.js', 'js/store.js', 'js/store-cloud.js', 'js/store-teambull.js',
  'vendor/mp4box.all.min.js', 'vendor/jspdf.umd.min.js', 'vendor/supabase.js', 'vendor/mp4-muxer.js', 'vendor/tasks-vision/vision_bundle.mjs'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION && k !== MODELS).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  // nube, fuentes, videos locales y el resto de Team Bull no pasan por acá
  if (req.method !== 'GET' || url.origin !== location.origin || !url.pathname.startsWith(new URL('./', self.location).pathname)) return;
  const store = /\/(models|vendor\/tasks-vision\/wasm)\//.test(url.pathname) ? MODELS : VERSION;
  e.respondWith(caches.open(store).then(c => c.match(req, { ignoreSearch: url.pathname.endsWith('.html') || url.pathname.endsWith('/') })).then(r => r || fetch(req).then(res => {
    if (res.ok) { const copy = res.clone(); caches.open(store).then(c => c.put(req, copy)); }
    return res;
  })));
});
