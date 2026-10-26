// Planillas de Excel con los datos de cada análisis y de la ficha de un alumno. Solo valores calculados
// o marcados; las celdas sin dato quedan vacías (nunca se rellenan).
import { SHORT, MOMENT_IDS } from './moments.js';
import { PHASES } from './phases.js';
import { computeRace, secPerCycle, strokesPerMin, angleValue } from './race.js';
import { reportToResults } from './reports.js';

const r3 = (v, d = 3) => (Number.isFinite(v) ? Math.round(v * 10 ** d) / 10 ** d : null);
const STYLE = { crol: 'Crol', espalda: 'Espalda', pecho: 'Pecho', mariposa: 'Mariposa', medley: 'Medley' };
const J = { 0: 'Nariz', 11: 'Hombro izq.', 12: 'Hombro der.', 13: 'Codo izq.', 14: 'Codo der.', 15: 'Muñeca izq.', 16: 'Muñeca der.', 23: 'Cadera izq.', 24: 'Cadera der.', 25: 'Rodilla izq.', 26: 'Rodilla der.', 27: 'Tobillo izq.', 28: 'Tobillo der.' };

// Técnica: resumen, por cuadro (ángulos y articulaciones), ciclos, fases y momentos clave.
export function techSheets(r, { moments = [], phases = null, flight = null, checks = [] } = {}) {
  const m = r.meta, sheets = [];
  const info = [['Dato', 'Valor'], ['Nadador', m.swimmer], ['Fecha', m.date || ''], ['Estilo', STYLE[m.style] || m.style], ['Toma', m.viewLabel || ''], ['Prueba o tarea', m.event || ''],
    ['Resolución', `${m.width}×${m.height}`], ['Cuadros por segundo', r3(m.fps, 2)], ['Cuadros', r.times.length], ['Tiempos de cuadro', m.timingSource === 'container' ? 'leídos del archivo' : 'estimados'],
    ['Nadador detectado (%)', r3(100 * r.quality.detectedFraction, 1)], ['Modelo', m.model], []];
  info.push(['Variable', 'Valor', 'Unidad', 'Estado', 'Confianza', 'Detalle']);
  for (const x of r.metrics) info.push([x.label, r3(x.value), x.unit || '', x.status, x.confidence || '', x.detail || '']);
  if (flight && !flight.error) info.push([], ['Vuelo de la salida', 'Valor', 'Margen'], ['Tiempo de vuelo (s)', r3(flight.time), r3(flight.frameDur)], ['Despegue (°)', r3(flight.takeoff.deg, 1), r3(flight.takeoff.err, 1)], ['Entrada (°)', r3(flight.entry.deg, 1), r3(flight.entry.err, 1)], ...(flight.body ? [['Cuerpo al entrar (°)', r3(flight.body.deg, 1), r3(flight.body.err, 1)]] : []));
  if (checks.length) info.push([], ['Verificación con ángulo conocido', 'Real (°)', 'Medido (°)', 'Error (°)'], ...checks.map(c => ['', r3(c.real, 1), r3(c.measured, 1), r3(c.err, 1)]));
  sheets.push({ name: 'Resumen', rows: info, widths: [26, 14, 12, 14, 12, 60] });

  const ids = Object.keys(r.angles);
  const head = ['Cuadro', 'Tiempo (s)', 'Detectado', ...ids.flatMap(id => [`${SHORT[id] || id} (°)`, `${SHORT[id] || id} interpolado`])];
  const joints = Object.keys(J).map(Number);
  head.push(...joints.flatMap(j => [`${J[j]} x (px)`, `${J[j]} y (px)`, `${J[j]} confianza`]));
  const rows = [head];
  for (let i = 0; i < r.times.length; i++) {
    const row = [i + 1, r3(r.times[i], 4), r.quality.detectedMask[i] ? 'sí' : 'no'];
    for (const id of ids) {
      const s = r.angles[id], ok = Number.isFinite(s.values[i]) && (s.conf[i] >= m.minVisibility || s.interp[i]);
      row.push(ok ? r3(s.values[i], 1) : null, ok && s.interp[i] ? 'sí' : null);
    }
    for (const j of joints) {
      const t = r.tracks[j], ok = Number.isFinite(t.x[i]) && (t.rawValid?.[i] || t.interpolated?.[i]);
      row.push(ok ? r3(t.x[i], 1) : null, ok ? r3(t.y[i], 1) : null, ok ? r3(t.vis?.[i], 2) : null);
    }
    rows.push(row);
  }
  sheets.push({ name: 'Por cuadro', rows });

  const cyc = [['Brazo', 'Ciclo', 'Inicio (s)', 'Duración (s)', 'Codo mínimo (°)', 'Datos (%)', 'Aceptado']];
  for (const side of ['L', 'R']) r.arms[side].cycles.forEach((c, k) => {
    const pc = r.perCycle.find(p => p.side === side && Math.abs(p.tStart - c.tStart) < 1e-6);
    cyc.push([side === 'L' ? 'Izquierdo' : 'Derecho', k + 1, r3(c.tStart), r3(c.duration), r3(pc?.elbowMin, 1), r3(100 * c.coverage, 0), c.accepted ? 'sí' : 'no']);
  });
  sheets.push({ name: 'Ciclos', rows: cyc });

  if (phases && !phases.error) {
    const ph = [['Brazo', 'Ciclo', 'Entrada (s)', 'Inicio tracción (s)', 'Mano bajo el hombro (s)', 'Salida (s)', 'Entrada siguiente (s)', 'Duración (s)', ...PHASES.flatMap(p => [`${p.label} (s)`, `${p.label} (%)`]), 'Corregido a mano', 'Observación']];
    for (const side of ['L', 'R']) for (const c of phases.arms[side].cycles) {
      const t = (e) => (c[e] >= 0 ? r3(r.times[c[e]]) : null);
      ph.push([side === 'L' ? 'Izquierdo' : 'Derecho', c.n, t('E'), t('B'), t('P'), t('X'), t('E2'), c.ok ? r3(c.dur) : null, ...(c.ok ? c.phases.flatMap(p => [r3(p.dur), r3(p.pct, 1)]) : PHASES.flatMap(() => [null, null])), c.edited ? 'sí' : '', c.reason || '']);
    }
    sheets.push({ name: 'Fases', rows: ph });
  }

  if (moments.length) {
    const cols = MOMENT_IDS.filter(id => moments.some(x => x.angles[id]));
    const mo = [['#', 'Momento', 'Cuadro', 'Tiempo (s)', 'Desde el primero (s)', ...cols.map(id => `${SHORT[id]} (°)`), ...cols.map(id => `${SHORT[id]} interpolado`)]];
    for (const x of moments) mo.push([x.n, x.label, x.frame + 1, r3(x.t), r3(x.dt), ...cols.map(id => r3(x.angles[id]?.v, 1)), ...cols.map(id => (x.angles[id]?.interp ? 'sí' : null))]);
    sheets.push({ name: 'Momentos clave', rows: mo });
  }
  return sheets;
}

// Competencia: marcas, largos, salida y virajes, ángulos y velocidad continua.
export function raceSheets(cfg, res, { angles = [], raceTime = (t) => t, speed = null, angleType = {}, checks = [] } = {}) {
  const sheets = [];
  const info = [['Dato', 'Valor'], ['Nadador', cfg.swimmer], ['Prueba', `${cfg.distance} m ${STYLE[cfg.style] || cfg.style}`], ['Pileta (m)', cfg.poolLength], ['Fecha', cfg.date || ''], ['Evento', cfg.event || ''], ['Tiempo final (s)', r3(res.finalTime, 2)], [],
    ['Salida', 'Valor'], ['Reacción oficial (s)', r3(res.start.reaction, 2)], ['Tiempo de bloque (s)', r3(res.start.blockTime, 2)], ['Tiempo de vuelo (s)', r3(res.start.flightTime, 2)], ['Break out (m)', r3(res.start.breakoutDist, 2)], ['T break out (s)', r3(res.start.breakoutTime, 2)], ['Vel. subacuática (m/s)', r3(res.start.underwaterSpeed, 2)]];
  if (checks.length) info.push([], ['Verificación con distancia conocida', 'Real (m)', 'Medida (m)', 'Error (m)', 'Error (%)', 'Método'], ...checks.map(c => ['', r3(c.real, 2), r3(c.measured, 2), r3(c.err, 2), r3(c.pct, 1), c.method || '']));
  if (res.warnings?.length) info.push([], ['Avisos'], ...res.warnings.map(w => [w]));
  sheets.push({ name: 'Resumen', rows: info, widths: [26, 18] });
  sheets.push({ name: 'Marcas', rows: [['Marca (m)', 'Largo', 'T total (s)', 'T parcial (s)', 'Velocidad (m/s)', 'Ciclos', 'Frecuencia (ciclos/min)', 'Tiempo por ciclo (s)', 'Brazadas/min', 'Distancia por ciclo (m)'],
    ...res.sections.map(s => [s.dist, (s.lap ?? 0) + 1, r3(s.cumulative, 2), r3(s.partial, 2), r3(s.speed), s.cycles ?? null, r3(s.strokeRate, 1), r3(secPerCycle(s.strokeRate), 2), r3(strokesPerMin(s.strokeRate, cfg.style), 1), r3(s.dps, 2)])] });
  sheets.push({ name: 'Largos', rows: [['Largo', 'Parcial (s)', 'Acumulado (s)', 'Ciclos', 'Velocidad de nado (m/s)', 'Frecuencia (ciclos/min)', 'Distancia por ciclo (m)'],
    ...res.laps.map(l => [l.lap, r3(l.split, 2), r3(l.cumulative, 2), l.cycles ?? null, r3(l.cleanSpeed), r3(l.strokeRate, 1), r3(l.dps, 2)])] });
  if (res.turns?.length) sheets.push({ name: 'Virajes', rows: [['Pared (m)', '5 m in (s)', '15 m out (s)', 'Giro 5+15 (s)', 'Contacto (s)', 'Break out (m)', 'T break out (s)', 'Vel. subacuática (m/s)'],
    ...res.turns.map(t => [t.wall, r3(t.in5, 2), r3(t.out15, 2), r3(t.turnTime, 2), r3(t.contact, 2), r3(t.breakoutDist, 2), r3(t.breakoutTime, 2), r3(t.underwaterSpeed, 2)])] });
  if (angles.length) sheets.push({ name: 'Ángulos', rows: [['Ángulo', 'Tiempo de carrera (s)', 'Tiempo de video (s)', 'Valor (°)', 'Tipo'],
    ...angles.slice().sort((a, b) => a.t - b.t).map(a => [a.label, r3(raceTime(a.t)), r3(a.t), r3(angleValue(a), 1), angleType[a.type] || a.type || ''])] });
  if (speed?.sp?.length) {
    sheets.push({ name: 'Velocidad', rows: [['Tiempo de video (s)', 'Tiempo de carrera (s)', 'Distancia (m)', 'Velocidad (m/s)', 'Margen (m/s)'], ...speed.sp.map(s => [r3(s.t), r3(raceTime(s.t)), r3(s.d, 2), r3(s.v), r3(s.sv)])] });
    if (speed.segs?.length) sheets.push({ name: 'Cada 5 m', rows: [['Desde (m)', 'Hasta (m)', 'Tiempo (s)', 'Velocidad (m/s)'], ...speed.segs.map(g => [g.from, g.to, r3(g.time), r3(g.speed)])] });
  }
  return sheets;
}

// Ficha del alumno: todas sus evaluaciones, y las marcas de cada competencia en una sola tabla.
export function athleteSheets(a, evs) {
  const list = [['Fecha', 'Tipo', 'Título', 'Prueba o tarea', 'Tiempo final (s)', 'Frecuencia de ciclo (ciclos/min)', 'Visible para el nadador']];
  const marks = [['Fecha', 'Evento', 'Distancia', 'Estilo', 'Pileta (m)', 'Marca (m)', 'T total (s)', 'T parcial (s)', 'Velocidad (m/s)', 'Frecuencia (ciclos/min)', 'Distancia por ciclo (m)', 'Origen']];
  const starts = [['Fecha', 'Evaluación', 'Tiempo de vuelo (s)', 'Despegue (°)', 'Margen (°)', 'Entrada (°)', 'Margen (°)', 'Cuerpo al entrar (°)', 'Margen (°)']];
  const phases = [['Fecha', 'Evaluación', 'Brazo', 'Ciclos', 'Ciclo medio (s)', ...PHASES.map(p => `${p.label} (%)`)]];
  const KIND = { tech: 'Técnica', race: 'Competencia', report: 'Informe de prueba', gym: 'Gym' };
  for (const e of evs.slice().sort((x, y) => String(x.date).localeCompare(String(y.date)))) {
    list.push([e.date || '', KIND[e.kind] || e.kind, e.title, e.event || '', r3(e.summary?.finalTime, 2), r3(e.summary?.cycleRate, 1), e.shared === false ? 'no' : 'sí']);
    if (e.kind === 'race' || e.kind === 'report') {
      let res; try { res = e.kind === 'report' ? reportToResults(e.data) : computeRace(e.data.cfg, e.data.events, e.data.cycles || []); } catch { continue; }
      const c = res.cfg || e.data.cfg;
      for (const s of res.sections) marks.push([e.date || '', e.event || e.title, c.distance, STYLE[c.style] || c.style, c.poolLength, s.dist, r3(s.cumulative, 2), r3(s.partial, 2), r3(s.speed), r3(s.strokeRate, 1), r3(s.dps, 2), e.kind === 'report' ? 'informe externo' : 'medido en video']);
    }
    const fl = e.data?.flight;
    if (e.kind === 'tech' && fl) starts.push([e.date || '', e.title, r3(fl.time), r3(fl.takeoff, 1), r3(fl.takeoffErr, 1), r3(fl.entry, 1), r3(fl.entryErr, 1), r3(fl.body, 1), r3(fl.bodyErr, 1)]);
    const ph = e.data?.phases;
    if (e.kind === 'tech' && ph) for (const side of ['L', 'R']) if (ph[side]?.n) phases.push([e.date || '', e.title, side === 'L' ? 'Izquierdo' : 'Derecho', ph[side].n, r3(ph[side].cycleDur), ...ph[side].summary.map(x => r3(x.pct, 1))]);
  }
  const sheets = [
    { name: 'Alumno', rows: [['Dato', 'Valor'], ['Nombre', a.name], ['Año de nacimiento', a.year || ''], ['Sexo', a.sex || ''], ['Club', a.club || ''], ['Categoría', a.category || ''], ['Pruebas', a.events || ''], ['Notas', a.notes || '']], widths: [20, 60] },
    { name: 'Evaluaciones', rows: list },
  ];
  if (marks.length > 1) sheets.push({ name: 'Competencias por marca', rows: marks });
  if (starts.length > 1) sheets.push({ name: 'Salidas', rows: starts });
  if (phases.length > 1) sheets.push({ name: 'Fases de brazada', rows: phases });
  return sheets;
}
