// Fases de la brazada (crol, espalda y mariposa, toma lateral), con los eventos de Chollet:
//   E entrada de la mano (la muñeca pasa por debajo del nivel del hombro, yendo hacia adelante)
//   B inicio del movimiento hacia atrás (mano más adelantada sobre el eje del tronco)
//   P mano debajo del hombro (la muñeca cruza el plano del hombro hacia atrás)
//   X salida (mano más atrasada, al final del empuje)
// Fases: entrada y agarre E→B, tracción B→P, empuje P→X, recobro X→E siguiente.
// Es una propuesta a partir de la pose: el nivel del agua no se ve, se toma el del hombro. Cada evento se
// puede corregir a mano. Solo se usan cuadros con la muñeca y el hombro vistos (no interpolados).

export const PHASES = [
  { id: 'entry', label: 'Entrada y agarre', from: 'E', to: 'B' },
  { id: 'pull', label: 'Tracción', from: 'B', to: 'P' },
  { id: 'push', label: 'Empuje', from: 'P', to: 'X' },
  { id: 'recovery', label: 'Recobro', from: 'X', to: 'E2' },
];
export const EVENT_LABEL = { E: 'Entrada', B: 'Inicio de la tracción', P: 'Mano bajo el hombro', X: 'Salida', E2: 'Entrada siguiente' };
export const PHASE_COLORS = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100'];
const SUPPORTED = ['crol', 'espalda', 'mariposa'];

const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;
const sd = (a) => { if (a.length < 2) return NaN; const m = mean(a); return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / (a.length - 1)); };

// Por qué no se pueden calcular (o null si se puede intentar).
export function phasesUnsupported(meta) {
  if (!SUPPORTED.includes(meta.style)) return 'En pecho las fases de brazos y piernas son otras (barrido hacia afuera, hacia adentro, recobro); este módulo cubre crol, espalda y mariposa.';
  if (meta.view && !String(meta.view).startsWith('lateral')) return 'Las fases se calculan con toma lateral: en toma frontal, posterior o cenital no se ve el avance de la mano respecto del hombro.';
  return null;
}

// Señales de un brazo: a lo largo del tronco (positivo = mano por delante del hombro) y nivel respecto del
// hombro (positivo = mano por debajo), en largos de tronco.
export function armSignals(r, side) {
  const T = r.tracks, n = r.times.length;
  const [sh, wr] = side === 'L' ? [11, 15] : [12, 16];
  const along = new Array(n).fill(NaN), level = new Array(n).fill(NaN), seen = new Array(n).fill(false);
  for (let i = 0; i < n; i++) {
    const pts = [11, 12, 23, 24, sh, wr].map(j => [T[j].x[i], T[j].y[i]]);
    if (pts.some(p => !Number.isFinite(p[0]) || !Number.isFinite(p[1]))) continue;
    const s = [(pts[0][0] + pts[1][0]) / 2, (pts[0][1] + pts[1][1]) / 2], h = [(pts[2][0] + pts[3][0]) / 2, (pts[2][1] + pts[3][1]) / 2];
    const ax = s[0] - h[0], ay = s[1] - h[1], L = Math.hypot(ax, ay);
    if (L < 1e-6) continue;
    const dx = pts[5][0] - pts[4][0], dy = pts[5][1] - pts[4][1];
    along[i] = (dx * ax + dy * ay) / (L * L);
    level[i] = dy / L; // en la imagen, hacia abajo es hacia el fondo de la pileta
    seen[i] = !!(T[wr].rawValid?.[i] && T[sh].rawValid?.[i]);
  }
  return { along, level, seen };
}

// Extremos locales de la señal (solo cuadros vistos), con una prominencia mínima.
function extrema(sig, seen, kind, minProm, minDist) {
  const out = [], n = sig.length, k = kind === 'max' ? 1 : -1;
  for (let i = 1; i < n - 1; i++) {
    if (!seen[i] || !Number.isFinite(sig[i])) continue;
    const v = k * sig[i];
    let ok = true, lo = v, ro = v;
    for (let j = Math.max(0, i - minDist); j <= Math.min(n - 1, i + minDist); j++) {
      if (j === i || !Number.isFinite(sig[j])) continue;
      if (k * sig[j] > v || (k * sig[j] === v && j < i)) { ok = false; break; }
    }
    if (!ok) continue;
    for (let j = i - 1; j >= 0 && j >= i - 3 * minDist; j--) if (Number.isFinite(sig[j])) lo = Math.min(lo, k * sig[j]);
    for (let j = i + 1; j < n && j <= i + 3 * minDist; j++) if (Number.isFinite(sig[j])) ro = Math.min(ro, k * sig[j]);
    if (v - Math.max(lo, ro) >= minProm) out.push(i);
  }
  return out;
}

// Eventos y fases de un brazo. edits: { 'k:E': frame, ... } correcciones del entrenador.
export function armPhases(r, side, edits = {}) {
  const fps = r.meta.fps, times = r.times;
  const { along, level, seen } = armSignals(r, side);
  const minDist = Math.max(3, Math.round(0.25 * fps));
  const B = extrema(along, seen, 'max', 0.25, minDist);
  const near = (i) => seen[i] || seen[i - 1] || seen[i + 1];
  // última vez que la muñeca pasa por debajo del nivel del hombro en (from, to]
  const entryIn = (from, to) => { let e = -1; for (let i = Math.max(1, from + 1); i <= to; i++) if (Number.isFinite(level[i - 1]) && Number.isFinite(level[i]) && level[i - 1] <= 0 && level[i] > 0) e = i; return e; };
  const maxLag = Math.round(4 * fps);
  const out = [];
  let prevX = -1;
  for (let k = 0; k + 1 < B.length; k++) {
    const b = B[k], b2 = B[k + 1];
    // salida: mano más atrasada entre dos extensiones
    let x = -1;
    for (let i = b + 1; i < b2; i++) if (seen[i] && Number.isFinite(along[i]) && (x < 0 || along[i] < along[x])) x = i;
    // mano bajo el hombro: cruce de la señal por cero hacia atrás
    let p = -1;
    if (x > 0) for (let i = b + 1; i <= x; i++) if (Number.isFinite(along[i - 1]) && Number.isFinite(along[i]) && along[i - 1] >= 0 && along[i] < 0) { p = i; break; }
    const e = entryIn(prevX >= 0 ? prevX : Math.max(0, b - maxLag), b), e2 = x > 0 ? entryIn(x, b2) : -1;
    prevX = x;
    const c = { side, n: out.length + 1, E: e, B: b, P: p, X: x, E2: e2, auto: {} };
    for (const ev of ['E', 'B', 'P', 'X', 'E2']) {
      c.auto[ev] = c[ev];
      const key = `${side}${c.n}:${ev}`;
      if (Number.isInteger(edits[key])) { c[ev] = edits[key]; c.edited = true; }
    }
    const evs = ['E', 'B', 'P', 'X', 'E2'];
    const missing = evs.filter(e => !(c[e] >= 0));
    c.ok = !missing.length && evs.every((e, i) => i === 0 || c[evs[i - 1]] < c[e]);
    c.reason = missing.length ? `No se vio: ${missing.map(e => EVENT_LABEL[e].toLowerCase()).join(', ')}.` : !c.ok ? 'Los eventos quedaron fuera de orden: revisalos a mano.' : '';
    c.unseen = evs.filter(e => c[e] >= 0 && !near(c[e]) && !Number.isInteger(edits[`${side}${c.n}:${e}`]));
    if (c.ok) {
      c.dur = times[c.E2] - times[c.E];
      if (c.dur < 0.6 || c.dur > 4) { c.ok = false; c.reason = `Duración incoherente (${c.dur.toFixed(2)} s).`; }
      else c.phases = PHASES.map(ph => { const d = times[c[ph.to]] - times[c[ph.from]]; return { id: ph.id, label: ph.label, dur: d, pct: 100 * d / c.dur }; });
    }
    out.push(c);
  }
  return out;
}

// Resumen de los dos brazos: medias por fase de los ciclos válidos, y el error por cuadro.
export function strokePhases(r, edits = {}) {
  const why = phasesUnsupported(r.meta);
  if (why) return { error: why };
  const arms = {};
  for (const side of ['L', 'R']) {
    const cycles = armPhases(r, side, edits), ok = cycles.filter(c => c.ok);
    arms[side] = {
      cycles,
      n: ok.length,
      summary: ok.length ? PHASES.map((ph, i) => { const d = ok.map(c => c.phases[i].dur), p = ok.map(c => c.phases[i].pct); return { id: ph.id, label: ph.label, dur: mean(d), durSd: sd(d), pct: mean(p), pctSd: sd(p) }; }) : [],
      cycleDur: ok.length ? mean(ok.map(c => c.dur)) : NaN,
    };
  }
  const best = arms.L.n >= arms.R.n ? 'L' : 'R';
  return { arms, best, frameErr: 1 / r.meta.fps, error: arms.L.n + arms.R.n ? null : 'No se encontró ningún ciclo con los cuatro eventos a la vista. Hace falta ver la muñeca y el hombro durante toda la brazada.' };
}

// Fase en el cuadro i del brazo indicado (para mostrarla sobre el video), o null.
export function phaseAt(sp, side, i) {
  const a = sp?.arms?.[side];
  if (!a) return null;
  for (const c of a.cycles) {
    if (!c.ok || i < c.E || i >= c.E2) continue;
    const k = PHASES.findIndex(ph => i >= c[ph.from] && i < c[ph.to]);
    if (k >= 0) return { cycle: c.n, k, label: PHASES[k].label, color: PHASE_COLORS[k] };
  }
  return null;
}
