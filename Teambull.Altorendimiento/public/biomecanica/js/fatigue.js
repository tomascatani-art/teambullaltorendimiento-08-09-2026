// Fatiga técnica: ¿la técnica del final es distinta de la del principio? Se comparan el primer y el último
// tramo (de un video largo, de una carrera o de una serie del mismo día) con el mismo criterio de cambio
// real que la evolución: la diferencia tiene que superar 1,96·√(error₁² + error₂²).
import { seOfMean, realChange } from './change.js';

const mean = (xs) => { const v = xs.filter(Number.isFinite); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : NaN; };
const median = (xs) => { const v = xs.filter(Number.isFinite).sort((a, b) => a - b); return v.length ? (v.length % 2 ? v[v.length >> 1] : (v[v.length / 2 - 1] + v[v.length / 2]) / 2) : NaN; };
const row = (label, unit, a, b, d) => ({ label, unit, a, b, change: realChange(a, b), pct: Number.isFinite(a.v) && a.v ? 100 * (b.v - a.v) / a.v : NaN, d });

// Dentro de un video: primer tercio de los ciclos contra el último tercio (mínimo 3 y 3).
// r: resultado del análisis (con arms.*.cycles y angles). defs: [{ id, label }] de los ángulos a comparar.
export function techFatigue(r, defs) {
  const arms = ['L', 'R'].map(s => ({ s, c: r.arms[s].cycles.filter(c => c.accepted) })).sort((a, b) => b.c.length - a.c.length);
  const cyc = arms[0].c, k = Math.floor(cyc.length / 3);
  if (k < 3) return { error: `Hacen falta al menos 9 ciclos completos del mismo brazo para comparar el primer y el último tercio (hay ${cyc.length}).`, n: cyc.length };
  const first = cyc.slice(0, k), last = cyc.slice(-k);
  const stat = (cs, f) => { const v = cs.map(f); return { v: mean(v), se: seOfMean(v), n: v.filter(Number.isFinite).length }; };
  const rows = [row('Tiempo por ciclo', 's', stat(first, c => c.duration), stat(last, c => c.duration), 2)];
  for (const d of defs) {
    const s = r.angles[d.id];
    if (!s) continue;
    const med = (c) => { const v = []; for (let i = c.start; i <= c.end; i++) if (Number.isFinite(s.values[i]) && !s.interp[i]) v.push(s.values[i]); return v.length >= 3 ? median(v) : NaN; };
    const a = stat(first, med), b = stat(last, med);
    if (a.n >= 3 && b.n >= 3) rows.push(row(d.label, '°', a, b, 0));
  }
  return { side: arms[0].s, n: cyc.length, k, from: [first[0].tStart, first[k - 1].tStart + first[k - 1].duration], to: [last[0].tStart, last[k - 1].tStart + last[k - 1].duration], rows };
}

// En una carrera: primer largo contra el último, con el nado limpio (después del break out, sin la pared).
// El error sale de marcar cada evento a ±½ cuadro.
export function raceFatigue(res, frameDur) {
  const laps = res.laps.filter(l => Number.isFinite(l.cleanSpeed) || Number.isFinite(l.strokeRate));
  if (laps.length < 2) return { error: 'Hacen falta al menos dos largos con nado limpio marcado (pasos por las marcas o ciclos).' };
  const a = laps[0], b = laps[laps.length - 1];
  const st = frameDur / Math.sqrt(6);
  const lapStats = (lap) => {
    const secs = res.sections.filter(s => s.lap === lap.lap - 1 && s.clean && Number.isFinite(s.speed));
    const T = secs.reduce((x, s) => x + s.partial, 0);
    const v = { v: lap.cleanSpeed, se: Number.isFinite(lap.cleanSpeed) && T > 0 ? lap.cleanSpeed * st / T : null };
    const srs = res.sections.filter(s => s.lap === lap.lap - 1 && Number.isFinite(s.strokeRate));
    const sr = { v: lap.strokeRate, se: srs.length ? Math.sqrt(srs.reduce((x, s) => x + (s.strokeRate * st / s.partial) ** 2, 0)) / srs.length : null };
    const dps = { v: lap.dps, se: Number.isFinite(lap.dps) && v.se != null && sr.se != null ? lap.dps * Math.hypot(v.se / v.v, sr.se / sr.v) : null };
    return { v, sr, dps };
  };
  const A = lapStats(a), B = lapStats(b);
  const rows = [row('Velocidad de nado', 'm/s', A.v, B.v, 2), row('Frecuencia', 'ciclos/min', A.sr, B.sr, 1), row('Distancia por ciclo', 'm', A.dps, B.dps, 2)].filter(x => Number.isFinite(x.a.v) && Number.isFinite(x.b.v));
  return { first: a.lap, last: b.lap, rows };
}

// En una serie: análisis de técnica del mismo día, estilo y toma; la primera repetición contra la última.
export function seriesFatigue(evs) {
  const byDay = new Map();
  for (const e of evs) {
    const m = e.data?.meta;
    if (e.kind !== 'tech' || !m || !e.date || !Array.isArray(e.data.metrics)) continue;
    const key = `${e.date}:${m.style}:${m.view}`;
    if (!byDay.has(key)) byDay.set(key, { date: e.date, label: m.viewLabel || '', style: m.style, list: [] });
    byDay.get(key).list.push(e);
  }
  const out = [];
  for (const g of byDay.values()) {
    if (g.list.length < 2) continue;
    g.list.sort((x, y) => String(x.createdAt || '').localeCompare(String(y.createdAt || '')) || String(x.data.meta.fileName || '').localeCompare(String(y.data.meta.fileName || '')));
    const A = g.list[0], B = g.list[g.list.length - 1];
    const ma = Object.fromEntries(A.data.metrics.filter(x => Number.isFinite(x.value)).map(x => [x.id, x]));
    const rows = B.data.metrics.filter(x => Number.isFinite(x.value) && ma[x.id] && (x.id.startsWith('ang_') || ['cycleRate', 'cycleTime', 'kickRate'].includes(x.id)))
      .map(x => row(x.label, x.unit, { v: ma[x.id].value, se: ma[x.id].se }, { v: x.value, se: x.se }, x.unit === '°' ? 0 : x.unit === 's' ? 2 : 1));
    out.push({ ...g, n: g.list.length, first: A, last: B, rows });
  }
  return out.sort((a, b) => String(b.date).localeCompare(String(a.date)));
}

// Tabla común. f: formateador de números (valor, decimales).
export function fatigueTable(rows, f, labels = ['Principio', 'Final']) {
  const txt = { real: 'cambio real', ruido: 'dentro del ruido', 'sin margen': 'sin margen de error' };
  const ci = (x, d) => (Number.isFinite(x.se) ? ` <small>±${f(1.96 * x.se, d)}</small>` : '');
  return `<div class="table-wrap"><table class="data sheet wide"><tr><th>Medida</th><th>${labels[0]}</th><th>${labels[1]}</th><th>Cambio</th></tr>${rows.map(r => `<tr><th scope="row">${r.label}${r.unit ? ` <small>(${r.unit})</small>` : ''}</th><td class="mono">${f(r.a.v, r.d)}${ci(r.a, r.d)}</td><td class="mono">${f(r.b.v, r.d)}${ci(r.b, r.d)}</td><td class="${r.change?.verdict === 'real' ? 'chg-real' : 'chg-noise'}">${r.change ? `${r.change.d > 0 ? '+' : r.change.d < 0 ? '−' : ''}${f(Math.abs(r.change.d), r.d)}${Number.isFinite(r.pct) && r.unit !== '°' ? ` (${r.pct > 0 ? '+' : ''}${f(r.pct, 0)} %)` : ''} · ${txt[r.change.verdict]}` : '–'}</td></tr>`).join('')}</table></div>`;
}
