// Velocidad dentro del ciclo, por fase. Con una distancia conocida marcada en la toma lateral (dos puntos en
// la dirección del nado y en el plano del nadador) se pasa la posición de la cadera o de la cabeza a metros y
// se mide cuánto avanza el nadador en cada fase de la brazada. La velocidad media de una fase sale de lo que
// avanza entre sus dos eventos (no de derivar cuadro a cuadro), así el ruido de la pose pesa menos.
// Errores declarados: el de la escala (±1 px en cada marca), el de la posición (ruido de la pose, medido en el
// propio video) y la variación entre ciclos.
import { apply as camApply } from './camera.js';
import { PHASES } from './phases.js';

const mean = (xs) => { const v = xs.filter(Number.isFinite); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : NaN; };
const sd = (xs) => { const v = xs.filter(Number.isFinite); if (v.length < 2) return NaN; const m = mean(v); return Math.sqrt(v.reduce((s, x) => s + (x - m) ** 2, 0) / (v.length - 1)); };
const median = (xs) => { const v = xs.filter(Number.isFinite).sort((a, b) => a - b); return v.length ? (v.length % 2 ? v[v.length >> 1] : (v[v.length / 2 - 1] + v[v.length / 2]) / 2) : NaN; };

export const POINTS = {
  hip: { label: 'Cadera', joints: [23, 24] },
  head: { label: 'Cabeza', joints: [0] },
  shoulder: { label: 'Hombros', joints: [11, 12] },
};

// Escala: p1 y p2 en píxeles del cuadro `frame` (llevados a la referencia de la cámara si se movió), a D metros.
export function swimScale({ p1, p2, D, frame = 0 }, cam = null, markErrPx = 1) {
  const T = cam?.toBase?.[frame];
  const a = T ? camApply(T, p1) : p1, b = T ? camApply(T, p2) : p2;
  const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (!(L > 5) || !(D > 0)) return null;
  return { origin: a, u: [(b[0] - a[0]) / L, (b[1] - a[1]) / L], mpp: D / L, px: L, D, rel: Math.SQRT2 * markErrPx / L };
}

// Posición a lo largo de la dirección del nado, en metros, cuadro a cuadro. ok = punto visto (no interpolado).
export function positionSeries(r, sc, point = 'hip', cam = null) {
  const n = r.times.length, js = POINTS[point].joints, x = new Array(n).fill(NaN), ok = new Array(n).fill(false);
  for (let i = 0; i < n; i++) {
    const pts = js.map(j => [r.tracks[j].x[i], r.tracks[j].y[i], r.tracks[j].rawValid?.[i] && !r.tracks[j].interpolated?.[i]]).filter(p => Number.isFinite(p[0]) && Number.isFinite(p[1]));
    if (!pts.length) continue;
    let p = [mean(pts.map(q => q[0])), mean(pts.map(q => q[1]))];
    const T = cam?.toBase?.[i];
    if (T) p = camApply(T, p);
    x[i] = ((p[0] - sc.origin[0]) * sc.u[0] + (p[1] - sc.origin[1]) * sc.u[1]) * sc.mpp;
    ok[i] = pts.length === js.length && pts.every(q => q[2]) && (!cam || cam.ok?.[i] !== false);
  }
  return { x, ok };
}

// Ajuste cuadrático local (posición y velocidad en el centro) con los cuadros vistos dentro de ±half segundos.
// Con un ajuste cuadrático la posición no se achata en las curvas de la velocidad.
function localFit(times, x, ok, i, half) {
  const S = [0, 0, 0, 0, 0], B = [0, 0, 0];
  let n = 0;
  const t0 = times[i];
  const add = (j) => { const t = times[j] - t0, y = x[j]; n++; let p = 1; for (let k = 0; k < 5; k++) { S[k] += p; if (k < 3) B[k] += p * y; p *= t; } };
  for (let j = i; j >= 0 && t0 - times[j] <= half; j--) if (ok[j]) add(j);
  for (let j = i + 1; j < times.length && times[j] - t0 <= half; j++) if (ok[j]) add(j);
  if (n < 5) return null;
  // sistema normal 3x3 [S0 S1 S2; S1 S2 S3; S2 S3 S4]·[a b c] = B (Cramer)
  const m = [[S[0], S[1], S[2]], [S[1], S[2], S[3]], [S[2], S[3], S[4]]];
  const det3 = (q) => q[0][0] * (q[1][1] * q[2][2] - q[1][2] * q[2][1]) - q[0][1] * (q[1][0] * q[2][2] - q[1][2] * q[2][0]) + q[0][2] * (q[1][0] * q[2][1] - q[1][1] * q[2][0]);
  const D = det3(m);
  if (Math.abs(D) < 1e-18) return null;
  const col = (k) => m.map((row, r) => row.map((v, c) => c === k ? B[r] : v));
  return { x: det3(col(0)) / D, v: det3(col(1)) / D };
}

// Velocidad instantánea suavizada y ruido de la posición (desvío robusto de los puntos respecto del ajuste).
export function velocitySeries(times, x, ok, half = 0.1) {
  const n = times.length, v = new Array(n).fill(NaN), xs = new Array(n).fill(NaN), res = [];
  for (let i = 0; i < n; i++) {
    const f = localFit(times, x, ok, i, half);
    if (!f) continue;
    v[i] = f.v; xs[i] = f.x;
    if (ok[i]) res.push(x[i] - f.x);
  }
  // el ajuste absorbe parte del ruido (3 parámetros con k puntos): se corrige por √(k/(k−3))
  const mad = median(res.map(Math.abs)), k = Math.max(5, Math.round(2 * half / Math.max(1e-6, median(times.slice(1).map((t, i) => t - times[i])))) + 1);
  return { v, xs, sigmaX: Number.isFinite(mad) ? 1.4826 * mad * Math.sqrt(k / (k - 3)) : NaN };
}

// Resumen por fase con los ciclos válidos del brazo con más ciclos. sp: strokePhases(r).
export function phaseVelocity(r, sp, sc, point = 'hip', cam = null, half = 0.1) {
  if (!sp || sp.error) return { error: sp?.error || 'Hacen falta las fases de la brazada.' };
  const { x, ok } = positionSeries(r, sc, point, cam);
  const seen = ok.filter(Boolean).length;
  if (seen < 0.3 * r.times.length) return { error: `${POINTS[point].label}: vista en el ${Math.round(100 * seen / r.times.length)} % de los cuadros. Hace falta al menos el 30 %.` };
  const t = r.times, vs = velocitySeries(t, x, ok, half);
  // posición en un evento: la del ajuste local (si el punto no se vio justo ahí, el ajuste lo cubre)
  const at = (i) => Number.isFinite(vs.xs[i]) ? vs.xs[i] : NaN;
  const side = sp.best, cycles = sp.arms[side].cycles.filter(c => c.ok);
  let dir = 1;
  const disp = cycles.map(c => at(c.E2) - at(c.E)).filter(Number.isFinite);
  if (disp.length && median(disp) < 0) dir = -1; // el nadador va en sentido contrario a las marcas
  const rows = [];
  for (const c of cycles) {
    const cv = dir * (at(c.E2) - at(c.E)) / (t[c.E2] - t[c.E]);
    if (!Number.isFinite(cv)) continue;
    const ph = PHASES.map(p => { const a = c[p.from], b = c[p.to]; return { id: p.id, v: dir * (at(b) - at(a)) / (t[b] - t[a]), dt: t[b] - t[a] }; });
    const inst = []; for (let i = c.E; i <= c.E2; i++) if (Number.isFinite(vs.v[i])) inst.push(dir * vs.v[i]);
    // curva normalizada al 0-100 % del ciclo
    const curve = Array.from({ length: 51 }, (_, k) => { const tt = t[c.E] + (k / 50) * (t[c.E2] - t[c.E]); let j = c.E; while (j < c.E2 && t[j + 1] <= tt) j++; const w = j < c.E2 ? (tt - t[j]) / (t[j + 1] - t[j]) : 0; const a = vs.v[j], b = vs.v[Math.min(j + 1, c.E2)]; return dir * (Number.isFinite(a) && Number.isFinite(b) ? a + w * (b - a) : NaN); });
    rows.push({ n: c.n, E: c.E, E2: c.E2, v: cv, dur: t[c.E2] - t[c.E], phases: ph, ivv: inst.length >= 5 ? 100 * sd(inst) / mean(inst) : NaN, curve, minAt: curve.indexOf(Math.min(...curve.filter(Number.isFinite))) * 2 });
  }
  if (rows.length < 2) return { error: `Hacen falta 2 ciclos completos con la ${POINTS[point].label.toLowerCase()} a la vista (hay ${rows.length}).` };
  const nC = rows.length, sX = vs.sigmaX;
  const stat = (vals, dts) => { const m = mean(vals), s = sd(vals); const meas = Number.isFinite(sX) ? mean(dts.map(d => Math.SQRT2 * sX / d)) / Math.sqrt(vals.length) : NaN; return { v: m, sd: s, se: Number.isFinite(s) ? s / Math.sqrt(vals.length) : NaN, meas, n: vals.length }; };
  const phases = PHASES.map((p, k) => ({ id: p.id, label: p.label, ...stat(rows.map(rw => rw.phases[k].v), rows.map(rw => rw.phases[k].dt)), pct: mean(rows.map(rw => 100 * rw.phases[k].dt / rw.dur)) }));
  const cyc = stat(rows.map(rw => rw.v), rows.map(rw => rw.dur));
  const durs = rows.map(rw => rw.dur), dpc = rows.map(rw => rw.v * rw.dur);
  const curve = Array.from({ length: 51 }, (_, k) => { const vals = rows.map(rw => rw.curve[k]).filter(Number.isFinite); return { pct: 2 * k, v: mean(vals), sd: sd(vals) }; });
  // ruido de la velocidad instantánea: con ajuste de ±half s, σv ≈ σx·√(12/(n(n²-1)))/Δt (n puntos; el término
  // cuadrático no cambia la pendiente en una ventana simétrica)
  const nWin = Math.max(4, Math.round(2 * half * r.meta.fps) + 1), dt = 1 / r.meta.fps;
  const vNoise = Number.isFinite(sX) ? sX * Math.sqrt(12 / (nWin * (nWin * nWin - 1))) / dt : NaN;
  // la fase más lenta se señala solo si está por debajo de la media del ciclo más que su margen
  const slow = phases.filter(p => Number.isFinite(p.v)).reduce((a, b) => b.v < a.v ? b : a, { v: Infinity });
  const margin = Number.isFinite(slow.v) ? 1.96 * Math.hypot(slow.se || 0, slow.meas || 0, cyc.se || 0) : Infinity;
  if (!(cyc.v - slow.v > margin)) slow.v = Infinity;
  return {
    side, point, n: nC, rows, phases, cycle: cyc, ivv: mean(rows.map(rw => rw.ivv)), ivvSd: sd(rows.map(rw => rw.ivv)),
    dpc: { v: mean(dpc), sd: sd(dpc), se: sd(dpc) / Math.sqrt(nC) }, cycleDur: mean(durs),
    curve, sigmaX: sX, vNoise, scaleRel: sc.rel, slowest: Number.isFinite(slow.v) ? slow.id : null, half,
  };
}

// Lo que se guarda en la evaluación.
export function velocitySaved(res, scaleIn) {
  if (!res || res.error) return scaleIn ? { scale: scaleIn } : null;
  const r3 = (v) => Number.isFinite(v) ? +v.toFixed(3) : null;
  return {
    scale: scaleIn, point: res.point, side: res.side, n: res.n,
    cycle: { v: r3(res.cycle.v), se: r3(res.cycle.se) }, dpc: { v: r3(res.dpc.v), se: r3(res.dpc.se) }, ivv: r3(res.ivv),
    phases: res.phases.map(p => ({ id: p.id, label: p.label, v: r3(p.v), se: r3(p.se), pct: r3(p.pct) })),
    sigmaX: r3(res.sigmaX), scaleRel: r3(res.scaleRel),
  };
}
