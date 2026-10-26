// Récords mundiales como referencia: búsqueda por prueba y conversión al formato de resultados del
// modo competencia. Solo se usa lo que trae la fuente (tiempo final y, si están, parciales cada 50 m).
import { RECORDS, RELAY_RECORDS, RECORDS_ASOF, RECORDS_SOURCES } from './records-data.js';

export { RECORDS, RELAY_RECORDS, RECORDS_ASOF, RECORDS_SOURCES };

export const STYLE_NAME = { crol: 'Libre', espalda: 'Espalda', pecho: 'Pecho', mariposa: 'Mariposa', medley: 'Medley' };
export const SEX_NAME = { F: 'Mujeres', M: 'Hombres', X: 'Mixta' };
export const courseOf = (poolLength) => (Number(poolLength) === 25 ? 'SC' : 'LC');
export const COURSE_NAME = { LC: 'Pileta de 50 m', SC: 'Pileta de 25 m' };

// Récord de una prueba. sex 'F' | 'M' o vacío (devuelve los dos).
export function findRecords({ distance, style, poolLength, sex }) {
  const c = courseOf(poolLength);
  return RECORDS.filter(r => r.course === c && r.distance === Number(distance) && r.style === style && (!sex || sex === 'X' || r.sex === sex))
    .sort((a, b) => a.sex.localeCompare(b.sex));
}

export function fmtTime(s) {
  if (!Number.isFinite(s)) return '–';
  const m = Math.floor(s / 60), r = s - m * 60;
  return m ? `${m}:${r.toFixed(2).padStart(5, '0')}` : r.toFixed(2);
}

export const recordKey = (r) => `${r.course}:${r.sex}:${r.distance}:${r.style}`;
export const recordLabel = (r) => `Récord mundial ${SEX_NAME[r.sex].toLowerCase()} · ${r.name} (${r.nation}) · ${fmtTime(r.time)}`;
export const recordWhere = (r) => [r.date.split('-').reverse().join('/'), r.meet, r.place].filter(Boolean).join(' · ');

// Resultados compatibles con compare(): marcas cada 50 m (pared o llegada) con el tiempo acumulado.
// No hay parciales de 15 m, frecuencia ni distancia por ciclo: la fuente no los publica.
export function recordToResults(rec, poolLength) {
  const L = Number(poolLength) || (rec.course === 'SC' ? 25 : 50);
  const nLaps = Math.round(rec.distance / L);
  const cfg = { swimmer: rec.name, date: rec.date, event: `Récord mundial · ${rec.meet}`, style: rec.style, distance: rec.distance, poolLength: L, officialTime: rec.time, source: 'Récord mundial' };
  const sections = [], laps = [];
  let cum = 0;
  (rec.splits50 || []).forEach((sp, k) => {
    cum += sp;
    const dist = (k + 1) * 50, lapIdx = dist / L - 1;
    const last = dist === rec.distance;
    sections.push({ id: last ? 'finish' : `wall${lapIdx}`, dist, lap: lapIdx, kind: last ? 'finish' : 'wall', local: L, from: dist - 50, cumulative: Math.round(cum * 100) / 100, partial: null, speed: null, cycles: null, strokeRate: null, dps: null, clean: false });
  });
  if (!rec.splits50) sections.push({ id: 'finish', dist: rec.distance, lap: nLaps - 1, kind: 'finish', local: L, from: 0, cumulative: rec.time, partial: null, speed: null, cycles: null, strokeRate: null, dps: null, clean: false });
  for (let k = 0; k < nLaps; k++) {
    // con pileta de 50 m cada parcial de 50 es un largo; en 25 m no hay parcial por largo
    const split = L === 50 && rec.splits50 ? rec.splits50[k] : (nLaps === 1 ? rec.time : null);
    laps.push({ lap: k + 1, split, cumulative: null, cycles: null, cleanSpeed: null, strokeRate: null, dps: null });
  }
  return { cfg, sync: { t0: 0, method: 'récord' }, start: { reaction: rec.reaction ?? null, blockTime: null, flightTime: null, breakoutTime: null, breakoutDist: null, underwaterSpeed: null }, sections, turns: [], laps, finalTime: rec.time, warnings: [], slots: [], fromRecord: true };
}

// Línea de diferencia contra el récord: "+1.23 s (101.1 % del récord)".
export function gapText(time, rec) {
  if (!Number.isFinite(time) || !rec) return '';
  const d = time - rec.time;
  return `${d >= 0 ? '+' : '−'}${Math.abs(d).toFixed(2)} s · ${(time / rec.time * 100).toFixed(1)} % del récord`;
}
