// Evolución del alumno: sus pruebas e informes de una misma distancia, estilo y pileta, ordenados por
// fecha, con el tiempo final, la frecuencia y la distancia por ciclo medias, y la distancia al récord.
import { findRecords, fmtTime, STYLE_NAME } from './records.js';
import { realChange, VERDICT_TEXT } from './change.js';

const mean = (xs) => { const v = xs.filter(Number.isFinite); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; };
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const f = (v, d = 2) => (Number.isFinite(v) ? v.toFixed(d).replace('.', ',') : '–');

export const METRICS = {
  time: { label: 'Tiempo final', unit: 's', fmt: (v) => fmtTime(v), lowerBetter: true },
  rate: { label: 'Frecuencia media', unit: 'ciclos/min', fmt: (v) => f(v, 1), lowerBetter: null },
  dps: { label: 'Distancia por ciclo media', unit: 'm', fmt: (v) => f(v, 2), lowerBetter: false },
};

// items: [{ e, cfg, res }] (evaluación, configuración y resultados ya calculados).
// Devuelve grupos por prueba: { key, label, cfg, rows: [{ date, time, rate, dps, kind, title }] }.
export function evoGroups(items) {
  const groups = new Map();
  for (const { e, cfg, res } of items) {
    if (!cfg || !Number.isFinite(cfg.distance)) continue;
    const key = `${cfg.distance}:${cfg.style}:${cfg.poolLength}`;
    if (!groups.has(key)) groups.set(key, { key, cfg, label: `${cfg.distance} m ${(STYLE_NAME[cfg.style] || cfg.style || '').toLowerCase()} · pileta de ${cfg.poolLength} m`, rows: [] });
    groups.get(key).rows.push({
      id: e.id, date: e.date || cfg.date || '', kind: e.kind, title: e.event || e.title || '',
      time: Number.isFinite(res?.finalTime) ? res.finalTime : null,
      // tiempo marcado a mano: salida y llegada con ±½ cuadro cada una (desvío de cuadro/√6 la diferencia)
      timeSe: e.kind === 'race' && Number.isFinite(e.data?.frameDur) ? e.data.frameDur / Math.sqrt(6) : null,
      rate: mean((res?.laps || []).map(l => l.strokeRate)),
      dps: mean((res?.laps || []).map(l => l.dps)),
    });
  }
  for (const g of groups.values()) g.rows.sort((a, b) => String(a.date).localeCompare(String(b.date)));
  return [...groups.values()].sort((a, b) => b.rows.length - a.rows.length || a.label.localeCompare(b.label));
}

const dayOf = (d) => { const t = Date.parse(d); return Number.isFinite(t) ? t / 864e5 : null; };

// Gráfico de una serie (SVG) con el valor de cada fecha; el eje x respeta la separación real entre fechas.
export function evoChart(rows, metric, width = 640, M = METRICS[metric]) {
  const pts = rows.map((r, k) => ({ r, k, x: dayOf(r.date), y: r[metric] })).filter(p => Number.isFinite(p.y));
  if (!pts.length) return '<p class="fine">No hay datos de esta medida en las evaluaciones de esta prueba.</p>';
  const W = Math.max(300, Math.round(width)), H = 220, L = 58, R = 16, T = 14, B = 34;
  const xs = pts.map((p, i) => (Number.isFinite(p.x) ? p.x : i)), ys = pts.map(p => p.y);
  let x0 = Math.min(...xs), x1 = Math.max(...xs); if (x1 === x0) { x0 -= 1; x1 += 1; }
  // escala con marcas redondas (0,1 · 0,2 · 0,5 · 1 · 2 · 5 …) que cubren los datos con un margen
  let y0 = Math.min(...ys), y1 = Math.max(...ys); const pad = Math.max((y1 - y0) * 0.15, Math.abs(y1) * 0.005, 0.05);
  const raw = (y1 - y0 + 2 * pad) / 3, mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map(m => m * mag).find(v => v >= raw);
  y0 = Math.floor((y0 - pad) / step) * step; y1 = Math.ceil((y1 + pad) / step) * step;
  const X = (v) => L + (v - x0) / (x1 - x0) * (W - L - R), Y = (v) => T + (1 - (v - y0) / (y1 - y0)) * (H - T - B);
  const ticks = []; for (let v = y0; v <= y1 + step / 2; v += step) ticks.push(v);
  const grid = ticks.map(v => `<line x1="${L}" x2="${W - R}" y1="${Y(v)}" y2="${Y(v)}" class="evo-grid"/><text x="${L - 8}" y="${Y(v) + 4}" text-anchor="end" class="evo-tick">${esc(M.fmt(v))}</text>`).join('');
  const lab = (p) => p.r.date ? p.r.date.split('-').reverse().join('/') : '';
  // una etiqueta por fecha (varios análisis del mismo día comparten la etiqueta)
  const uniq = pts.filter((p, k) => !k || lab(p) !== lab(pts[k - 1]));
  const xl = uniq.length <= 6 ? uniq : [uniq[0], uniq[uniq.length - 1]];
  const xlab = xl.map((p, i) => `<text x="${X(xs[pts.indexOf(p)])}" y="${H - 10}" text-anchor="${xl.length === 1 ? 'middle' : i === 0 ? 'start' : i === xl.length - 1 ? 'end' : 'middle'}" class="evo-tick">${esc(lab(p))}</text>`).join('');
  const path = pts.map((p, i) => `${i ? 'L' : 'M'}${X(xs[i]).toFixed(1)},${Y(p.y).toFixed(1)}`).join(' ');
  const dots = pts.map((p, i) => `<g class="evo-pt" tabindex="0" data-i="${i}" data-tip="${esc(`${lab(p)} · ${M.fmt(p.y)}${metric === 'time' ? '' : ' ' + M.unit}${p.r.kind === 'report' ? ' · informe' : ''}`)}"><circle cx="${X(xs[i])}" cy="${Y(p.y)}" r="14" class="evo-hit"/><circle cx="${X(xs[i])}" cy="${Y(p.y)}" r="5" class="evo-dot"/></g>`).join('');
  return `<div class="evo-chart"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(M.label)} por fecha">${grid}${xlab}<path d="${path}" class="evo-line"/>${dots}</svg><div class="evo-tip mono" hidden></div></div>`;
}

export function evoTable(g, sex) {
  const rec = findRecords({ ...g.cfg, sex })[0];
  const head = `<tr><th>Fecha</th><th>Tiempo</th><th>Δ anterior</th><th>Frec. (c/min)</th><th>DPC (m)</th>${rec ? '<th>% del récord</th>' : ''}</tr>`;
  let prev = null;
  const body = g.rows.map(r => {
    const ch = prev && Number.isFinite(r.time) ? realChange({ v: prev.time, se: prev.timeSe }, { v: r.time, se: r.timeSe }) : null;
    const d = ch ? ch.d : null;
    if (Number.isFinite(r.time)) prev = r;
    const cls = ch && ch.verdict !== 'ruido' && Math.abs(d) > 1e-9 ? (d < 0 ? 'better' : 'worse') : '';
    return `<tr><th scope="row">${esc(r.date.split('-').reverse().join('/'))}${r.kind === 'report' ? '<small>informe</small>' : ''}</th><td>${fmtTime(r.time)}</td><td class="${cls}">${Number.isFinite(d) ? `${d > 0 ? '+' : d < 0 ? '−' : ''}${f(Math.abs(d))}${ch.verdict === 'ruido' ? '<small>dentro del error</small>' : ''}` : '–'}</td><td>${f(r.rate, 1)}</td><td>${f(r.dps)}</td>${rec ? `<td>${Number.isFinite(r.time) ? f(r.time / rec.time * 100, 1) : '–'}</td>` : ''}</tr>`;
  }).join('');
  return `<div class="table-wrap"><table class="data sheet wide">${head}${body}</table></div>${rec ? `<p class="fine">Récord mundial de referencia: ${esc(rec.name)} (${esc(rec.nation)}) ${fmtTime(rec.time)}. Δ anterior en segundos: verde mejora, rojo empeora.</p>` : ''}<p class="fine">Con dos competencias marcadas en el video, una diferencia menor que el error de marcar salida y llegada (±1 cuadro) figura como "dentro del error". En los informes externos no se conoce ese error.</p>`;
}

// Tooltip del gráfico: al pasar el mouse, tocar o enfocar un punto.
export function bindEvoChart(root) {
  const tip = root.querySelector('.evo-tip'), box = root.querySelector('.evo-chart');
  if (!tip || !box) return;
  const showTip = (g) => {
    const c = g.querySelector('.evo-dot').getBoundingClientRect(), b = box.getBoundingClientRect();
    tip.textContent = g.dataset.tip; tip.hidden = false;
    const x = c.left + c.width / 2 - b.left;
    tip.style.left = `${Math.max(4, Math.min(b.width - tip.offsetWidth - 4, x - tip.offsetWidth / 2))}px`;
    tip.style.top = `${c.top - b.top - tip.offsetHeight - 8}px`;
    root.querySelectorAll('.evo-pt').forEach(p => p.classList.toggle('on', p === g));
  };
  root.querySelectorAll('.evo-pt').forEach(g => { g.onpointerenter = () => showTip(g); g.onclick = () => showTip(g); g.onfocus = () => showTip(g); });
  box.onpointerleave = () => { tip.hidden = true; root.querySelectorAll('.evo-pt').forEach(p => p.classList.remove('on')); };
}

// Evolución de la técnica: análisis de un mismo estilo y toma, por fecha. Cada valor con su intervalo
// del 95 % y, debajo, el cambio respecto del análisis anterior: real o dentro del ruido de la medición.
const TECH_IDS = ['cycleRate', 'cycleTime', 'kickRate'];
export function techGroups(evs) {
  const groups = new Map();
  for (const e of evs) {
    const m = e.data?.meta;
    if (e.kind !== 'tech' || !m || !Array.isArray(e.data.metrics)) continue;
    const key = `${m.style}:${m.view}`;
    if (!groups.has(key)) groups.set(key, { key, label: `${STYLE_NAME[m.style] || m.style || ''} · ${m.viewLabel || m.view || ''}`, rows: [] });
    groups.get(key).rows.push({ e, date: e.date || m.date || '', metrics: Object.fromEntries(e.data.metrics.filter(x => Number.isFinite(x.value)).map(x => [x.id, x])) });
  }
  for (const g of groups.values()) g.rows.sort((a, b) => String(a.date).localeCompare(String(b.date)) || String(a.e.createdAt || '').localeCompare(String(b.e.createdAt || '')));
  return [...groups.values()].sort((a, b) => b.rows.length - a.rows.length);
}
export function techEvoTable(g) {
  const ids = [...TECH_IDS, ...new Set(g.rows.flatMap(r => Object.keys(r.metrics).filter(id => id.startsWith('ang_'))))].filter(id => g.rows.some(r => r.metrics[id]));
  const rows = g.rows.slice(-6);
  const d0 = (u) => (u === '°' ? 0 : u === 's' ? 2 : 1);
  const cell = (r, p, id) => {
    const m = r.metrics[id];
    if (!m) return '<td>–</td>';
    const dd = d0(m.unit), ci = Number.isFinite(m.se) ? `<span class="ci">±${f(1.96 * m.se, dd)}</span>` : '';
    const pm = p?.metrics[id], ch = pm ? realChange({ v: pm.value, se: pm.se }, { v: m.value, se: m.se }) : null;
    const dtxt = ch ? `<small class="chg ${ch.verdict === 'real' ? 'real' : 'noise'}">${ch.d > 0 ? '+' : ch.d < 0 ? '−' : ''}${f(Math.abs(ch.d), dd)} · ${VERDICT_TEXT[ch.verdict]}</small>` : '';
    return `<td class="mono">${f(m.value, dd)}${ci}${dtxt}</td>`;
  };
  const label = (id) => { const m = g.rows.map(r => r.metrics[id]).find(Boolean); return `${esc(m.label)}${m.unit ? ` <small>(${esc(m.unit)})</small>` : ''}`; };
  const real = rows.some((r, k) => k && ids.some(id => r.metrics[id] && rows[k - 1].metrics[id] && realChange({ v: rows[k - 1].metrics[id].value, se: rows[k - 1].metrics[id].se }, { v: r.metrics[id].value, se: r.metrics[id].se })?.verdict === 'real'));
  return `<div class="table-wrap"><table class="data sheet wide tech-evo"><tr><th>Medida</th>${rows.map(r => `<th>${esc(String(r.date).split('-').reverse().join('/'))}<small>${esc(r.e.event || r.e.data.meta?.fileName || '')}</small></th>`).join('')}</tr>
    ${ids.map(id => `<tr><th scope="row">${label(id)}</th>${rows.map((r, k) => cell(r, rows[k - 1], id)).join('')}</tr>`).join('')}</table></div>
    <p class="fine">±: intervalo del 95 % según cuánto varía la medida entre los ciclos del mismo video. Un cambio es <b>real</b> cuando supera 1,96·√(error₁² + error₂²); si no, puede ser solo la variación normal entre brazadas o de la detección. ${real ? '' : 'Por ahora ningún cambio supera ese margen. '}Los análisis anteriores a esta versión no guardaron su error: figuran "sin margen de error" hasta que se vuelvan a analizar. Los ángulos son 2D: solo se comparan tomas desde el mismo lugar.</p>`;
}
