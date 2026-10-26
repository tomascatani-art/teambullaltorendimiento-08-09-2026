// Dos ciclos de brazada superpuestos, alineados por fase: cada ciclo se estira o se comprime por tramos
// para que la entrada, el inicio de la tracción, la mano bajo el hombro y la salida caigan en el mismo
// punto (el reparto medio de los dos). Así se compara la misma parte de la brazada aunque un ciclo sea más
// lento o tenga una fase más larga. Eje: % del ciclo alineado (0 = entrada, 100 = entrada siguiente).
import { PHASES } from './phases.js';

const EVS = ['E', 'B', 'P', 'X', 'E2'];

// Porcentaje del ciclo donde cae cada evento (promedio de los ciclos dados).
export function refPercents(cycles, times) {
  const pc = cycles.map(c => EVS.map(e => 100 * (times[c[e]] - times[c.E]) / (times[c.E2] - times[c.E])));
  return EVS.map((_, k) => pc.reduce((s, p) => s + p[k], 0) / pc.length);
}

// Cuadro (fraccionario) del ciclo c que corresponde al u % alineado.
export function warpFrame(c, ref, u) {
  let k = 0;
  while (k < EVS.length - 2 && u > ref[k + 1]) k++;
  const a = c[EVS[k]], b = c[EVS[k + 1]], s = (u - ref[k]) / Math.max(1e-9, ref[k + 1] - ref[k]);
  return a + Math.min(1, Math.max(0, s)) * (b - a);
}
// Al revés: el % alineado del cuadro i dentro del ciclo c (null fuera del ciclo).
export function unwarp(c, ref, i) {
  if (i < c.E || i > c.E2) return null;
  let k = 0;
  while (k < EVS.length - 2 && i > c[EVS[k + 1]]) k++;
  const a = c[EVS[k]], b = c[EVS[k + 1]];
  return ref[k] + (b > a ? (i - a) / (b - a) : 0) * (ref[k + 1] - ref[k]);
}

const lerpAt = (vals, f) => {
  const i = Math.floor(f), t = f - i, a = vals[i], b = vals[Math.min(vals.length - 1, i + 1)];
  if (t < 1e-9) return Number.isFinite(a) ? a : NaN;
  return Number.isFinite(a) && Number.isFinite(b) ? a + (b - a) * t : NaN;
};

// Curva de una serie (valores por cuadro) a lo largo del ciclo alineado, en N+1 puntos.
export function cycleCurve(vals, c, ref, N = 100) {
  return Array.from({ length: N + 1 }, (_, k) => lerpAt(vals, warpFrame(c, ref, 100 * k / N)));
}

// Comparación: curvas de A y B, banda de la variación normal entre todos los ciclos válidos (±1 desvío)
// y diferencia media por fase.
export function compareCycles(vals, A, B, all, times, N = 100) {
  const ref = refPercents([A, B], times);
  const ca = cycleCurve(vals, A, ref, N), cb = cycleCurve(vals, B, ref, N);
  const refAll = refPercents(all, times), curves = all.map(c => cycleCurve(vals, c, refAll, N));
  const band = Array.from({ length: N + 1 }, (_, k) => {
    const v = curves.map(cv => cv[k]).filter(Number.isFinite);
    if (v.length < 3) return NaN;
    const m = v.reduce((s, x) => s + x, 0) / v.length;
    return Math.sqrt(v.reduce((s, x) => s + (x - m) ** 2, 0) / (v.length - 1));
  });
  const phases = PHASES.map((ph, k) => {
    const lo = ref[k], hi = ref[k + 1];
    const idx = []; for (let j = 0; j <= N; j++) { const u = 100 * j / N; if (u >= lo && u <= hi) idx.push(j); }
    const pair = idx.filter(j => Number.isFinite(ca[j]) && Number.isFinite(cb[j]));
    const mA = pair.length ? pair.reduce((s, j) => s + ca[j], 0) / pair.length : NaN;
    const mB = pair.length ? pair.reduce((s, j) => s + cb[j], 0) / pair.length : NaN;
    const sd = idx.map(j => band[j]).filter(Number.isFinite);
    return { id: ph.id, label: ph.label, a: mA, b: mB, d: mB - mA, spread: sd.length ? sd.reduce((s, x) => s + x, 0) / sd.length : NaN, n: pair.length };
  });
  return { ref, a: ca, b: cb, band, phases };
}

// Puntos del esqueleto del ciclo B en el mismo momento alineado que el cuadro i del ciclo A, llevados
// sobre el nadador de A: mismo centro de cadera y misma escala de tronco (sin girar).
export function ghostSkeleton(tracks, A, B, ref, i) {
  const u = unwarp(A, ref, i);
  if (u == null) return null;
  const f = warpFrame(B, ref, u);
  const at = (fr, j) => [lerpAt(tracks[j].x, fr), lerpAt(tracks[j].y, fr)];
  const frame = (fr) => {
    const h = [0, 1].map(k => (at(fr, 23)[k] + at(fr, 24)[k]) / 2), s = [0, 1].map(k => (at(fr, 11)[k] + at(fr, 12)[k]) / 2);
    return { h, L: Math.hypot(s[0] - h[0], s[1] - h[1]) };
  };
  const fa = frame(i), fb = frame(f);
  if (![...fa.h, fa.L, ...fb.h, fb.L].every(Number.isFinite) || fb.L < 1e-6) return null;
  const k = fa.L / fb.L;
  const pts = tracks.map((_, j) => { const p = at(f, j); return Number.isFinite(p[0]) && Number.isFinite(p[1]) ? [fa.h[0] + (p[0] - fb.h[0]) * k, fa.h[1] + (p[1] - fb.h[1]) * k] : null; });
  return { u, pts };
}
