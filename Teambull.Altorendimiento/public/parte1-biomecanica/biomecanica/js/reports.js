// Informes de prueba externos (por ejemplo, los análisis de competencia hechos por un biomecánico):
// se guardan tal como fueron informados, con su fuente, y se convierten al mismo formato de resultados
// del modo competencia para poder compararlos tramo por tramo.

const r2 = (v) => (Number.isFinite(v) ? Math.round(v * 100) / 100 : null);
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

export function isReport(j) { return j && j.kind === 'informe' && Array.isArray(j.laps) && Number.isFinite(j.distance); }

// Frecuencia de un largo en ciclos por minuto (el informe puede venir en brazadas/min en estilos alternados).
export function lapRateCpm(rep, k) {
  const v = num(rep.per50?.rate?.[k]);
  if (v != null) return v;
  return null;
}

export function reportToResults(rep) {
  const L = rep.poolLength || 50;
  const cfg = { swimmer: rep.swimmer, date: rep.date, event: rep.event, style: rep.style, distance: rep.distance, poolLength: L, officialTime: rep.finalTime, source: rep.source };
  const sections = [], turns = [], laps = [];
  let prev = { dist: 0, t: 0 };
  rep.laps.forEach((lap, k) => {
    const base = k * L;
    const rate = lapRateCpm(rep, k), dps = num(rep.per50?.dps?.[k]);
    const marks = Object.keys(lap.splits || {}).map(Number).filter(m => m > 0 && m <= L).sort((a, b) => a - b);
    for (const m of marks) {
      const t = num(lap.splits[m]);
      const last = m === L;
      const id = last ? (k === rep.laps.length - 1 ? 'finish' : `wall${k}`) : `m${base + m}`;
      const sec = { id, dist: base + m, lap: k, kind: last ? (id === 'finish' ? 'finish' : 'wall') : 'mark', local: m, from: prev.dist, cumulative: r2(t), partial: null, speed: null, cycles: null, strokeRate: null, dps: null, clean: false };
      if (t != null && prev.t != null) { sec.partial = t - prev.t; sec.speed = (sec.dist - prev.dist) / sec.partial; }
      // frecuencia y distancia por ciclo del informe (promedio del largo) en las marcas de nado limpio
      if (!last && m > Math.max(15, num(lap.uwDist) || 0)) { sec.strokeRate = rate; sec.dps = dps; sec.clean = true; }
      sections.push(sec);
      prev = { dist: sec.dist, t };
    }
    const startT = k === 0 ? 0 : num(rep.laps[k - 1].splits?.[L]);
    const endT = num(lap.splits?.[L]);
    laps.push({ lap: k + 1, style: lap.style, split: r2(num(rep.per50?.split?.[k]) ?? (endT != null && startT != null ? endT - startT : null)), cumulative: r2(endT), cycles: null, cleanSpeed: num(rep.per50?.speed?.[k]), strokeRate: rate, dps });
    if (k < rep.laps.length - 1) {
      const next = rep.laps[k + 1];
      const wallT = endT, offT = num(lap.turn);
      const in5 = num(lap.splits?.[L - 5]) != null && wallT != null ? wallT - lap.splits[L - 5] : NaN;
      const out15 = num(next.splits?.[15]) != null && wallT != null ? next.splits[15] - wallT : NaN;
      turns.push({
        wall: (k + 1) * L, in5: r2(in5), out15: r2(out15), turnTime: r2(in5 + out15),
        contact: r2(offT != null && wallT != null ? offT - wallT : NaN),
        breakoutDist: num(next.uwDist), breakoutTime: r2(num(next.uwTime) != null && offT != null ? next.uwTime - offT : NaN),
        underwaterSpeed: num(rep.per50?.uwSpeed?.[k + 1]),
      });
    }
  });
  const first = rep.laps[0] || {};
  const start = {
    reaction: num(rep.start?.reaction), blockTime: null, flightTime: num(rep.start?.flight),
    breakoutTime: num(first.uwTime), breakoutDist: num(first.uwDist), underwaterSpeed: num(rep.per50?.uwSpeed?.[0]),
  };
  return { cfg, sync: { t0: 0, method: 'informe' }, start, sections, turns, laps, finalTime: num(rep.finalTime), warnings: [], slots: [], fromReport: true };
}

// Registro de evaluación para guardar el informe en la ficha del alumno.
export function reportRecord(rep) {
  return {
    kind: 'report', title: rep.swimmer, date: rep.date || '', event: rep.event || '',
    sourceKey: `informe:${rep.swimmer}:${rep.date}:${rep.event}`,
    summary: { finalTime: num(rep.finalTime) }, data: rep,
  };
}
