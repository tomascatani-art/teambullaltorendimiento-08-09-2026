// Pestaña "Errores": la biblioteca de errores aplicada al análisis, con la evidencia de cada uno y la
// decisión del entrenador. Los umbrales y el historial de decisiones quedan en este dispositivo.
import { detectFaults, suggestThreshold, FAULTS, STATUS_LABEL } from './faults.js';

const KEY = 'swimlab-faults';
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const num = (v, d) => Number.isFinite(v) ? v.toLocaleString('es-AR', { minimumFractionDigits: d, maximumFractionDigits: d }) : '–';
const ORDER = { detectado: 0, posible: 1, 'sin umbral': 2, no: 3, 'no medible': 4 };

export function loadPrefs() {
  try { const p = JSON.parse(localStorage.getItem(KEY) || '{}'); return { thr: p.thr || {}, hist: p.hist || {} }; } catch { return { thr: {}, hist: {} }; }
}
function savePrefs(p) { try { localStorage.setItem(KEY, JSON.stringify(p)); } catch {} }

// Guarda la decisión en el historial (una por análisis y error; la última vale).
export function recordDecision(prefs, id, key, value, ok) {
  const h = (prefs.hist[id] || []).filter(x => x.key !== key);
  if (ok != null && Number.isFinite(value)) h.push({ key, v: value, ok, at: new Date().toISOString() });
  prefs.hist[id] = h.slice(-200);
  savePrefs(prefs);
}

// ctx: { r, phases, decisions, sourceKey, fps, onSeek(frame), onChange() }. Devuelve la lista evaluada.
export function renderFaults(box, ctx) {
  const prefs = loadPrefs();
  const list = detectFaults(ctx.r, { phases: ctx.phases }, prefs.thr).sort((a, b) => ORDER[a.status] - ORDER[b.status]);
  const d = ctx.decisions;
  const unit = (f) => f.unit === '°' ? '°' : ' ' + f.unit;
  const val = (f) => `${num(f.value, f.decimals)}${unit(f)}${Number.isFinite(f.se) ? ` <small>± ${num(1.96 * f.se, f.decimals)}</small>` : ''}`;
  const card = (f) => {
    const rule = FAULTS.find(x => x.id === f.id), dec = d[f.id];
    if (f.status === 'no medible') return `<div class="fault na"><div class="fault-head"><b>${esc(f.label)}</b><span class="fstat na">${STATUS_LABEL[f.status]}</span></div><p class="metric-detail">${esc(f.reason)}</p></div>`;
    const sug = rule.noLearn ? null : suggestThreshold(prefs.hist[f.id]);
    const t = f.thr;
    return `<div class="fault ${f.status.replace(' ', '-')}" data-id="${f.id}">
      <div class="fault-head"><b>${esc(f.label)}</b><span class="fstat ${f.status.replace(' ', '-')}">${STATUS_LABEL[f.status]}</span>${dec?.ok === true ? '<span class="fstat ok">Confirmado</span>' : dec?.ok === false ? '<span class="fstat na">Descartado</span>' : ''}</div>
      <div class="fault-val"><span class="mono">${val(f)}</span><span class="fine">${t ? `umbral ${num(t.v, f.decimals)}${unit(f)} (${esc(t.src)})` : 'sin umbral: definilo vos'}</span></div>
      <p class="metric-detail">${esc(f.how)} ${esc(f.detail || '')}</p>
      ${f.frames?.length ? `<div class="chips">${f.frames.map(x => `<button type="button" class="chip" data-seek="${x.f}">${esc(x.label)} · ${num(ctx.r.times[x.f], 2)} s</button>`).join('')}</div>` : ''}
      <div class="fault-act">
        <button type="button" class="btn small ${dec?.ok === true ? 'primary' : 'ghost'}" data-dec="1">Confirmar</button>
        <button type="button" class="btn small ${dec?.ok === false ? 'primary' : 'ghost'}" data-dec="0">Descartar</button>
        <input type="text" class="fault-note" id="fn-${f.id}" maxlength="200" placeholder="Nota (opcional)" value="${esc(dec?.note || '')}">
      </div>
      ${rule.noLearn ? '' : `<details class="fault-thr"><summary>Umbral${sug ? ' · hay una sugerencia' : ''}</summary>
        <div class="fault-act"><label>Avisar si supera <input type="number" step="any" id="ft-${f.id}" value="${Number.isFinite(prefs.thr[f.id]) ? prefs.thr[f.id] : ''}" placeholder="${t ? t.v : ''}"> ${esc(f.unit)}</label>
        <button type="button" class="btn ghost small" data-thr="set">Guardar</button>${Number.isFinite(prefs.thr[f.id]) ? '<button type="button" class="linkish" data-thr="clear">Quitar</button>' : ''}</div>
        ${sug ? `<p class="fine">Con tus decisiones (${sug.nC} confirmados, ${sug.nD} descartados), un umbral de <b>${num(sug.v, f.decimals)}${unit(f)}</b> ${sug.clean ? 'separa lo que confirmaste de lo que descartaste' : 'queda entre lo que confirmaste y lo que descartaste, aunque se superponen'}. <button type="button" class="linkish" data-thr="use" data-v="${sug.v}">Usar ese umbral</button></p>`
          : '<p class="fine">Cuando confirmes y descartes este error en varios análisis, la app te propone el umbral que separa unos de otros.</p>'}</details>`}
    </div>`;
  };
  const live = list.filter(f => f.status !== 'no medible'), na = list.filter(f => f.status === 'no medible');
  const det = live.filter(f => f.status === 'detectado' || f.status === 'posible');
  box.innerHTML = `<p class="metric-detail">La app sugiere y vos decidís. Cada error muestra la medida con su margen, el umbral y los cuadros que lo prueban: tocalos para ir a ese momento y confirmá o descartá. "Posible" quiere decir que supera el umbral pero el margen de error lo alcanza.</p>
    ${live.length ? live.map(card).join('') : '<p class="metric-detail">Con este estilo y esta toma no se puede medir ningún error de la biblioteca.</p>'}
    ${na.length ? `<details class="na-list"><summary>${na.length} error${na.length === 1 ? '' : 'es'} que esta toma no permite medir</summary>${na.map(card).join('')}</details>` : ''}
    <p class="fine">Ángulos y distancias en el plano de la imagen. Los umbrales y tus decisiones quedan guardados en este dispositivo; las decisiones también se guardan con la evaluación.</p>`;
  box.querySelectorAll('[data-seek]').forEach(b => b.onclick = () => ctx.onSeek(+b.dataset.seek));
  box.querySelectorAll('.fault[data-id]').forEach(el => {
    const id = el.dataset.id, f = list.find(x => x.id === id);
    el.querySelectorAll('[data-dec]').forEach(b => b.onclick = () => {
      const ok = b.dataset.dec === '1', cur = d[id]?.ok;
      const next = cur === ok ? null : ok; // tocar de nuevo deshace
      d[id] = { ok: next, note: el.querySelector('.fault-note').value.trim() };
      recordDecision(prefs, id, ctx.sourceKey, f.value, next);
      ctx.onChange();
    });
    const note = el.querySelector('.fault-note');
    if (note) note.onchange = () => { d[id] = { ok: d[id]?.ok ?? null, note: note.value.trim() }; };
    const thr = (v) => { const p = loadPrefs(); if (v == null) delete p.thr[id]; else p.thr[id] = v; savePrefs(p); ctx.onChange(); };
    el.querySelectorAll('[data-thr]').forEach(b => b.onclick = () => {
      if (b.dataset.thr === 'clear') return thr(null);
      if (b.dataset.thr === 'use') return thr(+(+b.dataset.v).toFixed(3));
      const v = parseFloat(el.querySelector(`#ft-${id}`).value.replace(',', '.'));
      if (Number.isFinite(v)) thr(v);
    });
  });
  return { list, count: det.length };
}

