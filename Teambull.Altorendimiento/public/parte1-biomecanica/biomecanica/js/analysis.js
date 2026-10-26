// Motor de análisis biomecánico 2D (funciones puras, sin DOM).
// Entrada: serie de landmarks por cuadro (MediaPipe BlazePose, 33 puntos).
// Salida: series suavizadas, ángulos con confianza, ciclos, métricas y calidad.
// Todo cálculo trabaja en píxeles (no en coordenadas normalizadas) para no deformar ángulos.
import { seOfMean } from './change.js';

export const LM = {
  nose: 0, lEar: 7, rEar: 8,
  lShoulder: 11, rShoulder: 12, lElbow: 13, rElbow: 14, lWrist: 15, rWrist: 16,
  lHip: 23, rHip: 24, lKnee: 25, rKnee: 26, lAnkle: 27, rAnkle: 28,
  lHeel: 29, rHeel: 30, lFoot: 31, rFoot: 32,
};

export const SKELETON = [
  [11, 12], [11, 13], [13, 15], [12, 14], [14, 16],
  [11, 23], [12, 24], [23, 24],
  [23, 25], [25, 27], [27, 31], [24, 26], [26, 28], [28, 32],
  [0, 11], [0, 12],
];

// Umbral de visibilidad a partir del cual un punto se considera utilizable.
export const DEFAULT_CONFIG = {
  minVisibility: 0.5,
  maxGapSeconds: 0.2,      // huecos más largos no se interpolan
  smoothSeconds: 0.1,      // ventana de suavizado centrada
  minCycleSec: 0.8,        // 75 ciclos/min
  maxCycleSec: 3.5,        // ~17 ciclos/min
  minKickSec: 0.25,
  maxKickSec: 2.0,
};

export const ANGLE_DEFS = [
  { id: 'elbowL', label: 'Codo izquierdo', pts: [11, 13, 15], note: '180° = brazo extendido' },
  { id: 'elbowR', label: 'Codo derecho', pts: [12, 14, 16], note: '180° = brazo extendido' },
  { id: 'shoulderL', label: 'Hombro izquierdo (brazo-tronco)', pts: [13, 11, 23], note: '0° = brazo junto al cuerpo' },
  { id: 'shoulderR', label: 'Hombro derecho (brazo-tronco)', pts: [14, 12, 24], note: '0° = brazo junto al cuerpo' },
  { id: 'hipL', label: 'Cadera izquierda', pts: [11, 23, 25], note: '180° = tronco y muslo alineados' },
  { id: 'hipR', label: 'Cadera derecha', pts: [12, 24, 26], note: '180° = tronco y muslo alineados' },
  { id: 'kneeL', label: 'Rodilla izquierda', pts: [23, 25, 27], note: '180° = pierna extendida' },
  { id: 'kneeR', label: 'Rodilla derecha', pts: [24, 26, 28], note: '180° = pierna extendida' },
];

// ---------- utilidades numéricas ----------

export function median(a) {
  const v = a.filter(Number.isFinite).sort((x, y) => x - y);
  if (!v.length) return NaN;
  const m = v.length >> 1;
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

export function quantile(a, q) {
  const v = a.filter(Number.isFinite).sort((x, y) => x - y);
  if (!v.length) return NaN;
  const pos = (v.length - 1) * q;
  const lo = Math.floor(pos), hi = Math.ceil(pos);
  return v[lo] + (v[hi] - v[lo]) * (pos - lo);
}

export function mean(a) {
  const v = a.filter(Number.isFinite);
  return v.length ? v.reduce((s, x) => s + x, 0) / v.length : NaN;
}

export function std(a) {
  const v = a.filter(Number.isFinite);
  if (v.length < 2) return NaN;
  const m = mean(v);
  return Math.sqrt(v.reduce((s, x) => s + (x - m) ** 2, 0) / (v.length - 1));
}

// Interpola huecos de hasta maxGap muestras; devuelve {values, interpolated}.
export function fillGaps(values, maxGap) {
  const out = values.slice();
  const interp = new Array(values.length).fill(false);
  let i = 0;
  while (i < out.length) {
    if (Number.isFinite(out[i])) { i++; continue; }
    let j = i;
    while (j < out.length && !Number.isFinite(out[j])) j++;
    const gap = j - i;
    if (i > 0 && j < out.length && gap <= maxGap) {
      const a = out[i - 1], b = out[j];
      for (let k = i; k < j; k++) {
        out[k] = a + (b - a) * (k - i + 1) / (gap + 1);
        interp[k] = true;
      }
    }
    i = j;
  }
  return { values: out, interpolated: interp };
}

// Media móvil centrada que ignora NaN y no rellena huecos.
export function smooth(values, half) {
  if (half < 1) return values.slice();
  const out = new Array(values.length).fill(NaN);
  for (let i = 0; i < values.length; i++) {
    if (!Number.isFinite(values[i])) continue;
    let s = 0, n = 0;
    for (let k = i - half; k <= i + half; k++) {
      if (k >= 0 && k < values.length && Number.isFinite(values[k])) { s += values[k]; n++; }
    }
    out[i] = s / n;
  }
  return out;
}

function angleAt(a, b, c) {
  const v1x = a[0] - b[0], v1y = a[1] - b[1];
  const v2x = c[0] - b[0], v2y = c[1] - b[1];
  const n1 = Math.hypot(v1x, v1y), n2 = Math.hypot(v2x, v2y);
  if (n1 < 1e-6 || n2 < 1e-6) return NaN;
  const cos = Math.max(-1, Math.min(1, (v1x * v2x + v1y * v2y) / (n1 * n2)));
  return Math.acos(cos) * 180 / Math.PI;
}

// ---------- paso 1: limpieza y suavizado de trayectorias ----------

// frames: [{t, lm: [[x,y,vis,pres] x33] | null}], coordenadas normalizadas.
export function buildTracks(frames, width, height, fps, cfg = DEFAULT_CONFIG) {
  const n = frames.length;
  const maxGap = Math.max(1, Math.round(cfg.maxGapSeconds * fps));
  const half = Math.max(0, Math.round(cfg.smoothSeconds * fps / 2));
  const tracks = [];
  for (let j = 0; j < 33; j++) {
    const xs = new Array(n).fill(NaN), ys = new Array(n).fill(NaN), vis = new Array(n).fill(0);
    for (let i = 0; i < n; i++) {
      const lm = frames[i].lm;
      if (!lm) continue;
      const p = lm[j];
      const v = Math.min(p[2] ?? 0, p[3] ?? 1);
      vis[i] = v;
      if (v >= cfg.minVisibility) { xs[i] = p[0] * width; ys[i] = p[1] * height; }
    }
    const fx = fillGaps(xs, maxGap), fy = fillGaps(ys, maxGap);
    tracks.push({
      x: smooth(fx.values, half),
      y: smooth(fy.values, half),
      vis,
      interpolated: fx.interpolated,
      rawValid: xs.map(Number.isFinite),
      manual: frames.map(f => f.manual?.[j] || 0), // 1 = puesto a mano, 2 = ajustado desde una corrección cercana
    });
  }
  return tracks;
}

function pointAt(tracks, j, i) {
  const t = tracks[j];
  const x = t.x[i], y = t.y[i];
  return Number.isFinite(x) && Number.isFinite(y) ? [x, y] : null;
}

function midAt(tracks, a, b, i) {
  const p = pointAt(tracks, a, i), q = pointAt(tracks, b, i);
  return p && q ? [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2] : null;
}

// ---------- paso 2: ángulos articulares ----------

export function computeAngles(tracks, n) {
  const series = {};
  for (const def of ANGLE_DEFS) {
    const values = new Array(n).fill(NaN), conf = new Array(n).fill(0), interp = new Array(n).fill(false);
    for (let i = 0; i < n; i++) {
      const [a, b, c] = def.pts.map(j => pointAt(tracks, j, i));
      if (!a || !b || !c) continue;
      values[i] = angleAt(a, b, c);
      conf[i] = Math.min(...def.pts.map(j => tracks[j].vis[i]));
      interp[i] = def.pts.some(j => tracks[j].interpolated[i]);
    }
    series[def.id] = { values, conf, interp };
  }
  // Inclinación del tronco respecto de la horizontal de la imagen (solo válida en toma lateral nivelada).
  const trunk = new Array(n).fill(NaN), trunkConf = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    const s = midAt(tracks, 11, 12, i) || pointAt(tracks, 11, i) || pointAt(tracks, 12, i);
    const h = midAt(tracks, 23, 24, i) || pointAt(tracks, 23, i) || pointAt(tracks, 24, i);
    if (!s || !h) continue;
    const dx = s[0] - h[0], dy = s[1] - h[1];
    if (Math.hypot(dx, dy) < 1e-6) continue;
    // ángulo agudo de la línea cadera-hombro con la horizontal, positivo = hombros más altos (y menor) que cadera
    let a = Math.atan2(-dy, Math.abs(dx)) * 180 / Math.PI;
    trunk[i] = a;
    trunkConf[i] = Math.min(
      Math.max(tracks[11].vis[i], tracks[12].vis[i]),
      Math.max(tracks[23].vis[i], tracks[24].vis[i]),
    );
  }
  series.trunkIncl = { values: trunk, conf: trunkConf, interp: new Array(n).fill(false) };
  return series;
}

export const EXTRA_SERIES = [
  { id: 'trunkIncl', label: 'Inclinación del tronco', note: 'Línea cadera-hombro respecto de la horizontal de la imagen. Positivo = hombros más altos que la cadera. Solo interpretable en toma lateral con cámara nivelada.' },
];

// ---------- paso 3: señales periódicas y ciclos ----------

// Posición de la muñeca respecto del hombro, proyectada sobre el eje del tronco y
// normalizada por la longitud del tronco. Máximo = mano más adelantada (extensión/entrada).
export function armSignal(tracks, n, side) {
  const [sh, wr] = side === 'L' ? [11, 15] : [12, 16];
  const out = new Array(n).fill(NaN);
  for (let i = 0; i < n; i++) {
    const s = midAt(tracks, 11, 12, i), h = midAt(tracks, 23, 24, i);
    const shp = pointAt(tracks, sh, i), w = pointAt(tracks, wr, i);
    if (!s || !h || !shp || !w) continue;
    const ax = s[0] - h[0], ay = s[1] - h[1];
    const L = Math.hypot(ax, ay);
    if (L < 1e-6) continue;
    out[i] = ((w[0] - shp[0]) * ax + (w[1] - shp[1]) * ay) / (L * L);
  }
  return out;
}

// Desplazamiento del tobillo perpendicular al eje del tronco (patada).
export function kickSignal(tracks, n, side) {
  const an = side === 'L' ? 27 : 28;
  const out = new Array(n).fill(NaN);
  for (let i = 0; i < n; i++) {
    const s = midAt(tracks, 11, 12, i), h = midAt(tracks, 23, 24, i), a = pointAt(tracks, an, i);
    if (!s || !h || !a) continue;
    const ax = s[0] - h[0], ay = s[1] - h[1];
    const L = Math.hypot(ax, ay);
    if (L < 1e-6) continue;
    out[i] = ((a[0] - h[0]) * -ay + (a[1] - h[1]) * ax) / (L * L);
  }
  return out;
}

// Autocorrelación normalizada sobre muestras válidas; devuelve {lag, r}.
export function dominantPeriod(signal, minLag, maxLag) {
  const v = signal;
  const m = mean(v);
  const n = v.length;
  let best = { lag: 0, r: -1 };
  const rs = [];
  for (let lag = Math.max(1, minLag); lag <= Math.min(maxLag, Math.floor(n / 2)); lag++) {
    let num = 0, d1 = 0, d2 = 0, cnt = 0;
    for (let i = 0; i + lag < n; i++) {
      const a = v[i], b = v[i + lag];
      if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
      num += (a - m) * (b - m); d1 += (a - m) ** 2; d2 += (b - m) ** 2; cnt++;
    }
    const r = cnt > lag * 0.5 && d1 > 0 && d2 > 0 ? num / Math.sqrt(d1 * d2) : -1;
    rs.push([lag, r]);
  }
  // primer máximo local fuerte (evita elegir múltiplos del período)
  const top = Math.max(...rs.map(x => x[1]));
  for (let k = 1; k < rs.length - 1; k++) {
    const [lag, r] = rs[k];
    if (r >= rs[k - 1][1] && r >= rs[k + 1][1] && r >= 0.8 * top && r > 0.2) { best = { lag, r }; break; }
  }
  if (!best.lag && rs.length) {
    const b = rs.reduce((p, c) => (c[1] > p[1] ? c : p));
    best = { lag: b[0], r: b[1] };
  }
  return best;
}

// Máximos locales separados al menos minDist muestras, con prominencia mínima.
export function findPeaks(signal, minDist, minProm) {
  const n = signal.length;
  const cand = [];
  for (let i = 1; i < n - 1; i++) {
    const v = signal[i];
    if (!Number.isFinite(v)) continue;
    let isMax = true;
    for (let k = Math.max(0, i - minDist); k <= Math.min(n - 1, i + minDist); k++) {
      if (k !== i && Number.isFinite(signal[k]) && signal[k] > v) { isMax = false; break; }
    }
    if (!isMax) continue;
    // prominencia: diferencia con el mínimo de cada lado dentro de la ventana de un período
    let lmin = v, rmin = v;
    for (let k = i - 1; k >= Math.max(0, i - 2 * minDist); k--) if (Number.isFinite(signal[k])) lmin = Math.min(lmin, signal[k]);
    for (let k = i + 1; k <= Math.min(n - 1, i + 2 * minDist); k++) if (Number.isFinite(signal[k])) rmin = Math.min(rmin, signal[k]);
    if (v - Math.max(lmin, rmin) >= minProm) cand.push(i);
  }
  // elimina duplicados cercanos (mesetas)
  const out = [];
  for (const i of cand) if (!out.length || i - out[out.length - 1] >= minDist) out.push(i);
  return out;
}

// Detecta ciclos en una señal. Un ciclo va de un máximo al siguiente.
// Solo se aceptan ciclos con cobertura de datos reales >= 70% y duración coherente con el período.
export function detectCycles(signal, validMask, times, fps, minSec, maxSec) {
  const n = signal.length;
  const coverage = validMask.filter(Boolean).length / Math.max(1, n);
  const result = { cycles: [], periodSec: NaN, autocorr: NaN, coverage, reason: '' };
  if (coverage < 0.4) { result.reason = 'Datos insuficientes: el punto está visible en menos del 40% de los cuadros.'; return result; }
  const { lag, r } = dominantPeriod(signal, Math.round(minSec * fps), Math.round(maxSec * fps));
  result.autocorr = r;
  if (!lag || r < 0.3) { result.reason = 'No se encontró un patrón periódico claro (autocorrelación baja).'; return result; }
  result.periodSec = lag / fps;
  const amp = quantile(signal, 0.9) - quantile(signal, 0.1);
  const peaks = findPeaks(signal, Math.max(1, Math.round(lag * 0.6)), amp * 0.3);
  for (let k = 0; k + 1 < peaks.length; k++) {
    const a = peaks[k], b = peaks[k + 1];
    const dur = times[b] - times[a];
    let real = 0;
    for (let i = a; i <= b; i++) if (validMask[i]) real++;
    const cov = real / (b - a + 1);
    const ok = cov >= 0.7 && dur >= 0.6 * result.periodSec && dur <= 1.5 * result.periodSec;
    result.cycles.push({ start: a, end: b, tStart: times[a], tEnd: times[b], duration: dur, coverage: cov, accepted: ok });
  }
  if (!result.cycles.some(c => c.accepted)) result.reason = 'Se detectó periodicidad pero ningún ciclo completo con datos suficientes.';
  return result;
}

// ---------- paso 4: calidad de la toma ----------

const GROUPS = {
  'Cabeza': [0, 7, 8],
  'Hombros': [11, 12],
  'Codos': [13, 14],
  'Muñecas': [15, 16],
  'Caderas': [23, 24],
  'Rodillas': [25, 26],
  'Tobillos': [27, 28],
};

export function assessQuality(frames, tracks, meta) {
  const n = frames.length;
  // Un cuadro cuenta como "nadador detectado" si al menos 4 articulaciones principales superan el umbral
  // (el modelo puede devolver una pose de baja confianza incluso sin persona en la imagen).
  const KEY = [0, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28];
  const detectedMask = frames.map((_, i) => KEY.filter(j => tracks[j].rawValid[i]).length >= 4);
  const detected = detectedMask.filter(Boolean).length;
  const groups = Object.entries(GROUPS).map(([name, ids]) => {
    let vis = 0, cnt = 0, usable = 0;
    for (let i = 0; i < n; i++) {
      if (!frames[i].lm) continue;
      for (const j of ids) { vis += tracks[j].vis[i]; cnt++; if (tracks[j].rawValid[i]) usable++; }
    }
    return { name, meanVisibility: cnt ? vis / cnt : 0, usableFraction: n ? usable / (n * ids.length) : 0 };
  });
  // tamaño del nadador en el cuadro: diagonal del rectángulo de puntos visibles
  const sizes = [];
  for (let i = 0; i < n; i++) {
    const xs = [], ys = [];
    for (let j = 0; j < 33; j++) if (tracks[j].rawValid[i]) { xs.push(tracks[j].x[i]); ys.push(tracks[j].y[i]); }
    if (xs.length >= 6) sizes.push(Math.hypot(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) / Math.hypot(meta.width, meta.height));
  }
  const warnings = [];
  if (meta.fps < 25) warnings.push(`Frecuencia de cuadro baja (${meta.fps.toFixed(1)} fps): la resolución temporal es de ±${(1000 / meta.fps).toFixed(0)} ms por evento.`);
  if (Math.min(meta.width, meta.height) < 480) warnings.push(`Resolución baja (${meta.width}×${meta.height}): la localización de articulaciones pierde precisión.`);
  if (detected / n < 0.6) warnings.push(`El nadador solo se detectó en el ${(100 * detected / n).toFixed(0)}% de los cuadros.`);
  const sizeMed = median(sizes);
  if (Number.isFinite(sizeMed) && sizeMed < 0.25) warnings.push('El nadador ocupa una parte pequeña del cuadro: conviene acercar la cámara o recortar la toma.');
  if (meta.timingSource !== 'container') warnings.push('No se pudieron leer los tiempos exactos de cada cuadro desde el archivo; se estimaron durante la reproducción.');
  return { detectedFraction: n ? detected / n : 0, detectedMask, groups, swimmerSize: sizeMed, warnings };
}

// ---------- paso 5: métricas ----------

function summarizeAngle(s) {
  const real = s.values.filter((v, i) => Number.isFinite(v) && !s.interp[i]);
  const conf = s.conf.filter((c, i) => Number.isFinite(s.values[i]));
  return {
    validFrames: real.length,
    median: median(real),
    p10: quantile(real, 0.1),
    p90: quantile(real, 0.9),
    min: quantile(real, 0.02),
    max: quantile(real, 0.98),
    meanConf: mean(conf),
  };
}

function confLabel(score) {
  if (score >= 0.75) return 'alta';
  if (score >= 0.5) return 'media';
  return 'baja';
}

// Analiza una serie de cuadros completa. meta: {width,height,fps,duration,timingSource,style,view,...}
export function analyze(frames, meta, cfg = DEFAULT_CONFIG) {
  const n = frames.length;
  const times = frames.map(f => f.t);
  const fps = meta.fps;
  const tracks = buildTracks(frames, meta.width, meta.height, fps, cfg);
  const angles = computeAngles(tracks, n);
  const quality = assessQuality(frames, tracks, meta);

  // ciclos de brazada por brazo
  const arms = {};
  for (const side of ['L', 'R']) {
    const sig = armSignal(tracks, n, side);
    const wr = side === 'L' ? 15 : 16, sh = side === 'L' ? 11 : 12;
    const valid = sig.map((v, i) => Number.isFinite(v) && tracks[wr].rawValid[i] && tracks[sh].rawValid[i]);
    arms[side] = { signal: sig, ...detectCycles(sig, valid, times, fps, cfg.minCycleSec, cfg.maxCycleSec) };
  }
  const kicks = {};
  for (const side of ['L', 'R']) {
    const sig = kickSignal(tracks, n, side);
    const an = side === 'L' ? 27 : 28;
    const valid = sig.map((v, i) => Number.isFinite(v) && tracks[an].rawValid[i]);
    kicks[side] = { signal: sig, ...detectCycles(sig, valid, times, fps, cfg.minKickSec, cfg.maxKickSec) };
  }

  const metrics = [];
  const frameErrMs = 1000 / fps;

  // Métricas medidas directamente del archivo
  metrics.push({ id: 'duration', group: 'Video', label: 'Duración analizada', value: meta.duration, unit: 's', status: 'medido', detail: `${n} cuadros a ${fps.toFixed(2)} fps.` });

  // Frecuencia de ciclo: brazo con más ciclos aceptados
  const armRank = ['L', 'R'].map(s => ({ s, c: arms[s].cycles.filter(c => c.accepted) })).sort((a, b) => b.c.length - a.c.length);
  const best = armRank[0];
  const styleCycles = { crol: 'alternado', espalda: 'alternado', pecho: 'simultáneo', mariposa: 'simultáneo' }[meta.style] || 'desconocido';
  if (best.c.length >= 2) {
    const durs = best.c.map(c => c.duration);
    const md = mean(durs), sd = std(durs);
    const cv = sd / md;
    const covAvg = mean(best.c.map(c => c.coverage));
    const score = Math.min(1, Math.max(0, arms[best.s].autocorr)) * 0.5 + covAvg * 0.3 + (cv < 0.1 ? 0.2 : cv < 0.2 ? 0.1 : 0);
    const side = best.s === 'L' ? 'izquierdo' : 'derecho';
    metrics.push({
      id: 'cycleTime', group: 'Brazada', label: 'Tiempo por ciclo', value: md, unit: 's', status: 'estimado', confidence: confLabel(score),
      spread: sd, n: best.c.length, se: seOfMean(durs),
      detail: `Media de ${best.c.length} ciclos completos del brazo ${side} (de mano adelantada a mano adelantada). Desvío ±${sd.toFixed(2)} s. Error de detección de cada evento: ±${frameErrMs.toFixed(0)} ms.`,
    });
    metrics.push({
      id: 'cycleRate', group: 'Brazada', label: 'Frecuencia de ciclo', value: 60 / md, unit: 'ciclos/min', status: 'estimado', confidence: confLabel(score),
      n: best.c.length, se: seOfMean(durs) == null ? null : 60 / (md * md) * seOfMean(durs),
      detail: `1 ciclo = una vuelta completa del mismo brazo.${styleCycles === 'alternado' ? ` En ${meta.style} equivale a ${(120 / md).toFixed(1)} brazadas/min (dos brazadas por ciclo).` : styleCycles === 'simultáneo' ? ` En ${meta.style} cada ciclo es una brazada simultánea de ambos brazos.` : ''}`,
    });
    metrics.push({
      id: 'cycleCV', group: 'Brazada', label: 'Variabilidad entre ciclos', value: 100 * cv, unit: '% (CV)', status: 'estimado', confidence: best.c.length >= 4 ? confLabel(score) : 'baja',
      detail: best.c.length < 4 ? 'Con menos de 4 ciclos la variabilidad es poco representativa.' : 'Coeficiente de variación de la duración de los ciclos.',
    });
    // simetría temporal entre brazos, solo si ambos tienen ciclos
    const other = armRank[1];
    if (other.c.length >= 2) {
      const mo = mean(other.c.map(c => c.duration));
      metrics.push({
        id: 'armSym', group: 'Brazada', label: 'Diferencia de duración de ciclo izq./der.', value: 100 * Math.abs(md - mo) / ((md + mo) / 2), unit: '%', status: 'estimado', confidence: 'media',
        detail: `Izquierdo ${mean(arms.L.cycles.filter(c => c.accepted).map(c => c.duration)).toFixed(2)} s, derecho ${mean(arms.R.cycles.filter(c => c.accepted).map(c => c.duration)).toFixed(2)} s. En toma lateral el brazo lejano suele estar ocluido, lo que reduce la fiabilidad.`,
      });
    }
  } else {
    metrics.push({ id: 'cycleRate', group: 'Brazada', label: 'Frecuencia de ciclo', value: null, status: 'no disponible', detail: arms[best.s].reason || 'Se necesitan al menos 2 ciclos completos con datos suficientes.' });
  }

  // Frecuencia de patada
  const kRank = ['L', 'R'].map(s => ({ s, c: kicks[s].cycles.filter(c => c.accepted) })).sort((a, b) => b.c.length - a.c.length);
  if (kRank[0].c.length >= 3) {
    const kd = kRank[0].c.map(c => c.duration), md = mean(kd), kse = seOfMean(kd);
    const cov = mean(kRank[0].c.map(c => c.coverage));
    metrics.push({
      id: 'kickRate', group: 'Patada', label: 'Frecuencia de patada', value: 60 / md, unit: 'patadas/min', status: 'estimado',
      n: kd.length, se: kse == null ? null : 60 / (md * md) * kse,
      confidence: confLabel(Math.min(1, kicks[kRank[0].s].autocorr) * 0.6 + cov * 0.4),
      detail: `Una patada = oscilación completa del tobillo ${kRank[0].s === 'L' ? 'izquierdo' : 'derecho'} perpendicular al eje del tronco (${kRank[0].c.length} detectadas).`,
    });
  } else {
    metrics.push({ id: 'kickRate', group: 'Patada', label: 'Frecuencia de patada', value: null, status: 'no disponible', detail: kicks[kRank[0].s].reason || 'No se detectaron suficientes patadas con el tobillo visible.' });
  }

  // Ángulos
  const angleSummary = {};
  for (const def of [...ANGLE_DEFS, ...EXTRA_SERIES]) {
    const s = summarizeAngle(angles[def.id]);
    angleSummary[def.id] = s;
    const coverage = s.validFrames / n;
    if (s.validFrames < Math.max(10, 0.15 * n)) {
      metrics.push({ id: 'ang_' + def.id, group: 'Ángulos (2D)', label: def.label, value: null, status: 'no disponible', detail: `Articulación visible con confianza suficiente solo en ${s.validFrames} cuadros (${(100 * coverage).toFixed(0)}%).` });
      continue;
    }
    // error de la mediana: cuánto varía la mediana de cada ciclo (los cuadros seguidos no son independientes)
    const perC = best.c.map(c => { const v = []; for (let i = c.start; i <= c.end; i++) { const x = angles[def.id].values[i]; if (Number.isFinite(x) && !angles[def.id].interp[i]) v.push(x); } return v.length >= 3 ? median(v) : NaN; });
    metrics.push({
      id: 'ang_' + def.id, group: 'Ángulos (2D)', label: def.label, value: s.median, unit: '°', status: 'estimado',
      se: seOfMean(perC), n: perC.filter(Number.isFinite).length,
      confidence: confLabel(s.meanConf * 0.7 + Math.min(1, coverage * 1.5) * 0.3),
      range: [s.p10, s.p90],
      detail: `Mediana; rango habitual (P10-P90) ${s.p10.toFixed(0)}°-${s.p90.toFixed(0)}°. ${(100 * coverage).toFixed(0)}% de cuadros con datos. ${def.note}. Ángulo proyectado en el plano de la imagen.`,
    });
  }

  // Ángulos por ciclo (mínimo de codo por ciclo del brazo correspondiente)
  const perCycle = [];
  for (const side of ['L', 'R']) {
    const ang = angles[side === 'L' ? 'elbowL' : 'elbowR'];
    for (const c of arms[side].cycles.filter(c => c.accepted)) {
      let minV = Infinity, minI = -1, maxV = -Infinity;
      for (let i = c.start; i <= c.end; i++) {
        const v = ang.values[i];
        if (Number.isFinite(v) && !ang.interp[i]) { if (v < minV) { minV = v; minI = i; } if (v > maxV) maxV = v; }
      }
      perCycle.push({ side, tStart: c.tStart, duration: c.duration, elbowMin: Number.isFinite(minV) ? minV : null, elbowMinFrame: minI, elbowMax: Number.isFinite(maxV) ? maxV : null });
    }
  }

  // No disponibles en esta versión (siempre explícitos)
  metrics.push({ id: 'speed', group: 'Rendimiento', label: 'Velocidad', value: null, status: 'no disponible', detail: 'Requiere una distancia conocida en la toma: se marca en la pestaña Fases, sección Velocidad dentro del ciclo.' });
  metrics.push({ id: 'strokeLength', group: 'Rendimiento', label: 'Longitud de ciclo', value: null, status: 'no disponible', detail: 'Requiere velocidad calibrada. No se estima sin escala espacial.' });
  metrics.push({ id: 'phases', group: 'Técnica', label: 'Fases de la brazada', value: null, status: 'no disponible', detail: 'La segmentación en entrada, agarre, tracción, empuje y recobro es un módulo pendiente.' });

  const observations = buildObservations(metrics, quality, meta);

  // puntos descartados por baja confianza, solo para mostrarlos como referencia
  const KEY = [0, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28];
  const rawLow = frames.map(f => f.lm ? KEY.filter(j => Math.min(f.lm[j][2] ?? 0, f.lm[j][3] ?? 1) < cfg.minVisibility)
    .map(j => [f.lm[j][0] * meta.width, f.lm[j][1] * meta.height]) : null);

  return { version: 1, meta, times, rawLow, tracks: compactTracks(tracks), angles, arms: stripSignals(arms), kicks: stripSignals(kicks), armSignals: { L: arms.L.signal, R: arms.R.signal }, quality, metrics, angleSummary, perCycle, observations };
}

function stripSignals(o) {
  const out = {};
  for (const k of Object.keys(o)) { const { signal, ...rest } = o[k]; out[k] = rest; }
  return out;
}

function compactTracks(tracks) {
  return tracks.map(t => ({ x: t.x, y: t.y, vis: t.vis, interpolated: t.interpolated, rawValid: t.rawValid, manual: t.manual }));
}

// Observaciones derivadas solo de datos medidos; se expresan como hechos, no como errores.
function buildObservations(metrics, quality, meta) {
  const obs = [];
  const get = id => metrics.find(m => m.id === id);
  const cv = get('cycleCV');
  if (cv && Number.isFinite(cv.value) && cv.confidence !== 'baja' && cv.value > 8) {
    obs.push({ type: 'Inconsistencia entre ciclos', priority: cv.value > 15 ? 'media' : 'baja', text: `La duración de los ciclos varía un ${cv.value.toFixed(1)}% (CV). Conviene revisar si coincide con respiraciones, virajes o fatiga antes de interpretarlo como un problema técnico.` });
  }
  const sym = get('armSym');
  if (sym && Number.isFinite(sym.value) && sym.value > 10) {
    obs.push({ type: 'Asimetría temporal', priority: 'media', text: `La duración media del ciclo difiere un ${sym.value.toFixed(1)}% entre brazos. Verificar con una toma frontal o desde ambos lados, porque en toma lateral un brazo suele quedar ocluido.` });
  }
  for (const side of ['L', 'R']) {
    const e = get('ang_elbow' + side);
    if (e && e.range && e.confidence !== 'baja' && e.range[0] > 150 && meta.style !== 'espalda') {
      obs.push({ type: 'Aspecto a revisar', priority: 'baja', text: `El codo ${side === 'L' ? 'izquierdo' : 'derecho'} se mantiene mayormente extendido en el plano de la imagen (P10 ${e.range[0].toFixed(0)}°). Puede deberse a la perspectiva; revisar la fase subacuática en los fotogramas.` });
    }
  }
  for (const w of quality.warnings) obs.push({ type: 'Limitación de la toma', priority: 'info', text: w });
  return obs;
}

export const LIMITATIONS = [
  'Todos los ángulos son proyecciones 2D en el plano de la imagen. No reconstruyen la biomecánica tridimensional: un segmento que se aleja o acerca a la cámara se ve acortado y altera el ángulo.',
  'Las posiciones articulares provienen de un modelo de estimación de pose (MediaPipe BlazePose) entrenado mayormente con personas fuera del agua. Burbujas, salpicaduras, reflejos, refracción y miembros sumergidos reducen su precisión; cada punto lleva su confianza.',
  'Los puntos con confianza inferior a 0,5 se descartan. Huecos de hasta 0,2 s se interpolan y se marcan como interpolados; no se usan para resumir ángulos.',
  'La precisión de este sistema todavía no fue validada frente a mediciones de referencia (digitalización manual por evaluadores expertos). Los valores deben tomarse como estimaciones.',
  'Velocidad y distancia por ciclo solo se calculan si se marca una distancia conocida en la toma (pestaña Fases).',
  'El estilo y el tipo de toma los declara el entrenador; la detección automática es un módulo pendiente.',
];
