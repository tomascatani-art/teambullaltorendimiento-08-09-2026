// Lectura de tiempos de cuadro y estimación de pose cuadro por cuadro en el navegador.
import { FilesetResolver, PoseLandmarker } from '../vendor/tasks-vision/vision_bundle.mjs';
import { cameraTracker, rescale } from './camera.js';
import { TRACK_W } from './track.js';

// Lee los tiempos exactos de cada cuadro desde el contenedor MP4/MOV (sin decodificar).
export async function readFrameTimes(file) {
  const MP4Box = window.MP4Box;
  if (!MP4Box) return null;
  return new Promise((resolve) => {
    const mp4 = MP4Box.createFile();
    let done = false;
    mp4.onError = () => { if (!done) { done = true; resolve(null); } };
    mp4.onReady = (info) => {
      done = true;
      const v = info.videoTracks && info.videoTracks[0];
      if (!v) return resolve(null);
      const trak = mp4.getTrackById(v.id);
      const samples = trak.samples || [];
      if (!samples.length) return resolve(null);
      const cts = samples.map(s => s.cts).sort((a, b) => a - b);
      let offset = cts[0];
      const elst = trak.edts && trak.edts.elst && trak.edts.elst.entries;
      if (elst && elst.length) {
        const e = elst.find(x => x.media_time >= 0);
        if (e) offset = e.media_time;
      }
      const ts = v.timescale;
      const times = cts.map(c => (c - offset) / ts).filter(t => t >= -1e-6);
      const durs = [];
      for (let i = 1; i < times.length; i++) durs.push(times[i] - times[i - 1]);
      durs.sort((a, b) => a - b);
      const frameDur = durs[durs.length >> 1] || (1 / 30);
      const vfr = durs.length > 2 && (durs[durs.length - 1] - durs[0]) > frameDur * 0.5;
      resolve({
        times, frameDur, fps: 1 / frameDur, vfr,
        codec: v.codec, width: v.video?.width || v.track_width, height: v.video?.height || v.track_height,
        rotation: matrixRotation(v.matrix),
      });
    };
    (async () => {
      const chunk = 4 * 1024 * 1024;
      for (let pos = 0; pos < file.size && !done; pos += chunk) {
        const buf = await file.slice(pos, Math.min(file.size, pos + chunk)).arrayBuffer();
        buf.fileStart = pos;
        mp4.appendBuffer(buf);
      }
      mp4.flush();
      setTimeout(() => { if (!done) { done = true; resolve(null); } }, 50);
    })().catch(() => { if (!done) { done = true; resolve(null); } });
  });
}

function matrixRotation(m) {
  if (!m || m.length < 4) return 0;
  const a = m[0] / 65536, b = m[1] / 65536;
  return Math.round(Math.atan2(b, a) * 180 / Math.PI);
}

// Respaldo para formatos sin tabla de muestras: estima el período reproduciendo 1,5 s.
export async function probeFrameTimes(video) {
  if (!('requestVideoFrameCallback' in HTMLVideoElement.prototype)) return null;
  const mt = [];
  video.muted = true;
  video.currentTime = 0;
  await new Promise(r => video.addEventListener('seeked', r, { once: true }));
  await new Promise((resolve) => {
    const cb = (_, meta) => { mt.push(meta.mediaTime); if (mt.length < 45 && !video.ended) video.requestVideoFrameCallback(cb); else resolve(); };
    video.requestVideoFrameCallback(cb);
    video.play().catch(resolve);
    setTimeout(resolve, 3000);
  });
  video.pause();
  const d = [];
  for (let i = 1; i < mt.length; i++) if (mt[i] > mt[i - 1]) d.push(mt[i] - mt[i - 1]);
  if (d.length < 5) return null;
  d.sort((a, b) => a - b);
  // promedio de los pasos normales (no la mediana): en WebM los tiempos van en milisegundos enteros y a
  // 60 cuadros/s alternan 16 y 17 ms; la mediana daría 17 ms (1,7 % de error)
  // (y si se saltea un cuadro al reproducir, ese paso vale dos): tramo total / cantidad de cuadros
  const med = d[d.length >> 1], steps = d.reduce((s, x) => s + Math.max(1, Math.round(x / med)), 0);
  const frameDur = d.reduce((a, b) => a + b, 0) / steps;
  const n = Math.floor(video.duration / frameDur);
  return { times: Array.from({ length: n }, (_, i) => i * frameDur), frameDur, fps: 1 / frameDur, vfr: false };
}

const cache = new Map();

// Los archivos pesados (wasm y modelos) se guardan partidos en trozos de 4 MB para que
// GitHub los acepte al subirlos desde la web; acá se vuelven a unir antes de usarlos.
const PARTES = {
  'vendor/tasks-vision/wasm/vision_wasm_internal.wasm': 4,
  'vendor/tasks-vision/wasm/vision_wasm_nosimd_internal.wasm': 4,
  'models/pose_landmarker_full.task.wasm': 3,
  'models/pose_landmarker_lite.task.wasm': 2,
};
const unidos = new Map();
function archivoUnido(ruta, base) {
  const key = new URL(ruta, base).href;
  if (!unidos.has(key)) {
    const pr = Promise.all(Array.from({ length: PARTES[ruta] }, (_, i) =>
      fetch(key + '.part' + (i + 1)).then(r => { if (!r.ok) throw new Error('No se pudo cargar ' + ruta); return r.arrayBuffer(); })))
      .then(bufs => new Blob(bufs, { type: ruta.endsWith('.task.wasm') ? 'application/octet-stream' : 'application/wasm' }));
    unidos.set(key, pr);
    pr.catch(() => unidos.delete(key));
  }
  return unidos.get(key);
}

function createLandmarker(model, base, delegate, tag = '') {
  const key = model + ':' + delegate + tag;
  if (cache.has(key)) return cache.get(key);
  const pr = (async () => {
    const simd = await FilesetResolver.isSimdSupported();
    const wasmBase = new URL('vendor/tasks-vision/wasm/', base).href;
    const wasmBlob = await archivoUnido(`vendor/tasks-vision/wasm/${simd ? 'vision_wasm_internal' : 'vision_wasm_nosimd_internal'}.wasm`, base);
    const modelo = new Uint8Array(await (await archivoUnido(`models/pose_landmarker_${model}.task.wasm`, base)).arrayBuffer());
    const fileset = {
      wasmLoaderPath: wasmBase + (simd ? 'vision_wasm_internal.js' : 'vision_wasm_nosimd_internal.js'),
      wasmBinaryPath: URL.createObjectURL(wasmBlob),
    };
    const lm = await PoseLandmarker.createFromOptions(fileset, {
      baseOptions: { modelAssetBuffer: modelo, delegate },
      runningMode: 'VIDEO', numPoses: 3, // varias personas: después se elige al nadador
      minPoseDetectionConfidence: 0.4, minPosePresenceConfidence: 0.4, minTrackingConfidence: 0.4,
    });
    lm.__lastTs = 0;
    lm.__delegate = delegate;
    return lm;
  })();
  cache.set(key, pr);
  pr.catch(() => cache.delete(key));
  return pr;
}

function timeIt(lm, canvas, runs = 3) {
  lm.detectForVideo(canvas, ++lm.__lastTs, () => {});
  const t = performance.now();
  for (let k = 0; k < runs; k++) lm.detectForVideo(canvas, ++lm.__lastTs, () => {});
  return (performance.now() - t) / runs;
}

// Elige GPU o CPU según cuál sea más rápido en este dispositivo
// (en equipos sin GPU real, el modo GPU emulado puede ser 10 veces más lento).
// tag: instancia aparte (el recorte al nadador usa otra, porque el modo video sigue a la persona entre cuadros)
export async function getLandmarker(model, base, sampleCanvas, tag = '') {
  let gpu = null, gpuMs = Infinity;
  try { gpu = await createLandmarker(model, base, 'GPU', tag); gpuMs = timeIt(gpu, sampleCanvas); } catch (e) { gpu = null; }
  if (gpu && gpuMs < 80) return gpu;
  let cpu = null, cpuMs = Infinity;
  try { cpu = await createLandmarker(model, base, 'CPU', tag); cpuMs = timeIt(cpu, sampleCanvas); } catch (e) { cpu = null; }
  if (!gpu && !cpu) throw new Error('No se pudo cargar el modelo de pose en este navegador.');
  return cpuMs <= gpuMs ? cpu : gpu;
}

function seekTo(video, t) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('El navegador no respondió al buscar el cuadro ' + t.toFixed(3) + ' s')), 8000);
    const done = () => { clearTimeout(timer); resolve(); };
    if ('requestVideoFrameCallback' in video) {
      video.addEventListener('seeked', () => video.requestVideoFrameCallback(done), { once: true });
      // rVFC no siempre se dispara en videos pausados; respaldo
      video.addEventListener('seeked', () => setTimeout(done, 50), { once: true });
    } else {
      video.addEventListener('seeked', done, { once: true });
    }
    video.currentTime = t;
  });
}

// Recorre todos los cuadros (o uno de cada `step`) y ejecuta la pose. Con camera: true estima además el
// movimiento de la cámara (frames[k].cam = transformación al primer cuadro, en píxeles del video).
export async function runPose(video, timing, landmarker, { step = 1, onProgress, signal, camera = false } = {}) {
  const frames = [];
  const idx = [];
  for (let i = 0; i < timing.times.length; i += step) idx.push(i);
  const canvas = document.createElement('canvas');
  canvas.width = video.videoWidth; canvas.height = video.videoHeight;
  const ctx = canvas.getContext('2d', { willReadFrequently: false });
  const t0 = performance.now();
  let lastTs = landmarker.__lastTs || 0;
  // copia chica en grises para el movimiento de la cámara
  const gw = TRACK_W, gh = Math.round(canvas.height * gw / canvas.width), gs = canvas.width / gw;
  const gcv = camera ? Object.assign(document.createElement('canvas'), { width: gw, height: gh }) : null;
  const gctx = gcv?.getContext('2d', { willReadFrequently: true });
  const camTr = camera ? cameraTracker(gw, gh) : null;
  for (let k = 0; k < idx.length; k++) {
    if (signal?.aborted) throw new DOMException('Cancelado', 'AbortError');
    const t = timing.times[idx[k]];
    await seekTo(video, Math.min(video.duration - 1e-3, t + timing.frameDur * 0.5));
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    let ts = lastTs + Math.max(1, Math.round((t - (k ? timing.times[idx[k - 1]] : t)) * 1000));
    lastTs = ts;
    landmarker.__lastTs = ts;
    let cands = [];
    landmarker.detectForVideo(canvas, ts, (res) => {
      cands = (res.landmarks || []).map(p => p.map(q => [q.x, q.y, q.visibility ?? 0, q.presence ?? 1]));
    });
    const fr = { t, lm: cands[0] || null, cands };
    if (camTr) {
      gctx.drawImage(canvas, 0, 0, gw, gh);
      const d = gctx.getImageData(0, 0, gw, gh).data, G = new Float32Array(gw * gh);
      for (let q = 0, o = 0; q < G.length; q++, o += 4) G[q] = 0.299 * d[o] + 0.587 * d[o + 1] + 0.114 * d[o + 2];
      // las personas no son fondo: se excluye su caja, agrandada
      const ex = cands.map(p => personBox(p, gw, gh)).filter(Boolean);
      const r = camTr.push(G, ex);
      fr.cam = { T: rescale(r.toBase, gs), ok: r.ok };
    }
    frames.push(fr);
    if (onProgress && (k % 3 === 0 || k === idx.length - 1)) {
      const el = (performance.now() - t0) / 1000;
      onProgress({ done: k + 1, total: idx.length, eta: el / (k + 1) * (idx.length - k - 1) });
    }
  }
  return frames;
}
function personBox(lm, w, h) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const q of lm) { if ((q[2] ?? 0) < 0.2) continue; x0 = Math.min(x0, q[0]); x1 = Math.max(x1, q[0]); y0 = Math.min(y0, q[1]); y1 = Math.max(y1, q[1]); }
  if (!Number.isFinite(x0)) return null;
  const mx = 0.3 * (x1 - x0) + 0.03, my = 0.3 * (y1 - y0) + 0.03;
  return [(x0 - mx) * w, (y0 - my) * h, (x1 + mx) * w, (y1 + my) * h];
}

// ---------- segunda pasada recortando al nadador ----------
// El detector de personas trabaja sobre la imagen entera reducida; un nadador chico, lejos o medio
// sumergido se pierde. Recortando un cuadrado alrededor del nadador (su caja, o la interpolada entre
// cuadros vecinos si en ese cuadro no se vio) y agrandándolo, el modelo lo ve más grande.

// Caja (en píxeles) de los puntos visibles de una pose normalizada.
function poseBox(lm, W, H) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, n = 0;
  for (const q of lm) {
    if ((q[2] ?? 0) < 0.3) continue;
    x0 = Math.min(x0, q[0] * W); x1 = Math.max(x1, q[0] * W); y0 = Math.min(y0, q[1] * H); y1 = Math.max(y1, q[1] * H); n++;
  }
  return n >= 4 ? [(x0 + x1) / 2, (y0 + y1) / 2, Math.max(x1 - x0, y1 - y0)] : null;
}

// Recorte cuadrado por cuadro: [cx, cy, lado] en píxeles, o null. Donde no hay pose se interpola entre
// las cajas vecinas (hasta maxGap cuadros) y se agranda el margen.
export function cropBoxes(frames, W, H, maxGap) {
  const n = frames.length, raw = frames.map(f => (f.lm ? poseBox(f.lm, W, H) : null));
  const out = new Array(n).fill(null);
  const minSide = 0.18 * Math.min(W, H);
  for (let i = 0; i < n; i++) {
    let b = raw[i], m = 1.5;
    if (!b) {
      let a = i - 1, c = i + 1;
      while (a >= 0 && !raw[a] && i - a <= maxGap) a--;
      while (c < n && !raw[c] && c - i <= maxGap) c++;
      const A = a >= 0 && i - a <= maxGap ? raw[a] : null, C = c < n && c - i <= maxGap ? raw[c] : null;
      if (A && C) { const u = (i - a) / (c - a); b = A.map((v, k) => v + (C[k] - v) * u); }
      else b = A || C;
      m = 2;
    }
    if (b) out[i] = [b[0], b[1], Math.max(minSide, b[2] * m)];
  }
  // recorte estable: centro promediado y lado máximo en una ventana de ±half cuadros (un recorte que
  // tiembla cuadro a cuadro hace temblar los puntos)
  const half = Math.max(1, Math.round(maxGap / 3));
  return out.map((b, i) => {
    if (!b) return null;
    let cx = 0, cy = 0, side = 0, k = 0;
    for (let j = Math.max(0, i - half); j <= Math.min(n - 1, i + half); j++) if (out[j]) { cx += out[j][0]; cy += out[j][1]; side = Math.max(side, out[j][2]); k++; }
    return [cx / k, cy / k, side];
  });
}

// frames: los cuadros ya seguidos (frames[k].lm = nadador elegido), con frames[k].t.
// Devuelve, por cuadro, la pose encontrada en el recorte (normalizada a la imagen entera) o null.
export async function refinePose(video, frames, landmarker, { frameDur, size = 512, signal, onProgress } = {}) {
  const W = video.videoWidth, H = video.videoHeight;
  const boxes = cropBoxes(frames, W, H, Math.round(0.5 / frameDur));
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const out = new Array(frames.length).fill(null);
  let lastTs = landmarker.__lastTs || 0;
  const t0 = performance.now();
  for (let k = 0; k < frames.length; k++) {
    if (signal?.aborted) throw new DOMException('Cancelado', 'AbortError');
    const b = boxes[k];
    if (!b) continue;
    await seekTo(video, Math.min(video.duration - 1e-3, frames[k].t + frameDur * 0.5));
    const [cx, cy, side] = b, x0 = cx - side / 2, y0 = cy - side / 2, s = size / side;
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, size, size);
    ctx.drawImage(video, -x0 * s, -y0 * s, W * s, H * s);
    lastTs += Math.max(1, Math.round(frameDur * 1000));
    landmarker.__lastTs = lastTs;
    let cands = [];
    landmarker.detectForVideo(canvas, lastTs, (res) => { cands = (res.landmarks || []).map(p => p.map(q => [q.x, q.y, q.visibility ?? 0, q.presence ?? 1])); });
    // la persona más cercana al centro del recorte (el nadador está centrado)
    let best = null, bd = Infinity;
    for (const p of cands) {
      const bb = poseBox(p, 1, 1);
      if (!bb) continue;
      const d = Math.hypot(bb[0] - 0.5, bb[1] - 0.5);
      if (d < bd && d < 0.3) { bd = d; best = p; }
    }
    if (best) out[k] = best.map(q => [(q[0] * side + x0) / W, (q[1] * side + y0) / H, q[2], q[3]]);
    if (onProgress && (k % 3 === 0 || k === frames.length - 1)) {
      const el = (performance.now() - t0) / 1000;
      onProgress({ done: k + 1, total: frames.length, eta: el / (k + 1) * (frames.length - k - 1) });
    }
  }
  return out;
}

// Nota: el modelo .task se publica con extensión .wasm solo porque el hosting de Artifacts
// únicamente sirve tipos web estándar; el contenido es el archivo .task original de MediaPipe.

// ---------- buscar al nadador donde lo toca el entrenador ----------
// Recorta un cuadrado centrado en (cx, cy) (píxeles del video), lo agranda y busca una persona ahí.
// Devuelve la pose normalizada a la imagen entera, o null.
function detectarEnRecorte(video, landmarker, ctx, size, cx, cy, side) {
  const W = video.videoWidth, H = video.videoHeight, x0 = cx - side / 2, y0 = cy - side / 2, s = size / side;
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, size, size);
  ctx.drawImage(video, -x0 * s, -y0 * s, W * s, H * s);
  const ts = (landmarker.__lastTs || 0) + 33;
  landmarker.__lastTs = ts;
  let cands = [];
  landmarker.detectForVideo(ctx.canvas, ts, (res) => { cands = (res.landmarks || []).map(p => p.map(q => [q.x, q.y, q.visibility ?? 0, q.presence ?? 1])); });
  let best = null, bd = Infinity;
  for (const p of cands) {
    const bb = poseBox(p, 1, 1);
    if (!bb) continue;
    const d = Math.hypot(bb[0] - 0.5, bb[1] - 0.5);
    if (d < bd && d < 0.35) { bd = d; best = p; }
  }
  return best ? best.map(q => [(q[0] * side + x0) / W, (q[1] * side + y0) / H, q[2], q[3]]) : null;
}
const lienzo = (size) => { const c = document.createElement('canvas'); c.width = c.height = size; return c.getContext('2d'); };

// En el cuadro del tiempo t, prueba recortes de varios tamaños alrededor del toque.
export async function poseEnPunto(video, t, cx, cy, landmarker, { size = 512 } = {}) {
  await seekTo(video, Math.min(video.duration - 1e-3, t));
  const ctx = lienzo(size), m = Math.min(video.videoWidth, video.videoHeight);
  for (const f of [0.35, 0.5, 0.7, 0.95, 1.3]) {
    const p = detectarEnRecorte(video, landmarker, ctx, size, cx, cy, f * m);
    if (p) return p;
  }
  return null;
}

// Sigue a esa persona hacia adelante y hacia atrás: en cada cuadro busca alrededor de donde estaba en el
// anterior. Corta después de `maxMiss` cuadros seguidos sin encontrarla. Devuelve Map(índice → pose).
export async function seguirPose(video, times, i0, pose0, landmarker, { frameDur, size = 512, maxMiss = 6, onProgress, signal } = {}) {
  const W = video.videoWidth, H = video.videoHeight, ctx = lienzo(size), out = new Map();
  const minSide = 0.2 * Math.min(W, H);
  let hechos = 0;
  for (const dir of [1, -1]) {
    let prev = pose0, miss = 0;
    for (let k = i0 + dir; k >= 0 && k < times.length; k += dir) {
      if (signal?.aborted) throw new DOMException('Cancelado', 'AbortError');
      const b = poseBox(prev, W, H);
      if (!b) break;
      await seekTo(video, Math.min(video.duration - 1e-3, times[k] + frameDur * 0.5));
      const p = detectarEnRecorte(video, landmarker, ctx, size, b[0], b[1], Math.max(minSide, b[2] * (1.6 + 0.3 * miss)));
      if (p) { out.set(k, p); prev = p; miss = 0; } else if (++miss > maxMiss) break;
      hechos++;
      if (onProgress && hechos % 5 === 0) onProgress({ done: hechos, total: times.length });
    }
  }
  return out;
}
