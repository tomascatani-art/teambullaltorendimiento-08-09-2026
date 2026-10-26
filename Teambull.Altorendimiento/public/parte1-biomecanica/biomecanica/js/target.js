// Tiempo meta: arma una referencia con el tiempo final objetivo repartido en las mismas marcas de la
// prueba, para compararla con la pestaña Comparar (cuánto falta o sobra en cada marca). El reparto sale
// de datos reales: el perfil de esta misma prueba, los parciales de un récord mundial, o ritmo parejo.
import { recordToResults, fmtTime } from './records.js';

// "1:02.50", "1:02,5", "62.5" → segundos (NaN si no se entiende).
export function parseTime(s) {
  const t = String(s ?? '').trim().replace(',', '.');
  const m = t.match(/^(?:(\d+):)?(\d+(?:\.\d+)?)$/);
  if (!m) return NaN;
  const v = (m[1] ? +m[1] * 60 : 0) + +m[2];
  return v > 0 ? v : NaN;
}

const r2 = (v) => (Number.isFinite(v) ? Math.round(v * 100) / 100 : null);

// mode: 'own' (perfil de esta prueba: res), 'record' (récord con parciales: rec), 'even' (largos iguales).
export function targetToResults(cfg, time, mode, { res = null, rec = null } = {}) {
  const L = cfg.poolLength, nLaps = Math.round(cfg.distance / L);
  let sections = [], laps = [], how = '';
  if (mode === 'own') {
    if (!res || !Number.isFinite(res.finalTime)) throw new Error('Esta prueba no tiene tiempo final para tomar su reparto.');
    const k = time / res.finalTime;
    sections = res.sections.filter(s => Number.isFinite(s.cumulative)).map(s => ({ id: s.id, dist: s.dist, lap: s.lap, kind: s.kind, local: s.local, from: s.from, cumulative: r2(s.cumulative * k), partial: r2(s.partial * k), speed: Number.isFinite(s.speed) ? s.speed / k : null, cycles: null, strokeRate: null, dps: null, clean: false }));
    laps = res.laps.map(l => ({ lap: l.lap, split: r2(l.split * k), cumulative: r2(l.cumulative * k), cycles: null, cleanSpeed: null, strokeRate: null, dps: null }));
    how = 'con el mismo reparto que esta prueba';
  } else if (mode === 'record') {
    if (!rec?.splits50) throw new Error('Ese récord no tiene parciales publicados.');
    const base = recordToResults(rec, L), k = time / rec.time;
    sections = base.sections.map(s => ({ ...s, cumulative: r2(s.cumulative * k) }));
    laps = base.laps.map(l => ({ ...l, split: r2(l.split * k) }));
    how = `con el reparto del récord de ${rec.name} (${fmtTime(rec.time)})`;
  } else {
    const split = time / nLaps;
    for (let i = 0; i < nLaps; i++) {
      const last = i === nLaps - 1, dist = (i + 1) * L;
      sections.push({ id: last ? 'finish' : `wall${i}`, dist, lap: i, kind: last ? 'finish' : 'wall', local: L, from: dist - L, cumulative: r2(split * (i + 1)), partial: null, speed: null, cycles: null, strokeRate: null, dps: null, clean: false });
      laps.push({ lap: i + 1, split: r2(split), cumulative: r2(split * (i + 1)), cycles: null, cleanSpeed: null, strokeRate: null, dps: null });
    }
    how = 'en largos iguales';
  }
  sections.sort((a, b) => a.dist - b.dist);
  return {
    cfg: { ...cfg, swimmer: 'Tiempo meta', event: `${fmtTime(time)} ${how}`, officialTime: time, source: 'Tiempo meta' },
    sync: { t0: 0, method: 'meta' }, start: { reaction: null, blockTime: null, flightTime: null, breakoutTime: null, breakoutDist: null, underwaterSpeed: null },
    sections, turns: [], laps, finalTime: time, warnings: [], slots: [], fromTarget: true, how,
  };
}
