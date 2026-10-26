// Errores técnicos con evidencia. Cada error de la biblioteca dice qué mide, en qué estilo y con qué toma
// se puede medir, y muestra los cuadros que lo prueban. La app solo sugiere: el entrenador confirma o
// descarta, y con sus decisiones la app propone el umbral que separa lo que confirmó de lo que descartó.
// La app no trae umbrales inventados: salvo la diferencia entre brazos (10 %, el criterio que la app ya
// usaba en las observaciones), cada umbral lo define el entrenador. Hasta entonces se muestra la medida.
import { seOfMean, Z95 } from './change.js';
import { techFatigue } from './fatigue.js';
import { kickSignal, ANGLE_DEFS } from './analysis.js';

const mean = (xs) => { const v = xs.filter(Number.isFinite); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : NaN; };
const median = (xs) => { const v = xs.filter(Number.isFinite).sort((a, b) => a - b); return v.length ? (v.length % 2 ? v[v.length >> 1] : (v[v.length / 2 - 1] + v[v.length / 2]) / 2) : NaN; };
const LAT = (v) => String(v || '').startsWith('lateral');
const SIDE = { L: 'izquierdo', R: 'derecho' };
const accepted = (r, s) => (r.arms?.[s]?.cycles || []).filter(c => c.accepted);
const bestArm = (r) => ['L', 'R'].map(s => ({ s, c: accepted(r, s) })).sort((a, b) => b.c.length - a.c.length)[0];
const pt = (r, j, i) => { const t = r.tracks[j]; return t && Number.isFinite(t.x[i]) && Number.isFinite(t.y[i]) ? [t.x[i], t.y[i]] : null; };
const seen = (r, j, i) => !!r.tracks[j]?.rawValid?.[i];
const mid = (a, b) => a && b ? [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] : null;

// Cada regla: id, nombre, estilos, toma que pide, unidad, sentido (mayor = peor), y la medida.
// measure(r, ctx) → { value, se?, n?, frames: [{ f, label }], detail } o { na: 'por qué no se puede medir' }.
export const FAULTS = [
  {
    id: 'asym', label: 'Asimetría entre brazos', styles: ['crol', 'espalda'], unit: '%', decimals: 1,
    shot: 'Frontal, posterior o lateral desde los dos lados', how: 'Diferencia de la duración media del ciclo de cada brazo.',
    defaultThr: 10, defaultNote: 'criterio inicial de la app (no validado)',
    viewOk: () => true,
    measure(r) {
      const L = accepted(r, 'L'), R = accepted(r, 'R');
      if (L.length < 2 || R.length < 2) return { na: `Hacen falta 2 ciclos completos de cada brazo (hay ${L.length} del izquierdo y ${R.length} del derecho).` };
      const dl = L.map(c => c.duration), dr = R.map(c => c.duration), ml = mean(dl), mr = mean(dr), m = (ml + mr) / 2;
      const sl = seOfMean(dl), sr = seOfMean(dr);
      const pick = (cs, md) => cs.reduce((b, c) => Math.abs(c.duration - md) < Math.abs(b.duration - md) ? c : b);
      const a = pick(L, ml), b = pick(R, mr);
      return {
        value: 100 * Math.abs(ml - mr) / m, se: sl == null || sr == null ? null : 100 * Math.hypot(sl, sr) / m, n: Math.min(dl.length, dr.length),
        frames: [{ f: a.start, label: `Ciclo típico del brazo izquierdo (${ml.toFixed(2)} s)` }, { f: b.start, label: `Ciclo típico del brazo derecho (${mr.toFixed(2)} s)` }],
        detail: `Izquierdo ${ml.toFixed(2)} s, derecho ${mr.toFixed(2)} s.${LAT(r.meta.view) ? ' En toma lateral el brazo lejano suele quedar tapado: confirmalo con una toma de frente o desde el otro lado.' : ''}`,
      };
    },
  },
  {
    id: 'headLift', label: 'Cabeza que sube al respirar', styles: ['crol'], unit: '% del tronco', decimals: 0,
    shot: 'Lateral', how: 'Cuánto más alta queda la cabeza (nariz respecto de los hombros) en el ciclo donde más sube que en un ciclo típico, en porcentaje del largo del tronco.',
    viewOk: LAT,
    measure(r) {
      const { s, c } = bestArm(r);
      if (c.length < 3) return { na: `Hacen falta al menos 3 ciclos completos (hay ${c.length}).` };
      const peaks = c.map(cy => {
        let best = -Infinity, bi = -1, nSeen = 0;
        for (let i = cy.start; i <= cy.end; i++) {
          const n = pt(r, 0, i), sh = mid(pt(r, 11, i), pt(r, 12, i)), hp = mid(pt(r, 23, i), pt(r, 24, i));
          if (!n || !sh || !hp || !seen(r, 0, i)) continue;
          const L = Math.hypot(sh[0] - hp[0], sh[1] - hp[1]);
          if (L < 1e-6) continue;
          nSeen++;
          const h = 100 * (sh[1] - n[1]) / L; // positivo = nariz por encima de los hombros
          if (h > best) { best = h; bi = i; }
        }
        return nSeen >= 0.5 * (cy.end - cy.start + 1) ? { h: best, f: bi } : null;
      }).filter(Boolean);
      if (peaks.length < 3) return { na: 'La nariz se vio en menos de la mitad de los cuadros de la mayoría de los ciclos.' };
      const typ = median(peaks.map(p => p.h)), top = peaks.reduce((a, b) => b.h > a.h ? b : a);
      const typP = peaks.reduce((a, b) => Math.abs(b.h - typ) < Math.abs(a.h - typ) ? b : a);
      return {
        value: top.h - typ, n: peaks.length,
        frames: [{ f: top.f, label: 'Cabeza en su punto más alto' }, { f: typP.f, label: 'Cabeza en un ciclo típico' }],
        detail: `Brazo ${SIDE[s]}, ${peaks.length} ciclos con la cabeza visible. Es un solo ciclo contra la mediana, así que no lleva margen de error: miralo en los cuadros.`,
      };
    },
  },
  {
    id: 'lateCatch', label: 'Agarre tardío', styles: ['crol'], unit: '% del ciclo', decimals: 0,
    shot: 'Lateral o subacuática', how: 'Duración de la fase de entrada y agarre (de la entrada al inicio de la tracción) en porcentaje del ciclo.',
    viewOk: LAT,
    measure(r, ctx) {
      const sp = ctx.phases;
      if (!sp || sp.error) return { na: sp?.error || 'No hay fases de la brazada.' };
      const a = sp.arms[sp.best], ok = a.cycles.filter(c => c.ok);
      if (ok.length < 2) return { na: `Hacen falta 2 ciclos con las cuatro fases (hay ${ok.length}).` };
      const p = ok.map(c => c.phases[0].pct), w = ok.reduce((x, c) => c.phases[0].pct > x.phases[0].pct ? c : x);
      return {
        value: mean(p), se: seOfMean(p), n: p.length,
        frames: [{ f: w.E, label: `Entrada (ciclo ${w.n}, el agarre más largo)` }, { f: w.B, label: `Inicio de la tracción (ciclo ${w.n})` }],
        detail: `Brazo ${SIDE[sp.best]}. Las fases salen de la pose y se pueden corregir a mano en la pestaña Fases.`,
      };
    },
  },
  {
    id: 'droppedElbow', label: 'Codo caído en la tracción', styles: ['crol', 'mariposa'], unit: '°', decimals: 0,
    shot: 'Lateral subacuática', how: 'Ángulo del codo en la mitad de la tracción. Cuanto más abierto (cerca de 180°), más recto empuja el brazo.',
    viewOk: (v) => v === 'lateral-subacuatica',
    measure(r, ctx) {
      const sp = ctx.phases;
      if (!sp || sp.error) return { na: sp?.error || 'No hay fases de la brazada.' };
      const side = sp.best, ang = r.angles['elbow' + side], ok = sp.arms[side].cycles.filter(c => c.ok);
      const vals = ok.map(c => { const i = Math.round((c.B + c.P) / 2); return Number.isFinite(ang?.values[i]) && !ang.interp[i] ? { v: ang.values[i], f: i, n: c.n } : null; }).filter(Boolean);
      if (vals.length < 2) return { na: 'El codo no se vio en la mitad de la tracción en al menos 2 ciclos.' };
      const w = vals.reduce((a, b) => b.v > a.v ? b : a);
      return {
        value: mean(vals.map(x => x.v)), se: seOfMean(vals.map(x => x.v)), n: vals.length,
        frames: [{ f: w.f, label: `Mitad de la tracción, ciclo ${w.n} (${w.v.toFixed(0)}°)` }],
        detail: `Brazo ${SIDE[side]}. Ángulo en el plano de la imagen.`,
      };
    },
  },
  {
    id: 'handCross', label: 'Cruce de la mano al entrar', styles: ['crol'], unit: '% del ancho de hombros', decimals: 0,
    shot: 'Frontal o cenital', how: 'Cuánto pasa la muñeca al otro lado de la línea media del cuerpo, en porcentaje del ancho de hombros (percentil 95 de los cuadros vistos).',
    viewOk: (v) => ['frontal', 'cenital', 'posterior'].includes(v),
    measure(r) {
      const n = r.times.length, out = {};
      for (const [s, sh, wr] of [['L', 11, 15], ['R', 12, 16]]) {
        const xs = [];
        for (let i = 0; i < n; i++) {
          const a = pt(r, 11, i), b = pt(r, 12, i), w = pt(r, wr, i);
          if (!a || !b || !w || !seen(r, wr, i) || !seen(r, sh, i)) continue;
          const width = Math.abs(a[0] - b[0]);
          if (width < 1e-6) continue;
          const m = (a[0] + b[0]) / 2, own = Math.sign((sh === 11 ? a : b)[0] - m);
          const past = -own * (w[0] - m); // positivo = la muñeca pasó al otro lado
          xs.push({ v: 100 * Math.max(0, past) / width, f: i });
        }
        if (xs.length >= 20) {
          const sorted = [...xs].sort((p, q) => p.v - q.v), p95 = sorted[Math.floor(0.95 * (sorted.length - 1))];
          out[s] = { v: p95.v, f: p95.f, n: xs.length };
        }
      }
      const sides = Object.keys(out);
      if (!sides.length) return { na: 'Las muñecas y los hombros no se vieron en suficientes cuadros.' };
      const w = sides.reduce((a, b) => out[b].v > out[a].v ? b : a);
      return {
        value: out[w].v, n: out[w].n,
        frames: [{ f: out[w].f, label: `Muñeca ${SIDE[w] === 'izquierdo' ? 'izquierda' : 'derecha'} más cruzada` }],
        detail: sides.map(s => `${s === 'L' ? 'Izquierda' : 'Derecha'}: ${out[s].v.toFixed(0)} %`).join(', ') + '. El recobro por encima de la cabeza también puede cruzar la línea: mirá el cuadro.',
      };
    },
  },
  {
    id: 'hipSink', label: 'Cadera hundida', styles: ['crol', 'espalda', 'pecho', 'mariposa'], unit: '°', decimals: 1,
    shot: 'Lateral con la cámara nivelada', how: 'Inclinación de la línea cadera-hombro respecto de la horizontal de la imagen (mediana). Positivo = hombros más altos que la cadera.',
    viewOk: LAT,
    measure(r) {
      const s = r.angles.trunkIncl;
      if (!s) return { na: 'No hay datos del tronco.' };
      const all = s.values.map((v, i) => ({ v, i })).filter(x => Number.isFinite(x.v));
      if (all.length < 20) return { na: 'El tronco se vio en muy pocos cuadros.' };
      const { c } = bestArm(r);
      const perC = c.map(cy => median(s.values.slice(cy.start, cy.end + 1)));
      const med = median(all.map(x => x.v)), typ = all.reduce((a, b) => Math.abs(b.v - med) < Math.abs(a.v - med) ? b : a);
      return {
        value: med, se: seOfMean(perC), n: perC.filter(Number.isFinite).length,
        frames: [{ f: typ.i, label: `Posición típica del tronco (${typ.v.toFixed(1)}°)` }],
        detail: 'Si la cámara no está nivelada con el agua, este ángulo se corre lo mismo que la cámara: revisá que la superficie del agua se vea horizontal.',
      };
    },
  },
  {
    id: 'wideKick', label: 'Patada muy amplia', styles: ['crol', 'espalda'], unit: '% del tronco', decimals: 0,
    shot: 'Lateral', how: 'Amplitud de la patada: recorrido del tobillo perpendicular al tronco en cada patada (mediana), en porcentaje del largo del tronco. El suavizado de los puntos achica las patadas rápidas (a 30 cuadros por segundo, una patada de 0,5 s se ve cerca de 17 % más chica).',
    viewOk: LAT,
    measure(r) {
      const kc = ['L', 'R'].map(s => ({ s, c: (r.kicks?.[s]?.cycles || []).filter(c => c.accepted) })).sort((a, b) => b.c.length - a.c.length)[0];
      if (kc.c.length < 3) return { na: `Hacen falta al menos 3 patadas completas con el tobillo visible (hay ${kc.c.length}).` };
      const sig = kickSignal(r.tracks, r.times.length, kc.s);
      const amps = kc.c.map(c => { let lo = Infinity, hi = -Infinity, fl = -1, fh = -1; for (let i = c.start; i <= c.end; i++) { const v = sig[i]; if (!Number.isFinite(v)) continue; if (v < lo) { lo = v; fl = i; } if (v > hi) { hi = v; fh = i; } } return hi > lo ? { a: 100 * (hi - lo), fl, fh } : null; }).filter(Boolean);
      if (amps.length < 3) return { na: 'El tobillo no se vio bien en las patadas.' };
      const med = median(amps.map(x => x.a)), w = amps.reduce((a, b) => b.a > a.a ? b : a);
      return {
        value: med, se: seOfMean(amps.map(x => x.a)), n: amps.length,
        frames: [{ f: w.fh, label: 'Patada más amplia: un extremo' }, { f: w.fl, label: 'Patada más amplia: el otro extremo' }],
        detail: `Tobillo ${SIDE[kc.s]}, ${amps.length} patadas. Sirve sobre todo en largos de patada con tabla o de nado con la patada visible.`,
      };
    },
  },
  {
    id: 'fatigue', label: 'Caída de técnica por fatiga', styles: ['crol', 'espalda', 'pecho', 'mariposa'], unit: 'medidas', decimals: 0,
    shot: 'La misma toma durante un tramo largo', how: 'Cantidad de medidas (tiempo por ciclo y ángulos) que cambian de verdad entre el primer y el último tercio de los ciclos.',
    defaultThr: 0, defaultNote: 'cualquier cambio real (supera el error de la medida)', noLearn: true,
    viewOk: () => true,
    measure(r) {
      const defs = ANGLE_DEFS.filter(d => r.metrics?.find(x => x.id === 'ang_' + d.id)?.value != null);
      const fat = techFatigue(r, defs);
      if (fat.error) return { na: fat.error };
      const real = fat.rows.filter(x => x.change.verdict === 'real');
      const { c } = bestArm(r);
      return {
        value: real.length, n: fat.rows.length,
        frames: [{ f: c[0].start, label: 'Primer tramo' }, { f: c[c.length - fat.k].start, label: 'Último tramo' }],
        detail: real.length ? `Cambian de verdad: ${real.map(x => `${x.label.toLowerCase()} (${x.d === 2 ? x.change.d.toFixed(2) : x.change.d.toFixed(0)}${x.unit === '°' ? '°' : ' ' + x.unit})`).join(', ')}. El detalle está en la pestaña Ciclos.` : 'Ninguna medida cambia más que su error entre el principio y el final.',
      };
    },
  },
];

// Umbral efectivo de una regla: el del entrenador o, si no definió ninguno, el inicial (si lo hay).
export function thresholdOf(rule, thr = {}) {
  if (Number.isFinite(thr[rule.id])) return { v: thr[rule.id], src: 'entrenador' };
  if (Number.isFinite(rule.defaultThr)) return { v: rule.defaultThr, src: rule.defaultNote };
  return null;
}

// Evalúa la biblioteca sobre un análisis. thr: umbrales del entrenador; ctx: { phases }.
// Estados: detectado (supera el umbral aun con el error), posible (lo supera pero el error lo alcanza),
// no (por debajo), sin umbral, no medible (la toma o los datos no alcanzan; dice qué toma pide).
export function detectFaults(r, ctx = {}, thr = {}) {
  const out = [];
  for (const rule of FAULTS) {
    if (!rule.styles.includes(r.meta.style)) continue;
    const base = { id: rule.id, label: rule.label, unit: rule.unit, decimals: rule.decimals, how: rule.how, shot: rule.shot };
    if (!rule.viewOk(r.meta.view)) { out.push({ ...base, status: 'no medible', reason: `Pide toma ${rule.shot.toLowerCase()}.` }); continue; }
    let m;
    try { m = rule.measure(r, ctx); } catch (e) { m = { na: 'No se pudo calcular: ' + e.message }; }
    if (m.na) { out.push({ ...base, status: 'no medible', reason: m.na }); continue; }
    const t = thresholdOf(rule, thr), se = Number.isFinite(m.se) ? m.se : null;
    let status = 'sin umbral';
    if (t) {
      const lo = se == null ? m.value : m.value - Z95 * se;
      status = m.value > t.v ? (lo > t.v ? 'detectado' : 'posible') : 'no';
    }
    out.push({ ...base, status, value: m.value, se, n: m.n, frames: m.frames, detail: m.detail, thr: t });
  }
  return out;
}

// Umbral que separa lo confirmado de lo descartado (mayor = peor). history: [{ v, ok }].
// Necesita al menos una decisión de cada tipo; si se superponen, toma el punto medio de las medianas.
export function suggestThreshold(history = []) {
  const C = history.filter(h => h.ok && Number.isFinite(h.v)).map(h => h.v), D = history.filter(h => !h.ok && Number.isFinite(h.v)).map(h => h.v);
  if (!C.length || !D.length) return null;
  const minC = Math.min(...C), maxD = Math.max(...D);
  const v = maxD < minC ? (maxD + minC) / 2 : (median(C) + median(D)) / 2;
  return { v, clean: maxD < minC, nC: C.length, nD: D.length };
}

// Lo que se guarda en la evaluación (sin los cuadros de evidencia salvo su número).
export function faultsSaved(list, decisions = {}) {
  return list.map(f => ({ id: f.id, label: f.label, unit: f.unit, status: f.status, value: Number.isFinite(f.value) ? +f.value.toFixed(3) : null, se: f.se, n: f.n ?? null, thr: f.thr?.v ?? null, reason: f.reason || '', frames: (f.frames || []).map(x => x.f), decision: decisions[f.id]?.ok == null ? null : decisions[f.id].ok ? 'confirmado' : 'descartado', note: decisions[f.id]?.note || '' }));
}

export const STATUS_LABEL = { detectado: 'Detectado', posible: 'Posible', no: 'No aparece', 'sin umbral': 'Sin umbral', 'no medible': 'No medible' };
