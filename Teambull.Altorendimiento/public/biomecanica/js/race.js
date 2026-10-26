// Análisis de competencia (cinemática de carrera): a partir de los eventos marcados en el video
// calcula tiempos de salida, parciales, velocidades, virajes, ciclos, frecuencia y distancia por ciclo.
// Funciones puras, sin DOM.

export const SOUND_SPEED = 343; // m/s a ~20 °C

export function defaultMarks(poolLength) {
  return poolLength === 25 ? [15, 20] : [15, 25, 35, 45];
}

// Genera la lista ordenada de eventos que hay que marcar para una prueba.
export function buildSlots(cfg) {
  const L = cfg.poolLength, n = Math.round(cfg.distance / L);
  const marks = (cfg.marks && cfg.marks.length ? cfg.marks : defaultMarks(L)).filter(m => m > 0 && m < L).sort((a, b) => a - b);
  const back = cfg.style === 'espalda';
  const slots = [
    { id: 'signal', kind: 'signal', label: 'Señal de salida', hint: 'El cuadro en que suena la bocina o se enciende el flash.' },
    { id: 'blockOff', kind: 'blockOff', label: back ? 'Despegue de la pared (pies)' : 'Despegue del bloque (pies)', hint: 'Último cuadro con los pies en contacto.' },
    { id: 'entry', kind: 'entry', label: back ? 'Entrada al agua (manos)' : 'Entrada al agua (manos)', hint: 'Primer contacto de las manos con el agua.' },
    { id: 'bo0', kind: 'breakout', lap: 0, label: 'Break out de la salida', hint: 'La cabeza rompe la superficie. Indicá también la distancia.', needsDist: true },
  ];
  for (let k = 0; k < n; k++) {
    for (const m of marks) slots.push({ id: `m${k * L + m}`, kind: 'mark', lap: k, dist: k * L + m, local: m, label: `Paso por ${k * L + m} m`, hint: `La cabeza cruza la marca de ${m} m de este largo.` });
    if (k < n - 1) {
      slots.push({ id: `wall${k}`, kind: 'wall', lap: k, dist: (k + 1) * L, label: `Viraje ${(k + 1) * L} m: contacto con la pared`, hint: 'Primer contacto (pies en crol y espalda, manos en pecho y mariposa).' });
      slots.push({ id: `off${k}`, kind: 'wallOff', lap: k, dist: (k + 1) * L, label: `Viraje ${(k + 1) * L} m: pies dejan la pared`, hint: 'Último cuadro con los pies apoyados.' });
      slots.push({ id: `bo${k + 1}`, kind: 'breakout', lap: k + 1, label: `Break out tras el viraje de ${(k + 1) * L} m`, hint: 'La cabeza rompe la superficie. Indicá la distancia desde la pared.', needsDist: true });
    } else {
      slots.push({ id: 'finish', kind: 'finish', lap: k, dist: (k + 1) * L, label: `Llegada (${(k + 1) * L} m)`, hint: 'Primer contacto con la placa.' });
    }
  }
  return slots;
}

// Tiempo cero de la carrera en segundos de video y cómo se obtuvo.
export function syncOffset(cfg, ev) {
  const sig = ev.signal?.t;
  const fin = ev.finish?.t;
  const delay = cfg.signalBy === 'sonido' ? (cfg.cameraDistance || 0) / SOUND_SPEED : 0;
  const bySignal = Number.isFinite(sig) ? sig - delay : NaN;
  if (Number.isFinite(cfg.officialTime) && Number.isFinite(fin)) {
    const byOfficial = fin - cfg.officialTime;
    return { t0: byOfficial, method: 'oficial', bySignal, delay, discrepancy: Number.isFinite(bySignal) ? bySignal - byOfficial : NaN };
  }
  if (Number.isFinite(bySignal)) return { t0: bySignal, method: cfg.signalBy === 'sonido' ? 'sonido' : 'visual', bySignal, delay, discrepancy: NaN };
  return { t0: NaN, method: 'ninguno', bySignal, delay, discrepancy: NaN };
}

const r2 = (x) => (Number.isFinite(x) ? x : null);

// Calcula todos los indicadores. ev: {slotId: {t, dist?}}, cycles: [t,...] en segundos de video.
export function computeRace(cfg, ev, cycles = []) {
  const slots = buildSlots(cfg);
  const sync = syncOffset(cfg, ev);
  const T = (id) => (ev[id] && Number.isFinite(ev[id].t) && Number.isFinite(sync.t0) ? ev[id].t - sync.t0 : NaN);
  const L = cfg.poolLength, n = Math.round(cfg.distance / L);
  const warnings = [];
  const cyc = cycles.filter(Number.isFinite).map(t => t - sync.t0).sort((a, b) => a - b);

  // orden temporal de los eventos marcados
  let last = -Infinity, lastLabel = '';
  for (const s of slots) {
    const t = ev[s.id]?.t;
    if (!Number.isFinite(t)) continue;
    if (t < last - 1e-6) warnings.push(`"${s.label}" está marcado antes que "${lastLabel}". Revisá el orden.`);
    last = t; lastLabel = s.label;
  }
  if (!Number.isFinite(sync.t0)) warnings.push('Falta la señal de salida (o la llegada más el tiempo oficial) para fijar el tiempo cero.');
  if (Number.isFinite(sync.discrepancy) && Math.abs(sync.discrepancy) > 0.05) {
    warnings.push(`La señal marcada y el tiempo oficial difieren en ${(sync.discrepancy * 1000).toFixed(0)} ms. Se usa el tiempo oficial.`);
  }

  // salida
  const start = {
    reaction: r2(cfg.reactionTime),
    blockTime: r2(T('blockOff')),
    flightTime: r2(T('entry') - T('blockOff')),
    breakoutTime: r2(T('bo0')),
    breakoutDist: r2(ev.bo0?.dist),
    underwaterSpeed: null,
  };
  if (Number.isFinite(ev.bo0?.dist) && Number.isFinite(T('bo0')) && Number.isFinite(T('blockOff'))) {
    start.underwaterSpeed = ev.bo0.dist / (T('bo0') - T('blockOff'));
  }

  // breakouts por largo (tiempo desde el inicio de la carrera)
  const breakoutT = (lap) => T(`bo${lap}`);

  // secciones entre marcas consecutivas (incluye paredes y llegada)
  const points = [{ dist: 0, t: 0, id: 'start' }];
  for (const s of slots) {
    if (s.kind === 'mark' || s.kind === 'wall' || s.kind === 'finish') points.push({ dist: s.dist, t: T(s.id), id: s.id, kind: s.kind, lap: s.lap, local: s.local, label: s.label });
  }
  const sections = [];
  let prev = points[0];
  for (let i = 1; i < points.length; i++) {
    const p = points[i];
    const sec = { id: p.id, dist: p.dist, lap: p.lap, kind: p.kind, local: p.local, from: prev.dist, cumulative: r2(p.t), partial: null, speed: null, cycles: null, strokeRate: null, dps: null, clean: false };
    if (Number.isFinite(p.t) && Number.isFinite(prev.t)) {
      sec.partial = p.t - prev.t;
      sec.speed = (p.dist - prev.dist) / sec.partial;
      // ciclos dentro de la sección
      const inSec = cyc.filter(t => t > prev.t && t <= p.t);
      sec.cycles = cycles.length ? inSec.length : null;
      const bo = breakoutT(p.lap);
      // sección "limpia": empieza después del break out del largo y no incluye la pared
      sec.clean = Number.isFinite(bo) && prev.t >= bo && p.kind === 'mark';
      // la frecuencia usa los ciclos de la sección y el último ciclo de la anterior para cubrir el tramo
      const before = cyc.filter(t => t <= prev.t && (!Number.isFinite(bo) || t >= bo)).slice(-1);
      const span = [...before, ...inSec];
      if (span.length >= 3) {
        sec.strokeRate = 60 * (span.length - 1) / (span[span.length - 1] - span[0]);
        if (sec.clean) sec.dps = sec.speed / (sec.strokeRate / 60);
      }
    }
    sections.push(sec);
    prev = p;
  }

  // virajes
  const turns = [];
  for (let k = 0; k < n - 1; k++) {
    const wallT = T(`wall${k}`), offT = T(`off${k}`), boT = T(`bo${k + 1}`);
    const before = points.filter(p => p.lap === k && p.kind === 'mark').map(p => ({ ...p })).find(p => p.local === L - 5);
    const after = points.find(p => p.lap === k + 1 && p.kind === 'mark' && p.local === 15);
    const in5 = before && Number.isFinite(before.t) ? wallT - before.t : NaN;
    const out15 = after && Number.isFinite(after.t) ? after.t - wallT : NaN;
    const boDist = ev[`bo${k + 1}`]?.dist;
    turns.push({
      wall: (k + 1) * L,
      in5: r2(in5),
      out15: r2(out15),
      turnTime: r2(in5 + out15),
      contact: r2(offT - wallT),
      breakoutDist: r2(boDist),
      breakoutTime: r2(boT - offT),
      underwaterSpeed: r2(Number.isFinite(boDist) ? boDist / (boT - offT) : NaN),
    });
  }

  // resumen por largo
  const laps = [];
  for (let k = 0; k < n; k++) {
    const endId = k < n - 1 ? `wall${k}` : 'finish';
    const startT = k === 0 ? 0 : T(`wall${k - 1}`);
    const endT = T(endId);
    const lapCycles = cyc.filter(t => t > (Number.isFinite(startT) ? startT : Infinity) && t <= endT);
    const clean = sections.filter(s => s.lap === k && s.clean && Number.isFinite(s.speed));
    const srs = sections.filter(s => s.lap === k && Number.isFinite(s.strokeRate)).map(s => s.strokeRate);
    laps.push({
      lap: k + 1,
      split: r2(endT - startT),
      cumulative: r2(endT),
      cycles: cycles.length ? lapCycles.length : null,
      cleanSpeed: clean.length ? clean.reduce((a, s) => a + (s.dist - s.from), 0) / clean.reduce((a, s) => a + s.partial, 0) : null,
      strokeRate: srs.length ? srs.reduce((a, b) => a + b, 0) / srs.length : null,
    });
    const lp = laps[laps.length - 1];
    lp.dps = Number.isFinite(lp.cleanSpeed) && Number.isFinite(lp.strokeRate) ? lp.cleanSpeed / (lp.strokeRate / 60) : null;
  }

  const finalTime = T('finish');
  return { cfg, sync, start, sections, turns, laps, finalTime: r2(finalTime), warnings, slots };
}

// Diferencias contra una referencia (otro análisis): negativo = más rápido en tiempos.
export function compare(a, b) {
  const pick = (r) => Object.fromEntries(r.sections.map(s => [s.id, s]));
  const pa = pick(a), pb = pick(b);
  const rows = [];
  for (const s of a.sections) {
    const o = pb[s.id];
    if (!o) continue;
    rows.push({ id: s.id, dist: s.dist, cumulative: diff(s.cumulative, o.cumulative), partial: diff(s.partial, o.partial), speed: diff(s.speed, o.speed), strokeRate: diff(s.strokeRate, o.strokeRate), dps: diff(s.dps, o.dps) });
  }
  return { rows, finalTime: diff(a.finalTime, b.finalTime), start: { blockTime: diff(a.start.blockTime, b.start.blockTime), breakoutDist: diff(a.start.breakoutDist, b.start.breakoutDist), breakoutTime: diff(a.start.breakoutTime, b.start.breakoutTime) } };
}
function diff(x, y) { return Number.isFinite(x) && Number.isFinite(y) ? x - y : null; }

// Medición de distancia sobre una línea de la pileta a partir de 2 o 3 referencias en el mismo cuadro.
// refs: [{p:[x,y], m}], target: [x,y]. Con 3 referencias usa una transformación proyectiva 1D (exacta
// para puntos sobre la misma recta bajo perspectiva); con 2, interpolación lineal (aproximada).
export function measureAlongLine(refs, target) {
  if (refs.length < 2) return null;
  const a = refs[0].p, b = refs[refs.length - 1].p;
  const dx = b[0] - a[0], dy = b[1] - a[1], len2 = dx * dx + dy * dy;
  if (len2 < 1) return null;
  const u = (p) => ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2; // coordenada sobre la recta
  const us = refs.map(r => u(r.p)), ms = refs.map(r => r.m), ut = u(target);
  if (refs.length === 2) {
    return { meters: ms[0] + (ut - us[0]) * (ms[1] - ms[0]) / (us[1] - us[0]), method: 'lineal (2 referencias, aproximado)' };
  }
  // m = (A u + B) / (C u + 1)  →  A u + B - C u m = m
  const rows = us.slice(0, 3).map((x, i) => [x, 1, -x * ms[i], ms[i]]);
  const sol = solve3(rows);
  if (!sol) return null;
  const [A, B, C] = sol;
  const den = C * ut + 1;
  if (Math.abs(den) < 1e-9) return null;
  return { meters: (A * ut + B) / den, method: 'proyectivo (3 referencias)' };
}

function solve3(r) {
  const m = r.map(x => x.slice());
  for (let c = 0; c < 3; c++) {
    let p = c;
    for (let i = c + 1; i < 3; i++) if (Math.abs(m[i][c]) > Math.abs(m[p][c])) p = i;
    if (Math.abs(m[p][c]) < 1e-12) return null;
    [m[c], m[p]] = [m[p], m[c]];
    for (let i = 0; i < 3; i++) if (i !== c) { const f = m[i][c] / m[c][c]; for (let j = c; j < 4; j++) m[i][j] -= f * m[c][j]; }
  }
  return [m[0][3] / m[0][0], m[1][3] / m[1][1], m[2][3] / m[2][2]];
}

// Tabla con el formato de planilla de análisis de competencia (filas × columnas), para CSV y PDF.
export function raceTable(res) {
  const cols = [];
  for (const s of res.sections) {
    if (s.kind === 'wall') continue;
    cols.push(s);
  }
  return cols;
}

// Ángulo en el vértice b formado por a-b-c, en grados (0 a 180), en el plano de la imagen.
export function angle3(a, b, c) {
  const v1 = [a[0] - b[0], a[1] - b[1]], v2 = [c[0] - b[0], c[1] - b[1]];
  const n = Math.hypot(...v1) * Math.hypot(...v2);
  if (!n) return NaN;
  const cos = Math.max(-1, Math.min(1, (v1[0] * v2[0] + v1[1] * v2[1]) / n));
  return Math.acos(cos) * 180 / Math.PI;
}
// Ángulo agudo del segmento p-q respecto de la horizontal de la imagen, en grados (0 a 90).
export function angleH(p, q) {
  const dx = q[0] - p[0], dy = q[1] - p[1];
  if (!dx && !dy) return NaN;
  const a = Math.abs(Math.atan2(dy, dx)) * 180 / Math.PI;
  return a > 90 ? 180 - a : a;
}
// Ángulo agudo del segmento p-q respecto de la vertical de la imagen, en grados (0 a 90).
export function angleV(p, q) { const h = angleH(p, q); return Number.isFinite(h) ? 90 - h : NaN; }
export function angleValue(a) {
  if (a.type === 'h') return angleH(a.pts[0], a.pts[1]);
  if (a.type === 'v') return angleV(a.pts[0], a.pts[1]);
  return angle3(a.pts[0], a.pts[1], a.pts[2]);
}
// Error del ángulo por el marcado: cada punto puede quedar corrido e píxeles de video (aprox. un
// píxel de pantalla al marcar). Propagación lineal: un corrimiento e perpendicular a un brazo de largo L
// gira ese brazo e/L radianes; el vértice mueve los dos brazos. Devuelve grados (1 desvío).
export function angleError(a, e = 1) {
  const len = (p, q) => Math.hypot(q[0] - p[0], q[1] - p[1]);
  if (a.type === 'h' || a.type === 'v') { const L = len(a.pts[0], a.pts[1]); return L ? Math.SQRT2 * e / L * 180 / Math.PI : NaN; }
  const L1 = len(a.pts[1], a.pts[0]), L2 = len(a.pts[1], a.pts[2]);
  if (!L1 || !L2) return NaN;
  return e * Math.sqrt(2 / (L1 * L1) + 2 / (L2 * L2)) * 180 / Math.PI;
}
export const ANGLE_TYPE_LABEL = { '3p': '3 puntos', h: 'contra la horizontal', v: 'contra la vertical' };

// Conversiones de frecuencia (las mismas de las tablas de stroke rate):
// segundos por ciclo = 60 / ciclos por minuto; en crol y espalda cada ciclo son 2 brazadas.
export const secPerCycle = (sr) => (Number.isFinite(sr) && sr > 0 ? 60 / sr : NaN);
// en medley depende del estilo de cada largo, que la planilla no separa: no se convierte
export const strokesPerMin = (sr, style) => (Number.isFinite(sr) && style !== 'medley' ? (style === 'crol' || style === 'espalda' ? 2 * sr : sr) : NaN);
