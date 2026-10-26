// Marcado automático del salto: sigue los pies con el modelo de pose y propone el despegue, la caída y,
// en el drop jump, el contacto al bajar del cajón. Es una propuesta: el entrenador la revisa cuadro a
// cuadro y puede corregir cualquier marca a mano.
//
// Cómo decide: en cada cuadro toma el punto más bajo de los pies (tobillos, talones y puntas). El piso es
// el nivel más bajo en el que los pies se quedan quietos; el deportista está en el aire cuando ese punto
// sube más de un 4 % del largo de su pierna sobre el piso. Primero recorre el video salteando cuadros
// para ubicar el salto y después mira cuadro por cuadro alrededor de cada cambio.
import { getLandmarker } from './pose.js';
import { seekVideo } from './clip.js';

const BASE = new URL('../', import.meta.url);
const FOOT = [27, 28, 29, 30, 31, 32];
const MAX_W = 640;

// Estado en el aire / en el piso de una serie de alturas de pie (y crece hacia abajo, como en la imagen).
export function floorLevel(ys) {
  const v = ys.filter(Number.isFinite).sort((a, b) => a - b);
  if (v.length < 5) return null;
  return v[Math.min(v.length - 1, Math.floor(v.length * 0.92))];
}

// Tramos seguidos con el mismo estado: [{ air, i0, i1 }] sobre los índices de la lista.
export function runs(states) {
  const out = [];
  states.forEach((s, i) => {
    if (s == null) return;
    const last = out[out.length - 1];
    if (last && last.air === s) last.i1 = i; else out.push({ air: s, i0: i, i1: i });
  });
  return out;
}

// Elige el salto entre los tramos: el tramo en el aire más largo que tenga piso antes y después.
// En drop jump, además, el piso de antes tiene que venir después de estar arriba del cajón.
export function pickJump(rs, drop) {
  let best = null;
  for (let k = 1; k < rs.length - 1; k++) {
    const r = rs[k];
    if (!r.air || rs[k - 1].air || rs[k + 1].air) continue;
    if (drop && !(k >= 2 && rs[k - 2].air)) continue;
    const len = r.i1 - r.i0;
    if (!best || len > best.len) best = { k, len };
  }
  if (!best) return null;
  const { k } = best;
  return { before: rs[k - 1], air: rs[k], after: rs[k + 1], box: drop ? rs[k - 2] : null };
}

// Un modelo propio, en modo imagen: cada cuadro por separado. En modo video el modelo suaviza entre
// cuadros (correría el despegue y la caída) y acá además se saltean cuadros.
let _modelo = null;
function modelo(sample) {
  if (!_modelo) {
    _modelo = getLandmarker('full', BASE, sample, ':salto').then(async (lm) => { await lm.setOptions({ runningMode: 'IMAGE' }); return lm; });
    _modelo.catch(() => { _modelo = null; });
  }
  return _modelo;
}

export async function detectJump(video, times, frameDur, { drop = false, onProgress, signal, landmarker = null } = {}) {
  const W = video.videoWidth, H = video.videoHeight;
  const sc = Math.min(1, MAX_W / W);
  const cv = document.createElement('canvas');
  cv.width = Math.round(W * sc); cv.height = Math.round(H * sc);
  const ctx = cv.getContext('2d');
  ctx.drawImage(video, 0, 0, cv.width, cv.height);
  const lm = landmarker || await modelo(cv); // landmarker: solo para las pruebas automáticas
  const n = times.length;
  const cache = new Map(); // cuadro → { y, x, leg } en coordenadas del video (píxeles)
  let hechos = 0, total = 0;

  const medir = async (i) => {
    if (cache.has(i)) return cache.get(i);
    if (signal?.aborted) throw new DOMException('Cancelado', 'AbortError');
    await seekVideo(video, times[i] + frameDur * 0.5);
    ctx.drawImage(video, 0, 0, cv.width, cv.height);
    let p = null;
    lm.detect(cv, (res) => { p = (res.landmarks || [])[0] || null; });
    let out = null;
    if (p) {
      const vis = (q) => (q.visibility ?? 1) > 0.3;
      const pies = FOOT.map(j => p[j]).filter(vis);
      if (pies.length >= 2) {
        const low = pies.reduce((a, q) => (q.y > a.y ? q : a));
        const hip = [p[23], p[24]].filter(vis), ank = [p[27], p[28]].filter(vis);
        const leg = hip.length && ank.length ? Math.abs(ank.reduce((s, q) => s + q.y, 0) / ank.length - hip.reduce((s, q) => s + q.y, 0) / hip.length) * H : NaN;
        out = { y: low.y * H, x: low.x * W, leg };
      }
    }
    cache.set(i, out);
    hechos++;
    onProgress?.(Math.min(0.99, hechos / Math.max(1, total)));
    return out;
  };

  // 1. pasada salteando cuadros (unos 160 en total)
  const step = Math.max(1, Math.ceil(n / 160));
  const idx = [];
  for (let i = 0; i < n; i += step) idx.push(i);
  if (idx[idx.length - 1] !== n - 1) idx.push(n - 1);
  total = idx.length + 6 * step;
  for (const i of idx) await medir(i);

  const pts = idx.map(i => cache.get(i));
  const floor = floorLevel(pts.map(q => q?.y));
  const legs = pts.map(q => q?.leg).filter(Number.isFinite).sort((a, b) => a - b);
  const leg = legs.length ? legs[legs.length >> 1] : NaN;
  if (floor == null || !Number.isFinite(leg) || leg < 10) return { error: 'No encontré bien los pies en el video. Filmá de costado, con el cuerpo entero y los pies a la vista, y marcá a mano.' };
  const thr = 0.04 * leg;
  const enAire = (q) => (q ? q.y < floor - thr : null);

  const rs = runs(pts.map(enAire));
  const pick = pickJump(rs, drop);
  if (!pick) return { error: drop ? 'No encontré la bajada del cajón y el salto. Revisá que se vean los pies todo el tiempo, o marcá a mano.' : 'No encontré el salto en el video. Revisá que se vean los pies, o marcá a mano.' };

  // 2. cuadro por cuadro entre la última muestra de un estado y la primera del otro
  const primero = async (a, b, quiero) => {
    for (let i = a + 1; i <= b; i++) {
      const q = await medir(i);
      if (enAire(q) === quiero) return i;
    }
    return b;
  };
  total = hechos + (pick.air.i0 - pick.before.i1 + pick.after.i0 - pick.air.i1) * step + (drop ? step : 0);
  const take = await primero(idx[pick.before.i1], idx[pick.air.i0], true);
  const land = await primero(idx[pick.air.i1], idx[pick.after.i0], false);
  let contact = null;
  if (drop) contact = await primero(idx[pick.box.i1], idx[pick.before.i0], false);
  onProgress?.(1);

  // dónde están los pies en cada cuadro medido, para la lupa
  const pies = [...cache.entries()].filter(([, q]) => q).map(([i, q]) => ({ i, x: q.x, y: q.y })).sort((a, b) => a.i - b.i);
  return { take, land, contact, pies, floor, leg };
}
