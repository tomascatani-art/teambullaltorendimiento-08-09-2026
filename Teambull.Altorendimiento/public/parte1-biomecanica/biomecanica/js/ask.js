// Preguntas en castellano sobre los datos guardados de un nadador ("¿mejoró el codo izquierdo esta
// temporada?", "mejor tiempo en 100 libre", "última frecuencia de ciclo"). La pregunta se traduce a una
// consulta (medida, filtros, período y qué calcular) con reglas fijas; el cálculo sale siempre de los
// valores guardados, con su margen de error, y la respuesta muestra cómo se interpretó la pregunta.
// Si las reglas no reconocen la medida, se puede pedir ayuda a Claude solo para la traducción (validada
// contra el catálogo); los números nunca los produce el modelo.
import { computeRace } from './race.js';
import { reportToResults } from './reports.js';
import { realChange, VERDICT_TEXT } from './change.js';
import { fmtTime, STYLE_NAME } from './records.js';
import { EXERCISES } from './gym.js';

const mean = (xs) => { const v = xs.filter(Number.isFinite); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
export const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[¿?¡!.,;:()"]/g, ' ').replace(/\s+/g, ' ').trim();
const fx = (v, d) => (Number.isFinite(v) ? v.toFixed(d).replace('.', ',') : '–');

// Catálogo: id, nombre, unidad, decimales, de dónde sale (técnica, prueba o salida), si menor es mejor
// (null = la medida no tiene un sentido de "mejor" fijo) y frases que la nombran (sin tildes).
export const CATALOG = [
  { id: 'cycleTime', label: 'Tiempo por ciclo', unit: 's', dec: 2, src: 'tech', lower: null, words: ['tiempo por ciclo', 'tiempo de ciclo', 'duracion del ciclo', 'duracion de ciclo'] },
  { id: 'cycleRate', label: 'Frecuencia de ciclo', unit: 'ciclos/min', dec: 1, src: 'tech', lower: null, alt: 'rate', words: ['frecuencia de ciclo', 'frecuencia de brazada', 'frecuencia', 'ritmo de brazada', 'ciclos por minuto', 'brazadas por minuto'] },
  { id: 'kickRate', label: 'Frecuencia de patada', unit: 'patadas/min', dec: 1, src: 'tech', lower: null, words: ['frecuencia de patada', 'patadas por minuto', 'ritmo de patada', 'patada', 'patadas'] },
  { id: 'speed', label: 'Velocidad', unit: 'm/s', dec: 2, src: 'tech', lower: false, words: ['velocidad'] },
  { id: 'strokeLength', label: 'Longitud de ciclo', unit: 'm', dec: 2, src: 'tech', lower: false, alt: 'dps', words: ['longitud de ciclo', 'longitud de brazada', 'distancia por ciclo', 'distancia por brazada', 'dpc', 'dps'] },
  { id: 'ang_elbowL', label: 'Codo izquierdo', unit: '°', dec: 0, src: 'tech', lower: null, words: ['codo izquierdo'], pair: 'ang_elbowR', base: ['codo', 'codos', 'angulo del codo'] },
  { id: 'ang_elbowR', label: 'Codo derecho', unit: '°', dec: 0, src: 'tech', lower: null, words: ['codo derecho'] },
  { id: 'ang_shoulderL', label: 'Hombro izquierdo (brazo-tronco)', unit: '°', dec: 0, src: 'tech', lower: null, words: ['hombro izquierdo'], pair: 'ang_shoulderR', base: ['hombro', 'hombros'] },
  { id: 'ang_shoulderR', label: 'Hombro derecho (brazo-tronco)', unit: '°', dec: 0, src: 'tech', lower: null, words: ['hombro derecho'] },
  { id: 'ang_hipL', label: 'Cadera izquierda', unit: '°', dec: 0, src: 'tech', lower: null, words: ['cadera izquierda'], pair: 'ang_hipR', base: ['angulo de cadera', 'cadera', 'caderas'] },
  { id: 'ang_hipR', label: 'Cadera derecha', unit: '°', dec: 0, src: 'tech', lower: null, words: ['cadera derecha'] },
  { id: 'ang_kneeL', label: 'Rodilla izquierda', unit: '°', dec: 0, src: 'tech', lower: null, words: ['rodilla izquierda'], pair: 'ang_kneeR', base: ['rodilla', 'rodillas'] },
  { id: 'ang_kneeR', label: 'Rodilla derecha', unit: '°', dec: 0, src: 'tech', lower: null, words: ['rodilla derecha'] },
  { id: 'ang_trunkIncl', label: 'Inclinación del tronco', unit: '°', dec: 1, src: 'tech', lower: null, words: ['inclinacion del tronco', 'tronco'] },
  { id: 'fault_asym', label: 'Asimetría entre brazos', unit: '%', dec: 1, src: 'tech', lower: true, words: ['asimetria'] },
  { id: 'fault_headLift', label: 'Cabeza que sube al respirar', unit: '% del tronco', dec: 0, src: 'tech', lower: null, words: ['cabeza que sube', 'levanta la cabeza', 'sube la cabeza', 'cabeza al respirar'] },
  { id: 'fault_lateCatch', label: 'Agarre tardío', unit: '% del ciclo', dec: 0, src: 'tech', lower: null, words: ['agarre tardio', 'agarre'] },
  { id: 'fault_droppedElbow', label: 'Codo caído en la tracción', unit: '°', dec: 0, src: 'tech', lower: null, words: ['codo caido', 'codo bajo'] },
  { id: 'fault_handCross', label: 'Cruce de la mano al entrar', unit: '% del ancho de hombros', dec: 0, src: 'tech', lower: null, words: ['cruce de la mano', 'cruza la mano', 'cruce'] },
  { id: 'fault_hipSink', label: 'Cadera hundida', unit: '°', dec: 1, src: 'tech', lower: null, words: ['cadera hundida', 'hunde la cadera'] },
  { id: 'fault_wideKick', label: 'Patada muy amplia', unit: '% del tronco', dec: 0, src: 'tech', lower: null, words: ['patada amplia', 'patada muy amplia', 'amplitud de patada', 'amplitud de la patada'] },
  { id: 'fault_fatigue', label: 'Caída de técnica por fatiga', unit: 'medidas', dec: 0, src: 'tech', lower: true, words: ['fatiga'] },
  { id: 'barMV', label: 'Mejor velocidad media de la barra', unit: 'm/s', dec: 2, src: 'gym', lower: null, words: ['velocidad de la barra', 'velocidad de barra', 'velocidad media de la barra', 'barra'] },
  { id: 'barVL', label: 'Pérdida de velocidad en la serie', unit: '%', dec: 1, src: 'gym', lower: null, words: ['perdida de velocidad'] },
  { id: 'jump', label: 'Altura de salto', unit: 'cm', dec: 1, src: 'gym', lower: false, words: ['salto', 'saltos', 'altura de salto', 'altura del salto', 'cmj'] },
  { id: 'time', label: 'Tiempo final', unit: 's', dec: 2, src: 'race', lower: true, words: ['tiempo final', 'mejor marca', 'marca', 'tiempo', 'tiempos', 'record personal'] },
  { id: 'rate', label: 'Frecuencia media en la prueba', unit: 'ciclos/min', dec: 1, src: 'race', lower: null, alt: 'cycleRate', words: [] },
  { id: 'dps', label: 'Distancia por ciclo media en la prueba', unit: 'm', dec: 2, src: 'race', lower: false, alt: 'strokeLength', words: [] },
  { id: 'flight', label: 'Tiempo de vuelo en la salida', unit: 's', dec: 2, src: 'start', lower: null, words: ['tiempo de vuelo', 'vuelo'] },
  { id: 'takeoff', label: 'Ángulo de despegue en la salida', unit: '°', dec: 0, src: 'start', lower: null, words: ['angulo de despegue', 'despegue'] },
  { id: 'entry', label: 'Ángulo de entrada al agua en la salida', unit: '°', dec: 0, src: 'start', lower: null, words: ['angulo de entrada', 'entrada al agua'] },
];
const BY_ID = Object.fromEntries(CATALOG.map(m => [m.id, m]));
export const measureInfo = (id) => BY_ID[id] || null;

const raceRes = (e) => (e.kind === 'report' ? reportToResults(e.data) : computeRace(e.data.cfg, e.data.events, e.data.cycles || []));
const dateOf = (e) => e.date || String(e.createdAt || '').slice(0, 10);

// Todos los valores guardados de un nadador como puntos { evId, date, created, id, value, se, ...filtros }.
export function measuresFromEvals(evs) {
  const out = [];
  for (const e of evs || []) {
    const date = dateOf(e), base = { evId: e.id, date, created: e.createdAt || '', kind: e.kind, title: e.event || e.title || '' };
    if (e.kind === 'tech' && e.data?.meta) {
      const m = e.data.meta, tb = { ...base, style: m.style || null, view: m.view || null, file: m.fileName || '' };
      for (const x of e.data.metrics || []) if (BY_ID[x.id] && Number.isFinite(x.value)) out.push({ ...tb, id: x.id, value: x.value, se: Number.isFinite(x.se) ? x.se : null, n: x.n ?? null });
      // los errores técnicos valen por su medida, esté o no confirmado el error
      for (const f of e.data.faults || []) if (BY_ID['fault_' + f.id] && Number.isFinite(f.value)) out.push({ ...tb, id: 'fault_' + f.id, value: f.value, se: Number.isFinite(f.se) ? f.se : null, decision: f.decision || null });
      const fl = e.data.flight;
      if (fl) {
        // vuelo marcado a mano: ±½ cuadro en cada punta
        if (Number.isFinite(fl.time)) out.push({ ...tb, id: 'flight', value: fl.time, se: Number.isFinite(fl.frameDur) ? fl.frameDur / Math.sqrt(6) : null });
        if (Number.isFinite(fl.takeoff)) out.push({ ...tb, id: 'takeoff', value: fl.takeoff, se: Number.isFinite(fl.takeoffErr) ? fl.takeoffErr : null });
        if (Number.isFinite(fl.entry)) out.push({ ...tb, id: 'entry', value: fl.entry, se: Number.isFinite(fl.entryErr) ? fl.entryErr : null });
      }
    } else if (e.kind === 'gym' && e.data) {
      const d = e.data;
      if (d.type === 'bar' && Number.isFinite(d.best?.mv)) {
        const gb = { ...base, style: null, exercise: d.exercise, load: d.load };
        out.push({ ...gb, id: 'barMV', value: d.best.mv, se: Number.isFinite(d.best.se) ? d.best.se : null });
        if (d.vl && Number.isFinite(d.vl.v)) out.push({ ...gb, id: 'barVL', value: d.vl.v, se: Number.isFinite(d.vl.se) ? d.vl.se : null });
      }
      if (d.type === 'jump') for (const type of new Set((d.jumps || []).map(j => j.type))) {
        const b = (d.jumps || []).filter(j => j.type === type && Number.isFinite(j.h)).reduce((a, j) => (!a || j.h > a.h ? j : a), null);
        if (b) out.push({ ...base, style: null, exercise: 'salto_' + type, id: 'jump', value: 100 * b.h, se: Number.isFinite(b.se) ? 100 * b.se : null });
      }
    } else if (e.kind === 'race' || e.kind === 'report') {
      let res = null;
      try { res = raceRes(e); } catch { continue; }
      const cfg = (e.kind === 'report' ? res?.cfg : e.data?.cfg) || {};
      const rb = { ...base, style: cfg.style || null, distance: Number.isFinite(cfg.distance) ? cfg.distance : null, pool: Number.isFinite(cfg.poolLength) ? cfg.poolLength : null };
      if (Number.isFinite(res?.finalTime)) out.push({ ...rb, id: 'time', value: res.finalTime, se: e.kind === 'race' && Number.isFinite(e.data?.frameDur) ? e.data.frameDur / Math.sqrt(6) : null });
      const rate = mean((res?.laps || []).map(l => l.strokeRate)), dps = mean((res?.laps || []).map(l => l.dps));
      if (Number.isFinite(rate)) out.push({ ...rb, id: 'rate', value: rate, se: null });
      if (Number.isFinite(dps)) out.push({ ...rb, id: 'dps', value: dps, se: null });
    }
  }
  return out;
}

const STYLES = [['crol', ['crol', 'libre', 'freestyle', 'estilo libre']], ['espalda', ['espalda', 'dorso']], ['pecho', ['pecho', 'braza']], ['mariposa', ['mariposa', 'delfin']], ['medley', ['medley', 'combinado', 'estilos']]];
const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const iso = (y, m, d) => `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
const has = (q, w) => new RegExp(`(^| )${w.replace(/ /g, ' ')}( |$)`).test(q);
const lastDay = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();

// Pregunta → consulta. today: 'AAAA-MM-DD'. Devuelve { measure, style, distance, pool, from, to, agg, notes[], text }.
export function parseQuestion(question, today = new Date().toISOString().slice(0, 10)) {
  const q = norm(question), notes = [];
  const [ty, tm, td] = today.split('-').map(Number);
  // medida: la frase más larga que aparece en la pregunta
  let measure = null, best = 0;
  for (const m of CATALOG) for (const w of [...m.words, ...(m.base || [])]) if (w.length > best && has(q, w)) { best = w.length; measure = m.id; }
  let pool = null;
  const pm = q.match(/(pileta|piscina) (de )?(25|50)( ?m| metros)?/);
  if (pm) pool = +pm[3]; else if (/(pileta|piscina) corta/.test(q)) pool = 25; else if (/(pileta|piscina) larga/.test(q)) pool = 50;
  const qd = pm ? q.replace(pm[0], ' ') : q; // "pileta de 50" no es la distancia
  let distance = null;
  const dm = qd.match(/(^| )(50|100|200|400|800|1500) ?(m|mts|metros)?( |$)/);
  if (dm) distance = +dm[2];
  // "frecuencia" o "distancia por ciclo" en una prueba (con distancia o la palabra prueba/competencia/torneo)
  const raceCtx = distance != null || /(^| )(prueba|pruebas|competencia|competencias|torneo|torneos|carrera|carreras)( |$)/.test(q);
  if (raceCtx && BY_ID[measure]?.alt && BY_ID[BY_ID[measure].alt].src === 'race') measure = BY_ID[measure].alt;
  let style = null;
  for (const [id, ws] of STYLES) if (ws.some(w => has(q, w))) { style = id; break; }
  // período
  let from = null, to = null;
  const seasonStart = (y) => iso(y, 9, 1);
  const curSeason = tm >= 9 ? ty : ty - 1;
  if (/temporada (pasada|anterior)/.test(q)) { from = seasonStart(curSeason - 1); to = iso(curSeason, 8, 31); notes.push('Temporada pasada: del 1/9 al 31/8 (supuesto: la temporada empieza en septiembre).'); }
  else if (/(esta|la) temporada/.test(q)) { from = seasonStart(curSeason); notes.push(`Esta temporada: desde el 1/9/${curSeason} (supuesto: la temporada empieza en septiembre).`); }
  else if (/(mes pasado|mes anterior)/.test(q)) { const y = tm === 1 ? ty - 1 : ty, m = tm === 1 ? 12 : tm - 1; from = iso(y, m, 1); to = iso(y, m, lastDay(y, m)); }
  else if (/este mes/.test(q)) from = iso(ty, tm, 1);
  else if (/(ano pasado|ano anterior)/.test(q)) { from = iso(ty - 1, 1, 1); to = iso(ty - 1, 12, 31); }
  else if (/este ano/.test(q)) from = iso(ty, 1, 1);
  else {
    const ln = q.match(/ultim[oa]s? (\d+|dos|tres|cuatro|seis|doce)? ?(dias|semanas|meses|mes|semana|ano|anos)/);
    if (ln) {
      const n = { dos: 2, tres: 3, cuatro: 4, seis: 6, doce: 12 }[ln[1]] || +ln[1] || 1, unit = ln[2];
      const d = new Date(Date.UTC(ty, tm - 1, td));
      if (unit.startsWith('dia')) d.setUTCDate(d.getUTCDate() - n);
      else if (unit.startsWith('semana')) d.setUTCDate(d.getUTCDate() - 7 * n);
      else if (unit.startsWith('mes')) d.setUTCMonth(d.getUTCMonth() - n);
      else d.setUTCFullYear(d.getUTCFullYear() - n);
      from = d.toISOString().slice(0, 10);
    }
    const ds = q.match(/desde (el )?(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?/);
    if (ds) { let y = ds[4] ? +ds[4] : ty; if (y < 100) y += 2000; from = iso(y, +ds[3], +ds[2]); }
    const mo = q.match(new RegExp(`(desde|en|de) (${MONTHS.join('|')})( (de )?(\\d{4}))?`));
    if (mo && !ds) {
      const m = MONTHS.indexOf(mo[2]) + 1, y = mo[5] ? +mo[5] : (m > tm ? ty - 1 : ty);
      from = iso(y, m, 1);
      if (mo[1] !== 'desde') to = iso(y, m, lastDay(y, m));
    }
  }
  // qué calcular
  let agg = 'summary';
  const w = (re) => new RegExp(`(^| )(${re})( |$)`).test(q);
  if (w('cuantas|cuantos')) agg = 'count';
  else if (w('maximo|mas alto|mas alta|mayor')) agg = 'max';
  else if (w('minimo|mas bajo|mas baja|menor')) agg = 'min';
  else if (w('mejoro|mejoraron|empeoro|empeoraron|cambio|cambiaron|evoluciono|evolucion|progreso|progresion|bajo|bajaron|subio|subieron|comparar|comparado|comparacion')) agg = 'change';
  else if (w('mejor|mejores|record personal|mejor marca')) agg = 'best';
  else if (w('peor|peores')) agg = 'worst';
  else if (w('promedio|media|en promedio')) agg = 'mean';
  else if (w('ultimo|ultima|actual|ahora|hoy')) agg = 'last';
  return { measure, style, distance, pool, from, to, agg, notes, text: question };
}

const inRange = (p, a) => (!a.from || p.date >= a.from) && (!a.to || p.date <= a.to);
const groupKey = (p, m) => (m.src === 'gym' ? `${p.exercise}:${p.id === 'barMV' || p.id === 'barVL' ? p.load : ''}` : m.src === 'race' ? `${p.distance ?? '?'}:${p.style ?? '?'}:${p.pool ?? '?'}` : `${p.style ?? '?'}:${p.view ?? '?'}`);
const groupLabel = (p, m) => {
  if (m.src === 'gym') return p.exercise?.startsWith('salto_') ? ({ salto_cmj: 'salto con contramovimiento', salto_sj: 'salto sin contramovimiento', salto_abk: 'salto con brazos', salto_drop: 'salto con caída', salto_loaded: 'salto con carga' }[p.exercise] || 'salto') : `${(EXERCISES[p.exercise]?.label || 'otro ejercicio').toLowerCase()}${p.load != null ? ` con ${String(p.load).replace('.', ',')} kg` : ''}`;
  const st = (STYLE_NAME[p.style] || p.style || 'estilo sin dato').toLowerCase();
  return m.src === 'race' ? `${p.distance ?? '?'} m ${st} · pileta de ${p.pool ?? '?'} m` : `${st} · toma ${String(p.view || 'sin dato').replace('-', ' ')}`;
};
export const fmtVal = (m, v) => (m.id === 'time' ? fmtTime(v).replace('.', ',') : `${fx(v, m.dec)}${m.unit === '°' ? '°' : ' ' + m.unit}`);
const fmtDate = (d) => (d ? d.split('-').reverse().join('/') : 'sin fecha');

// Consulta + puntos → respuesta { ok, text, measure, group, rows, change, best, mean, chips, notes, others }.
export function runQuery(points, query, { evalCount = null } = {}) {
  const notes = [...(query.notes || [])];
  let m = BY_ID[query.measure];
  const chips = [];
  if (query.style) chips.push(STYLE_NAME[query.style] || query.style);
  if (query.distance) chips.push(`${query.distance} m`);
  if (query.pool) chips.push(`pileta de ${query.pool} m`);
  if (query.from || query.to) chips.push(query.from && query.to ? `del ${fmtDate(query.from)} al ${fmtDate(query.to)}` : query.from ? `desde el ${fmtDate(query.from)}` : `hasta el ${fmtDate(query.to)}`);
  if (!m) {
    if (query.agg === 'count' && evalCount != null) {
      const evs = new Map(points.filter(p => inRange(p, query) && (!query.style || p.style === query.style)).map(p => [p.evId, p]));
      return { ok: true, text: `Hay ${evs.size} evaluaciones con datos medidos${chips.length ? ` (${chips.join(', ')})` : ''}, de ${evalCount} guardadas en total.`, chips, notes, rows: [] };
    }
    return { ok: false, text: 'No reconocí qué medida querés consultar.', chips, notes };
  }
  // un lado sin especificar (codo, hombro, cadera, rodilla): el que tenga más datos, avisando
  const filt = (id) => points.filter(p => p.id === id && inRange(p, query) && (!query.style || p.style === query.style) && (!query.distance || p.distance === query.distance) && (!query.pool || p.pool === query.pool));
  let pts = filt(m.id);
  if (m.pair && !m.words.some(w => has(norm(query.text), w))) {
    const other = filt(m.pair);
    if (other.length > pts.length) { m = BY_ID[m.pair]; [pts] = [other]; }
    notes.push(`No dijiste qué lado: tomé ${m.label.toLowerCase()} (${pts.length} valores). Preguntá por el otro lado si lo querés.`);
  }
  // sin datos de la medida de técnica pero sí de pruebas (o al revés): la equivalente, avisando
  if (!pts.length && m.alt) {
    const alt = filt(m.alt);
    if (alt.length) { notes.push(`No hay valores de "${m.label.toLowerCase()}"; uso "${BY_ID[m.alt].label.toLowerCase()}".`); m = BY_ID[m.alt]; pts = alt; }
  }
  chips.unshift(m.label);
  if (!pts.length) return { ok: false, measure: m, chips, notes, text: `No hay valores guardados de ${m.label.toLowerCase()}${chips.length > 1 ? ' con esos filtros' : ''}.` };
  // no se mezclan pruebas distintas ni estilos o tomas distintas: el grupo con más valores, avisando
  const groups = new Map();
  for (const p of pts) { const k = groupKey(p, m); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(p); }
  const sorted = [...groups.entries()].sort((a, b) => b[1].length - a[1].length);
  const [, rows0] = sorted[0];
  const rows = rows0.slice().sort((a, b) => (a.date + a.created).localeCompare(b.date + b.created));
  const group = groupLabel(rows[0], m);
  const others = sorted.slice(1).map(([, r]) => `${groupLabel(r[0], m)} (${r.length})`);
  if (others.length) notes.push(`Uso ${group}, el grupo con más valores. También hay: ${others.join('; ')}. No se mezclan porque no son comparables entre sí.`);
  const first = rows[0], last = rows[rows.length - 1];
  const change = rows.length >= 2 ? realChange({ v: first.value, se: first.se }, { v: last.value, se: last.se }) : null;
  const vals = rows.map(r => r.value);
  const maxR = rows.reduce((a, b) => (b.value > a.value ? b : a)), minR = rows.reduce((a, b) => (b.value < a.value ? b : a));
  const bestR = m.lower === true ? minR : m.lower === false ? maxR : null;
  const avg = mean(vals);
  const fv = (v) => fmtVal(m, v), pm = (r) => (Number.isFinite(r.se) ? ` (±${fx(1.96 * r.se, m.dec + (m.dec ? 0 : 1))})` : '');
  const at = (r) => `${fv(r.value)}${pm(r)} el ${fmtDate(r.date)}`;
  let text;
  const changeText = () => {
    if (!change) return `Hay un solo valor (${at(first)}): todavía no se puede ver un cambio.`;
    const dir = change.d > 0 ? 'subió' : change.d < 0 ? 'bajó' : 'no cambió';
    const dd = `${fx(Math.abs(change.d), m.dec)}${m.unit === '°' ? '°' : ' ' + m.unit}`;
    let judge = '';
    if (change.verdict === 'real' && m.lower != null && change.d !== 0) judge = (m.lower ? change.d < 0 : change.d > 0) ? ' Mejoró.' : ' Empeoró.';
    const u = m.unit === '°' ? '°' : ' ' + m.unit;
    const verdict = change.verdict === 'real' ? `es un ${VERDICT_TEXT.real} (supera el margen de ${fx(change.mdc, m.dec + 1)}${u})` : change.verdict === 'ruido' ? `está ${VERDICT_TEXT.ruido} (margen ${fx(change.mdc, m.dec + 1)}${u}): no se puede decir que cambió` : 'pero falta el margen de error de algún valor, así que no se puede decir si es un cambio real';
    return `Del ${fmtDate(first.date)} al ${fmtDate(last.date)} ${dir} ${dd} (de ${fv(first.value)} a ${fv(last.value)}) y ${verdict}.${judge}`;
  };
  switch (query.agg) {
    case 'best': case 'worst':
      if (!bestR) text = `${m.label} no tiene un sentido de mejor o peor fijo. El valor más alto fue ${at(maxR)} y el más bajo ${at(minR)}.`;
      else text = `${query.agg === 'best' ? 'Mejor' : 'Peor'} valor: ${at(query.agg === 'best' ? bestR : (bestR === minR ? maxR : minR))}, entre ${rows.length}.`;
      break;
    case 'max': text = `El valor más alto fue ${at(maxR)}, entre ${rows.length}.`; break;
    case 'min': text = `El valor más bajo fue ${at(minR)}, entre ${rows.length}.`; break;
    case 'last': text = `Último valor: ${at(last)}.${rows.length >= 2 ? ' ' + changeText() : ''}`; break;
    case 'mean': text = `Promedio de ${rows.length} valores: ${fv(avg)} (del ${fmtDate(first.date)} al ${fmtDate(last.date)}). Es el promedio de evaluaciones distintas, no un valor medido.`; break;
    case 'count': text = `Hay ${rows.length} valores de ${m.label.toLowerCase()} (${group}).`; break;
    default: text = changeText();
  }
  return { ok: true, text, measure: m, group, rows, change, best: bestR, mean: avg, chips, notes, others };
}

// Para Claude (solo la traducción de la pregunta): instrucciones y validación de lo que devuelve.
export function samplePrompt(question, today) {
  const cat = CATALOG.map(m => `${m.id}: ${m.label}`).join('\n');
  return `Traducí la pregunta de un entrenador de natación a una consulta JSON. No calcules ni inventes valores.
Hoy es ${today}. Medidas posibles (usá el id exacto o null si ninguna corresponde):
${cat}
Formato: {"measure": id|null, "style": "crol"|"espalda"|"pecho"|"mariposa"|"medley"|null, "distance": número|null, "pool": 25|50|null, "from": "AAAA-MM-DD"|null, "to": "AAAA-MM-DD"|null, "agg": "summary"|"change"|"best"|"worst"|"last"|"mean"|"max"|"min"|"count"}
Pregunta: ${question}
Respondé solo el JSON.`;
}
export function validQuery(j, question) {
  if (!j || typeof j !== 'object') return null;
  const okDate = (d) => (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null);
  const q = {
    measure: BY_ID[j.measure] ? j.measure : null,
    style: STYLES.some(([s]) => s === j.style) ? j.style : null,
    distance: [50, 100, 200, 400, 800, 1500].includes(+j.distance) ? +j.distance : null,
    pool: [25, 50].includes(+j.pool) ? +j.pool : null,
    from: okDate(j.from), to: okDate(j.to),
    agg: ['summary', 'change', 'best', 'worst', 'last', 'mean', 'max', 'min', 'count'].includes(j.agg) ? j.agg : 'summary',
    notes: ['Interpretada con ayuda de Claude: revisá los filtros de abajo. Los valores salen de los datos guardados.'], text: question,
  };
  return q.measure || q.agg === 'count' ? q : null;
}
