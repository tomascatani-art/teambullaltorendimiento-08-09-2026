// Gimnasio: velocidad de la barra, saltos y perfil carga-velocidad, todo medido en el video.
// Barra: se sigue el centro del disco cuadro a cuadro (como Metric VBT o Qwik VBT) y con el diámetro del
// disco se pasa a metros. Por repetición: velocidad media de la fase concéntrica (subida), pico, recorrido
// y desvío horizontal de la barra; por serie, la pérdida de velocidad (fatiga).
// Salto: tiempo de vuelo entre el despegue y la caída marcados a mano (método de My Jump),
// h = g·t²/8 (Bosco y col., 1983).
// Errores declarados: el de la escala (±1 px en cada marca del disco), el de la posición (ruido del
// seguimiento, medido en el propio video) y, en el salto, ±½ cuadro en cada marca.
import { velocitySeries } from './velocity.js';

const G = 9.81;
const mean = (xs) => { const v = xs.filter(Number.isFinite); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : NaN; };

// Ejercicios. table: la tabla de velocidades vale tal cual (se armó con datos de sentadilla);
// 'other' = la misma velocidad equivale a otro % del máximo; 'olympic' = en los olímpicos se mira el pico.
// Las claves squat, bench, deadlift y other ya están en evaluaciones guardadas: no cambiarlas.
// v1rm: velocidad media de referencia en el 1RM (m/s), de la bibliografía de entrenamiento por velocidad
// (González-Badillo, Sánchez-Medina y col.). Sirve para estimar el RM con la recta carga-velocidad.
export const EXERCISES = {
  squat: { label: 'Sentadilla', group: 'Piernas', table: 'squat' , v1rm: 0.30 },
  front_squat: { label: 'Sentadilla frontal', group: 'Piernas', table: 'squat' , v1rm: 0.30 },
  half_squat: { label: 'Media sentadilla', group: 'Piernas', table: 'squat' , v1rm: 0.30 },
  split_squat: { label: 'Sentadilla búlgara', group: 'Piernas', table: 'other' , v1rm: 0.30 },
  lunge: { label: 'Estocada', group: 'Piernas', table: 'other' , v1rm: 0.30 },
  leg_press: { label: 'Prensa', group: 'Piernas', table: 'other' , v1rm: 0.21 },
  jump_squat: { label: 'Sentadilla con salto', group: 'Piernas', table: 'other' },
  deadlift: { label: 'Peso muerto', group: 'Cadera', table: 'other' , v1rm: 0.15 },
  rdl: { label: 'Peso muerto rumano', group: 'Cadera', table: 'other' , v1rm: 0.20 },
  hip_thrust: { label: 'Hip thrust', group: 'Cadera', table: 'other' , v1rm: 0.25 },
  bench: { label: 'Press de banca', group: 'Empuje', table: 'other' , v1rm: 0.17 },
  incline_bench: { label: 'Press inclinado', group: 'Empuje', table: 'other' , v1rm: 0.17 },
  ohp: { label: 'Press militar', group: 'Empuje', table: 'other' , v1rm: 0.19 },
  push_press: { label: 'Push press', group: 'Empuje', table: 'other' },
  row: { label: 'Remo con barra', group: 'Tracción', table: 'other' , v1rm: 0.45 },
  prone_row: { label: 'Remo en banco plano', group: 'Tracción', table: 'other' , v1rm: 0.50 },
  pullup: { label: 'Dominadas con lastre', group: 'Tracción', table: 'other' , v1rm: 0.23 },
  power_clean: { label: 'Cargada de potencia', group: 'Olímpicos', table: 'olympic' },
  hang_clean: { label: 'Cargada colgada', group: 'Olímpicos', table: 'olympic' },
  snatch: { label: 'Arranque', group: 'Olímpicos', table: 'olympic' },
  jerk: { label: 'Envión', group: 'Olímpicos', table: 'olympic' },
  other: { label: 'Otro ejercicio', group: 'Otros', table: 'other' },
};

// Tabla de Prilepin adaptada al entrenamiento basado en la velocidad (Medvedyev, 1986; D. Baker y col., 2000),
// tal como la trae el material del entrenador. Velocidad media de las repeticiones de la serie.
export const ZONES = [
  { id: 'abs', label: 'Fuerza absoluta', lo: 0.15, hi: 0.30, pct: '92 a 100 %', reps: '1 a 2', sets: '4 a 5', total: '4 a 10' },
  { id: 'max', label: 'Hacia la fuerza máxima', lo: 0.30, hi: 0.50, pct: '80 a 92 %', reps: '2 a 4', sets: '4 a 5', total: '8 a 16' },
  { id: 'acc', label: 'Fuerza acelerativa', lo: 0.50, hi: 0.75, pct: '65 a 80 %', reps: '3 a 5', sets: '3 a 4', total: '10 a 20' },
  { id: 'fv', label: 'Fuerza-velocidad', lo: 0.75, hi: 1.00, pct: '45 a 65 %', reps: '3 a 5', sets: '4 a 5', total: '12 a 25' },
  { id: 'vf', label: 'Velocidad-fuerza', lo: 1.00, hi: 1.30, pct: '25 a 45 %', reps: '4 a 6', sets: '4 a 5', total: '18 a 30' },
];
// Adaptada a la práctica (Prof. Jorge González Guedes, datos de sentadilla).
export const PRACTICE = [
  { id: 'build_f', label: 'Construcción de la fuerza', lo: 0, hi: 0.70, reps: '2 a 5', sets: '4 a 6', total: '25 a 30' },
  { id: 'build_v', label: 'Construcción de la velocidad', lo: 0.70, hi: 1.00, reps: '2 a 5', sets: '4 a 6', total: '20 a 25' },
  { id: 'peak', label: 'Puesta a punto', lo: 1.00, hi: Infinity, reps: '4 a 6', sets: '4 a 6', total: '15 a 20' },
];
// Si el déficit de la serie pasa de −10 %, solo se hace una serie más (misma fuente).
export const DEFICIT_LIMIT = -10;

// Zona de una velocidad v (m/s) con su error estándar se. Si el margen al 95 % cruza un límite, se dice.
function inBands(bands, v, se = 0) {
  if (!Number.isFinite(v)) return null;
  const z = bands.find(b => v >= b.lo && v < b.hi) || null;
  const m = 1.96 * (Number.isFinite(se) ? se : 0);
  const near = z ? bands.find(b => b !== z && ((b.hi === z.lo && v - m < z.lo) || (b.lo === z.hi && v + m >= z.hi))) || null : null;
  return { zone: z, near };
}
export const zoneOf = (v, se) => {
  const r = inBands(ZONES, v, se);
  if (r && !r.zone) r.out = v < ZONES[0].lo ? 'below' : 'above';
  return r;
};
export const practiceOf = (v, se) => inBands(PRACTICE, v, se);

// Déficit de la serie como en la planilla de control: (velocidad media de las repeticiones − velocidad de la 1.ª)
// / velocidad media × 100. Negativo = la serie se frenó.
export function seriesDeficit(reps) {
  const v = reps.map(r => r.mv), ok = v.every(Number.isFinite);
  if (reps.length < 2 || !ok) return null;
  const n = v.length, m = v.reduce((a, b) => a + b, 0) / n, v1 = v[0];
  const d = 100 * (m - v1) / m;
  // propagación con el error de cada repetición (derivadas de d respecto de cada velocidad)
  const ses = reps.map(r => (Number.isFinite(r.se) ? r.se : 0));
  let s2 = 0;
  for (let i = 0; i < n; i++) {
    const dm = 1 / n, g = 100 * ((i === 0 ? dm - 1 : dm) * m - (m - v1) * dm) / (m * m);
    s2 += (g * ses[i]) ** 2;
  }
  return { v: d, se: Math.sqrt(s2), first: v1, mean: m, stop: d < DEFICIT_LIMIT };
}

// Carga efectiva: la serie posterior a la mayor pérdida (series del mismo día y ejercicio, en orden).
export function effectiveSet(deficits) {
  let k = -1, worst = Infinity;
  deficits.forEach((d, i) => { if (Number.isFinite(d) && d < worst) { worst = d; k = i; } });
  return k >= 0 && worst < 0 && k + 1 < deficits.length ? k + 1 : -1;
}

// Diámetro de los discos de competencia (reglamento IWF: 450 mm). Los de entrenamiento pueden medir otra cosa.
export const PLATE_MM = 450;

// Escala con dos puntos en bordes opuestos del disco (en píxeles del video), a D metros.
export function barScale(p1, p2, D, markErrPx = 1) {
  const L = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
  if (!(L > 5) || !(D > 0)) return null;
  return { mpp: D / L, px: L, D, rel: Math.SQRT2 * markErrPx / L };
}

// Recorrido del disco: pts [{ t, x, y }] en píxeles del video → metros (y hacia arriba, desde el primer punto).
export function barPath(pts, sc) {
  const p0 = pts[0];
  return { t: pts.map(p => p.t), x: pts.map(p => (p.x - p0.x) * sc.mpp), y: pts.map(p => (p0.y - p.y) * sc.mpp) };
}

// En vivo se saltean cuadros cuando el dispositivo no llega a procesarlos: se reparte el recorrido en pasos
// iguales (el paso típico), interpolando en línea recta en los huecos, para que el ajuste de velocidad tenga
// siempre la misma cantidad de puntos.
export function uniform(path) {
  const { t, x, y } = path, n = t.length;
  const d = t.slice(1).map((v, i) => v - t[i]).sort((p, q) => p - q), step = d[d.length >> 1];
  if (!(step > 0) || d[d.length - 1] < 1.5 * step) return path;
  const T = [], X = [], Y = [];
  for (let k = 0, j = 0; t[0] + k * step <= t[n - 1] + 1e-9; k++) {
    const tt = t[0] + k * step;
    while (j < n - 2 && t[j + 1] < tt) j++;
    const w = (tt - t[j]) / (t[j + 1] - t[j] || 1);
    T.push(tt); X.push(x[j] + w * (x[j + 1] - x[j])); Y.push(y[j] + w * (y[j + 1] - y[j]));
  }
  return { t: T, x: X, y: Y };
}

// Repeticiones y serie. Una subida cuenta cuando la barra sube al menos `minRom` (y el 35 % del
// recorrido total), entre un punto bajo y el siguiente alto. half: ventana del ajuste local (s).
export function analyzeBar(path, sc, { half = null, minRom = 0.05 } = {}) {
  if (path.t.length < 10) return { error: 'Hacen falta más cuadros seguidos.' };
  const rawT = path.t;
  const { t, x, y } = uniform(path), n = t.length;
  // hueco más largo entre cuadros reales cerca de un instante (en vivo se saltean cuadros)
  const gapNear = (tt) => { let g = 0; for (let i = 1; i < rawT.length; i++) if (rawT[i] >= tt - 0.1 && rawT[i - 1] <= tt + 0.1) g = Math.max(g, rawT[i] - rawT[i - 1]); return g || dt; };
  const dt = (t[n - 1] - t[0]) / (n - 1);
  half ??= Math.max(0.05, 2.5 * dt); // al menos 5 cuadros en la ventana
  const ok = new Array(n).fill(true);
  const vs = velocitySeries(t, y, ok, half);
  const ys = vs.xs.map((v, i) => (Number.isFinite(v) ? v : y[i]));
  const range = Math.max(...ys) - Math.min(...ys);
  const P = Math.max(minRom, 0.35 * range);
  // puntos de giro con histéresis P
  const turns = [];
  let lo = 0, hi = 0, dir = 0;
  for (let i = 1; i < n; i++) {
    if (ys[i] < ys[lo]) lo = i;
    if (ys[i] > ys[hi]) hi = i;
    if (dir >= 0 && ys[i] < ys[hi] - P) { if (dir > 0 || !turns.length) turns.push({ i: hi, kind: 'top' }); dir = -1; lo = i; }
    else if (dir <= 0 && ys[i] > ys[lo] + P) { if (dir < 0 || !turns.length) turns.push({ i: lo, kind: 'bottom' }); dir = 1; hi = i; }
  }
  if (dir > 0) turns.push({ i: hi, kind: 'top' });
  else if (dir < 0) turns.push({ i: lo, kind: 'bottom' });
  const sX = vs.sigmaX;
  // ruido de la velocidad instantánea (ajuste de ±half s): σv ≈ σx·√(12/(m(m²−1)))/Δt
  const m = Math.max(5, Math.round(2 * half / dt) + 1);
  const vNoise = Number.isFinite(sX) ? sX * Math.sqrt(12 / (m * (m * m - 1))) / dt : 0;
  const reps = [];
  let cut = false;
  for (let k = 0; k + 1 < turns.length; k++) {
    const a = turns[k], b = turns[k + 1];
    if (a.kind !== 'bottom' || b.kind !== 'top') continue;
    // la subida empieza cuando la velocidad pasa el ruido y termina cuando vuelve a él (los extremos de
    // la posición caen en cualquier punto de una pausa abajo o arriba)
    // la subida empieza y termina con velocidad cero, pero cerca de cero mandan el ruido y el suavizado
    // (que mezcla una pausa abajo o arriba). Se toman los cruces de dos niveles de velocidad (15 % y 30 %
    // del pico, o más si el ruido lo pide) y se prolonga esa recta hasta velocidad cero.
    let pk = -Infinity; for (let i = a.i; i <= b.i; i++) if (vs.v[i] > pk) pk = vs.v[i];
    const L1 = Math.max(0.15 * pk, 3 * vNoise), L2 = Math.min(Math.max(2 * L1, 0.3 * pk), 0.6 * pk);
    if (!(L2 > L1)) continue;
    const lerp = (j, k, lvl) => { const va = vs.v[j], vb = vs.v[k], w = (lvl - va) / (vb - va); return { t: t[j] + w * (t[k] - t[j]), y: ys[j] + w * (ys[k] - ys[j]) }; };
    const edge = (from, to, stp) => {
      while (from !== to && !Number.isFinite(vs.v[from])) from += stp; // sin ajuste en el borde del video
      if (!(vs.v[from] <= L1)) return null; // en la punta todavía se mueve: el video la corta
      let j = from; while (j !== to && !(vs.v[j] > L2)) j += stp; // primer paso por L2 desde la punta
      if (j === to) return null;
      const c2 = lerp(j - stp, j, L2);
      let k = j; while (k !== from && vs.v[k] > L1) k -= stp; // hacia afuera hasta bajar de L1
      const c1 = lerp(k, k + stp, L1);
      const dtz = (c1.t - c2.t) * L1 / (L2 - L1); // de L1 a cero, con la misma pendiente
      return { t: c1.t + dtz, y: c1.y + dtz * L1 / 2 };
    };
    const s0 = edge(a.i, b.i, 1), s1 = edge(b.i, a.i, -1);
    if (!s0 || !s1) { if (b.i >= n - 3 || a.i <= 2) cut = true; continue; }
    const i0 = a.i, i1 = b.i;
    const dur = s1.t - s0.t, rom = s1.y - s0.y;
    const mv = rom / dur;
    if (!Number.isFinite(mv) || !(dur > 0)) continue;
    let pv = -Infinity, pvAt = a.i;
    for (let i = i0; i <= i1; i++) if (Number.isFinite(vs.v[i]) && vs.v[i] > pv) { pv = vs.v[i]; pvAt = i; }
    const xs = x.slice(i0, i1 + 1);
    // margen: ruido de la posición en las dos puntas y la escala
    const meas = Number.isFinite(sX) ? Math.SQRT2 * sX / dur : NaN;
    // inicio y fin: hasta un cuadro de corrimiento en cada punta (se toma como un desvío)
    const tim = mv * Math.hypot(Math.max(dt, gapNear(s0.t)), Math.max(dt, gapNear(s1.t))) / dur;
    const se = Math.hypot(Number.isFinite(meas) ? meas : 0, mv * sc.rel, tim);
    const ecc = k > 0 && turns[k - 1].kind === 'top' ? t[i0] - t[turns[k - 1].i] : null;
    reps.push({ n: reps.length + 1, from: i0, to: i1, t0: s0.t, t1: s1.t, mv, se, pv, pvAt, rom, dur, ecc, dx: Math.max(...xs) - Math.min(...xs) });
  }
  if (!reps.length) return { error: `No encontré ninguna subida de al menos ${Math.round(100 * P)} cm. Revisá que el punto seguido sea el disco y que se vea la serie entera.`, curve: { t, v: vs.v, y: ys } };
  const best = reps.reduce((a, b) => (b.mv > a.mv ? b : a)), last = reps[reps.length - 1];
  // pérdida de velocidad: de la repetición más rápida a la última (en %)
  let vl = null;
  if (reps.length >= 2) {
    const v = 100 * (best.mv - last.mv) / best.mv;
    const se = 100 * Math.hypot(last.se / best.mv, last.mv * best.se / best.mv ** 2);
    vl = { v, se, from: best.n, to: last.n };
  }
  return {
    reps, best, vl, cut, meanMv: mean(reps.map(r => r.mv)), sigmaX: sX, vNoise, scaleRel: sc.rel, P,
    curve: { t, v: vs.v, y: ys, x },
  };
}

// Lo que se guarda de una serie.
export function barSaved(res, extra) {
  const r3 = (v) => (Number.isFinite(v) ? +v.toFixed(3) : null);
  return {
    type: 'bar', ...extra,
    reps: res.reps.map(r => ({ n: r.n, t0: r3(r.t0), t1: r3(r.t1), mv: r3(r.mv), se: r3(r.se), pv: r3(r.pv), rom: r3(r.rom), dur: r3(r.dur), ecc: r3(r.ecc), dx: r3(r.dx) })),
    best: { n: res.best.n, mv: r3(res.best.mv), se: r3(res.best.se) },
    vl: res.vl ? { v: +res.vl.v.toFixed(1), se: +res.vl.se.toFixed(1), from: res.vl.from, to: res.vl.to } : null,
    deficit: (() => { const d = seriesDeficit(res.reps); return d ? { v: +d.v.toFixed(2), se: +d.se.toFixed(2) } : null; })(),
    meanMv: r3(res.meanMv), sigmaX: r3(res.sigmaX), scaleRel: r3(res.scaleRel),
  };
}

// Salto por tiempo de vuelo. tTake: primer cuadro sin contacto; tLand: primer cuadro con contacto.
// Cada marca tiene ±½ cuadro (uniforme): desvío del tiempo de vuelo = cuadro/√6.
export function jumpHeight(tTake, tLand, frameDur) {
  const ft = tLand - tTake;
  if (!(ft > 0)) return null;
  const h = G * ft * ft / 8, sdT = frameDur / Math.sqrt(6);
  return { ft, h, se: G * ft * sdT / 4, frameDur };
}

// Perfil carga-velocidad: recta v = a + b·carga con la repetición más rápida de cada serie.
// loadAt(v) devuelve la carga estimada a esa velocidad con su margen (predicción inversa).
export function loadVelocity(points) {
  const P = points.filter(p => Number.isFinite(p.load) && Number.isFinite(p.v));
  const n = P.length;
  if (n < 2) return { n, error: 'Hacen falta series con al menos dos cargas distintas.' };
  const mx = mean(P.map(p => p.load)), my = mean(P.map(p => p.v));
  const Sxx = P.reduce((s, p) => s + (p.load - mx) ** 2, 0), Sxy = P.reduce((s, p) => s + (p.load - mx) * (p.v - my), 0);
  if (!(Sxx > 0)) return { n, error: 'Todas las series tienen la misma carga: hacen falta cargas distintas.' };
  const b = Sxy / Sxx, a = my - b * mx;
  const res = P.map(p => p.v - (a + b * p.load)), sse = res.reduce((s, r) => s + r * r, 0);
  const Syy = P.reduce((s, p) => s + (p.v - my) ** 2, 0);
  const s = n > 2 ? Math.sqrt(sse / (n - 2)) : NaN;
  const lmin = Math.min(...P.map(p => p.load)), lmax = Math.max(...P.map(p => p.load));
  const loadAt = (v) => {
    if (!(b < 0)) return null;
    const L = (v - a) / b;
    const se = Number.isFinite(s) ? (s / Math.abs(b)) * Math.sqrt(1 + 1 / n + (v - my) ** 2 / (b * b * Sxx)) : NaN;
    return { load: L, se, extrapolated: L < lmin || L > lmax };
  };
  return { n, a, b, r2: Syy > 0 ? 1 - sse / Syy : NaN, s, lmin, lmax, loadAt };
}

// Salto con caída (drop jump): contacto con el piso al caer del cajón, despegue y caída final.
// RSI = altura del salto / tiempo de contacto (m/s).
export function dropJump(tContact, tTake, tLand, frameDur) {
  const j = jumpHeight(tTake, tLand, frameDur), tc = tTake - tContact;
  if (!j || !(tc > 0)) return null;
  const sdT = frameDur / Math.sqrt(6);
  const rsi = j.h / tc;
  return { ...j, tc, tcSe: sdT, rsi, rsiSe: rsi * Math.hypot(j.se / j.h, sdT / tc) };
}

// Perfil fuerza-velocidad en salto (método de Samozino y col., 2008): con la masa del deportista, la
// distancia de empuje (hpo: largo de la pierna extendida menos la altura de la posición inicial) y saltos
// con distintas cargas agregadas. Por salto: F = (m+carga)·g·(h/hpo + 1), v = √(g·h/2). Recta F-v:
// F0 (fuerza a velocidad cero), V0 (velocidad a fuerza cero) y potencia máxima F0·V0/4, por kg de masa.
export function fvProfile(mass, hpo, jumps) {
  if (!(mass > 0) || !(hpo > 0)) return { error: 'Faltan la masa y la distancia de empuje.' };
  const pts = jumps.filter(j => Number.isFinite(j.h) && j.h > 0 && Number.isFinite(j.load)).map(j => {
    const F = (mass + j.load) * G * (j.h / hpo + 1) / mass, v = Math.sqrt(G * j.h / 2);
    return { load: j.load, h: j.h, F, v, P: F * v };
  });
  const loads = new Set(pts.map(p => p.load));
  if (loads.size < 2) return { pts, error: 'Hacen falta saltos con al menos dos cargas distintas.' };
  const fit = loadVelocity(pts.map(p => ({ load: p.v, v: p.F }))); // recta F = a + b·v
  if (fit.error || !(fit.b < 0)) return { pts, error: 'Con estos saltos la fuerza no baja al subir la velocidad: revisá las cargas y las marcas.' };
  const F0 = fit.a, V0 = -fit.a / fit.b;
  return { pts, F0, V0, Pmax: F0 * V0 / 4, slope: fit.b, r2: fit.r2, n: pts.length };
}
