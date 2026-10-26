// Pantalla de récords mundiales: lista por pileta, categoría y estilo, con parciales cuando la fuente los da.
import { RECORDS, RELAY_RECORDS, RECORDS_ASOF, RECORDS_SOURCES, STYLE_NAME, SEX_NAME, fmtTime, recordWhere } from './records.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ORDER = ['crol', 'espalda', 'pecho', 'mariposa', 'medley'];
let bound = false;

function splitsHtml(r) {
  if (!r.splits50) return '<p class="fine">La fuente consultada no publica los parciales de esta marca.</p>';
  let cum = 0;
  const cells = r.splits50.map((s, k) => { cum += s; return `<td>${s.toFixed(2)}<small>${fmtTime(cum)}</small></td>`; }).join('');
  return `<div class="table-wrap"><table class="data sheet wide"><tr><th></th>${r.splits50.map((_, k) => `<th>${(k + 1) * 50} m</th>`).join('')}</tr><tr><th scope="row">Parcial<small>acumulado</small></th>${cells}</tr></table></div>`;
}

function rowHtml(r) {
  const tags = [r.note ? `<span class="tag ${/Pendiente/.test(r.note) ? 'est' : 'na'}">${esc(r.note)}</span>` : '', Number.isFinite(r.reaction) ? `<span class="tag na">reacción ${r.reaction.toFixed(2)} s</span>` : ''].join('');
  return `<details class="wr-row"><summary><span class="wr-ev">${r.distance} m ${esc(STYLE_NAME[r.style].toLowerCase())}</span><b class="mono wr-t">${fmtTime(r.time)}</b><span class="wr-who">${esc(r.name)} <small>${esc(r.nation)}</small></span></summary>
    <div class="wr-body"><p class="metric-detail">${esc(recordWhere(r))}</p>${tags ? `<div class="metric-tags">${tags}</div>` : ''}${splitsHtml(r)}</div></details>`;
}

function relayHtml(r) {
  return `<details class="wr-row"><summary><span class="wr-ev">${esc(r.event)}</span><b class="mono wr-t">${fmtTime(r.time)}</b><span class="wr-who">${esc(r.team)}</span></summary>
    <div class="wr-body"><p class="metric-detail">${esc(recordWhere(r))}</p>${r.note ? `<div class="metric-tags"><span class="tag na">${esc(r.note)}</span></div>` : ''}
    <div class="table-wrap"><table class="data sheet wr-legs">${r.legs.map((l, k) => `<tr><th scope="row">${k + 1}</th><td class="wr-leg">${esc(l.name)}</td><td>${fmtTime(l.split)}</td></tr>`).join('')}</table></div></div></details>`;
}

export function renderRecords() {
  if (!bound) { ['wr-course', 'wr-sex', 'wr-style'].forEach(id => { $(id).onchange = renderRecords; }); bound = true; }
  const c = $('wr-course').value, sex = $('wr-sex').value, st = $('wr-style').value;
  $('wr-asof').textContent = `${SEX_NAME[sex]} · pileta de ${c === 'LC' ? 50 : 25} m · vigentes al ${RECORDS_ASOF.split('-').reverse().join('/')}`;
  let h = '';
  if (st !== 'postas') {
    for (const style of ORDER) {
      if (st && st !== style) continue;
      const list = RECORDS.filter(r => r.course === c && r.sex === sex && r.style === style).sort((a, b) => a.distance - b.distance);
      if (!list.length) continue;
      h += `<section class="panel wr-group"><div class="eyebrow">${esc(STYLE_NAME[style])}</div>${list.map(rowHtml).join('')}</section>`;
    }
  }
  if (!st || st === 'postas') {
    const rel = RELAY_RECORDS.filter(r => r.course === c && (r.sex === sex || r.sex === 'X'));
    h += `<section class="panel wr-group"><div class="eyebrow">Postas</div>${rel.map(r => relayHtml({ ...r, event: `${r.event}${r.sex === 'X' ? ' mixta' : ''}` })).join('')}</section>`;
  }
  $('wr-list').innerHTML = h;
  $('wr-sources').textContent = `Fuentes: ${RECORDS_SOURCES.join('; ')}. Los parciales se cargaron solo si suman exactamente el tiempo final. Al comparar una prueba, el récord aparece en la pestaña Comparar.`;
}
