// Alumnos, fichas e historial de evaluaciones.
import { store } from './store.js';
import { xlsxBlob } from './xlsx.js';
import { inTeamBull, pedirInforme } from './store-teambull.js';
import { athleteSheets } from './exports.js';
import { MOMENT_IDS, SHORT } from './moments.js';
import { computeRace, compare, angleValue } from './race.js';
import { buildRaceReport } from './race-report.js';
import { isReport, reportToResults, reportRecord } from './reports.js';
import { renderReview } from './review.js';
import { seriesFatigue, fatigueTable } from './fatigue.js';
import { planStatus, newPlan, TRACKABLE, measuresOf } from './drills.js';
import { evoGroups, evoChart, evoTable, bindEvoChart, METRICS, techGroups, techEvoTable } from './evolution.js';
import { gymSummary, gymSheet, bindGymSheet } from './gym-ui.js';
import { parseQuestion, runQuery, measuresFromEvals, samplePrompt, validQuery, fmtVal } from './ask.js';
import { findRecords, recordToResults, recordLabel, recordWhere, fmtTime, gapText, SEX_NAME, STYLE_NAME } from './records.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const f = (v, d = 2) => (Number.isFinite(v) ? v.toLocaleString('es-AR', { minimumFractionDigits: d, maximumFractionDigits: d }) : '–');
const fs = (v, d = 2) => (Number.isFinite(v) ? (v > 0 ? '+' : '') + f(v, d) : '–');
const STYLE = { crol: 'Crol', espalda: 'Espalda', pecho: 'Pecho', mariposa: 'Mariposa', medley: 'Medley' };
const initials = (name) => String(name || '?').trim().split(/\s+/).slice(0, 2).map(w => w.charAt(0).toUpperCase()).join('') || '?';

let H = null;        // helpers de app.js: {show, download}
let current = null;  // alumno abierto
let editing = null;

export function initAthletes(helpers) {
  H = helpers;
  $('btn-athletes').onclick = () => openList();
  $('ath-add').onclick = () => openForm(null);
  $('ath-search').oninput = () => filterList();
  $('ath-cancel').onclick = () => { $('ath-form').hidden = true; };
  $('ath-form').addEventListener('submit', saveForm);
  $('ap-back').onclick = () => openList();
  $('ap-edit').onclick = () => { openList(false); openForm(current); };
  $('ap-new').onclick = () => H.newAnalysisFor(current);
  // hoja como la del informe del alumno (gráficos y análisis), para mandar por WhatsApp; la arma Team Bull
  $('ap-informe').onclick = () => {
    if (!inTeamBull) { msg('ap-msg', 'El informe para compartir se arma dentro de Team Bull.'); return; }
    pedirInforme(current.id);
    msg('ap-msg', 'Se descargó el informe: abrilo, tocá «Imprimir / Guardar como PDF» y compartilo por WhatsApp.');
  };
  $('ap-xlsx').onclick = async () => {
    try { const evs = await store.listEvaluations(current.id); await H.download(xlsxBlob(athleteSheets(current, evs)), `${current.name.replace(/[^\w\-]+/g, '_')}_ficha.xlsx`, 'ap-msg'); }
    catch (err) { msg('ap-msg', 'No se pudo armar la planilla: ' + err.message); }
  };
  $('ap-del').onclick = () => confirmBox(`¿Borrar a ${esc(current.name)} y sus ${$('ap-evals').dataset.count || 0} evaluaciones? No se puede deshacer.`, 'Borrar alumno', async () => {
    await store.deleteAthlete(current.id); current = null; openList(); refreshSelect();
  });
  $('ath-backup').onclick = async () => {
    const data = await store.exportAll();
    H.download(new Blob([JSON.stringify(data)], { type: 'application/json' }), `swimbull_copia_${new Date().toISOString().slice(0, 10)}.json`, 'ath-msg');
  };
  $('ath-restore').onchange = async (e) => {
    const file = e.target.files[0]; if (!file) return;
    try { const r = await store.importAll(JSON.parse(await file.text())); msg('ath-msg', `Restaurados ${r.athletes} alumnos y ${r.evaluations} evaluaciones.`); renderList(); refreshSelect(); }
    catch (err) { msg('ath-msg', 'No se pudo restaurar: ' + err.message); }
    e.target.value = '';
  };
  // informes de prueba externos (JSON con el formato de SwimBull)
  const importReport = async (e, msgId, athleteId) => {
    const file = e.target.files[0]; if (!file) return;
    try {
      const rep = JSON.parse(await file.text());
      if (!isReport(rep)) throw new Error('El archivo no es un informe de prueba de SwimBull.');
      let id = athleteId;
      if (!id) {
        const list = await store.listAthletes();
        id = list.find(a => a.name.trim().toLowerCase() === rep.swimmer.trim().toLowerCase())?.id || (await store.saveAthlete({ name: rep.swimmer })).id;
      }
      const rec = reportRecord(rep);
      const prev = (await store.listEvaluations(id)).find(x => x.sourceKey === rec.sourceKey);
      if (prev) rec.id = prev.id;
      await store.saveEvaluation({ ...rec, athleteId: id });
      msg(msgId, `Informe guardado: ${rep.swimmer} · ${rep.event} · ${rep.date}${prev ? ' (reemplazó al anterior)' : ''}.`);
      if (athleteId) renderEvals(); else { renderList(); refreshSelect(); }
    } catch (err) { msg(msgId, 'No se pudo importar el informe: ' + err.message); }
    e.target.value = '';
  };
  $('ath-import-rep').onchange = (e) => importReport(e, 'ath-msg', null);
  $('ap-import-rep').onchange = (e) => importReport(e, 'ap-msg', current.id);
  $('ath-migrate').onclick = async () => {
    const btn = $('ath-migrate'); btn.disabled = true;
    try {
      const data = await H.localStore.exportAll();
      const r = await store.importAll(data);
      msg('ath-msg', `Pasados ${r.athletes} alumnos y ${r.evaluations} evaluaciones a tu cuenta. Los datos del dispositivo no se borraron.`);
      btn.hidden = true; renderList(); refreshSelect();
    } catch (err) { msg('ath-msg', 'No se pudo pasar: ' + err.message); }
    finally { btn.disabled = false; }
  };
  refreshSelect();
}

function msg(id, t) { const el = $(id); el.textContent = t; el.hidden = !t; }

export async function refreshSelect(selectId) {
  const sel = $('f-athlete');
  let list = [];
  try { list = await store.listAthletes(); } catch { sel.disabled = true; return; }
  const keep = selectId ?? sel.value;
  sel.innerHTML = '<option value="">Sin asignar (escribir el nombre abajo)</option>' + list.map(a => `<option value="${a.id}">${esc(a.name)}</option>`).join('');
  sel.value = list.some(a => a.id === keep) ? keep : '';
}

async function openList(show = true) {
  if (show) H.show('athletes');
  $('ath-form').hidden = true;
  if (store.backend === 'cloud') {
    $('ath-storage').textContent = 'Guardados en tu cuenta: los ves desde cualquier dispositivo.';
    try { const local = await H.localStore.listAthletes(); $('ath-migrate').hidden = !local.length; } catch { $('ath-migrate').hidden = true; }
  } else if (store.teambull) {
    $('ath-storage').textContent = 'Son tus alumnos de Team Bull. Cada medición se guarda en su ficha y entra en su informe.';
  } else {
    $('ath-storage').textContent = (await store.available())
      ? 'Guardados en este dispositivo. Hacé copias de seguridad hasta que esté la versión con cuentas.'
      : 'Este navegador no permite guardar datos (modo privado o almacenamiento bloqueado).';
  }
  renderList();
}

async function renderList() {
  let list = [];
  try { list = await store.listAthletes(); } catch { $('ath-list').innerHTML = ''; return; }
  $('ath-search-wrap').hidden = list.length < 6;
  if (!list.length) {
    $('ath-list').innerHTML = `<div class="empty"><span class="empty-ico"><svg width="24" height="24"><use href="#i-users"/></svg></span><b>Todavía no hay alumnos</b><p>Creá el primero y, al terminar cada análisis, guardalo en su ficha para armar el historial.</p><button class="btn primary" type="button" id="ath-add-empty"><svg width="16" height="16"><use href="#i-plus"/></svg>Nuevo alumno</button></div>`;
    $('ath-add-empty').onclick = () => openForm(null);
    return;
  }
  const counts = await Promise.all(list.map(a => store.listEvaluations(a.id).then(e => e)));
  $('ath-list').innerHTML = list.map((a, i) => {
    const evs = counts[i];
    const last = evs[0];
    const sub = [a.club, a.category, a.year && `nac. ${a.year}`].filter(Boolean).join(' · ');
    return `<button class="ath-card" data-id="${a.id}" data-q="${esc([a.name, a.club, a.category, a.events].filter(Boolean).join(' ').toLowerCase())}">
      <span class="avatar" aria-hidden="true">${esc(initials(a.name))}</span>
      <span class="ath-main"><span class="ath-name">${esc(a.name)}</span>
      <span class="ath-sub">${esc(sub) || 'Sin datos de club o categoría'}</span></span>
      <span class="ath-stat"><b class="mono">${evs.length}</b><small>${evs.length === 1 ? 'evaluación' : 'evaluaciones'}</small>${last ? `<small class="mono">${esc(last.date || '')}</small>` : ''}</span>
      <svg class="chev" width="16" height="16" aria-hidden="true"><use href="#i-chevron"/></svg>
    </button>`;
  }).join('');
  $('ath-list').querySelectorAll('.ath-card').forEach(b => b.onclick = () => openAthlete(b.dataset.id));
  filterList();
}

function filterList() {
  const q = $('ath-search').value.trim().toLowerCase();
  let n = 0;
  $('ath-list').querySelectorAll('.ath-card').forEach(b => { const ok = !q || b.dataset.q.includes(q); b.hidden = !ok; n += ok; });
  let none = $('ath-none');
  if (!n && q) { if (!none) { none = document.createElement('p'); none.id = 'ath-none'; none.className = 'fine'; $('ath-list').append(none); } none.textContent = `Ningún alumno coincide con "${q}".`; }
  else if (none) none.remove();
}

function openForm(a) {
  editing = a;
  $('ath-form-title').textContent = a ? `Editar a ${a.name}` : 'Nuevo alumno';
  $('a-name').value = a?.name || ''; $('a-name').readOnly = !!store.teambull; $('a-year').value = a?.year || ''; $('a-sex').value = a?.sex || '';
  $('a-club').value = a?.club || ''; $('a-cat').value = a?.category || ''; $('a-events').value = a?.events || ''; $('a-notes').value = a?.notes || '';
  $('a-email-wrap').hidden = store.backend !== 'cloud'; $('a-email').value = a?.email || '';
  $('ath-form').hidden = false;
  $('a-name').focus();
}

async function saveForm(e) {
  e.preventDefault();
  const rec = {
    ...(editing || {}),
    name: $('a-name').value.trim(), year: $('a-year').value.trim(), sex: $('a-sex').value,
    club: $('a-club').value.trim(), category: $('a-cat').value.trim(), events: $('a-events').value.trim(), notes: $('a-notes').value.trim(),
  };
  if (store.backend === 'cloud') rec.email = $('a-email').value.trim().toLowerCase();
  if (!rec.name) return;
  try {
    const saved = await store.saveAthlete(rec);
    $('ath-form').hidden = true;
    refreshSelect();
    if (editing) openAthlete(saved.id); else { renderList(); msg('ath-msg', `${saved.name} quedó guardado.`); }
  } catch (err) { msg('ath-msg', 'No se pudo guardar: ' + err.message); }
}

function confirmBox(text, action, fn) {
  const box = $('ap-confirm');
  box.innerHTML = `<p>${text}</p><div class="form-actions"><button class="btn primary danger-fill" id="cf-yes">${esc(action)}</button><button class="btn ghost" id="cf-no">Cancelar</button></div>`;
  box.hidden = false;
  $('cf-no').onclick = () => { box.hidden = true; };
  $('cf-yes').onclick = async () => { box.hidden = true; await fn(); };
  box.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

// ¿la ficha abierta es de otro entrenador (la ve el nadador)?
const readOnly = () => !!(current && store.backend === 'cloud' && current.coachId && current.coachId !== H.cloud?.session?.user?.id);
export async function openAthlete(id) {
  current = await store.getAthlete(id);
  if (!current) return openList();
  if (readOnly()) { const sh = (await store.sharedSheets()).find(x => x.id === id); current.coachName = sh?.coachName || ''; }
  H.show(readOnly() ? 'mine' : 'athlete');
  document.querySelectorAll('#view-athlete .coach-ctl').forEach(el => { el.hidden = readOnly(); });
  $('ap-confirm').hidden = true; $('ap-detail').hidden = true; msg('ap-msg', '');
  $('ap-name').textContent = current.name;
  $('ap-avatar').textContent = initials(current.name);
  $('ap-meta').textContent = [readOnly() && current.coachName && `Entrenador: ${current.coachName}`, current.club, current.category, current.year && `nacido/a en ${current.year}`, current.events, !readOnly() && current.email && `Ficha compartida con ${current.email}`].filter(Boolean).join('  ·  ');
  renderEvals();
}

const KIND = { race: ['race', 'i-timer', 'Competencia'], report: ['report', 'i-pulse', 'Informe de prueba'], tech: ['tech', 'i-angle', 'Técnica'], gym: ['gym', 'i-gym', 'Gym'] };
const kindOf = (e) => KIND[e.kind] || KIND.tech;
function evalResult(e) {
  if (e.kind === 'race' || e.kind === 'report') return Number.isFinite(e.summary?.finalTime) ? `${f(e.summary.finalTime)} s` : 'sin tiempo final';
  if (e.kind === 'gym') return Number.isFinite(e.summary?.mv) ? `${f(e.summary.mv)} m/s` : Number.isFinite(e.summary?.jump) ? `${f(100 * e.summary.jump, 1)} cm` : '–';
  return Number.isFinite(e.summary?.cycleRate) ? `${f(e.summary.cycleRate, 1)} ciclos/min` : '–';
}

// Evolución: una prueba elegida, su medida en el tiempo y la tabla con todas las fechas.
function renderEvo(evs) {
  const items = evs.filter(e => e.kind === 'race' || e.kind === 'report').map(e => { try { return { e, cfg: cfgOf(e), res: raceRes(e) }; } catch { return null; } }).filter(Boolean);
  const groups = evoGroups(items);
  $('ap-evo').hidden = !groups.length;
  if (!groups.length) return;
  const sel = $('evo-event'), prev = sel.value;
  sel.innerHTML = groups.map(g => `<option value="${g.key}">${esc(g.label)} (${g.rows.length})</option>`).join('');
  if (groups.some(g => g.key === prev)) sel.value = prev;
  const draw = () => {
    const g = groups.find(x => x.key === sel.value) || groups[0], m = $('evo-metric').value;
    $('evo-out').innerHTML = (g.rows.length < 2 ? '<p class="fine">Con una sola fecha todavía no hay evolución: cuando cargues otra prueba igual aparece la línea.</p>' : '')
      + `<div class="evo-title">${esc(METRICS[m].label)}${m === 'time' ? '' : ` <small>(${esc(METRICS[m].unit)})</small>`}</div>` + evoChart(g.rows, m, $('evo-out').clientWidth) + evoTable(g, current.sex);
    bindEvoChart($('evo-out'));
  };
  sel.onchange = draw; $('evo-metric').onchange = draw;
  draw();
}

// Preguntas en castellano sobre los datos guardados. Las reglas interpretan la pregunta; si no reconocen la
// medida y la página puede consultar a Claude, se le pide solo la traducción (validada). El cálculo es local.
let samplerP = null;
const sampler = () => (samplerP ||= (typeof claude !== 'undefined' && claude?.use ? claude.use('sample').catch(() => null) : Promise.resolve(null)));
function renderAsk(evs) {
  const pts = measuresFromEvals(evs);
  $('ap-ask').hidden = !pts.length;
  if (!pts.length) return;
  const has = (id) => pts.some(p => p.id === id);
  const t = pts.find(p => p.id === 'time');
  const ex = [
    has('ang_elbowL') && '¿Mejoró el codo izquierdo esta temporada?',
    t && `Mejor tiempo en ${t.distance} ${(STYLE_NAME[t.style] || '').toLowerCase()}`,
    has('cycleRate') && 'Última frecuencia de ciclo',
    has('fault_asym') && '¿Cambió la asimetría en los últimos 3 meses?',
    has('takeoff') && 'Ángulo de despegue promedio',
    has('speed') && 'Velocidad más alta',
    has('barMV') && '¿Mejoró la velocidad de la barra?',
    has('jump') && 'Mejor salto',
  ].filter(Boolean).slice(0, 5);
  $('ask-ex').innerHTML = ex.map(q => `<button class="chip" type="button">${esc(q)}</button>`).join('');
  $('ask-ex').querySelectorAll('.chip').forEach(b => b.onclick = () => { $('ask-q').value = b.textContent; ask(); });
  const out = $('ask-out');
  const ask = async () => {
    const text = $('ask-q').value.trim();
    if (!text) { $('ask-q').focus(); return; }
    const today = new Date().toISOString().slice(0, 10);
    let query = parseQuestion(text, today);
    if (!query.measure && query.agg !== 'count') {
      const s = await sampler();
      if (s) {
        out.innerHTML = '<p class="fine">Interpretando la pregunta…</p>';
        try { query = validQuery(await s.json(samplePrompt(text, today), { modelTier: 'quick' }), text) || query; } catch { /* sin ayuda: quedan las reglas */ }
      }
    }
    const a = runQuery(pts, query, { evalCount: evs.length });
    if (!a.ok && !a.measure) {
      out.innerHTML = `<p class="ask-ans">${esc(a.text)}</p><p class="fine">Probá nombrando la medida: tiempo, frecuencia, distancia por ciclo, velocidad, codo, hombro, cadera, rodilla, tronco, patada, asimetría, agarre, despegue o vuelo. Podés sumar estilo, distancia, pileta y período ("esta temporada", "últimos 3 meses", "desde el 1/9").</p>`;
      return;
    }
    const m = a.measure;
    const how = `<div class="ask-how"><span class="fine-label">Interpreté</span>${a.chips.map(c => `<span>${esc(c)}</span>`).join('')}${a.group ? `<span>${esc(a.group)}</span>` : ''}</div>`;
    const notes = a.notes.length ? `<ul class="ask-notes fine">${a.notes.map(n => `<li>${esc(n)}</li>`).join('')}</ul>` : '';
    let body = '';
    if (a.ok && a.rows?.length) {
      const M = { label: m.label, unit: m.unit, fmt: (v) => (m.id === 'time' ? fmtTime(v) : f(v, m.dec)) };
      const ci = (r) => (Number.isFinite(r.se) ? ` <span class="ci">±${f(1.96 * r.se, m.dec || 1)}</span>` : '');
      body = (a.rows.length >= 2 ? evoChart(a.rows.map(r => ({ date: r.date, value: r.value, kind: r.kind })), 'value', out.clientWidth || 640, M) : '')
        + `<div class="table-wrap"><table class="data sheet"><tr><th>Fecha</th><th>${esc(m.label)}${m.id === 'time' ? '' : ` <small>(${esc(m.unit)})</small>`}</th><th>Evaluación</th></tr>${a.rows.slice().reverse().map(r => `<tr><th scope="row">${esc((r.date || '').split('-').reverse().join('/'))}</th><td class="mono">${esc(fmtVal(m, r.value))}${ci(r)}</td><td><button class="linkish" type="button" data-ask-ev="${esc(r.evId)}">${esc(r.file || r.title || 'Abrir')}</button></td></tr>`).join('')}</table></div>`
        + '<p class="fine">± es el margen al 95 % de cada valor. Un cambio cuenta como real solo si supera el margen combinado de los dos valores.</p>';
    }
    out.innerHTML = `<p class="ask-ans">${esc(a.text)}</p>${how}${notes}${body}`;
    bindEvoChart(out);
    out.querySelectorAll('[data-ask-ev]').forEach(b => b.onclick = () => openEval(b.dataset.askEv, evs));
  };
  $('ask-form').onsubmit = (e) => { e.preventDefault(); ask(); };
}

function renderTechEvo(evs) {
  const groups = techGroups(evs);
  $('ap-tech').hidden = !groups.length;
  if (!groups.length) return;
  const sel = $('tech-group'), prev = sel.value;
  sel.innerHTML = groups.map(g => `<option value="${esc(g.key)}">${esc(g.label)} (${g.rows.length})</option>`).join('');
  if (groups.some(g => g.key === prev)) sel.value = prev;
  const draw = () => {
    const g = groups.find(x => x.key === sel.value) || groups[0];
    $('ap-tech-out').innerHTML = (g.rows.length < 2 ? '<p class="fine">Con un solo análisis de este estilo y toma todavía no hay evolución.</p>' : '') + techEvoTable(g) + seriesHtml(g);
  };
  // series: varios análisis del mismo día, la primera repetición contra la última
  const seriesHtml = (g) => {
    const ss = seriesFatigue(g.rows.map(x => x.e));
    if (!ss.length) return '<p class="fine">Fatiga en una serie: si analizás la primera y la última repetición del mismo día (mismo estilo y toma), acá se comparan.</p>';
    return ss.map(x => `<div class="mgroup">Serie del ${esc(x.date.split('-').reverse().join('/'))}: primera contra última (${x.n} análisis)</div>${fatigueTable(x.rows, f, [esc(x.first.data.meta.fileName || 'Primera'), esc(x.last.data.meta.fileName || 'Última')])}`).join('')
      + '<p class="fine">El orden de las repeticiones es el orden en que se guardaron los análisis.</p>';
  };
  sel.onchange = draw;
  draw();
}

// Ejercicios con retest: planes del alumno con el antes (toma de control) y el después (análisis posterior).
function renderDrills(evs) {
  const plans = current.plans || [], tech = evs.filter(e => e.kind === 'tech' && Array.isArray(e.data?.metrics));
  $('ap-drills').hidden = readOnly() ? !plans.length : !tech.length && !plans.length;
  if ($('ap-drills').hidden) return;
  const d0 = (u) => (u === '°' ? 0 : u === 's' ? 2 : 1);
  const val = (x) => (x ? `${f(x.v, d0(x.unit))}${x.unit === '°' ? '°' : ` ${esc(x.unit || '')}`}${Number.isFinite(x.se) ? ` <small>±${f(1.96 * x.se, d0(x.unit))}</small>` : ''}` : '–');
  const day = (d) => esc(String(d || '').split('-').reverse().join('/'));
  let h = plans.length ? '' : '<p class="fine">Asigná un ejercicio de tu biblioteca apuntando a una medida de un análisis (la toma de control). Cuando analices de nuevo con la misma toma, acá aparece el antes y el después.</p>';
  h += plans.map(p => {
    const st = planStatus(p, evs);
    if (st.error) return `<div class="plan"><b>${esc(p.drillName)}</b><p class="fine">${esc(st.error)}</p>${readOnly() ? '' : `<button class="linkish" data-pdel="${p.id}" type="button">Quitar</button>`}</div>`;
    const cls = { 'mejoró': 'better', 'empeoró': 'worse' }[st.verdict] || '';
    const pick = !readOnly() && st.candidates.length > 1 ? `<select data-pret="${p.id}" aria-label="Análisis del retest">${st.candidates.map(e => `<option value="${e.id}"${e.id === st.retest?.id ? ' selected' : ''}>${day(e.date)} · ${esc(e.data.meta.fileName || e.title)}</option>`).join('')}</select>` : '';
    return `<div class="plan"><div class="plan-head"><b>${esc(p.drillName)}</b><span class="fine">${esc(st.before?.label || p.metricId)} · objetivo: ${p.goal === 'bajar' ? 'bajar' : 'subir'}${p.retestBy ? ` · retest antes del ${day(p.retestBy)}` : ''}</span>${readOnly() ? '' : `<button class="linkish" data-pdel="${p.id}" type="button">Quitar</button>`}</div>
      ${p.drillNote ? `<p class="fine">${esc(p.drillNote)}</p>` : ''}
      <div class="plan-ab"><div><span>Control · ${day(st.base.date)}</span><b class="mono">${val(st.before)}</b></div><div><span>Retest${st.retest ? ` · ${day(st.retest.date)}` : ''}</span><b class="mono">${st.retest ? val(st.after) : 'pendiente'}</b>${pick}</div>
      <div><span>Resultado</span><b class="${cls}">${st.verdict || '—'}</b>${st.change ? `<small class="mono">${st.change.d > 0 ? '+' : st.change.d < 0 ? '−' : ''}${f(Math.abs(st.change.d), d0(st.before.unit))}${st.change.mdc ? ` · margen ±${f(st.change.mdc, d0(st.before.unit))}` : ''}</small>` : ''}</div></div>
      ${st.warn.map(w => `<p class="fine warn">${esc(w)}</p>`).join('')}</div>`;
  }).join('');
  if (!readOnly() && tech.length) h += `<button class="btn ghost small" id="plan-add" type="button">Asignar un ejercicio</button><div id="plan-form" hidden></div>`;
  h += '<p class="fine">El retest es el último análisis posterior con el mismo estilo y toma. "Mejoró" o "empeoró" solo cuando la diferencia supera el margen de error de las dos mediciones.</p>';
  $('ap-drills-out').innerHTML = h;
  const save = async (plans2) => { current = await store.saveAthlete({ ...current, plans: plans2 }); renderDrills(evs); };
  $('ap-drills-out').querySelectorAll('[data-pdel]').forEach(b => b.onclick = () => save(plans.filter(p => p.id !== b.dataset.pdel)).catch(err => msg('ap-msg', 'No se pudo quitar: ' + err.message)));
  $('ap-drills-out').querySelectorAll('[data-pret]').forEach(sel => sel.onchange = () => save(plans.map(p => (p.id === sel.dataset.pret ? { ...p, retestEvalId: sel.value } : p))).catch(err => msg('ap-msg', err.message)));
  if ($('plan-add')) $('plan-add').onclick = () => planForm(tech, plans, save);
}
async function planForm(tech, plans, save) {
  const box = $('plan-form');
  box.hidden = false;
  let drills = [];
  try { drills = await store.listDrills(); } catch (err) { msg('ap-msg', 'No se pudo leer la biblioteca: ' + err.message); }
  const evOpts = tech.map(e => `<option value="${e.id}">${esc(String(e.date || '').split('-').reverse().join('/'))} · ${esc(e.data.meta.fileName || e.title)}</option>`).join('');
  box.innerHTML = `<div class="fields plan-fields">
    <label>Ejercicio<select id="pf-drill">${drills.map(d => `<option value="${d.id}">${esc(d.name)}</option>`).join('')}<option value="new">+ Nuevo ejercicio…</option></select></label>
    <label id="pf-new-wrap" hidden>Nombre del ejercicio<input id="pf-name" maxlength="120" placeholder="Por ejemplo: Crol con un brazo, codo alto"></label>
    <label id="pf-note-wrap" hidden>Indicaciones (opcional)<input id="pf-note" maxlength="300" placeholder="Series, repeticiones, foco"></label>
    <label>Análisis de control<select id="pf-base">${evOpts}</select></label>
    <label>Medida<select id="pf-metric"></select></label>
    <label>Objetivo<select id="pf-goal"><option value="subir">Subir</option><option value="bajar">Bajar</option></select></label>
    <label>Retest antes del<input type="date" id="pf-date"></label></div>
    <div class="clip-actions"><button class="btn primary small" id="pf-save" type="button">Asignar</button><button class="btn ghost small" id="pf-cancel" type="button">Cancelar</button>${drills.length ? '<button class="linkish" id="pf-lib" type="button">Borrar ejercicios de mi biblioteca…</button>' : ''}</div><div id="pf-libbox"></div>`;
  const metrics = () => { const e = tech.find(x => x.id === $('pf-base').value); $('pf-metric').innerHTML = measuresOf(e).filter(x => Number.isFinite(x.value) && TRACKABLE(x.id)).map(x => `<option value="${x.id}">${esc(x.label)} (${f(x.value, x.unit === '°' ? 0 : 1)}${x.unit === '°' ? '°' : ' ' + esc(x.unit || '')})</option>`).join(''); };
  const drillUi = () => { const n = $('pf-drill').value === 'new'; $('pf-new-wrap').hidden = !n; $('pf-note-wrap').hidden = !n; };
  $('pf-base').onchange = metrics; $('pf-drill').onchange = drillUi; metrics(); drillUi();
  $('pf-cancel').onclick = () => { box.hidden = true; };
  if ($('pf-lib')) $('pf-lib').onclick = () => {
    $('pf-libbox').innerHTML = `<ul class="defs">${drills.map(d => `<li>${esc(d.name)} <button class="linkish" data-ddel="${d.id}" type="button">Borrar</button></li>`).join('')}</ul>`;
    $('pf-libbox').querySelectorAll('[data-ddel]').forEach(b => b.onclick = async () => { await store.deleteDrill(b.dataset.ddel); planForm(tech, plans, save); });
  };
  $('pf-save').onclick = async () => {
    try {
      let drill = drills.find(d => d.id === $('pf-drill').value);
      if (!drill) {
        const name = $('pf-name').value.trim();
        if (!name) { $('pf-name').focus(); return; }
        drill = await store.saveDrill({ name, note: $('pf-note').value.trim() });
      }
      if (!$('pf-metric').value) { msg('ap-msg', 'Ese análisis no tiene medidas con margen de error para seguir.'); return; }
      await save([...plans, newPlan({ drill, metricId: $('pf-metric').value, baseEvalId: $('pf-base').value, goal: $('pf-goal').value, retestBy: $('pf-date').value })]);
    } catch (err) { msg('ap-msg', 'No se pudo asignar: ' + err.message); }
  };
}

// Gym: perfil carga-velocidad por ejercicio y saltos.
function renderGym(evs) {
  const h = gymSheet(evs);
  $('ap-gym').hidden = !h;
  $('ap-gym-out').innerHTML = h;
  if (h) bindGymSheet($('ap-gym-out'), evs);
}

// Salidas: los intentos de técnica con despegue y entrada marcados, por fecha, con su diferencia con el anterior.
function renderStarts(evs) {
  const rows = evs.filter(e => e.kind === 'tech' && e.data?.flight).map(e => ({ e, fl: e.data.flight })).sort((a, b) => String(a.e.date).localeCompare(String(b.e.date)) || String(a.e.createdAt || '').localeCompare(String(b.e.createdAt || '')));
  $('ap-starts').hidden = !rows.length;
  if (!rows.length) return;
  const sg = (v, d) => (Number.isFinite(v) ? `${v > 0 ? '+' : v < 0 ? '−' : ''}${f(Math.abs(v), d)}` : '');
  const cell = (r, p, k, d, u) => `<td class="mono">${Number.isFinite(r.fl[k]) ? `${f(r.fl[k], d)}${u}` : '–'}${p && Number.isFinite(p.fl[k]) && Number.isFinite(r.fl[k]) ? `<small>${sg(r.fl[k] - p.fl[k], d)}${u}</small>` : ''}</td>`;
  $('ap-starts-out').innerHTML = `<div class="table-wrap"><table class="data sheet wide cmp-table"><tr><th>Intento</th><th>Vuelo</th><th>Despegue</th><th>Entrada</th><th>Cuerpo al entrar</th></tr>${rows.map((r, k) => { const p = rows[k - 1]; return `<tr><th scope="row">${esc((r.e.date || '').split('-').reverse().join('/'))}<small>${esc(r.e.event || r.e.data.meta?.fileName || '')}</small></th>${cell(r, p, 'time', 2, ' s')}${cell(r, p, 'takeoff', 0, '°')}${cell(r, p, 'entry', 0, '°')}${cell(r, p, 'body', 0, '°')}</tr>`; }).join('')}</table></div>
    <p class="fine">Abajo de cada valor, la diferencia con el intento anterior. Ángulos en el plano de la imagen: solo se pueden comparar intentos filmados desde el mismo lugar. Para ver dos intentos juntos, abrí uno en Técnica y elegí el otro en Comparar salidas.</p>`;
}

async function renderEvals() {
  const evs = await store.listEvaluations(current.id);
  renderAsk(evs);
  renderEvo(evs);
  renderTechEvo(evs);
  renderDrills(evs);
  renderStarts(evs);
  renderGym(evs);
  $('ap-evals').dataset.count = evs.length;
  $('ap-count').textContent = evs.length || '';
  if (!evs.length) {
    $('ap-evals').innerHTML = `<div class="empty compact"><b>Sin evaluaciones todavía</b><p>Con "Nuevo análisis" el alumno queda elegido y al terminar se guarda acá.</p></div>`;
    return;
  }
  $('ap-evals').innerHTML = `<ul class="eval-list">${evs.map(e => `<li><button class="eval-row" data-id="${e.id}">
      <span class="kind ${kindOf(e)[0]}"><svg width="16" height="16"><use href="#${kindOf(e)[1]}"/></svg></span>
      <span class="eval-main"><span class="eval-title">${esc(e.title)}${e.event ? ` · ${esc(e.event)}` : ''}</span><span class="eval-sub mono">${esc(e.date || '')} · ${kindOf(e)[2]}${current.email && !readOnly() && e.shared === false ? ' · oculta para el nadador' : ''}</span></span>
      <span class="eval-res mono">${evalResult(e)}</span>
      <svg class="chev" width="16" height="16" aria-hidden="true"><use href="#i-chevron"/></svg></button></li>`).join('')}</ul>`;
  $('ap-evals').querySelectorAll('.eval-row').forEach(b => b.onclick = () => {
    $('ap-evals').querySelectorAll('.eval-row').forEach(x => x.removeAttribute('aria-current'));
    b.setAttribute('aria-current', 'true');
    openEval(b.dataset.id, evs);
  });
}

function raceRes(e) { const d = e.data; return e.kind === 'report' ? reportToResults(d) : computeRace(d.cfg, d.events, d.cycles || []); }
const cfgOf = (e) => (e.kind === 'report' ? reportToResults(e.data).cfg : e.data.cfg);

// Récord mundial de la prueba (según el sexo del alumno) con la diferencia, y opciones para compararlo.
function wrBlock(c, t) {
  const recs = findRecords({ ...c, sex: current.sex });
  const line = recs.length ? `<div class="wr-line">${recs.map(r => `<div><span class="fine-label">Récord mundial ${esc(SEX_NAME[r.sex].toLowerCase())}</span><b>${esc(r.name)}</b> <small>${esc(r.nation)}</small> <b class="mono">${fmtTime(r.time)}</b><small> · ${esc(recordWhere(r))}${r.note ? ` · ${esc(r.note)}` : ''}</small>${Number.isFinite(t) ? `<span class="wr-gap mono">Esta prueba ${fmtTime(t)}: ${esc(gapText(t, r))}</span>` : ''}</div>`).join('')}</div>` : '';
  const all = findRecords({ ...c, sex: '' });
  const opts = all.length ? `<optgroup label="Récords mundiales">${all.map((r, k) => `<option value="wr${k}">${esc(recordLabel(r))}</option>`).join('')}</optgroup>` : '';
  const pick = (v) => { const r = all[+String(v).slice(2)]; return r ? { cfg: recordToResults(r, c.poolLength).cfg, res: recordToResults(r, c.poolLength) } : null; };
  return { line, opts, pick };
}

async function openEval(id, evs) {
  const e = evs.find(x => x.id === id);
  const box = $('ap-detail');
  box.hidden = false;
  let h = `<div class="detail-head"><div><div class="eyebrow">${kindOf(e)[2]} · ${esc(e.date || '')}</div><h2 class="detail-title">${esc(e.title)}${e.event ? ` · ${esc(e.event)}` : ''}</h2></div>
    <div class="head-actions">${e.kind === 'race' ? '<button class="btn primary" id="ev-pdf"><svg width="16" height="16"><use href="#i-download"/></svg>PDF</button>' : ''}${e.videoPath ? `<button class="btn ghost" id="ev-video">${e.kind === 'race' ? 'Abrir con el video' : 'Volver a analizar el video'}</button>` : ''}${readOnly() ? '' : '<button class="btn ghost danger" id="ev-del">Borrar evaluación</button>'}</div></div>`;
  if (store.backend === 'cloud' && current.email && !readOnly()) h += `<label class="check share-chk"><input type="checkbox" id="ev-share"${e.shared === false ? '' : ' checked'}> Visible para ${esc(current.name)} en su ficha</label>`;
  if (e.kind === 'race') {
    const res = raceRes(e);
    const others = evs.filter(x => (x.kind === 'race' || x.kind === 'report') && x.id !== e.id && cfgOf(x).distance === e.data.cfg.distance && cfgOf(x).poolLength === e.data.cfg.poolLength);
    const wr = wrBlock(e.data.cfg, res.finalTime);
    h += wr.line + raceSummary(res);
    if (e.data.angles?.length) {
      const t0 = res.sync?.t0;
      h += `<div class="mgroup">Ángulos medidos</div><div class="table-wrap"><table class="data sheet"><tr><th>Ángulo</th><th>Tiempo</th><th>Valor</th></tr>${e.data.angles.slice().sort((x, y) => x.t - y.t).map(a => `<tr><th scope="row">${esc(a.label)}</th><td>${Number.isFinite(t0) ? f(a.t - t0) + ' s' : '–'}</td><td>${f(angleValue(a), 1)}°</td></tr>`).join('')}</table></div>`;
    }
    h += `<div class="cmp-pick"><label>Comparar con un récord u otra evaluación de ${esc(current.name)}
      <select id="ev-cmp"><option value="">Elegir…</option>${wr.opts}${others.length ? `<optgroup label="Otras evaluaciones">${others.map(o => `<option value="${o.id}">${esc(o.date)} · ${esc(o.event || o.title)} · ${evalResult(o)}</option>`).join('')}</optgroup>` : ''}</select></label>
      ${others.length ? '' : '<p class="fine">No hay otras evaluaciones de la misma distancia y pileta.</p>'}</div><div id="ev-cmp-out"></div>`;
    box.innerHTML = h;
    let ref = null;
    $('ev-cmp').onchange = () => {
      const v = $('ev-cmp').value, o = others.find(x => x.id === v);
      ref = v.startsWith('wr') ? wr.pick(v) : o ? { cfg: cfgOf(o), res: raceRes(o) } : null;
      $('ev-cmp-out').innerHTML = ref ? compareTable(res, ref) : '';
    };
    $('ev-pdf').onclick = async () => {
      try {
        const blob = await buildRaceReport(e.data.cfg, res, ref, { frameDur: e.data.frameDur || 1 / 30, compare, angles: e.data.angles || [] });
        const name = `${current.name.replace(/[^\w\-]+/g, '_')}_${e.data.cfg.distance}${e.data.cfg.style}_${e.date || ''}${ref ? '_comparado' : ''}.pdf`;
        await H.download(blob, name, 'ap-msg');
      } catch (err) { msg('ap-msg', 'No se pudo generar el PDF: ' + err.message); }
    };
  } else if (e.kind === 'report') {
    const res = raceRes(e), c = res.cfg;
    const others = evs.filter(x => (x.kind === 'race' || x.kind === 'report') && x.id !== e.id && cfgOf(x).distance === c.distance && cfgOf(x).poolLength === c.poolLength);
    const wr = wrBlock(c, res.finalTime);
    h += wr.line + reportSummary(e.data, res);
    h += `<div class="cmp-pick"><label>Comparar con un récord u otra evaluación de ${esc(current.name)}
      <select id="ev-cmp"><option value="">Elegir…</option>${wr.opts}${others.length ? `<optgroup label="Otras evaluaciones">${others.map(o => `<option value="${o.id}">${esc(o.date)} · ${esc(o.event || o.title)} · ${evalResult(o)}</option>`).join('')}</optgroup>` : ''}</select></label>
      ${others.length ? '' : '<p class="fine">No hay otras evaluaciones de la misma distancia y pileta.</p>'}</div><div id="ev-cmp-out"></div>`;
    box.innerHTML = h;
    $('ev-cmp').onchange = () => {
      const v = $('ev-cmp').value, o = others.find(x => x.id === v);
      const ref = v.startsWith('wr') ? wr.pick(v) : o ? { cfg: cfgOf(o), res: raceRes(o) } : null;
      $('ev-cmp-out').innerHTML = ref ? compareTable(res, ref) : '';
    };
  } else if (e.kind === 'gym') {
    h += gymSummary(e.data);
    // reabrir en Gym con el video para corregir marcas, datos o fecha
    if (!readOnly() && H.openGym && e.data) h += `<div class="gy-row">${e.videoLocal ? '<button class="btn primary" id="ev-gym" type="button">Abrir con el video y corregir</button>' : ''}<label class="btn ${e.videoLocal ? 'ghost ' : ''}file-btn">${e.videoLocal ? 'Abrir con otro video' : 'Cargar el video para corregir'}<input type="file" id="ev-gym-file" accept="video/*"></label></div>${e.videoLocal ? '' : '<p class="fine">El video de esta medición no está guardado en este aparato. Si lo tenés, cargalo y se abre con las marcas y los datos guardados.</p>'}`;
    box.innerHTML = h;
    if ($('ev-gym')) $('ev-gym').onclick = () => H.openGym(e, e.videoLocal);
    if ($('ev-gym-file')) $('ev-gym-file').onchange = (x) => { const file = x.target.files[0]; x.target.value = ''; if (file) H.openGym(e, file); };
} else {
    h += techSummary(e.data);
    box.innerHTML = h;
  }
  if (e.videoPath) $('ev-video').onclick = async () => {
    const b = $('ev-video'); b.disabled = true; const l = b.textContent; b.textContent = 'Descargando el video…';
    try { const file = await store.videoFile(e.videoPath, e.data?.cfg?.fileName || e.data?.meta?.fileName); await H.openWithVideo(current, e, file); }
    catch (err) { msg('ap-msg', 'No se pudo abrir el video: ' + err.message); }
    finally { b.disabled = false; b.textContent = l; }
  };
  if ($('ev-del')) $('ev-del').onclick = () => confirmBox('¿Borrar esta evaluación? No se puede deshacer.', 'Borrar evaluación', async () => {
    await store.deleteEvaluation(e.id); box.hidden = true; renderEvals();
  });
  if ($('ev-share')) $('ev-share').onchange = async (ev) => {
    try { await store.saveEvaluation({ ...e, shared: ev.target.checked }); e.shared = ev.target.checked; msg('ap-msg', ev.target.checked ? `${current.name} ya la ve en su ficha.` : `Oculta para ${current.name}.`); renderEvalsKeep(e.id); }
    catch (err) { ev.target.checked = !ev.target.checked; msg('ap-msg', 'No se pudo cambiar: ' + err.message); }
  };
  const rv = document.createElement('div'); rv.className = 'review'; box.append(rv);
  renderReview(rv, e, { readOnly: readOnly(), onError: (err) => msg('ap-msg', 'Revisión: ' + err.message) });
  renderComments(e);
  box.scrollIntoView({ block: 'start', behavior: 'smooth' });
}

// vuelve a dibujar la lista sin cerrar la evaluación abierta
async function renderEvalsKeep(id) { await renderEvals(); $('ap-evals').querySelector(`.eval-row[data-id="${id}"]`)?.setAttribute('aria-current', 'true'); }

// Comentarios de la evaluación: entrenador y nadador en la nube; en este dispositivo son notas del entrenador.
async function renderComments(e) {
  const box = document.createElement('div');
  box.className = 'comments';
  $('ap-detail').append(box);
  const cloudMode = store.backend === 'cloud', ro = readOnly();
  const who = cloudMode ? { role: ro ? 'athlete' : 'coach', name: H.cloud?.session?.user?.user_metadata?.full_name || H.cloud?.session?.user?.email || '' } : {};
  const draw = async () => {
    let list = [];
    try { list = await store.listComments(e.id); } catch (err) { box.innerHTML = `<p class="fine">No se pudieron leer los comentarios: ${esc(err.message)}</p>`; return; }
    const when = (t) => { const d = new Date(t); return Number.isNaN(+d) ? '' : d.toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }); };
    box.innerHTML = `<div class="mgroup">${cloudMode ? 'Comentarios' : 'Notas del entrenador'}</div>
      ${list.length ? `<ul class="cmt-list">${list.map(c => `<li class="cmt ${c.authorRole}"><div class="cmt-head"><b>${esc(c.authorName || (c.authorRole === 'athlete' ? 'Nadador' : 'Entrenador'))}</b><span class="fine">${c.authorRole === 'athlete' ? 'nadador' : 'entrenador'} · ${when(c.createdAt)}</span>${c.mine || !ro ? `<button class="linkish" data-del="${c.id}" type="button">Borrar</button>` : ''}</div><p>${esc(c.body).replace(/\n/g, '<br>')}</p></li>`).join('')}</ul>` : `<p class="fine">${cloudMode ? (ro ? 'Todavía no hay comentarios. Podés escribirle a tu entrenador sobre esta evaluación.' : current.email ? `Lo que escribas acá lo ve ${esc(current.name)} en su ficha (si la evaluación está visible).` : 'Cargá el email del nadador en Editar datos para que vea su ficha y estos comentarios.') : 'Notas sobre esta evaluación. Quedan guardadas en este dispositivo.'}</p>`}
      <form class="cmt-form"><textarea rows="2" maxlength="2000" placeholder="${ro ? 'Escribile a tu entrenador…' : 'Escribí un comentario…'}" aria-label="Comentario"></textarea><button class="btn small" type="submit">${cloudMode ? 'Comentar' : 'Guardar nota'}</button></form>`;
    box.querySelector('form').onsubmit = async (ev) => {
      ev.preventDefault();
      const ta = box.querySelector('textarea'), body = ta.value.trim();
      if (!body) return;
      try { await store.addComment(e.id, body, who); await draw(); } catch (err) { msg('ap-msg', 'No se pudo guardar el comentario: ' + err.message); }
    };
    box.querySelectorAll('[data-del]').forEach(b => b.onclick = async () => { try { await store.deleteComment(b.dataset.del, e.id); await draw(); } catch (err) { msg('ap-msg', 'No se pudo borrar: ' + err.message); } });
  };
  await draw();
}

function raceSummary(r) {
  const secs = r.sections;
  const row = (label, vals) => `<tr><th scope="row">${label}</th>${vals.map(v => `<td>${v}</td>`).join('')}</tr>`;
  let h = `<div class="kpis board"><div><span>Tiempo final</span><b class="mono">${f(r.finalTime)} s</b></div><div><span>Tiempo de bloque</span><b class="mono">${f(r.start.blockTime)} s</b></div><div><span>Break out</span><b class="mono">${f(r.start.breakoutDist)} m</b></div><div><span>Reacción oficial</span><b class="mono">${Number.isFinite(r.start.reaction) ? f(r.start.reaction) + " s" : "no cargada"}</b></div></div>`;
  h += `<div class="table-wrap"><table class="data sheet wide"><tr><th></th>${secs.map(s => `<th>${s.dist} m</th>`).join('')}</tr>
    ${row('T total (s)', secs.map(s => f(s.cumulative)))}${row('T parcial (s)', secs.map(s => f(s.partial)))}${row('Velocidad (m/s)', secs.map(s => f(s.speed)))}
    ${row('Frecuencia (c/min)', secs.map(s => f(s.strokeRate, 1)))}${row('Dist. por ciclo (m)', secs.map(s => f(s.dps)))}</table></div>`;
  return h;
}

function compareTable(a, ref) {
  const c = compare(a, ref.res);
  const cls = (v, lower) => (Number.isFinite(v) && Math.abs(v) > 1e-9 ? ((v < 0) === lower ? 'better' : 'worse') : '');
  return `<p class="metric-detail">Diferencia con ${esc([ref.res.fromRecord ? ref.cfg.swimmer : '', ref.cfg.event || ref.cfg.date].filter(Boolean).join(' · ') || 'la referencia')} (esta − referencia). Tiempo final: <b class="${cls(c.finalTime, true)}">${fs(c.finalTime)} s</b>. El PDF incluye esta comparación.</p>
    <div class="table-wrap"><table class="data sheet wide"><tr><th>Marca</th>${c.rows.map(r => `<th>${r.dist} m</th>`).join('')}</tr>
    <tr><th scope="row">Δ T total</th>${c.rows.map(r => `<td class="${cls(r.cumulative, true)}">${fs(r.cumulative)}</td>`).join('')}</tr>
    <tr><th scope="row">Δ Velocidad</th>${c.rows.map(r => `<td class="${cls(r.speed, false)}">${fs(r.speed)}</td>`).join('')}</tr>
    <tr><th scope="row">Δ Frecuencia</th>${c.rows.map(r => `<td>${fs(r.strokeRate, 1)}</td>`).join('')}</tr>
    <tr><th scope="row">Δ Dist. por ciclo</th>${c.rows.map(r => `<td class="${cls(r.dps, false)}">${fs(r.dps)}</td>`).join('')}</tr></table></div>`;
}

// Informe de prueba externo: se muestra tal como fue informado, con su fuente.
export function reportSummary(rep, res) {
  const row = (label, vals, d = 2, cls = '') => `<tr class="${cls}"><th scope="row">${esc(label)}</th>${vals.map(v => `<td>${typeof v === 'number' ? f(v, d) : esc(v ?? '–')}</td>`).join('')}</tr>`;
  const P = rep.per50 || {}, R = rep.reference || {}, n = rep.laps.length, L = rep.poolLength || 50;
  const lapHead = rep.laps.map((l, k) => `<th>${(k + 1) * L} m${rep.style === 'medley' ? `<small>${esc(STYLE[l.style] || l.style || '')}</small>` : ''}</th>`).join('');
  let h = `<p class="metric-detail">Fuente: <b>${esc(rep.source || 'sin indicar')}</b>${rep.competition ? ` · ${esc(rep.competition)}` : ''}. Datos cargados tal como figuran en el informe; la app no los midió.</p>`;
  h += `<div class="kpis board"><div><span>Tiempo final</span><b class="mono">${f(rep.finalTime)} s</b></div>${(rep.splits100 || []).map((v, k) => `<div><span>Parcial ${(k + 1) * 100} m</span><b class="mono">${f(v)} s</b></div>`).join('')}<div><span>Reacción (informe)</span><b class="mono">${f(rep.start?.reaction)} s</b></div><div><span>Subacuático salida</span><b class="mono">${f(rep.laps[0]?.uwDist)} m</b></div></div>`;
  h += `<div class="mgroup">Por largo</div><div class="table-wrap"><table class="data sheet wide"><tr><th></th>${lapHead}</tr>
    ${row('Parcial (s)', P.split || [])}${row('Brazadas', P.strokes || [], 0)}${R.strokes ? row(`Brazadas · ${R.label || 'referencia'}`, R.strokes, 0, 'ref-row') : ''}
    ${row('Dist. por ciclo (m)', P.dps || [])}${R.dps ? row(`Dist. por ciclo · ${R.label || 'referencia'}`, R.dps, 2, 'ref-row') : ''}
    ${row('Frecuencia (ciclos/min)', P.rate || [], 1)}${R.rate ? row(`Frecuencia · ${R.label || 'referencia'}`, R.rate, 1, 'ref-row') : ''}
    ${row('Tiempo por ciclo (s)', P.secPerCycle || (P.rate || []).map(v => 60 / v))}
    ${row('Velocidad de nado (m/s)', P.speed || [])}${row('Subacuático (m)', P.uwDist || [])}${R.uwDist ? row(`Subacuático · ${R.label || 'referencia'}`, R.uwDist, 2, 'ref-row') : ''}
    ${row('Vel. subacuática (m/s)', P.uwSpeed || [])}</table></div>`;
  h += `<div class="mgroup">Pasos por las marcas</div><div class="table-wrap"><table class="data sheet wide"><tr><th>Largo</th><th>Salida subac.</th><th>15 m</th><th>25 m</th><th>35 m</th><th>45 m</th><th>${L} m</th><th>Giro</th></tr>
    ${rep.laps.map((l, k) => `<tr><th scope="row">${k + 1}${rep.style === 'medley' ? ` · ${esc(STYLE[l.style] || l.style)}` : ''}</th><td>${f(l.uwTime)}<small> ${f(l.uwDist)} m</small></td>${[15, 25, 35, 45, L].map(m => `<td>${f(l.splits?.[m])}</td>`).join('')}<td>${f(l.turn)}</td></tr>`).join('')}</table></div>`;
  if (rep.notes?.length) h += `<ul class="defs">${rep.notes.map(t => `<li>${esc(t)}</li>`).join('')}</ul>`;
  return h;
}

function techSummary(d) {
  let h = `<p class="metric-detail">${esc(d.meta.viewLabel || '')} · ${esc(STYLE[d.meta.style] || '')} · ${d.meta.width}×${d.meta.height} · ${f(d.meta.fps, 1)} fps · ${esc(d.meta.model)}. Para ver el video anotado o rehacer el PDF con fotogramas hay que volver a abrir el video.</p>`;
  h += d.metrics.map(m => `<div class="metric"><div class="metric-row"><span class="metric-label">${esc(m.label)}</span>${m.value == null ? '<span class="metric-value na">No disponible</span>' : `<span class="metric-value">${f(m.value, m.unit === 's' ? 2 : 1)}<small>${esc(m.unit || '')}</small></span>`}</div><div class="metric-tags"><span class="tag ${m.status === 'medido' ? 'med' : m.status === 'estimado' ? 'est' : 'na'}">${esc(m.status)}</span>${m.confidence ? `<span class="tag na">confianza ${esc(m.confidence)}</span>` : ''}</div></div>`).join('');
  const conf = (d.faults || []).filter(x => x.decision === 'confirmado'), pend = readOnly() ? [] : (d.faults || []).filter(x => !x.decision && (x.status === 'detectado' || x.status === 'posible'));
  if (conf.length || pend.length) {
    const fv = (x) => `${f(x.value, x.unit === '°' ? 1 : 0)}${x.unit === '°' ? '°' : ' ' + esc(x.unit)}${Number.isFinite(x.se) ? ` ±${f(1.96 * x.se, 1)}` : ''}`;
    h += `<div class="mgroup">Errores técnicos</div>${conf.map(x => `<div class="obs media"><b>${esc(x.label)} · confirmado</b>${fv(x)}${x.note ? `. ${esc(x.note)}` : ''}</div>`).join('')}${pend.map(x => `<div class="obs baja"><b>${esc(x.label)} · sugerido, sin confirmar</b>${fv(x)} (umbral ${f(x.thr, 1)}). Se confirma o descarta volviendo a abrir el video, en la pestaña Errores.</div>`).join('')}`;
  }
  if (d.flight) {
    const e = (v) => (Number.isFinite(v) ? ` ±${f(Math.max(1, v), 0)}°` : '');
    h += `<div class="mgroup">Vuelo de la salida</div><p class="metric-detail">Tiempo de vuelo ${f(d.flight.time, 2)} s · despegue ${f(d.flight.takeoff, 0)}°${e(d.flight.takeoffErr)} · entrada ${f(d.flight.entry, 0)}°${e(d.flight.entryErr)}${Number.isFinite(d.flight.body) ? ` · cuerpo al entrar ${f(d.flight.body, 0)}°${e(d.flight.bodyErr)}` : ''}. Ángulos en el plano de la imagen.</p>`;
  }
  if (d.moments?.length) {
    const cols = MOMENT_IDS.filter(id => d.moments.some(m => Number.isFinite(m.angles?.[id])));
    h += `<div class="mgroup">Momentos clave</div><div class="table-wrap"><table class="data sheet wide mom-table"><tr><th>Momento</th><th>Tiempo</th>${cols.map(id => `<th>${esc(SHORT[id])}</th>`).join('')}</tr>${d.moments.map(m => `<tr><th scope="row">${esc(m.label)}</th><td class="mono">${f(m.t, 3)} s</td>${cols.map(id => `<td class="mono">${Number.isFinite(m.angles?.[id]) ? `${f(m.angles[id], 0)}°` : '–'}</td>`).join('')}</tr>`).join('')}</table></div>`;
  }
  return h;
}

// ---------- guardar desde los análisis ----------
export async function saveEvaluationFor(athleteId, rec) {
  return store.saveEvaluation({ ...rec, athleteId });
}
