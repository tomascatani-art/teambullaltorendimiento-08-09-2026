import { bindClipPanel, clipPanelHtml, encodeClip, seekVideo, clipLabels, slowTag } from './clip.js';
import { analyze, ANGLE_DEFS, EXTRA_SERIES, SKELETON, LIMITATIONS, DEFAULT_CONFIG } from './analysis.js';
import { flightOf, drawFlight } from './flight.js';
import { shotCertificate, certificateHtml } from './certificate.js';
import { sendButton } from './review.js';
import { compareCycles, ghostSkeleton, refPercents } from './cyclecmp.js';
import { techFatigue, fatigueTable } from './fatigue.js';
import { renderFaults } from './faults-ui.js';
import { faultsSaved } from './faults.js';
import { swimScale, phaseVelocity, velocitySaved } from './velocity.js';
import { audioOffset } from './dualcam.js';
import { cameraSummary, between, apply as camApply, invert as camInvert } from './camera.js';
import { renderDrawings, drawingVisible, drawPanelHtml, bindDrawing } from './draw.js';
import { voicePanelHtml, bindVoice } from './voice.js';
import { xlsxBlob, csvBlob } from './xlsx.js';
import { techSheets } from './exports.js';
import { angleCheck, checkText, checkSummary } from './accuracy.js';
import { suggestStart } from './autostart.js';
import { strokePhases, phaseAt, PHASES, PHASE_COLORS, EVENT_LABEL } from './phases.js';
import { headAt, packSeries, startOf, alignOf, compareMoments, compareFlight, flightSaved, cmpCols } from './starts.js';
import { SERIES_COLORS, MAX_SERIES, SHORT, isDegree, toggleSeries, momentRows, usedCols } from './moments.js';
import { readFrameTimes, probeFrameTimes, getLandmarker, runPose, refinePose } from './pose.js';
import { GUIDE, fpsHint, fpsVerdict, fpsTable } from './fpsguide.js';
import { filmGuide } from './filmguide.js';
import { fixSwaps, despike, applyEdits } from './refine.js';
import { buildReport } from './report.js';
import { applyTrack, candidateAt } from './subject.js';
import { initAthletes, refreshSelect, openAthlete } from './athletes.js';
import { renderRecords } from './records-ui.js';
import { store, localStore } from './store.js';
import { initCloud, isLocked, cloud } from './auth.js';

const $ = (id) => document.getElementById(id);
const BASE = new URL('../', import.meta.url);
const APP_VERSION = '0.1 (Parte 1)';

const state = { file: null, url: null, result: null, abort: null, frame: 0, chartSel: [], chartColors: {}, moments: [], drawings: [], flight: null, showFlight: true, cmp: null, pendingMoments: null, phases: null, phaseEdits: {}, phaseSel: null, angleChecks: [], acc: null, pointEdits: [], found: null, fix: false };
window.__swimlabTech = state; // para las pruebas automáticas
state.test = {};

// ---------- tema ----------
function setTheme(t) {
  document.documentElement.dataset.theme = t;
  try { localStorage.setItem('swimlab-theme', t); } catch {}
  if (state.result) drawChart();
}
try { const t = localStorage.getItem('swimlab-theme'); if (t) document.documentElement.dataset.theme = t; } catch {}
$('btn-theme').onclick = () => setTheme(document.documentElement.dataset.theme === 'light' ? 'dark' : 'light');

// navegación: qué ítem queda marcado en cada pantalla, y acceso de vuelta al análisis abierto
const NAV_OF = { mine: 'mine', upload: 'new', progress: 'new', results: 'current', race: 'current', athletes: 'athletes', athlete: 'athletes', records: 'records', live: 'live', gym: 'gym' };
let openAnalysis = null;
function show(view) {
  if (isLocked() && view !== 'auth') view = 'auth';
  if (view !== 'live' && document.body.dataset.view === 'live') import('./live.js').then(m => m.leaveLive());
  if (view !== 'gym' && document.body.dataset.view === 'gym') import('./gym-ui.js').then(m => m.leaveGym());
  const nav = NAV_OF[view] || '';
  if (view === 'mine') view = 'athlete'; // la ficha propia del nadador usa la misma pantalla
  for (const v of ['auth', 'upload', 'progress', 'results', 'race', 'athletes', 'athlete', 'records', 'live', 'gym']) $('view-' + v).hidden = v !== view;
  if (view === 'results' || view === 'race') openAnalysis = view;
  document.body.dataset.view = view;
  document.querySelectorAll('[data-nav]').forEach(b => {
    if (b.dataset.nav === 'current') b.hidden = !openAnalysis;
    if (b.dataset.nav === nav) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
  });
  document.querySelectorAll('details.menu[open]').forEach(d => { d.open = false; });
  if (view === 'upload') refreshSelect();
  pairUi();
  window.scrollTo(0, 0);
}
// alto real de la barra superior, para que el video fijo quede justo debajo
const setTopbarH = () => document.documentElement.style.setProperty('--topbar-h', document.querySelector('.topbar').offsetHeight + 'px');
setTopbarH(); window.addEventListener('resize', setTopbarH);
$('btn-current').onclick = () => { if (openAnalysis) show(openAnalysis); };
$('btn-records').onclick = () => { renderRecords(); show('records'); };
let liveReady = false;
$('btn-live').onclick = async () => {
  const m = await import('./live.js');
  if (!liveReady) { liveReady = true; m.initLive({ download: (b, n) => download(b, n), analyze: (file, kind) => { setFile(file); setMode(kind === 'race' ? 'race' : 'tech'); show('upload'); } }); }
  show('live');
};
$('btn-gym').onclick = async () => {
  const m = await import('./gym-ui.js');
  m.initGym({ notify: (msg) => notify(msg, 'gy-msg') });
  await m.refreshAthletes();
  show('gym');
};
$('brand').onclick = (e) => { e.preventDefault(); if (!isLocked()) $('btn-athletes').click(); };
document.querySelectorAll('.tabbar [data-go]').forEach(b => b.onclick = () => $(b.dataset.go).click());
// menús desplegables: se cierran al elegir una opción, al tocar afuera o con Escape
document.addEventListener('click', (e) => {
  document.querySelectorAll('details.menu[open]').forEach(d => {
    if (!d.contains(e.target) || e.target.closest('.menu-item:not(.file-btn)')) d.open = false;
  });
});
document.addEventListener('change', (e) => { const d = e.target.closest('details.menu'); if (d) d.open = false; });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') document.querySelectorAll('details.menu[open]').forEach(d => { d.open = false; }); });

// ---------- carga ----------
$('f-date').valueAsDate = new Date();
const drop = $('drop');
['dragenter', 'dragover'].forEach(e => drop.addEventListener(e, ev => { ev.preventDefault(); drop.classList.add('over'); }));
['dragleave', 'drop'].forEach(e => drop.addEventListener(e, ev => { ev.preventDefault(); drop.classList.remove('over'); }));
drop.addEventListener('drop', ev => { const f = ev.dataTransfer.files[0]; if (f) setFile(f); });
$('file').addEventListener('change', ev => { const f = ev.target.files[0]; if (f) setFile(f); });

function setFile(f) {
  if (state.range && state.range.file !== f) clearRange();
  state.file = f;
  $('file').required = false; // el archivo puede llegar arrastrado o desde la cámara, sin pasar por el campo
  $('drop-title').textContent = f.name;
  $('drop-hint').textContent = `${(f.size / 1048576).toFixed(1)} MB`;
  $('btn-analyze').disabled = false;
  $('upload-error').hidden = true;
  fpsNote();
}
// cuadros por segundo del video elegido frente a lo que se va a medir (solo MP4/MOV: el contenedor los trae)
async function fpsNote() {
  const f = state.file, el = $('drop-fps');
  el.hidden = true;
  if (!f) return;
  const timing = await readFrameTimes(f).catch(() => null);
  if (state.file !== f || !timing?.fps) return;
  const v = fpsVerdict(mode() === 'tech' ? 'tech' : 'race', timing.fps);
  el.textContent = v.text; el.className = v.ok ? 'fine ok-line' : 'notice'; el.hidden = !v.text;
}
$('fps-guide').innerHTML = fpsTable();
$('live-fps').textContent = fpsHint('live');

// Un largo de la carrera a técnica: se analiza solo ese tramo del mismo video, con los datos de la prueba.
function analyzeSegment(file, cfg, t0, t1, label, style) {
  setFile(file);
  setMode('tech');
  state.range = { file, t0, t1, label };
  $('f-name').value = cfg.swimmer || '';
  if (cfg.athleteId) refreshSelect(cfg.athleteId).then(() => { $('f-athlete').value = cfg.athleteId; });
  $('f-style').value = style;
  if (cfg.date) $('f-date').value = cfg.date;
  $('f-event').value = [cfg.event || `${cfg.distance} m`, label].filter(Boolean).join(' · ');
  rangeUi();
  show('upload');
}
function clearRange() { state.range = null; rangeUi(); }
function rangeUi() {
  const r = state.range, el = $('range-note');
  el.hidden = !r;
  if (r) {
    el.innerHTML = `Se va a analizar solo el tramo del ${esc(r.label)}: de ${fmt(r.t0, 2)} s a ${fmt(r.t1, 2)} s del video (${fmt(r.t1 - r.t0, 1)} s). Elegí la toma y tocá Analizar. <button class="linkish" type="button" id="range-clear">Analizar el video completo</button>`;
    $('range-clear').onclick = clearRange;
  }
}

$('btn-new').onclick = () => {
  if (state.abort) state.abort.abort();
  const v = $('video'); v.pause();
  $('rc-video').pause();
  show('upload');
};

// tipo de análisis
const mode = () => ($('mode-both').checked ? 'both' : $('mode-race').checked ? 'race' : 'tech');
function applyMode() {
  const m = mode(), race = m !== 'tech', tech = m !== 'race';
  document.querySelectorAll('.only-race').forEach(el => el.hidden = !race);
  document.querySelectorAll('.only-tech').forEach(el => el.hidden = !tech);
  // el medley solo existe en competencia: la técnica analiza un estilo por vez
  const med = document.querySelector('#f-style .only-race-opt');
  med.hidden = med.disabled = tech;
  if (tech && $('f-style').value === 'medley') $('f-style').value = 'crol';
  $('btn-analyze').textContent = m === 'race' ? 'Abrir para marcar' : m === 'both' ? 'Analizar técnica y seguir con la prueba' : 'Analizar video';
  $('drop-hint').textContent = state.file ? `${(state.file.size / 1048576).toFixed(1)} MB` : (m === 'race'
    ? `MP4 o MOV de la prueba completa. Ideal: cámara fija en trípode a la altura de los 25 m, elevada. ${fpsHint('race')}`
    : m === 'both'
      ? `MP4 o MOV de la prueba completa, con el nadador lo más grande posible. La pose pierde precisión si el nadador se ve chico o lejos. ${fpsHint('race')}`
      : `MP4 o MOV. Recomendado: 10 a 60 s de nado continuo, toma lateral. ${fpsHint('tech')} Si es una salida o un viraje, en cámara lenta: ${GUIDE.start.rec} (mínimo ${GUIDE.start.min}).`);
  $('film-guide').innerHTML = filmGuide(m === 'tech' ? 'tech' : 'race', $('f-view').value);
  if (state.file) fpsNote();
}
$('f-view').addEventListener('change', () => { if (mode() === 'tech') $('film-guide').innerHTML = filmGuide('tech', $('f-view').value); });
$('mode-tech').onchange = applyMode;
$('mode-race').onchange = applyMode;
$('mode-both').onchange = applyMode;
function setMode(m) { $('mode-' + m).checked = true; applyMode(); }
applyMode();

// Técnica y competencia sobre el mismo video: se pasa de una a la otra con el selector de arriba.
function pairUi() {
  const f = state.techFile;
  const on = !!f && (state.raceFile === f || (state.pendingRace && state.pendingRace.file === f));
  document.querySelectorAll('.pair-switch').forEach(el => {
    el.hidden = !on;
    el.querySelectorAll('[data-pair]').forEach(b => b.setAttribute('aria-selected', b.dataset.pair === document.body.dataset.view));
  });
}
function openRace(file, cfg) {
  state.raceFile = file;
  return import('./race-ui.js').then(m => m.startRace(file, cfg, { show, download, saveToAthlete, analyzeSegment }));
}
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-pair]');
  if (!b) return;
  if (b.dataset.pair === 'results') { show('results'); return; }
  const p = state.pendingRace;
  if (state.raceFile === state.techFile) show('race');
  else if (p && p.file === state.techFile) {
    state.pendingRace = null;
    openRace(p.file, p.cfg).catch(err => { console.error(err); notify('No se pudo abrir el video: ' + (err.message || err)); });
  }
});
$('btn-to-race').onclick = () => {
  if (state.raceFile && state.raceFile === state.techFile) { show('race'); return; }
  if (state.techFile) setFile(state.techFile);
  setMode('race'); show('upload');
};
$('rc-to-tech').onclick = () => {
  if (state.techFile && state.raceFile === state.techFile) { show('results'); return; }
  if (state.raceFile) setFile(state.raceFile);
  setMode('tech'); show('upload');
};
$('f-pool').onchange = () => { $('f-marks').value = $('f-pool').value === '25' ? '15, 20' : '15, 25, 35, 45'; };
$('f-athlete').onchange = async () => {
  const id = $('f-athlete').value;
  if (!id) return;
  const a = await store.getAthlete(id);
  if (a) $('f-name').value = a.name;
};

// Guarda una evaluación en la ficha del alumno; si no hay alumno elegido, usa (o crea) uno con el nombre cargado.
async function saveToAthlete(athleteId, name, rec, msgId, file) {
  const show = (t, aid, saved) => {
    const el = $(msgId);
    el.innerHTML = '';
    el.append(t);
    if (aid) { const b = document.createElement('button'); b.className = 'linkish'; b.textContent = 'Ver ficha'; b.onclick = () => openAthlete(aid); el.append(' ', b); }
    if (saved && file && store.canStoreVideo && !saved.videoPath) {
      const u = document.createElement('button'); u.className = 'linkish'; u.textContent = 'Subir también el video';
      u.onclick = async () => {
        u.disabled = true; u.textContent = 'Subiendo el video…';
        try { await store.uploadVideo(saved.id, file); u.replaceWith(document.createTextNode('Video guardado en la nube.')); }
        catch (err) { u.replaceWith(document.createTextNode('No se pudo subir el video: ' + err.message)); }
      };
      el.append(' ', u);
    }
    el.hidden = false;
  };
  try {
    let id = athleteId;
    if (!id) {
      const list = await store.listAthletes();
      const found = list.find(a => a.name.trim().toLowerCase() === (name || '').trim().toLowerCase());
      if (found) id = found.id;
      else if (name && name !== 'Sin nombre') id = (await store.saveAthlete({ name })).id;
      else { show('Elegí un alumno o escribí el nombre del nadador antes de guardar.'); return null; }
    }
    if (rec.sourceKey) {
      const prev = (await store.listEvaluations(id)).find(e => e.sourceKey === rec.sourceKey);
      if (prev) rec.id = prev.id; // vuelve a guardar sobre la misma evaluación
    }
    const saved = await store.saveEvaluation({ ...rec, athleteId: id });
    const a = await store.getAthlete(id);
    show(`Guardado en la ficha de ${a.name}.`, id, saved);
    return saved;
  } catch (err) { show('No se pudo guardar: ' + err.message); return null; }
}

const num = (v) => { const x = parseFloat(String(v).replace(',', '.')); return Number.isFinite(x) ? x : NaN; };

$('upload-form').addEventListener('submit', (ev) => {
  ev.preventDefault();
  if (!state.file) return;
  const m = mode();
  if (m !== 'tech') {
    const cfg = {
      swimmer: $('f-name').value.trim() || 'Sin nombre',
      date: $('f-date').value,
      style: $('f-style').value,
      event: $('f-event').value.trim(),
      distance: +$('f-distance').value,
      poolLength: +$('f-pool').value,
      marks: $('f-marks').value.split(/[;,\s]+/).map(num).filter(Number.isFinite),
      officialTime: num($('f-official').value),
      reactionTime: num($('f-reaction').value),
      cameraDistance: Number.isFinite(num($('f-camdist').value)) ? num($('f-camdist').value) : 0,
      signalBy: 'sonido',
      fileName: state.file.name,
      athleteId: $('f-athlete').value || null,
    };
    if (cfg.distance % cfg.poolLength) { $('upload-error').textContent = 'La distancia de la prueba no es múltiplo del largo de la pileta.'; $('upload-error').hidden = false; return; }
    if (m === 'both') { state.pendingRace = { file: state.file, cfg }; runTech(); return; }
    openRace(state.file, cfg).catch(err => {
      console.error(err);
      $('upload-error').textContent = 'No se pudo abrir el video: ' + (err.message || err);
      $('upload-error').hidden = false;
      show('upload');
    });
    return;
  }
  state.pendingRace = null;
  runTech();
});
function runTech() {
  process().catch(err => {
    if (err.name === 'AbortError') { show('upload'); return; }
    console.error(err);
    $('progress-error').textContent = 'No se pudo completar el análisis: ' + (err.message || err);
    $('progress-error').hidden = false;
  });
}

$('btn-cancel').onclick = () => { if (state.abort) state.abort.abort(); show('upload'); };

function stepState(name, status) {
  const li = document.querySelector(`#steps li[data-step="${name}"]`);
  li.classList.toggle('active', status === 'active');
  li.classList.toggle('done', status === 'done');
}

function loadVideo(video, url) {
  return new Promise((resolve, reject) => {
    video.onloadeddata = () => resolve();
    video.onerror = () => reject(new Error('Este navegador no puede decodificar el video. Probá exportarlo como MP4 (H.264).'));
    video.src = url;
    video.load();
  });
}

// ---------- proceso completo ----------
async function process() {
  show('progress');
  document.querySelectorAll('#steps li').forEach(li => li.className = '');
  $('progress-error').hidden = true;
  $('bar-fill').style.width = '0%';
  $('pose-count').textContent = '';
  const file = state.file;
  $('progress-file').textContent = `${file.name} · ${(file.size / 1048576).toFixed(1)} MB`;
  state.abort = new AbortController();
  const signal = state.abort.signal;

  // 1. metadatos
  stepState('meta', 'active');
  if (state.url) URL.revokeObjectURL(state.url);
  state.url = URL.createObjectURL(file);
  const video = $('video');
  await loadVideo(video, state.url);
  let timing = await readFrameTimes(file);
  let timingSource = 'container';
  if (!timing || !timing.times.length) {
    timing = await probeFrameTimes(video);
    timingSource = 'probe';
  }
  if (!timing) throw new Error('No se pudo determinar la frecuencia de cuadro del video.');
  // recorta tiempos que excedan la duración reproducible
  timing.times = timing.times.filter(t => t < video.duration);
  // tramo elegido desde la carrera (un largo)
  const range = state.range && state.range.file === file ? state.range : null;
  if (range) timing.times = timing.times.filter(t => t >= range.t0 && t <= range.t1);
  if (range && !timing.times.length) throw new Error('El tramo elegido no tiene cuadros.');
  const W = video.videoWidth, H = video.videoHeight;
  if (!W || !H) throw new Error('El video no tiene dimensiones válidas.');
  if (range && range.t1 - range.t0 > 120) throw new Error(`El tramo dura ${(range.t1 - range.t0).toFixed(0)} s; el máximo es 120 s.`);
  if (!range && video.duration > 120) throw new Error(`El video dura ${video.duration.toFixed(0)} s. En esta versión el máximo es 120 s: recortalo al tramo de nado que querés analizar.`);
  stepState('meta', 'done');

  // 2. modelo
  if (signal.aborted) throw new DOMException('Cancelado', 'AbortError');
  stepState('model', 'active');
  const model = $('f-model').value;
  const sample = document.createElement('canvas');
  sample.width = W; sample.height = H;
  sample.getContext('2d').drawImage(video, 0, 0, W, H);
  const landmarker = await getLandmarker(model, BASE, sample);
  stepState('model', 'done');

  // 3. pose
  stepState('pose', 'active');
  const step = timing.fps > 65 ? Math.round(timing.fps / 60) : 1;
  const frames = await runPose(video, timing, landmarker, {
    step, signal, camera: true,
    onProgress: ({ done, total, eta }) => {
      $('pose-count').textContent = `${done}/${total}${eta > 3 ? ` · faltan ~${Math.ceil(eta)} s` : ''}`;
      $('bar-fill').style.width = (5 + 85 * done / total).toFixed(1) + '%';
    },
  });
  stepState('pose', 'done');

  // 4. análisis
  stepState('analysis', 'active');
  await new Promise(r => setTimeout(r, 30));
  const meta = {
    swimmer: $('f-name').value.trim() || 'Sin nombre',
    athleteId: $('f-athlete').value || null,
    date: $('f-date').value,
    style: $('f-style').value,
    view: $('f-view').value,
    viewLabel: $('f-view').selectedOptions[0].textContent,
    event: $('f-event').value.trim(),
    fileName: file.name,
    ...(range ? { range: { t0: range.t0, t1: range.t1, label: range.label } } : {}),
    width: W, height: H,
    fps: timing.fps / step,
    sourceFps: timing.fps,
    frameStep: step,
    vfr: timing.vfr,
    duration: frames.length ? frames[frames.length - 1].t - frames[0].t + timing.frameDur * step : 0,
    timingSource,
    model: model === 'full' ? 'MediaPipe Pose Landmarker Full' : 'MediaPipe Pose Landmarker Lite',
    appVersion: APP_VERSION,
    minVisibility: DEFAULT_CONFIG.minVisibility,
    analyzedAt: new Date().toISOString(),
  };
  state.raw = frames; state.anchors = []; state.found = null;
  const pm = state.pendingMoments;
  state.pointEdits = pm && pm.fileName === file.name ? pm.pointEdits || [] : [];
  // al reabrir una evaluación en la que se buscó al nadador en los cuadros perdidos, se repite la búsqueda
  if (pm && pm.fileName === file.name && pm.found) {
    const tracked = applyTrack(frames, [], W / H);
    const lm2 = await getLandmarker(model, BASE, sample, ':crop');
    state.found = await refinePose(video, tracked, lm2, { frameDur: timing.frameDur, signal });
  }
  const result = pipeline(meta);
  // momentos guardados de este mismo video (al reabrir una evaluación)
  state.moments = pm && pm.fileName === file.name ? pm.list.filter(m => m.frame < result.times.length) : [];
  state.drawings = pm && pm.fileName === file.name ? pm.drawings || [] : [];
  state.phaseEdits = pm && pm.fileName === file.name ? pm.phaseEdits || {} : {};
  state.faultDecisions = pm && pm.fileName === file.name ? pm.faultDecisions || {} : {};
  c2Reset(pm && pm.fileName === file.name ? pm.cam2 || null : null);
  state.vel = { scale: pm && pm.fileName === file.name ? pm.velScale || null : null, point: pm && pm.fileName === file.name ? pm.velPoint || 'hip' : 'hip', mark: null };
  state.angleChecks = pm && pm.fileName === file.name ? pm.angleChecks || [] : [];
  state.phaseSel = null;
  state.pendingMoments = null;
  pickUi(false);
  fixUi(false);
  stepState('analysis', 'done');
  stepState('done', 'active');
  $('bar-fill').style.width = '100%';
  renderResults(result);
  stepState('done', 'done');
  state.techFile = file;
  techClipUi.reset();
  show('results');
  setupPlayerSize();
  seekFrame(0);
}

// ---------- utilidades de resultados ----------
const STATUS_TAG = { 'medido': 'med', 'estimado': 'est', 'no disponible': 'na' };
const fmt = (v, d = 1) => Number.isFinite(v) ? v.toLocaleString('es-AR', { minimumFractionDigits: d, maximumFractionDigits: d }) : '–';
const esc = (s) => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const STYLE_LABEL = { crol: 'Crol', espalda: 'Espalda', pecho: 'Pecho', mariposa: 'Mariposa' };

// Pestaña Métricas (se vuelve a armar cuando cambian las fases o la escala de velocidad)
function renderMetrics(r) {
  let html = '';
  let group = '';
  const avail = r.metrics.filter(x => x.value != null), missing = r.metrics.filter(x => x.value == null);
  if (!avail.length) html += `<div class="empty-inline">Ninguna variable alcanzó datos suficientes en este video. Revisá la pestaña Calidad.</div>`;
  for (const x of avail) {
    if (x.group !== group) { group = x.group; html += `<div class="mgroup">${esc(group)}</div>`; }
    const val = x.value == null ? `<span class="metric-value na">No disponible</span>`
      : `<span class="metric-value">${fmt(x.value, x.unit === 's' ? 2 : 1)}<small>${esc(x.unit || '')}</small></span>`;
    html += `<div class="metric"><div class="metric-row"><span class="metric-label">${esc(x.label)}</span>${val}</div>
      <div class="metric-tags"><span class="tag ${STATUS_TAG[x.status]}">${esc(x.status)}</span>${x.confidence ? `<span class="tag ${x.confidence === 'baja' ? 'hi' : 'na'}">confianza ${esc(x.confidence)}</span>` : ''}</div>
      <div class="metric-detail">${esc(x.detail || '')}${Number.isFinite(x.se) ? ` Error de la medida: ±${fmt(1.96 * x.se, x.unit === 's' ? 2 : 1)}${esc(x.unit === '°' ? '°' : ' ' + (x.unit || ''))} (95 %, de ${x.n} ciclos); un cambio menor que eso entre dos análisis puede ser ruido.` : ''}</div></div>`;
  }
  if (missing.length) {
    html += `<details class="na-list"><summary>${missing.length} variable${missing.length === 1 ? '' : 's'} sin datos suficientes</summary>` +
      missing.map(x => `<div class="na-row"><span>${esc(x.label)}</span><small>${esc(x.detail || '')}</small></div>`).join('') + `</details>`;
  }
  if (r.observations.length) {
    html += `<div class="mgroup">Observaciones basadas en datos</div>`;
    for (const o of r.observations) html += `<div class="obs ${o.priority}"><b>${esc(o.type)}</b>${esc(o.text)}</div>`;
  }
  $('tab-metrics').innerHTML = html;
}

function renderResults(r) {
  const m = r.meta;
  $('r-title').textContent = `${m.swimmer} · ${STYLE_LABEL[m.style]}`;
  $('r-meta').textContent = [m.date, m.viewLabel, m.event, `${m.width}×${m.height}`, `${fmt(m.fps, 2)} fps`, `${r.times.length} cuadros`, `nadador detectado en ${fmt(100 * r.quality.detectedFraction, 0)}%`, `toma grado ${shotCertificate(r).grade}`].filter(Boolean).join('  ·  ');

  renderMetrics(r);

  // ciclos
  let ch = '';
  for (const side of ['L', 'R']) {
    const a = r.arms[side];
    ch += `<div class="mgroup">Brazo ${side === 'L' ? 'izquierdo' : 'derecho'}</div>`;
    if (!a.cycles.length) { ch += `<p class="metric-detail">${esc(a.reason || 'Sin ciclos detectados.')}</p>`; continue; }
    ch += `<table class="data"><thead><tr><th>#</th><th>Inicio</th><th>Duración</th><th>Codo mín.</th><th>Datos</th></tr></thead><tbody>`;
    a.cycles.forEach((c, k) => {
      const pc = r.perCycle.find(p => p.side === side && Math.abs(p.tStart - c.tStart) < 1e-6);
      ch += `<tr class="${c.accepted ? '' : 'rej'}" data-frame="${c.start}"><td>${k + 1}</td><td>${fmt(c.tStart, 2)} s</td><td>${fmt(c.duration, 2)} s</td><td>${pc && pc.elbowMin != null ? fmt(pc.elbowMin, 0) + '°' : '–'}</td><td>${fmt(100 * c.coverage, 0)}%${c.accepted ? '' : ' (descartado)'}</td></tr>`;
    });
    ch += `</tbody></table>`;
  }
  ch += `<p class="fine">Un ciclo va de una posición de mano adelantada a la siguiente del mismo brazo. Se descartan ciclos con menos del 70% de cuadros con la muñeca visible o con duración incoherente. Tocá una fila para ir a ese momento.</p>`;
  // fatiga técnica: primer tercio de los ciclos contra el último
  const fat = techFatigue(r, ANGLE_DEFS.filter(d => r.metrics.find(x => x.id === 'ang_' + d.id)?.value != null));
  ch += `<div class="mgroup">Fatiga técnica</div>`;
  ch += fat.error ? `<p class="metric-detail">${esc(fat.error)} Para medir la fatiga dentro de un video, filmá un tramo largo de nado (por ejemplo, 25 m completos con la cámara siguiendo al nadador). También se puede comparar la primera y la última repetición de una serie desde la ficha del alumno.</p>`
    : `<p class="metric-detail">Primeros ${fat.k} ciclos (${fmt(fat.from[0], 1)}–${fmt(fat.from[1], 1)} s) contra los últimos ${fat.k} (${fmt(fat.to[0], 1)}–${fmt(fat.to[1], 1)} s) del brazo ${fat.side === 'L' ? 'izquierdo' : 'derecho'}. Cada valor es la media por ciclo con su intervalo del 95 %.</p>${fatigueTable(fat.rows, fmt)}
      <p class="fine">"Cambio real" = la diferencia supera lo que varían los ciclos entre sí; si no, puede ser solo variación normal. Ángulos 2D, mediana de cada ciclo.</p>`;
  $('tab-cycles').innerHTML = ch;
  $('tab-cycles').querySelectorAll('tr[data-frame]').forEach(tr => tr.onclick = () => seekFrame(+tr.dataset.frame));

  // calidad
  const q = r.quality;
  r.certificate = shotCertificate(r);
  let qh = certificateHtml(r.certificate, esc) + `<div class="mgroup">Detección</div>
    <div class="metric"><div class="metric-row"><span class="metric-label">Cuadros con nadador detectado</span><span class="metric-value">${fmt(100 * q.detectedFraction, 0)}<small>%</small></span></div></div>
    <div class="metric"><div class="metric-row"><span class="metric-label">Tamaño del nadador en el cuadro</span><span class="metric-value">${fmt(100 * q.swimmerSize, 0)}<small>% diag.</small></span></div></div>
    <div class="metric"><div class="metric-row"><span class="metric-label">Tiempos de cuadro</span><span class="metric-value na">${r.meta.timingSource === 'container' ? 'Leídos del archivo' : 'Estimados'}${r.meta.vfr ? ' · variable' : ''}</span></div></div>
    <div class="mgroup">Visibilidad por segmento</div>`;
  for (const g of q.groups) {
    qh += `<div class="metric"><div class="metric-row"><span class="metric-label">${g.name}</span><span class="metric-value"><small>usable</small> ${fmt(100 * g.usableFraction, 0)}<small>%</small></span></div><div class="qbar"><div style="width:${(100 * g.usableFraction).toFixed(0)}%"></div></div></div>`;
  }
  const cl = r.meta.cleanup;
  if (cl) {
    qh += `<div class="mgroup">Correcciones de los puntos</div>
    <div class="metric"><div class="metric-row"><span class="metric-label">Cruces izquierda/derecha corregidos</span><span class="metric-value">${cl.swaps}</span></div></div>
    <div class="metric"><div class="metric-row"><span class="metric-label">Saltos aislados descartados</span><span class="metric-value">${cl.spikes}</span></div></div>
    ${cl.searched ? `<div class="metric"><div class="metric-row"><span class="metric-label">Cuadros recuperados recortando al nadador</span><span class="metric-value">${cl.found}</span></div></div>` : ''}
    <div class="metric"><div class="metric-row"><span class="metric-label">Puntos corregidos a mano</span><span class="metric-value">${cl.edits}</span></div></div>
    <p class="fine">Un cruce es cuando el modelo confunde el brazo o la pierna izquierda con la derecha; se corrige por continuidad con los cuadros anteriores. Un salto es un punto que se va lejos en un solo cuadro y vuelve; se descarta y, si el hueco es corto, se interpola. Los puntos corregidos a mano se ven con un anillo verde.</p>`;
  }
  const cm = r.meta.camera;
  $('t-cam-wrap').hidden = !cm?.moved;
  if (cm) {
    qh += `<div class="mgroup">Movimiento de la cámara</div>
    <div class="metric"><div class="metric-row"><span class="metric-label">Desplazamiento máximo de la imagen</span><span class="metric-value">${fmt(cm.maxShift, 0)} <small>px</small></span></div></div>
    <div class="metric"><div class="metric-row"><span class="metric-label">Cuadros con movimiento estimado</span><span class="metric-value">${fmt(100 * cm.okFrac, 0)}<small>%</small></span></div></div>
    <p class="fine">${cm.moved ? 'La cámara se movió (filmación en mano o paneo). Los recorridos de cabeza y muñeca y el vuelo de la salida se compensan siguiendo el fondo (corcheras, bordes, paredes), con un error típico de 1 a 3 px medido en un video real de prueba. Los ángulos articulares no dependen de la cámara.' : 'La cámara estuvo quieta (menos de 1 % de la imagen): no hace falta compensar.'}${cm.okFrac < 0.9 ? ' En algunos cuadros no había fondo con detalle suficiente para estimar el movimiento; ahí se supone la cámara quieta.' : ''}</p>`;
  }
  qh += `<p class="fine">"Usable" = cuadros en los que el modelo localizó la articulación con confianza ≥ ${r.meta.minVisibility}. Las variables que dependen de segmentos poco visibles se informan como no disponibles.</p>`;
  if (q.warnings.length) qh += `<div class="mgroup">Advertencias</div>` + q.warnings.map(w => `<div class="obs baja">${esc(w)}</div>`).join('');
  qh += `<div class="mgroup">Verificación con un ángulo conocido</div><div id="acc-box"></div>`;
  $('tab-quality').innerHTML = qh;
  state.acc = null;
  accUi();

  phasesUi();

  $('tab-limits').innerHTML = `<ul class="limits">${LIMITATIONS.map(l => `<li>${esc(l)}</li>`).join('')}</ul>
    <p class="fine">Modelo: ${esc(r.meta.model)}. Versión ${esc(r.meta.appVersion)}.</p>`;

  // series del gráfico: por defecto, el codo del brazo con más ciclos
  const bestArm = r.arms.L.cycles.filter(c => c.accepted).length >= r.arms.R.cycles.filter(c => c.accepted).length ? 'L' : 'R';
  state.chartSel = ['elbow' + bestArm]; state.chartColors = { ['elbow' + bestArm]: 0 };
  state.cmp = null; if (G.on) ghostOff();
  $('mom-sug').hidden = true; $('mom-sug').innerHTML = '';
  chartPickUi(r);
  momentsUi();
  cmpOptions();
  techDraw.refresh();
  state.trajSide = bestArm;
}

document.querySelectorAll('.tabs button').forEach(b => b.onclick = () => {
  document.querySelectorAll('.tabs button').forEach(x => x.setAttribute('aria-selected', x === b));
  for (const t of ['metrics', 'cycles', 'phases', 'faults', 'quality', 'limits']) $('tab-' + t).hidden = t !== b.dataset.tab;
});

// ---------- reproductor ----------
const video = $('video');
const overlay = $('overlay');
const stage = $('stage');
const player = $('player');
let zoom = 1, pan = { x: 0, y: 0 };

function setupPlayerSize() {
  const r = state.result;
  stage.style.aspectRatio = `${r.meta.width} / ${r.meta.height}`;
  player.style.maxHeight = '70vh';
  resizeOverlay();
}

function resizeOverlay() {
  const dpr = window.devicePixelRatio || 1;
  overlay.width = Math.round(stage.clientWidth * dpr);
  overlay.height = Math.round(stage.clientHeight * dpr);
  draw();
}
window.addEventListener('resize', () => { if (state.result) { resizeOverlay(); drawChart(); } });

function frameAt(t) {
  const ts = state.result.times;
  const tol = 0.5 / state.result.meta.fps;
  let lo = 0, hi = ts.length - 1;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (ts[mid] <= t + tol) lo = mid; else hi = mid - 1; }
  return lo;
}

function seekFrame(i) {
  const r = state.result;
  i = Math.max(0, Math.min(r.times.length - 1, i));
  state.frame = i;
  video.pause();
  video.currentTime = Math.min(video.duration - 1e-3, r.times[i] + 0.5 / r.meta.sourceFps);
  draw(); drawChart();
}

video.addEventListener('seeked', () => { if (video.paused) { draw(); drawChart(); } });
video.addEventListener('play', () => { $('play-ico').innerHTML = '<path d="M7 5h3v14H7zM14 5h3v14h-3z" fill="currentColor"/>'; tick(); });
video.addEventListener('pause', () => { $('play-ico').innerHTML = '<path d="M7 5l12 7-12 7z" fill="currentColor"/>'; draw(); });
video.addEventListener('ended', () => video.pause());

function tick() {
  if (video.paused || !state.result) return;
  const cb = (now, meta) => {
    state.frame = frameAt(meta ? meta.mediaTime : video.currentTime);
    draw(); drawChart();
    tick();
  };
  if ('requestVideoFrameCallback' in video) video.requestVideoFrameCallback(cb);
  else requestAnimationFrame(() => cb());
}

$('c-play').onclick = () => { if (video.paused) { video.playbackRate = +$('c-speed').value; video.play(); } else video.pause(); };
$('c-prev').onclick = () => seekFrame(state.frame - 1);
$('c-next').onclick = () => seekFrame(state.frame + 1);
$('c-speed').onchange = () => { video.playbackRate = +$('c-speed').value; };
$('c-zoom').onchange = () => { zoom = +$('c-zoom').value; pan = { x: 0, y: 0 }; applyZoom(); };
['t-skel', 't-ang', 't-traj', 't-low', 't-head', 't-phase'].forEach(id => $(id).onchange = draw);
$('t-cam').onchange = () => { if (state.result) { momentsUi(); draw(); } };
document.addEventListener('keydown', (e) => {
  if ($('view-results').hidden || /INPUT|SELECT|TEXTAREA/.test(e.target.tagName)) return;
  if (e.key === 'ArrowRight') { seekFrame(state.frame + 1); e.preventDefault(); }
  if (e.key === 'ArrowLeft') { seekFrame(state.frame - 1); e.preventDefault(); }
  if (e.key === ' ') { $('c-play').click(); e.preventDefault(); }
});

function applyZoom() {
  const w = stage.clientWidth, h = stage.clientHeight;
  pan.x = Math.min(0, Math.max(w - w * zoom, pan.x));
  pan.y = Math.min(0, Math.max(h - h * zoom, pan.y));
  stage.style.transform = zoom === 1 ? '' : `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`;
  player.classList.toggle('zoomed', zoom > 1);
}
// arrastre para desplazar con zoom
let drag = null;
player.addEventListener('pointerdown', e => { if (zoom > 1) { drag = { x: e.clientX, y: e.clientY, px: pan.x, py: pan.y }; player.setPointerCapture(e.pointerId); } });
player.addEventListener('pointermove', e => { if (drag) { pan.x = drag.px + e.clientX - drag.x; pan.y = drag.py + e.clientY - drag.y; applyZoom(); } });
player.addEventListener('pointerup', () => { drag = null; });

// Compensación del movimiento de la cámara: solo si se movió y está activada.
function camOf(r) { return r?.cam && r.meta.camera?.moved && $('t-cam').checked ? r.cam : null; }
// del primer cuadro (donde se ajusta el vuelo) a la imagen del cuadro i
function flightMap(r, i) { const c = camOf(r); return c ? (p) => camApply(camInvert(c.toBase[i]), p) : null; }

function css(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }

// Dibuja el esqueleto del cuadro i sobre ctx, escalando de píxeles de video a píxeles del canvas.
export function drawSkeleton(ctx, r, i, scale, opt) {
  const T = r.tracks;
  const thr = r.meta.minVisibility;
  const accent = opt.accent || '#ff9f1c';
  // cuadros sin detección confiable del nadador: solo se muestran los puntos interpolados entre cuadros
  // vecinos bien detectados (huecos cortos), en gris; nada medido en ese cuadro se dibuja como confiable
  const detected = !r.quality.detectedMask || r.quality.detectedMask[i];
  const P = (j) => {
    const x = T[j].x[i], y = T[j].y[i];
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    const man = T[j].manual?.[i] || 0;
    if (!detected && !T[j].interpolated[i] && !man) return null;
    return { x: x * scale, y: y * scale, v: T[j].vis[i], interp: T[j].interpolated[i] && !man, man };
  };
  const lw = Math.max(1.5, 2.2 * (opt.lineScale || 1));
  if (opt.head) {
    // recorrido de la cabeza desde el primer cuadro hasta el actual; punteado donde está interpolado
    const pathOf = (get, upto, color, dash, alpha, own) => {
      ctx.strokeStyle = color; ctx.lineWidth = lw; ctx.globalAlpha = alpha;
      let prev = null;
      for (let k = 0; k <= upto; k++) {
        let h = get(k);
        if (h && own && opt.cam) { const q = between(opt.cam, k, i, h); h = [q[0], q[1], h[2]]; }
        if (h && prev) { ctx.setLineDash(dash || (h[2] || prev[2] ? [4, 4] : [])); ctx.beginPath(); ctx.moveTo(prev[0] * scale, prev[1] * scale); ctx.lineTo(h[0] * scale, h[1] * scale); ctx.stroke(); }
        prev = h;
      }
      ctx.setLineDash([]); ctx.globalAlpha = 1;
      let h = get(upto);
      if (h && own && opt.cam) { const q = between(opt.cam, upto, i, h); h = [q[0], q[1], h[2]]; }
      if (h) { ctx.fillStyle = color; ctx.beginPath(); ctx.arc(h[0] * scale, h[1] * scale, lw * 1.8, 0, Math.PI * 2); ctx.fill(); }
    };
    // el otro intento (comparar salidas): su recorrido hasta el mismo instante, alineado en el momento elegido
    const g = opt.ghostHead;
    if (g) {
      const tNow = r.times[i] - g.shift;
      let upto = -1; while (upto + 1 < g.times.length && g.times[upto + 1] <= tNow + 1e-6) upto++;
      if (upto >= 0) pathOf((k) => g.head[k], upto, '#c6ffbd', [2, 5], 0.9);
    }
    pathOf((k) => headAt(T, k, r.quality.detectedMask), i, '#7cff6b', null, 1, true);
  }
  if (opt.traj) {
    const wr = opt.trajSide === 'R' ? 16 : 15;
    const span = Math.round(r.meta.fps * 1.5);
    ctx.lineWidth = lw * 0.9;
    for (let k = Math.max(1, i - span); k <= i; k++) {
      const a = T[wr];
      let x0 = a.x[k - 1], y0 = a.y[k - 1], x1 = a.x[k], y1 = a.y[k];
      if (![x0, y0, x1, y1].every(Number.isFinite)) continue;
      // con cámara en mano, el recorrido se lleva a la imagen del cuadro actual
      if (opt.cam) { [x0, y0] = between(opt.cam, k - 1, i, [x0, y0]); [x1, y1] = between(opt.cam, k, i, [x1, y1]); }
      const age = (i - k) / span;
      ctx.strokeStyle = `rgba(255,255,255,${(0.9 * (1 - age)).toFixed(2)})`;
      ctx.setLineDash(a.interpolated[k] ? [4, 4] : []);
      ctx.beginPath(); ctx.moveTo(x0 * scale, y0 * scale); ctx.lineTo(x1 * scale, y1 * scale); ctx.stroke();
    }
    ctx.setLineDash([]);
  }
  if (opt.skel) {
    for (const [a, b] of SKELETON) {
      const p = P(a), q = P(b);
      if (!p || !q) continue;
      const interp = p.interp || q.interp;
      ctx.strokeStyle = interp ? 'rgba(200,200,200,0.8)' : accent;
      ctx.setLineDash(interp ? [5, 4] : []);
      ctx.lineWidth = lw;
      ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(q.x, q.y); ctx.stroke();
    }
    ctx.setLineDash([]);
    for (const j of [0, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28]) {
      const p = P(j);
      if (!p) continue;
      ctx.fillStyle = p.interp ? '#bbb' : '#fff';
      ctx.strokeStyle = '#000'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(p.x, p.y, lw * 1.6, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      if (p.man) { // corregido a mano (entero) o ajustado desde una corrección cercana (punteado)
        ctx.strokeStyle = '#3ddc84'; ctx.lineWidth = lw; ctx.setLineDash(p.man === 1 ? [] : [3, 3]);
        ctx.beginPath(); ctx.arc(p.x, p.y, lw * 3.2, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
      }
    }
    if (opt.fixSel != null) { const p = P(opt.fixSel); if (p) { ctx.strokeStyle = '#ffd23f'; ctx.lineWidth = lw; ctx.beginPath(); ctx.arc(p.x, p.y, lw * 4.5, 0, Math.PI * 2); ctx.stroke(); } }
  }
  // puntos descartados por baja confianza (solo como referencia, huecos)
  if (opt.low && r.rawLow) {
    const raw = r.rawLow[i];
    if (raw) for (const [x, y] of raw) {
      ctx.strokeStyle = 'rgba(255,255,255,0.45)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(x * scale, y * scale, lw * 1.6, 0, Math.PI * 2); ctx.stroke();
    }
  }
  if (opt.ang) {
    const fs = Math.max(11, 13 * (opt.lineScale || 1));
    ctx.font = `600 ${fs}px "Geist Mono", monospace`;
    const placed = [];
    for (const def of ANGLE_DEFS) {
      if (def.id.startsWith('shoulder')) continue;
      const s = r.angles[def.id];
      const v = s.values[i];
      if (!Number.isFinite(v) || (s.conf[i] < thr && !s.interp[i])) continue;
      const [a, b, c] = def.pts.map(P);
      if (!a || !b || !c) continue;
      const a1 = Math.atan2(a.y - b.y, a.x - b.x), a2 = Math.atan2(c.y - b.y, c.x - b.x);
      let d = a2 - a1; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI;
      const rad = 18 * (opt.lineScale || 1);
      ctx.strokeStyle = s.interp[i] ? '#bbb' : accent; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(b.x, b.y, rad, a1, a1 + d, d < 0); ctx.stroke();
      const txt = `${s.interp[i] ? '≈' : ''}${Math.round(v)}°`;
      const mid = a1 + d / 2;
      const tx = b.x - Math.cos(mid) * (rad + 6) - ctx.measureText(txt).width / 2;
      let ty = b.y - Math.sin(mid) * (rad + 6) + fs / 3;
      const w = ctx.measureText(txt).width;
      // si dos etiquetas se pisan (izquierda y derecha superpuestas en la toma lateral), corre la nueva hacia abajo
      for (let k = 0; k < 6 && placed.some(q => tx < q.x + q.w + 4 && tx + w + 4 > q.x && ty < q.y + fs + 4 && ty + fs + 4 > q.y); k++) ty += fs + 5;
      placed.push({ x: tx, y: ty, w });
      ctx.fillStyle = 'rgba(0,0,0,0.7)'; ctx.fillRect(tx - 3, ty - fs + 2, w + 6, fs + 3);
      ctx.fillStyle = s.interp[i] ? '#ccc' : '#fff'; ctx.fillText(txt, tx, ty);
    }
  }
}

// En un cuadro sin detección, botones para ir al cuadro bien detectado más cercano hacia atrás o adelante.
function nearUi(i, detected) {
  const box = $('t-near'), m = state.result.quality.detectedMask;
  if (detected || !video.paused) { box.hidden = true; return; }
  let a = i - 1, b = i + 1;
  while (a >= 0 && !m[a]) a--;
  while (b < m.length && !m[b]) b++;
  const btn = (k, txt) => k >= 0 && k < m.length ? `<button type="button" class="ov-chip" data-go="${k}">${txt}</button>` : '';
  box.innerHTML = `<span class="ov-note">El modelo no vio bien al nadador en este cuadro${state.result.angles.kneeL.interp[i] || state.result.angles.elbowL.interp[i] || state.result.angles.kneeR.interp[i] || state.result.angles.elbowR.interp[i] ? ': lo gris es interpolado' : ''}.</span>${btn(a, `← cuadro ${a + 1}`)}${btn(b, `cuadro ${b + 1} →`)}`;
  box.hidden = false;
  box.querySelectorAll('[data-go]').forEach(x => { x.onpointerdown = (e) => e.stopPropagation(); x.onclick = (e) => { e.stopPropagation(); seekFrame(+x.dataset.go); }; });
}

function draw() {
  const r = state.result;
  if (!r) return;
  ghostSync(false);
  const ctx = overlay.getContext('2d');
  ctx.clearRect(0, 0, overlay.width, overlay.height);
  const i = state.frame;
  const scale = overlay.width / r.meta.width;
  const dpr = window.devicePixelRatio || 1;
  drawSkeleton(ctx, r, i, scale, {
    skel: $('t-skel').checked, ang: $('t-ang').checked, traj: $('t-traj').checked, low: $('t-low').checked, head: $('t-head').checked, ghostHead: ghostHead(), cam: camOf(r),
    trajSide: state.trajSide, accent: css('--overlay') || '#ff9f1c', lineScale: dpr * Math.min(1.4, Math.max(0.8, stage.clientWidth / 700)),
    fixSel: state.fix && $('t-fix-joint').value !== '' ? +$('t-fix-joint').value : null,
  });
  if (state.fixDrag) {
    const d = state.fixDrag, x = d.x * overlay.width, y = d.y * overlay.height;
    ctx.strokeStyle = '#3ddc84'; ctx.lineWidth = 2 * dpr;
    ctx.beginPath(); ctx.arc(x, y, 9 * dpr, 0, Math.PI * 2); ctx.moveTo(x - 14 * dpr, y); ctx.lineTo(x + 14 * dpr, y); ctx.moveTo(x, y - 14 * dpr); ctx.lineTo(x, y + 14 * dpr); ctx.stroke();
  }
  if (state.showFlight && state.flight) drawFlight(ctx, state.flight, scale, dpr * Math.min(1.4, Math.max(0.8, stage.clientWidth / 700)), undefined, flightMap(r, i));
  renderDrawings(ctx, state.drawings.filter(d => drawingVisible(d, r.times[i], 1 / r.meta.fps)), scale, dpr);
  if (state.pick && state.raw && state.raw[i]) drawOthers(ctx, i, scale, dpr);
  if ($('t-phase').checked && state.phases && !state.phases.error) drawPhaseTag(ctx, i, dpr);
  if (state.cc?.ghost) drawCycleGhost(ctx, r, i, scale, dpr);
  drawVel(ctx, r, i, scale, dpr);
  c2Hud();
  if (state.acc) drawAcc(ctx, scale, dpr);
  const detected = r.quality.detectedMask[i];
  $('hud').textContent = `${r.times[i].toFixed(3)} s · cuadro ${i + 1}${detected ? '' : ' · sin detección confiable'}`;
  nearUi(i, detected);
  phaseSelUi();
  $('c-readout').textContent = `${i + 1} / ${r.times.length}  ·  ${r.times[i].toFixed(3)} s`;
}

// ---------- verificación con un ángulo conocido ----------
// Algo con ángulo conocido en la misma toma (una escuadra de 90°, la pared contra la corchera): se marcan
// tres puntos y se compara con el valor real. Es el error de medir ángulos en esa toma, no el del modelo.
function accUi() {
  const box = $('acc-box');
  if (!box) return;
  const A = state.acc, list = state.angleChecks, sum = checkSummary(list);
  box.innerHTML = `<p class="fine">Si en el video se ve algo con un ángulo conocido (una escuadra, la pared y la corchera, una marca en el piso), marcá sus tres puntos: primero un extremo, después el vértice y después el otro extremo.</p>
    <div class="acc-row"><label>Ángulo real <input type="text" inputmode="decimal" id="acc-real" value="${A ? String(A.real).replace('.', ',') : '90'}" aria-label="Ángulo real en grados"> °</label>
    <button class="btn small" id="acc-go" type="button">${A ? `Tocá el punto ${A.pts.length + 1} de 3…` : 'Marcar 3 puntos en el video'}</button>${A ? '<button class="btn ghost small" id="acc-cancel" type="button">Cancelar</button>' : ''}</div>
    ${list.length ? `<ul class="limits chk-list">${list.map((c, i) => `<li>${esc(checkText(c))} <button class="linkish" data-acc-del="${i}" type="button">Borrar</button></li>`).join('')}</ul>${sum.n > 1 ? `<p class="fine">Error medio ${fmt(sum.mean, 1)}°, máximo ${fmt(sum.max, 1)}°.</p>` : ''}` : ''}`;
  $('acc-go').onclick = () => { if (state.acc) return; const v = parseFloat($('acc-real').value.replace(',', '.')); if (!Number.isFinite(v)) return; video.pause(); state.acc = { real: v, pts: [] }; overlay.classList.add('tool'); accUi(); };
  if ($('acc-cancel')) $('acc-cancel').onclick = () => { state.acc = null; overlay.classList.remove('tool'); accUi(); draw(); };
  box.querySelectorAll('[data-acc-del]').forEach(b => b.onclick = () => { state.angleChecks.splice(+b.dataset.accDel, 1); accUi(); });
}
overlay.addEventListener('click', (e) => {
  if (!state.acc) return;
  e.stopImmediatePropagation(); e.preventDefault();
  const rect = overlay.getBoundingClientRect(), r = state.result;
  state.acc.pts.push([(e.clientX - rect.left) / rect.width * r.meta.width, (e.clientY - rect.top) / rect.height * r.meta.height]);
  if (state.acc.pts.length === 3) {
    const c = angleCheck(state.acc.real, ...state.acc.pts);
    if (c) state.angleChecks.push({ ...c, frame: state.frame });
    state.acc = null; overlay.classList.remove('tool');
  }
  accUi(); draw();
}, true);
function drawAcc(ctx, scale, dpr) {
  const pts = state.acc?.pts || [];
  ctx.save(); ctx.strokeStyle = '#ffd23f'; ctx.fillStyle = '#ffd23f'; ctx.lineWidth = 2 * dpr;
  pts.forEach((p, i) => { ctx.beginPath(); ctx.arc(p[0] * scale, p[1] * scale, 5 * dpr, 0, Math.PI * 2); ctx.fill(); if (i) { ctx.beginPath(); ctx.moveTo(pts[i - 1][0] * scale, pts[i - 1][1] * scale); ctx.lineTo(p[0] * scale, p[1] * scale); ctx.stroke(); } });
  ctx.restore();
}

// ---------- fases de la brazada ----------
const fmtS = (v) => fmt(v, 2);
state.test.phasesUi = () => phasesUi();
function phasesUi() {
  const r = state.result, box = $('tab-phases');
  const sp = state.phases = strokePhases(r, state.phaseEdits);
  // la métrica deja de figurar como pendiente cuando hay ciclos con las cuatro fases
  const met = r.metrics.find(x => x.id === 'phases');
  if (met) {
    const a = !sp.error && sp.arms[sp.best];
    Object.assign(met, a && a.n ? { value: a.n, unit: 'ciclos', status: 'estimado', confidence: a.n >= 3 ? 'media' : 'baja', detail: `Brazo ${sp.best === 'L' ? 'izquierdo' : 'derecho'}: ${a.summary.map(x => `${x.label.toLowerCase()} ${fmt(x.pct, 0)} %`).join(', ')} del ciclo.` }
      : { value: null, unit: null, status: 'no disponible', confidence: null, detail: sp.error || 'Sin ciclos con las cuatro fases a la vista.' });
  }
  if (sp.error) { box.innerHTML = `<p class="metric-detail">${esc(sp.error)}</p>`; velUi(); faultsUi(); draw(); return; }
  let h = `<div class="phase-key">${PHASES.map((p, k) => `<span><i style="background:${PHASE_COLORS[k]}"></i>${p.label}</span>`).join('')}</div>`;
  for (const side of ['L', 'R']) {
    const a = sp.arms[side];
    h += `<div class="mgroup">Brazo ${side === 'L' ? 'izquierdo' : 'derecho'}</div>`;
    if (!a.cycles.length) { h += '<p class="metric-detail">No se encontraron brazadas con la muñeca y el hombro a la vista.</p>'; continue; }
    if (a.n) {
      h += `<div class="phase-bar" role="img" aria-label="Reparto medio del ciclo">${a.summary.map((x, k) => `<span style="width:${x.pct.toFixed(1)}%;background:${PHASE_COLORS[k]}" title="${x.label} ${fmt(x.pct, 0)} %">${x.pct >= 12 ? fmt(x.pct, 0) + ' %' : ''}</span>`).join('')}</div>
      <table class="data"><thead><tr><th>Fase</th><th>Duración</th><th>% del ciclo</th></tr></thead><tbody>${a.summary.map(x => `<tr><td>${x.label}</td><td>${fmtS(x.dur)} s${Number.isFinite(x.durSd) ? ` ±${fmtS(x.durSd)}` : ''}</td><td>${fmt(x.pct, 0)} %${Number.isFinite(x.pctSd) ? ` ±${fmt(x.pctSd, 0)}` : ''}</td></tr>`).join('')}
      <tr><td><b>Ciclo</b></td><td><b>${fmtS(a.cycleDur)} s</b></td><td>${a.n} ciclo${a.n === 1 ? '' : 's'}</td></tr></tbody></table>`;
    }
    h += `<div class="table-wrap"><table class="data phase-cyc"><thead><tr><th>#</th>${['E', 'B', 'P', 'X', 'E2'].map(e => `<th title="${EVENT_LABEL[e]}">${EVENT_LABEL[e].split(' ')[0]}${e === 'E2' ? ' sig.' : ''}</th>`).join('')}<th></th></tr></thead><tbody>`;
    for (const c of a.cycles) {
      h += `<tr class="${c.ok ? '' : 'rej'}"><td>${c.n}</td>${['E', 'B', 'P', 'X', 'E2'].map(e => {
        const key = `${side}${c.n}:${e}`, f = c[e];
        return `<td>${f >= 0 ? `<button type="button" class="ev-btn${state.phaseSel === key ? ' on' : ''}${state.phaseEdits[key] != null ? ' edited' : ''}${c.unseen.includes(e) ? ' unseen' : ''}" data-ev="${key}" data-f="${f}">${fmtS(r.times[f])}</button>` : `<button type="button" class="ev-btn none${state.phaseSel === key ? ' on' : ''}" data-ev="${key}">–</button>`}</td>`;
      }).join('')}<td class="fine">${c.ok ? fmtS(c.dur) + ' s' : esc(c.reason)}</td></tr>`;
    }
    h += '</tbody></table></div>';
  }
  h += cycleCmpHtml(sp);
  h += '<div id="vel-box"></div>';
  const sel = state.phaseSel;
  if (sel) {
    const [, side, n, ev] = sel.match(/^([LR])(\d+):(\w+)$/);
    h += `<div class="phase-edit"><span class="fine">${EVENT_LABEL[ev]}, ciclo ${n} del brazo ${side === 'L' ? 'izquierdo' : 'derecho'}. Buscá el cuadro exacto con ← →.</span>
      <button class="btn small" id="ph-set" type="button">Mover al cuadro actual (${state.frame + 1})</button>
      ${state.phaseEdits[sel] != null ? '<button class="btn ghost small" id="ph-auto" type="button">Volver al automático</button>' : ''}</div>`;
  }
  h += `<p class="fine">Tiempos en segundos del video. Tocá un evento para ir a ese cuadro y corregirlo. Con línea punteada: evento en un cuadro sin la muñeca bien vista. Margen de cada evento: ±1 cuadro (±${fmt(1000 / r.meta.fps, 0)} ms).</p>
    <ul class="limits"><li><b>Entrada:</b> el agua no se ve en la pose; se toma la entrada cuando la muñeca pasa por debajo del nivel del hombro. Conviene revisarla cuadro a cuadro.</li>
    <li><b>Toma lateral:</b> la mano lejana a la cámara suele quedar tapada; usá el brazo cercano.</li></ul>`;
  box.innerHTML = h;
  box.querySelectorAll('[data-ev]').forEach(b => b.onclick = () => { state.phaseSel = state.phaseSel === b.dataset.ev ? null : b.dataset.ev; if (b.dataset.f) seekFrame(+b.dataset.f); phasesUi(); });
  bindCycleCmp(sp);
  velUi();
  if ($('ph-set')) $('ph-set').onclick = () => { state.phaseEdits[sel] = state.frame; phasesUi(); };
  if ($('ph-auto')) $('ph-auto').onclick = () => { delete state.phaseEdits[sel]; phasesUi(); };
  faultsUi();
  draw();
}
// ---------- segunda cámara (borde y subacuática juntas) ----------
// La otra toma se ve al lado (o en un recuadro) y sigue al video principal con un desfase: t₂ = t + desfase.
// El análisis (esqueleto, fases, métricas) es el de la toma principal; la segunda sirve para ver lo que esa
// no muestra, en el mismo instante. La fase de la brazada del video principal se muestra sobre la segunda.
const video2 = $('tc-video2'), C2 = { on: false, file: null, url: null, offset: 0, mode: 'below', linked: true, frameDur: 1 / 30, hint: '' };
const c2Target = () => video.currentTime + C2.offset;
function c2Sync(force) {
  if (!C2.on || !C2.linked || !video2.duration) return;
  const t2 = c2Target(), target = Math.max(0, Math.min(video2.duration - 1e-3, t2));
  if (video.paused) { if (force || Math.abs(video2.currentTime - target) > 1e-3) { video2.pause(); video2.currentTime = target; } }
  else if (Math.abs(video2.currentTime - target) > 0.06) video2.currentTime = target;
  c2Hud();
}
function c2Hud() {
  if (!C2.on) return;
  if (!C2.linked) { c2Free(); return; }
  const t2 = c2Target(), sp = state.phases, ph = sp && !sp.error ? phaseAt(sp, sp.best, state.frame) : null;
  $('tc-hud2').textContent = t2 < 0 || t2 > (video2.duration || 0) ? 'fuera de la segunda toma' : `toma 2 · ${fmt(t2, 3)} s${ph ? ` · ${ph.label.toLowerCase()}` : ''}`;
}
video.addEventListener('play', () => { if (C2.on && C2.linked) { video2.playbackRate = video.playbackRate; c2Sync(true); video2.play().catch(() => {}); } });
video.addEventListener('pause', () => { if (C2.on && C2.linked) { video2.pause(); c2Sync(true); } });
video.addEventListener('seeked', () => c2Sync(true));
video.addEventListener('timeupdate', () => c2Sync(false));
video.addEventListener('ratechange', () => { if (C2.linked) video2.playbackRate = video.playbackRate; });
function c2Mode(m) {
  C2.mode = m; $('tc-dual').dataset.mode = C2.on ? m : 'single';
  $('tc-dual').classList.toggle('free', C2.on && !C2.linked); $('tc-ctl2').hidden = !C2.on || C2.linked;
  requestAnimationFrame(() => resizeOverlay());
}
async function c2Load(file) {
  if (C2.url) URL.revokeObjectURL(C2.url);
  C2.file = file; C2.url = URL.createObjectURL(file);
  await new Promise((resolve, reject) => { video2.onloadeddata = resolve; video2.onerror = () => reject(new Error('Este navegador no puede leer la segunda toma.')); video2.src = C2.url; video2.load(); });
  const timing = await readFrameTimes(file).catch(() => null);
  C2.frameDur = timing?.frameDur || 1 / 30;
  $('tc-stage2').style.aspectRatio = `${video2.videoWidth} / ${video2.videoHeight}`;
  C2.on = true; $('tc-player2').hidden = false;
  const m = state.cam2meta;
  C2.linked = true;
  if (m && m.fileName === file.name) { C2.offset = m.offset; C2.mode = m.mode || C2.mode; C2.hint = 'Se recuperó el desfase guardado con esta evaluación.'; }
  else { C2.offset = 0; C2.hint = ''; }
  c2Saved(); c2Mode(C2.mode); c2Ui(); c2Sync(true);
}
function c2Reset(meta) {
  C2.on = false; C2.linked = true; video2.pause(); video2.removeAttribute('src'); video2.load();
  $('tc-player2').hidden = true; state.cam2meta = meta || null; C2.hint = '';
  c2Mode(C2.mode); c2Ui();
}
// Juntas o cada una por su lado. Al volver a juntarlas, el desfase sale de dónde quedó cada una.
function c2Link(on) {
  if (!C2.on || on === C2.linked) return;
  video.pause(); video2.pause();
  if (on) {
    C2.offset = Math.round((video2.currentTime - video.currentTime) * 1e4) / 1e4;
    C2.hint = `Quedaron juntas con un desfase de ${c2Off(C2.offset)}, tomado de la posición de cada una. Precisión: ±1 cuadro de la toma con menos cuadros por segundo.`;
    C2.linked = true; video2.playbackRate = video.playbackRate;
  } else {
    C2.linked = false; C2.hint = '';
    video2.playbackRate = +$('c2-speed').value;
    if (C2.mode === 'pip') C2.mode = 'below';
  }
  c2Saved(); c2Mode(C2.mode); c2Ui(); if (on) c2Sync(true); else c2Free();
}
// Controles propios de la segunda toma (modo "cada una por su lado").
function c2Free() {
  const d = video2.duration || 0, t = video2.currentTime;
  $('c2-time').textContent = `${fmt(t, 3)} s`;
  if (document.activeElement !== $('c2-seek')) $('c2-seek').value = d ? Math.round(1000 * t / d) : 0;
  $('c2-play-ico').setAttribute('d', video2.paused ? 'M7 5l12 7-12 7z' : 'M7 5h4v14H7zM13 5h4v14h-4z');
  $('tc-hud2').textContent = `toma 2 · ${fmt(t, 3)} s · por su lado`;
}
const c2Step = (k) => { video2.pause(); video2.currentTime = Math.max(0, Math.min((video2.duration || 0) - 1e-3, video2.currentTime + k * C2.frameDur)); };
$('c2-prev').onclick = () => c2Step(-1);
$('c2-next').onclick = () => c2Step(1);
$('c2-play').onclick = () => { if (video2.paused) video2.play().catch(() => {}); else video2.pause(); };
$('c2-speed').onchange = () => { if (!C2.linked) video2.playbackRate = +$('c2-speed').value; };
$('c2-seek').oninput = () => { video2.pause(); if (video2.duration) video2.currentTime = video2.duration * $('c2-seek').value / 1000; };
['timeupdate', 'seeked', 'play', 'pause'].forEach(ev => video2.addEventListener(ev, () => { if (C2.on && !C2.linked) c2Free(); }));
function c2Saved() { if (C2.on) state.cam2meta = { fileName: C2.file.name, offset: C2.offset, mode: C2.mode }; }
const c2Off = (v) => `${v >= 0 ? '+' : '−'}${fmt(Math.abs(v), 3)} s`;
function c2Ui() {
  const box = $('tc-cam2');
  if (!C2.on) {
    box.innerHTML = `<p class="fine">Sumá la otra toma del mismo momento (por ejemplo, la subacuática si analizaste la del borde) para verlas juntas y sincronizadas. El análisis sigue siendo el de la toma principal. Filmala con los mismos cuadros por segundo que la principal, o más: la sincronización se ajusta de a un cuadro.${state.cam2meta ? ` Esta evaluación se guardó con "${esc(state.cam2meta.fileName)}" (desfase ${c2Off(state.cam2meta.offset)}): elegí ese archivo y se sincroniza solo.` : ''}</p>
      <label class="btn ghost small file-btn"><svg width="16" height="16"><use href="#i-video"/></svg>Agregar la otra toma<input type="file" id="tc-cam2-file" accept="video/mp4,video/quicktime,video/webm,video/*"></label>`;
  } else {
    box.innerHTML = `<div class="v2-row"><span class="mono v2-name">${esc(C2.file.name)}</span><button class="btn ghost small" id="tc-cam2-remove" type="button">Quitar</button></div>
      <div class="segmented" role="tablist" aria-label="Cómo ver las dos tomas"><button type="button" role="tab" data-c2mode="below" aria-selected="${C2.mode === 'below'}">Abajo</button><button type="button" role="tab" data-c2mode="side" aria-selected="${C2.mode === 'side'}">Lado a lado</button><button type="button" role="tab" data-c2mode="pip" aria-selected="${C2.mode === 'pip'}"${C2.linked ? '' : ' disabled'}>Recuadro</button></div>
      <div class="segmented" role="tablist" aria-label="Reproducción de la segunda toma"><button type="button" role="tab" data-c2link="1" aria-selected="${C2.linked}">Juntas</button><button type="button" role="tab" data-c2link="0" aria-selected="${!C2.linked}">Cada una por su lado</button></div>
      <p class="fine">${C2.linked ? 'Juntas: los controles de arriba mueven las dos tomas con el desfase de abajo.' : 'Cada una por su lado: la segunda toma tiene sus propios controles (play, velocidad, cuadro a cuadro). Poné las dos en el mismo instante y tocá "Juntas": el desfase queda fijado en esa posición.'}</p>
      <div${C2.linked ? '' : ' hidden'} class="v2-row"><span class="fine-label">Desfase de la segunda toma</span><b class="mono" id="tc-cam2-off">${c2Off(C2.offset)}</b></div>
      <div${C2.linked ? '' : ' hidden'} class="clip-actions"><button class="btn ghost small" data-c2step="-0.1" type="button">−0,1 s</button><button class="btn ghost small" data-c2step="-1f" type="button">−1 cuadro</button><button class="btn ghost small" data-c2step="1f" type="button">+1 cuadro</button><button class="btn ghost small" data-c2step="0.1" type="button">+0,1 s</button></div>
      <div${C2.linked ? '' : ' hidden'} class="clip-actions"><button class="btn small" id="tc-cam2-auto" type="button">Sincronizar por el sonido</button></div>
      <p class="fine" id="tc-cam2-hint"${C2.linked ? '' : ' hidden'}>${esc(C2.hint || 'Para ajustar a mano: pausá en un momento que se vea en las dos tomas (un aplauso, la entrada de una mano, el toque en la pared) y mové la segunda cuadro a cuadro hasta que coincidan. Precisión: ±1 cuadro de la toma con menos cuadros por segundo.')}</p>`;
  }
  if ($('tc-cam2-file')) $('tc-cam2-file').onchange = async (e) => { const f = e.target.files[0]; e.target.value = ''; if (!f) return; try { await c2Load(f); } catch (err) { notify(err.message); } };
  if ($('tc-cam2-remove')) $('tc-cam2-remove').onclick = () => c2Reset(null);
  box.querySelectorAll('[data-c2mode]').forEach(b => b.onclick = () => { c2Mode(b.dataset.c2mode); c2Saved(); c2Ui(); });
  box.querySelectorAll('[data-c2link]').forEach(b => b.onclick = () => c2Link(b.dataset.c2link === '1'));
  box.querySelectorAll('[data-c2step]').forEach(b => b.onclick = () => {
    video.pause();
    const st = b.dataset.c2step, d = st.endsWith('f') ? parseFloat(st) * C2.frameDur : parseFloat(st);
    C2.offset = Math.round((C2.offset + d) * 1e4) / 1e4; C2.hint = '';
    c2Saved(); $('tc-cam2-off').textContent = c2Off(C2.offset); c2Sync(true);
  });
  if ($('tc-cam2-auto')) $('tc-cam2-auto').onclick = async () => {
    const btn = $('tc-cam2-auto'); btn.disabled = true; btn.textContent = 'Comparando el sonido de las dos tomas…';
    try {
      const r = await audioOffset(state.techFile || state.file, C2.file);
      if (r.reliable) { C2.offset = Math.round(r.offset * 1e4) / 1e4; C2.hint = `Sincronizado por el sonido (coincidencia ${fmt(r.ratio, 1)} veces más fuerte que la siguiente). Verificalo en un momento que se vea en las dos tomas y corregí cuadro a cuadro si hace falta.`; }
      else C2.hint = `El sonido de las dos tomas no coincide con claridad${Number.isFinite(r.offset) ? ` (el mejor desfase, ${c2Off(r.offset)}, no se distingue de otros)` : ''}. Puede que una cámara no haya grabado sonido o que esté bajo el agua. Sincronizá a mano: un aplauso fuerte frente a las dos cámaras al empezar ayuda mucho.`;
      c2Saved(); video.pause(); c2Sync(true);
    } catch (err) { C2.hint = err.message + ' Sincronizá a mano con los botones.'; }
    c2Ui();
  };
}
c2Ui();

// ---------- velocidad dentro del ciclo, por fase ----------
// La escala son dos puntos a una distancia conocida en la dirección del nado (marcas de la corchera, banderines)
// marcados sobre el video; se guardan en píxeles del cuadro donde se marcaron.
const VEL_POINT_LABEL = { hip: 'Cadera', head: 'Cabeza', shoulder: 'Hombros' };
function velUi() {
  const box = $('vel-box'), r = state.result;
  const V = state.vel ||= { scale: null, point: 'hip', mark: null };
  const sp = state.phases;
  const sc = V.scale ? swimScale(V.scale, camOf(r)) : null;
  const res = state.velRes = sc && sp && !sp.error ? phaseVelocity(r, sp, sc, V.point, camOf(r)) : null;
  velMetrics(res, sc);
  renderMetrics(r);
  if (!box) return;
  const mark = V.mark;
  const ctrl = `<div class="fields vel-ctrl"><label>Distancia entre las marcas<input type="text" inputmode="decimal" id="vel-d" value="${String(mark?.D ?? V.scale?.D ?? 5).replace('.', ',')}"> m</label>
    <label>Punto del cuerpo<select id="vel-point">${Object.entries(VEL_POINT_LABEL).map(([k, l]) => `<option value="${k}"${k === V.point ? ' selected' : ''}>${l}</option>`).join('')}</select></label></div>
    <div class="clip-actions"><button class="btn small${sc ? ' ghost' : ''}" id="vel-mark" type="button">${mark ? `Tocá la marca ${mark.pts.length + 1} de 2…` : sc ? 'Volver a marcar la escala' : 'Marcar 2 puntos en el video'}</button>${mark ? '<button class="btn ghost small" id="vel-cancel" type="button">Cancelar</button>' : ''}${sc && !mark ? '<button class="linkish" id="vel-clear" type="button">Quitar la escala</button>' : ''}</div>`;
  let h = `<div class="mgroup">Velocidad dentro del ciclo</div>`;
  if (!sc) {
    h += `<p class="metric-detail">Para medir en qué fase gana o pierde velocidad el nadador hace falta una distancia conocida en la toma: dos marcas en la dirección del nado y a la misma distancia de la cámara que el nadador (por ejemplo, dos cambios de color de su corchera o dos banderines). Pará el video en un cuadro donde se vean, escribí la distancia y tocá las dos marcas.</p>${ctrl}`;
    box.innerHTML = h; bindVel(); return;
  }
  const u = (v, d = 2) => fmt(v, d);
  const pm = (x, d = 2) => Number.isFinite(x) ? ` <small>±${u(1.96 * x, d)}</small>` : '';
  if (!res || res.error) {
    h += `<p class="metric-detail">Escala: ${u(V.scale.D, 1)} m = ${fmt(sc.px, 0)} px (1 px = ${u(100 * sc.mpp, 2)} cm). ${esc(res?.error || 'Hacen falta las fases de la brazada.')}</p>${ctrl}`;
    box.innerHTML = h; bindVel(); return;
  }
  const scalePct = 100 * 1.96 * res.scaleRel;
  h += `<p class="metric-detail">${VEL_POINT_LABEL[res.point]}, brazo ${res.side === 'L' ? 'izquierdo' : 'derecho'}, ${res.n} ciclos. Cada velocidad es lo que avanza el punto entre los dos eventos de la fase, dividido por su duración; ± es el margen del 95 % entre ciclos.</p>
    <div class="table-wrap"><table class="data"><thead><tr><th>Fase</th><th>Velocidad</th><th>% del ciclo</th><th>Error de la pose</th></tr></thead><tbody>
    ${res.phases.map((p, k) => `<tr${p.id === res.slowest ? ' class="vel-slow"' : ''}><td><i class="dot" style="background:${PHASE_COLORS[k]}"></i>${esc(p.label)}${p.id === res.slowest ? ' <small>(la más lenta)</small>' : ''}</td><td class="mono">${u(p.v)} m/s${pm(p.se)}</td><td>${fmt(p.pct, 0)} %</td><td class="mono">±${u(1.96 * p.meas)} m/s</td></tr>`).join('')}
    <tr><td><b>Ciclo completo</b></td><td class="mono"><b>${u(res.cycle.v)} m/s</b>${pm(res.cycle.se)}</td><td>${fmtS(res.cycleDur)} s</td><td class="mono">±${u(1.96 * res.cycle.meas)} m/s</td></tr></tbody></table></div>
    <div id="vel-chart"></div>
    <p class="metric-detail">Distancia por ciclo ${u(res.dpc.v)} m${pm(res.dpc.se)}. Variación de la velocidad dentro del ciclo ${fmt(res.ivv, 0)} % (desvío sobre la media)${Number.isFinite(res.vNoise) ? `; el ruido de la pose solo ya aporta unos ${u(res.vNoise)} m/s de desvío, así que una parte de esa variación puede ser ruido` : ''}.</p>
    <p class="fine">Escala ${u(V.scale.D, 1)} m = ${fmt(sc.px, 0)} px: marcar cada punto con ±1 px de error suma ±${fmt(scalePct, 1)} % a todas las velocidades. Ruido de la posición del punto en este video: ${fmt(100 * res.sigmaX, 1)} cm. Si las marcas están más cerca o más lejos de la cámara que el nadador, todas las velocidades se corren en la misma proporción. La cadera bajo el agua es el punto menos preciso de la pose.</p>${ctrl}`;
  box.innerHTML = h;
  velChart($('vel-chart'), res, sp);
  bindVel();
}
function bindVel() {
  const V = state.vel;
  $('vel-point').onchange = (e) => { V.point = e.target.value; velUi(); };
  $('vel-mark').onclick = () => { if (V.mark) return; const D = parseFloat($('vel-d').value.replace(',', '.')); if (!(D > 0)) { $('vel-d').focus(); return; } video.pause(); V.mark = { D, pts: [] }; overlay.classList.add('tool'); velUi(); };
  if ($('vel-cancel')) $('vel-cancel').onclick = () => { V.mark = null; overlay.classList.remove('tool'); velUi(); draw(); };
  if ($('vel-clear')) $('vel-clear').onclick = () => { V.scale = null; velUi(); draw(); };
}
overlay.addEventListener('click', (e) => {
  const V = state.vel;
  if (!V?.mark) return;
  e.stopImmediatePropagation(); e.preventDefault();
  const rect = overlay.getBoundingClientRect(), r = state.result;
  V.mark.pts.push([(e.clientX - rect.left) / rect.width * r.meta.width, (e.clientY - rect.top) / rect.height * r.meta.height]);
  if (V.mark.pts.length === 2) {
    const s = { p1: V.mark.pts[0], p2: V.mark.pts[1], D: V.mark.D, frame: state.frame };
    if (swimScale(s)) V.scale = s; else notify('Las dos marcas quedaron demasiado juntas. Marcalas más separadas.');
    V.mark = null; overlay.classList.remove('tool');
  }
  velUi(); draw();
}, true);
// Escala sobre el video: los puntos marcados (y, con la cámara compensada, llevados al cuadro actual).
function drawVel(ctx, r, i, scale, dpr) {
  const V = state.vel;
  if (!V) return;
  const pts = V.mark ? V.mark.pts : V.scale && !$('tab-phases').hidden ? [V.scale.p1, V.scale.p2].map(p => between(camOf(r), V.scale.frame, i, p)) : [];
  if (!pts.length) return;
  ctx.save(); ctx.strokeStyle = '#3ad1ff'; ctx.fillStyle = '#3ad1ff'; ctx.lineWidth = 2 * dpr;
  pts.forEach((p, k) => { ctx.beginPath(); ctx.arc(p[0] * scale, p[1] * scale, 5 * dpr, 0, Math.PI * 2); ctx.fill(); if (k) { ctx.setLineDash([6 * dpr, 4 * dpr]); ctx.beginPath(); ctx.moveTo(pts[0][0] * scale, pts[0][1] * scale); ctx.lineTo(p[0] * scale, p[1] * scale); ctx.stroke(); } });
  if (pts.length === 2 && V.scale && !V.mark) { ctx.font = `${12 * dpr}px system-ui`; ctx.fillText(`${String(V.scale.D).replace('.', ',')} m`, (pts[0][0] + pts[1][0]) / 2 * scale + 6 * dpr, (pts[0][1] + pts[1][1]) / 2 * scale - 8 * dpr); }
  ctx.restore();
}
// La velocidad media y la distancia por ciclo pasan a ser métricas (con su error) cuando hay escala.
function velMetrics(res, sc) {
  const r = state.result, sp = r.metrics.find(x => x.id === 'speed'), sl = r.metrics.find(x => x.id === 'strokeLength');
  const na = (why) => ({ value: null, unit: null, status: 'no disponible', confidence: null, se: null, n: null, detail: why });
  if (!res || res.error) {
    const why = !sc ? 'Requiere una distancia conocida en la toma: se marca en la pestaña Fases, sección Velocidad dentro del ciclo.' : res?.error || 'Hacen falta las fases de la brazada.';
    if (sp) Object.assign(sp, na(why)); if (sl) Object.assign(sl, na(why));
    return;
  }
  const tot = (v, se) => Math.hypot(Number.isFinite(se) ? se : 0, v * res.scaleRel);
  const conf = res.n >= 4 && res.sigmaX < 0.03 ? 'media' : 'baja';
  if (sp) Object.assign(sp, { value: res.cycle.v, unit: 'm/s', status: 'estimado', confidence: conf, se: tot(res.cycle.v, res.cycle.se), n: res.n, detail: `Media de ${res.n} ciclos, de lo que avanza la ${VEL_POINT_LABEL[res.point].toLowerCase()} de entrada a entrada, con la escala marcada en la toma (incluye el error de la escala).` });
  if (sl) Object.assign(sl, { value: res.dpc.v, unit: 'm', status: 'estimado', confidence: conf, se: tot(res.dpc.v, res.dpc.se), n: res.n, detail: `Distancia que avanza el nadador en un ciclo completo del mismo brazo (media de ${res.n} ciclos).` });
}
function velChart(box, res, sp) {
  if (!box) return;
  const W = Math.max(300, box.clientWidth || 520), H = 190, L = 44, R = 10, T = 10, B = 26;
  const pts = res.curve.filter(c => Number.isFinite(c.v));
  if (pts.length < 10) { box.innerHTML = ''; return; }
  const lo = Math.min(...pts.map(c => c.v - (c.sd || 0))), hi = Math.max(...pts.map(c => c.v + (c.sd || 0)));
  const y0 = Math.floor(lo * 10) / 10, y1 = Math.ceil(hi * 10) / 10;
  const X = (p) => L + (W - L - R) * p / 100, Y = (v) => T + 8 + (H - T - 8 - B) * (1 - (v - y0) / Math.max(0.1, y1 - y0));
  const band = pts.filter(c => Number.isFinite(c.sd));
  const area = band.length > 2 ? `M${band.map(c => `${X(c.pct).toFixed(1)},${Y(c.v + c.sd).toFixed(1)}`).join('L')}L${band.slice().reverse().map(c => `${X(c.pct).toFixed(1)},${Y(c.v - c.sd).toFixed(1)}`).join('L')}Z` : '';
  let acc = 0;
  const bounds = res.phases.map((p, k) => { const a = acc; acc += p.pct; return { a, b: acc, k }; });
  const ticks = []; for (let v = y0; v <= y1 + 1e-9; v += (y1 - y0) > 0.8 ? 0.2 : 0.1) ticks.push(+v.toFixed(2));
  box.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="100%" class="vel-svg" role="img" aria-label="Velocidad media a lo largo del ciclo">
    ${bounds.map(bd => `<rect x="${X(bd.a).toFixed(1)}" y="${T + 8}" width="${(X(bd.b) - X(bd.a)).toFixed(1)}" height="${H - T - 8 - B}" fill="${PHASE_COLORS[bd.k]}" opacity="0.08"/>`).join('')}
    ${ticks.map(v => `<line x1="${L}" x2="${W - R}" y1="${Y(v).toFixed(1)}" y2="${Y(v).toFixed(1)}" stroke="var(--line)"/><text x="${L - 6}" y="${(Y(v) + 4).toFixed(1)}" text-anchor="end" class="ax">${fmt(v, 1)}</text>`).join('')}
    ${area ? `<path d="${area}" fill="var(--accent)" opacity="0.15"/>` : ''}
    <path d="M${pts.map(c => `${X(c.pct).toFixed(1)},${Y(c.v).toFixed(1)}`).join('L')}" fill="none" stroke="var(--accent)" stroke-width="2"/>
    ${[0, 25, 50, 75, 100].map(p => `<text x="${X(p).toFixed(1)}" y="${H - 8}" text-anchor="middle" class="ax">${p} %</text>`).join('')}
    <text x="2" y="${T + 4}" class="ax">m/s</text></svg>
    <p class="fine">Velocidad media de los ${res.n} ciclos a lo largo del ciclo (0 % = entrada de la mano), con la banda de ±1 desvío entre ciclos. Los colores de fondo son las fases medias.</p>`;
}
// ---------- errores técnicos con evidencia (las fases corregidas a mano cambian el agarre y el codo) ----------
function faultsUi() {
  const r = state.result, m = r.meta;
  const res = renderFaults($('tab-faults'), { r, phases: state.phases, decisions: state.faultDecisions ||= {}, sourceKey: `tech:${m.fileName}:${m.analyzedAt}`, onSeek: seekFrame, onChange: faultsUi });
  state.faults = res.list;
  $('tc-faults').textContent = res.count || '';
}
// ---------- dos ciclos superpuestos, alineados por fase ----------
const okCycles = (sp) => ['L', 'R'].flatMap(side => sp.arms[side].cycles.filter(c => c.ok).map(c => ({ key: side + c.n, side, c })));
function cycleSel(sp) {
  const list = okCycles(sp), best = list.filter(x => x.side === sp.best);
  const cc = state.cc ||= {};
  if (!list.some(x => x.key === cc.a)) cc.a = (best[0] || list[0])?.key;
  if (!list.some(x => x.key === cc.b) || cc.b === cc.a) cc.b = (best.length > 1 ? best[best.length - 1] : list.find(x => x.key !== cc.a))?.key;
  const A = list.find(x => x.key === cc.a), B = list.find(x => x.key === cc.b);
  const ids = [...ANGLE_DEFS, ...EXTRA_SERIES].map(d => d.id).filter(id => state.result.angles[id] && state.result.angleSummary[id]?.validFrames > 10);
  if (!ids.includes(cc.s)) cc.s = ids.find(id => id === 'elbow' + (A?.side || 'L')) || ids[0];
  return { list, A, B, ids };
}
function cycleCmpHtml(sp) {
  const { list, A, B, ids } = cycleSel(sp);
  if (list.length < 2) return '<div class="mgroup">Comparar dos ciclos</div><p class="metric-detail">Hacen falta al menos dos ciclos con las cuatro fases a la vista.</p>';
  const lab = SERIES_LABEL(), name = (x) => `${x.side === 'L' ? 'Izq.' : 'Der.'} ciclo ${x.c.n} · ${fmtS(state.result.times[x.c.E])} s`;
  const opts = (v) => list.map(x => `<option value="${x.key}"${x.key === v ? ' selected' : ''}>${name(x)}</option>`).join('');
  return `<div class="mgroup">Comparar dos ciclos, alineados por fase</div>
    <div class="fields cc-ctrl"><label>Ciclo A<select id="cc-a">${opts(A.key)}</select></label><label>Ciclo B<select id="cc-b">${opts(B.key)}</select></label>
    <label>Medida<select id="cc-s">${ids.map(id => `<option value="${id}"${id === state.cc.s ? ' selected' : ''}>${esc(lab[id])}</option>`).join('')}</select></label></div>
    <label class="check"><input type="checkbox" id="cc-ghost"${state.cc.ghost ? ' checked' : ''}> Superponer en el video el esqueleto del ciclo B (mientras se reproduce el A)</label>
    <div id="cc-out"></div>`;
}
function bindCycleCmp(sp) {
  if (!$('cc-a')) return;
  const redo = () => { phasesUi(); };
  $('cc-a').onchange = (e) => { state.cc.a = e.target.value; redo(); };
  $('cc-b').onchange = (e) => { state.cc.b = e.target.value; redo(); };
  $('cc-s').onchange = (e) => { state.cc.s = e.target.value; redo(); };
  $('cc-ghost').onchange = (e) => { state.cc.ghost = e.target.checked; if (state.cc.ghost) seekFrame(cycleSel(sp).A.c.E); draw(); };
  const { list, A, B } = cycleSel(sp), r = state.result;
  const all = list.filter(x => x.side === A.side).map(x => x.c);
  const res = compareCycles(r.angles[state.cc.s].values, A.c, B.c, all.length >= 3 ? all : [A.c, B.c], r.times);
  const W = Math.max(300, $('cc-out').clientWidth || 520), H = 200, L = 40, R = 10, T = 10, Bm = 26;
  const vals = [...res.a, ...res.b].filter(Number.isFinite);
  if (!vals.length) { $('cc-out').innerHTML = '<p class="fine">Esa medida no se vio en estos ciclos.</p>'; return; }
  let y0 = Math.min(...vals), y1 = Math.max(...vals); const pad = Math.max(5, (y1 - y0) * 0.1); y0 = Math.floor((y0 - pad) / 10) * 10; y1 = Math.ceil((y1 + pad) / 10) * 10;
  const X = (u) => L + u / 100 * (W - L - R), Y = (v) => T + (1 - (v - y0) / (y1 - y0)) * (H - T - Bm), N = res.a.length - 1;
  const path = (cv) => { let d = '', on = false; cv.forEach((v, k) => { if (!Number.isFinite(v)) { on = false; return; } d += `${on ? 'L' : 'M'}${X(100 * k / N).toFixed(1)},${Y(v).toFixed(1)}`; on = true; }); return d; };
  let band = '';
  const up = [], dn = [];
  res.a.forEach((v, k) => { if (Number.isFinite(v) && Number.isFinite(res.band[k])) { up.push(`${X(100 * k / N).toFixed(1)},${Y(v + res.band[k]).toFixed(1)}`); dn.unshift(`${X(100 * k / N).toFixed(1)},${Y(v - res.band[k]).toFixed(1)}`); } });
  if (up.length > 2) band = `<polygon points="${up.concat(dn).join(' ')}" class="cc-band"/>`;
  const bands = PHASES.map((p, k) => `<rect x="${X(res.ref[k])}" y="${T}" width="${X(res.ref[k + 1]) - X(res.ref[k])}" height="${H - T - Bm}" fill="${PHASE_COLORS[k]}" opacity="0.08"/><text x="${(X(res.ref[k]) + X(res.ref[k + 1])) / 2}" y="${H - 8}" text-anchor="middle" class="evo-tick">${p.label.split(' ')[0]}</text>`).join('');
  const ticks = []; for (let v = y0; v <= y1; v += (y1 - y0) / 4) ticks.push(v);
  const grid = ticks.map(v => `<line x1="${L}" x2="${W - R}" y1="${Y(v)}" y2="${Y(v)}" class="evo-grid"/><text x="${L - 6}" y="${Y(v) + 4}" text-anchor="end" class="evo-tick">${fmt(v, 0)}</text>`).join('');
  const nm = (x) => `${x.side === 'L' ? 'izq.' : 'der.'} ${x.c.n}`;
  $('cc-out').innerHTML = `<div class="cc-legend"><span><i class="cc-a"></i>A · ciclo ${nm(A)}</span><span><i class="cc-b"></i>B · ciclo ${nm(B)}</span>${band ? '<span><i class="cc-bandkey"></i>variación normal entre ciclos (±1 desvío)</span>' : ''}</div>
    <svg viewBox="0 0 ${W} ${H}" class="cc-chart" role="img" aria-label="Dos ciclos alineados por fase">${bands}${grid}${band}<path d="${path(res.a)}" class="cc-line-a"/><path d="${path(res.b)}" class="cc-line-b"/></svg>
    <table class="data"><thead><tr><th>Fase</th><th>A</th><th>B</th><th>B − A</th><th>Variación normal</th></tr></thead><tbody>${res.phases.map(p => `<tr><td>${p.label}</td><td>${fmt(p.a, 0)}°</td><td>${fmt(p.b, 0)}°</td><td class="${Number.isFinite(p.spread) && Math.abs(p.d) > 2 * p.spread ? 'worse' : ''}">${Number.isFinite(p.d) ? (p.d > 0 ? '+' : '') + fmt(p.d, 0) + '°' : '–'}</td><td>${Number.isFinite(p.spread) ? '±' + fmt(p.spread, 0) + '°' : '–'}</td></tr>`).join('')}</tbody></table>
    <p class="fine">Eje horizontal: % del ciclo alineado. Cada ciclo se estira o comprime por tramos para que entrada, inicio de la tracción, mano bajo el hombro y salida caigan en el mismo lugar; así se compara la misma parte de la brazada. Media de la medida en cada fase. En rojo, diferencias de más del doble de lo que varían normalmente los ciclos de este video (${all.length} ciclos del mismo brazo${all.length < 3 ? ': con menos de 3 no se puede estimar' : ''}). Ángulos 2D en el plano de la imagen.</p>`;
}
function drawCycleGhost(ctx, r, i, scale, dpr) {
  const sp = state.phases;
  if (!sp || sp.error) return;
  const { A, B } = cycleSel(sp);
  if (!A || !B) return;
  const g = ghostSkeleton(r.tracks, A.c, B.c, refPercents([A.c, B.c], r.times), i);
  if (!g) return;
  ctx.save();
  ctx.strokeStyle = '#ff5ea8'; ctx.lineWidth = 2.4 * dpr; ctx.setLineDash([6 * dpr, 4 * dpr]); ctx.globalAlpha = 0.95;
  for (const [a, b] of SKELETON) { const p = g.pts[a], q = g.pts[b]; if (!p || !q) continue; ctx.beginPath(); ctx.moveTo(p[0] * scale, p[1] * scale); ctx.lineTo(q[0] * scale, q[1] * scale); ctx.stroke(); }
  ctx.setLineDash([]);
  const label = `Ciclo B superpuesto · ${fmt(g.u, 0)} % del ciclo`;
  ctx.font = `600 ${12 * dpr}px "Instrument Sans", system-ui, sans-serif`;
  ctx.fillStyle = 'rgba(4,10,16,0.75)'; ctx.fillRect(10 * dpr, 10 * dpr + 30 * dpr, ctx.measureText(label).width + 16 * dpr, 22 * dpr);
  ctx.fillStyle = '#ff5ea8'; ctx.fillText(label, 18 * dpr, 10 * dpr + 30 * dpr + 15 * dpr);
  ctx.restore();
}

// la etiqueta del cuadro actual del botón Mover se actualiza al cambiar de cuadro
function phaseSelUi() { const b = $('ph-set'); if (b) b.textContent = `Mover al cuadro actual (${state.frame + 1})`; }
function drawPhaseTag(ctx, i, dpr) {
  const side = state.trajSide || state.phases.best, p = phaseAt(state.phases, side, i) || phaseAt(state.phases, side === 'L' ? 'R' : 'L', i);
  if (!p) return;
  const label = `${p.label}`, sub = `ciclo ${p.cycle}`;
  ctx.save();
  ctx.font = `600 ${13 * dpr}px "Instrument Sans", system-ui, sans-serif`;
  const w = ctx.measureText(label).width + ctx.measureText(sub).width * 0.85 + 34 * dpr, x = 10 * dpr, y = overlay.height - 36 * dpr;
  ctx.fillStyle = 'rgba(4,10,16,0.78)'; ctx.fillRect(x, y, w, 26 * dpr);
  ctx.fillStyle = p.color; ctx.fillRect(x + 8 * dpr, y + 8 * dpr, 10 * dpr, 10 * dpr);
  ctx.fillStyle = '#fff'; ctx.fillText(label, x + 24 * dpr, y + 18 * dpr);
  ctx.font = `500 ${11 * dpr}px "Geist Mono", monospace`; ctx.fillStyle = 'rgba(255,255,255,0.7)';
  ctx.fillText(sub, x + 30 * dpr + ctx.measureText(label).width * 1.12, y + 18 * dpr);
  ctx.restore();
}

// ---------- dibujo y texto ----------
$('tc-draw').innerHTML = drawPanelHtml('tc-draw');
const techDraw = bindDrawing(overlay, $('tc-draw'), 'tc-draw', {
  list: () => state.drawings, now: () => state.result.times[state.frame], frameDur: () => 1 / state.result.meta.fps,
  videoSize: () => [state.result.meta.width, state.result.meta.height], editing: () => $('tc-draw-box').open,
  changed: () => {}, redraw: draw, pause: () => video.pause(),
});
$('tc-draw-box').addEventListener('toggle', () => { if (!$('tc-draw-box').open) techDraw.off(); });

// ---------- gráfico sincronizado ----------
const chart = $('chart');

function seriesFor(r, id) {
  if (id === 'armL' || id === 'armR') {
    const v = r.armSignals[id === 'armL' ? 'L' : 'R'];
    return { values: v, conf: v.map(x => (Number.isFinite(x) ? 1 : 0)), interp: v.map(() => false), unit: '× tronco', arm: id.slice(3) };
  }
  const s = r.angles[id];
  return { ...s, unit: '°', arm: /L$/.test(id) ? 'L' : /R$/.test(id) ? 'R' : null };
}

export function renderChart(canvas, r, ids, cursor, colors, sizeOverride) {
  if (!Array.isArray(ids)) ids = [ids];
  const dpr = sizeOverride ? 1 : (window.devicePixelRatio || 1);
  const W = sizeOverride ? sizeOverride.w : canvas.clientWidth, H = sizeOverride ? sizeOverride.h : canvas.clientHeight;
  canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);
  if (colors.bg) { ctx.fillStyle = colors.bg; ctx.fillRect(0, 0, W, H); }
  const all = ids.map(id => seriesFor(r, id));
  const s0 = all[0];
  const tint = (k) => (colors.series && colors.series[k]) || colors.accent;
  const t = r.times;
  const pad = { l: 40, r: 10, t: 10, b: 22 };
  const ghosts = (colors.ghost || []).map(g => ({ ...g, v: g.v.map(x => (x == null ? NaN : x)) }));
  const vals = all.flatMap(s => s.values.filter(Number.isFinite)).concat(ghosts.flatMap(g => g.v.filter(Number.isFinite)));
  let lo = Math.min(...vals), hi = Math.max(...vals);
  if (!vals.length) { lo = 0; hi = 1; }
  if (s0.unit === '°') {
    // los ángulos articulares van de 0 a 180; la inclinación del tronco puede ser negativa
    const floor = ids.includes('trunkIncl') ? -90 : 0;
    lo = Math.max(floor, Math.floor(lo / 10) * 10); hi = Math.min(180, Math.ceil(hi / 10) * 10); if (hi - lo < 20) hi = lo + 20;
  }
  else { const m = (hi - lo) * 0.1 || 0.1; lo -= m; hi += m; }
  const t0 = t[0], t1 = t[t.length - 1] || 1;
  const X = (x) => pad.l + (x - t0) / (t1 - t0 || 1) * (W - pad.l - pad.r);
  const Y = (y) => pad.t + (1 - (y - lo) / (hi - lo)) * (H - pad.t - pad.b);
  ctx.font = '10.5px "Geist Mono", monospace';
  ctx.strokeStyle = colors.grid; ctx.fillStyle = colors.text2; ctx.lineWidth = 1;
  const ticks = 4;
  for (let k = 0; k <= ticks; k++) {
    const v = lo + (hi - lo) * k / ticks;
    const y = Math.round(Y(v)) + 0.5;
    ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(W - pad.r, y); ctx.stroke();
    ctx.fillText(s0.unit === '°' ? `${Math.round(v)}°` : v.toFixed(2), 2, y + 3);
  }
  const step = (t1 - t0) > 30 ? 10 : (t1 - t0) > 10 ? 5 : 1;
  for (let x = Math.ceil(t0 / step) * step; x <= t1; x += step) ctx.fillText(`${x}s`, X(x) - 6, H - 6);
  // ciclos del brazo correspondiente
  const arm = s0.arm || (r.arms.L.cycles.filter(c => c.accepted).length >= r.arms.R.cycles.filter(c => c.accepted).length ? 'L' : 'R');
  const cyc = r.arms[arm].cycles;
  const marks = new Set();
  for (const c of cyc) { if (c.accepted) { marks.add(c.start); marks.add(c.end); } }
  ctx.strokeStyle = colors.text2; ctx.setLineDash([2, 3]);
  for (const k of marks) { const x = Math.round(X(t[k])) + 0.5; ctx.beginPath(); ctx.moveTo(x, pad.t); ctx.lineTo(x, H - pad.b); ctx.stroke(); }
  ctx.setLineDash([]);
  // momentos clave marcados: línea y número arriba
  for (const m of colors.moments || []) {
    const x = Math.round(X(t[m.frame])) + 0.5;
    ctx.strokeStyle = colors.text; ctx.globalAlpha = 0.55; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x, pad.t + 12); ctx.lineTo(x, H - pad.b); ctx.stroke(); ctx.globalAlpha = 1;
    ctx.font = '600 10px "Geist Mono", monospace'; ctx.fillStyle = colors.text;
    const lab = String(m.n), w = ctx.measureText(lab).width;
    ctx.fillText(lab, Math.max(pad.l, Math.min(W - pad.r - w, x - w / 2)), pad.t + 8);
  }
  // series: dato confiable en línea llena, interpolado en punteado más tenue
  ctx.lineWidth = 2;
  all.forEach((s, k) => {
    for (let i = 1; i < t.length; i++) {
      const a = s.values[i - 1], b = s.values[i];
      if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
      const interp = s.interp[i] || s.interp[i - 1];
      ctx.strokeStyle = ids.length === 1 && interp ? colors.text3 : tint(k);
      ctx.globalAlpha = ids.length > 1 && interp ? 0.55 : 1;
      ctx.setLineDash(interp ? [3, 3] : []);
      ctx.beginPath(); ctx.moveTo(X(t[i - 1]), Y(a)); ctx.lineTo(X(t[i]), Y(b)); ctx.stroke();
    }
  });
  ctx.setLineDash([]); ctx.globalAlpha = 1;
  // otro intento: misma articulación, mismo color, en trazo corto y más tenue; solo dentro del eje de tiempo
  ctx.lineWidth = 1.6;
  for (const g of ghosts) {
    ctx.strokeStyle = tint(g.k); ctx.globalAlpha = 0.75; ctx.setLineDash([2, 3]);
    for (let i = 1; i < g.t.length; i++) {
      const a = g.v[i - 1], b = g.v[i];
      if (!Number.isFinite(a) || !Number.isFinite(b) || g.t[i - 1] < t0 || g.t[i] > t1) continue;
      ctx.beginPath(); ctx.moveTo(X(g.t[i - 1]), Y(a)); ctx.lineTo(X(g.t[i]), Y(b)); ctx.stroke();
    }
  }
  ctx.setLineDash([]); ctx.globalAlpha = 1;
  if (cursor != null) {
    const x = Math.round(X(t[cursor])) + 0.5;
    ctx.strokeStyle = colors.text; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x, pad.t); ctx.lineTo(x, H - pad.b); ctx.stroke();
    all.forEach((s, k) => {
      const v = s.values[cursor];
      if (!Number.isFinite(v)) return;
      ctx.fillStyle = colors.surface || '#fff'; ctx.beginPath(); ctx.arc(x, Y(v), 5.5, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = ids.length === 1 ? colors.text : tint(k); ctx.beginPath(); ctx.arc(x, Y(v), 3.5, 0, Math.PI * 2); ctx.fill();
    });
    // con una sola serie el valor va en el gráfico; con varias, en la leyenda
    const v = s0.values[cursor];
    if (ids.length === 1 && Number.isFinite(v)) {
      const label = s0.unit === '°' ? `${v.toFixed(1)}°` : v.toFixed(2);
      ctx.font = '600 11px "Geist Mono", monospace'; ctx.fillStyle = colors.text;
      const w = ctx.measureText(label).width;
      ctx.fillText(label, Math.min(W - pad.r - w - 4, x + 6), pad.t + 12);
    }
  }
  return { X, pad, t0, t1, W };
}

let chartGeom = null;
const SERIES_LABEL = () => Object.fromEntries([...ANGLE_DEFS, ...EXTRA_SERIES].map(d => [d.id, d.label]).concat([['armL', 'Mano izquierda: posición respecto del hombro'], ['armR', 'Mano derecha: posición respecto del hombro']]));
const darkTheme = () => { const t = document.documentElement.dataset.theme; return t ? t === 'dark' : !matchMedia('(prefers-color-scheme: light)').matches; };
const seriesHex = (id) => SERIES_COLORS[darkTheme() ? 'dark' : 'light'][state.chartColors[id] ?? 0];
function drawChart() {
  const r = state.result;
  if (!r || $('view-results').hidden) return;
  const ids = state.chartSel;
  const rows = momentRows(r, state.moments);
  chartGeom = renderChart(chart, r, ids, state.frame, {
    grid: css('--line'), text: css('--text'), text2: css('--text-3'), text3: css('--text-3'), accent: css('--accent'), surface: css('--surface'),
    series: ids.length > 1 || state.cmp ? ids.map(seriesHex) : null, moments: rows.map(m => ({ frame: m.frame, n: m.n })), ghost: ghostSeries(ids),
  });
  // leyenda con el valor de cada serie en el cuadro actual
  const lab = SERIES_LABEL();
  $('chart-legend').innerHTML = ids.length > 1 ? ids.map(id => {
    const v = seriesFor(r, id).values[state.frame];
    return `<span class="lg-item"><i style="background:${seriesHex(id)}"></i>${esc(SHORT[id] || lab[id])} <b class="mono">${Number.isFinite(v) ? (isDegree(id) ? `${fmt(v, 1)}°` : fmt(v, 2)) : '–'}</b></span>`;
  }).join('') : `<span class="lg-item"><b>${esc(lab[ids[0]])}</b></span>`;
  if (state.cmp?.align && state.cmp.series) $('chart-legend').innerHTML += `<span class="lg-item lg-ghost"><i></i>punteado: intento del ${esc(state.cmp.date.split('-').reverse().join('/'))}</span>`;
  $('chart-pick').querySelectorAll('button').forEach(b => {
    const on = ids.includes(b.dataset.id);
    b.setAttribute('aria-pressed', on);
    b.style.setProperty('--sw', on && ids.length > 1 ? seriesHex(b.dataset.id) : 'transparent');
  });
  const defs = [...ANGLE_DEFS, ...EXTRA_SERIES].filter(d => ids.includes(d.id));
  $('chart-note').textContent = defs.length ? [...new Set(defs.map(d => d.note.replace(/\.$/, '')))].join(' · ') + '. Los huecos son cuadros sin dato confiable.' :
    'Posición de la muñeca proyectada sobre el eje del tronco, en longitudes de tronco. Los máximos (mano adelantada) marcan el inicio de cada ciclo.';
}

// Recorrido de la cabeza del intento comparado (si se guardó con esa versión) y su corrimiento en el tiempo.
const ghostHead = () => (state.cmp?.align && state.cmp.series?.head ? { times: state.cmp.series.times, head: state.cmp.series.head, shift: state.cmp.align.shift - G.nudge } : null);
// Curvas del intento comparado, corridas en el tiempo para que coincida el momento de alineación.
function ghostSeries(ids) {
  const c = state.cmp;
  if (!c || !c.series || !c.align) return null;
  return ids.map((id, k) => c.series.angles[id] ? { k, t: c.series.times.map(t => t + c.align.shift), v: c.series.angles[id] } : null).filter(Boolean);
}
const savedMoments = () => momentRows(state.result, state.moments).map(({ label, t, angles }) => ({ label, t, angles: Object.fromEntries(Object.entries(angles).filter(([, a]) => a).map(([k, a]) => [k, a.v])) }));

// Lista de otros intentos guardados del alumno con momentos marcados.
async function cmpOptions() {
  const r = state.result, box = $('mom-cmp-box');
  const id = r?.meta.athleteId;
  if (!id) { box.hidden = true; return; }
  let evs = [];
  try { evs = await store.listEvaluations(id); } catch { evs = []; }
  const key = `tech:${r.meta.fileName}:${r.meta.analyzedAt}`;
  const list = evs.filter(e => e.kind === 'tech' && e.sourceKey !== key).map(startOf).filter(Boolean);
  state.cmpList = list;
  box.hidden = !list.length;
  const sel = $('mom-cmp'), prev = state.cmp?.id || '';
  sel.innerHTML = '<option value="">Elegí un intento…</option>' + list.map(x => `<option value="${esc(x.id)}">${esc(x.date.split('-').reverse().join('/'))} · ${esc(x.event || x.fileName || x.title)}${x.flight ? ` · vuelo ${fmt(x.flight.time, 2)} s` : ''}</option>`).join('');
  sel.value = list.some(x => x.id === prev) ? prev : '';
}
$('mom-cmp').onchange = () => {
  const x = (state.cmpList || []).find(c => c.id === $('mom-cmp').value);
  state.cmp = x ? { ...x } : null;
  cmpUi(); drawChart(); draw();
};

// ---------- otro intento encima del video, semitransparente ----------
const ghost = $('video-ghost');
const G = { on: false, url: null, nudge: 0 };
// tiempo del otro video para el instante t del principal: se corre lo que separa los dos momentos de alineación
const ghostTime = (t) => t - (state.cmp?.align?.shift || 0) + G.nudge;
function ghostSync(force) {
  if (!G.on || !state.cmp?.align) return;
  const t = ghostTime(video.paused ? state.result.times[state.frame] + 0.5 / state.result.meta.sourceFps : video.currentTime);
  const out = t < 0 || t > (ghost.duration || 0);
  ghost.style.visibility = out ? 'hidden' : 'visible';
  if (out) { if (!ghost.paused) ghost.pause(); return; }
  if (video.paused) { if (!ghost.paused) ghost.pause(); if (force || Math.abs(ghost.currentTime - t) > 1e-3) ghost.currentTime = t; return; }
  ghost.playbackRate = video.playbackRate;
  if (ghost.paused) ghost.play().catch(() => {});
  if (Math.abs(ghost.currentTime - t) > 1.5 / state.result.meta.sourceFps) ghost.currentTime = t;
}
async function ghostLoad(file) {
  if (G.url) URL.revokeObjectURL(G.url);
  G.url = URL.createObjectURL(file); G.nudge = 0;
  $('ghost-hint').textContent = 'Cargando el video…';
  try {
    await new Promise((res, rej) => { ghost.onloadeddata = res; ghost.onerror = () => rej(new Error('Este navegador no puede abrir ese video.')); ghost.src = G.url; ghost.load(); });
  } catch (e) { $('ghost-hint').textContent = e.message; return; }
  G.on = true; ghost.hidden = false;
  ghost.style.opacity = $('ghost-op').value / 100;
  const c = state.cmp;
  $('ghost-hint').textContent = c.fileName && file.name !== c.fileName ? `Ojo: ese intento se analizó con "${c.fileName}" y elegiste "${file.name}". Si no es el mismo video, la alineación no sirve.` : `Alineados en ${c.align.label.toLowerCase()}. Para que coincidan, la cámara tiene que estar en el mismo lugar en los dos intentos.`;
  ghostUi(); ghostSync(true);
}
function ghostOff() {
  G.on = false; ghost.hidden = true; ghost.pause(); ghost.removeAttribute('src'); ghost.load();
  if (G.url) URL.revokeObjectURL(G.url); G.url = null;
  ghostUi();
}
function ghostUi() {
  const c = state.cmp;
  $('ghost-ctrl').hidden = !c || !c.align;
  if (!c) { if (G.on) ghostOff(); return; }
  $('ghost-cloud').hidden = G.on || !c.videoPath || !store.videoFile;
  $('ghost-file-btn').hidden = G.on;
  $('ghost-off').hidden = !G.on;
  $('ghost-on').hidden = !G.on;
  const fd = 1 / state.result.meta.fps;
  $('ghost-off-txt').textContent = G.nudge ? `${G.nudge > 0 ? '+' : '−'}${Math.round(Math.abs(G.nudge) / fd)} cuadro${Math.round(Math.abs(G.nudge) / fd) === 1 ? '' : 's'}` : '';
}
$('ghost-file').onchange = (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) ghostLoad(f); };
$('ghost-cloud').onclick = async () => {
  const b = $('ghost-cloud'); b.disabled = true; b.textContent = 'Bajando el video…';
  try { await ghostLoad(await store.videoFile(state.cmp.videoPath, state.cmp.fileName)); }
  catch (e) { $('ghost-hint').textContent = 'No se pudo traer el video: ' + e.message; }
  finally { b.disabled = false; b.textContent = 'Traer su video de la nube'; }
};
$('ghost-off').onclick = ghostOff;
$('ghost-op').oninput = () => { ghost.style.opacity = $('ghost-op').value / 100; };
document.querySelectorAll('[data-gstep]').forEach(b => b.onclick = () => { G.nudge = Math.round((G.nudge + (+b.dataset.gstep) / state.result.meta.fps) * 1e4) / 1e4; ghostUi(); ghostSync(true); draw(); });
video.addEventListener('pause', () => ghostSync(true));
video.addEventListener('play', () => ghostSync(true));
video.addEventListener('ratechange', () => ghostSync(true));

function cmpUi() {
  const out = $('mom-cmp-out'), c = state.cmp;
  if (!c) { out.innerHTML = ''; ghostUi(); return; }
  const mine = savedMoments();
  c.align = alignOf(mine, c.moments);
  const lab = SERIES_LABEL(), dLab = c.date.split('-').reverse().join('/');
  if (!c.align) { ghostUi(); out.innerHTML = `<p class="fine">Para comparar, marcá en este video al menos uno de los mismos momentos que tiene el intento del ${esc(dLab)} (${esc(c.moments.map(m => m.label).join(', '))}).</p>`; return; }
  const sg = (v, d = 0) => (Number.isFinite(v) ? `${v > 0 ? '+' : v < 0 ? '−' : ''}${fmt(Math.abs(v), d)}` : '–');
  let h = `<p class="metric-detail">Este intento contra el del ${esc(dLab)}, alineados en <b>${esc(c.align.label)}</b>. En el gráfico, el otro intento va punteado con el mismo color de cada articulación.</p>`;
  const fr = compareFlight(flightSaved(state.flight), c.flight);
  if (fr.length) h += `<div class="table-wrap"><table class="data sheet cmp-table"><tr><th>Vuelo</th><th>Este</th><th>${esc(dLab)}</th><th>Diferencia</th></tr>${fr.map(x => `<tr><th scope="row">${esc(x.label)}</th><td class="mono">${fmt(x.a, x.dec)}${x.unit === '°' ? '°' : ' s'}</td><td class="mono">${fmt(x.b, x.dec)}${x.unit === '°' ? '°' : ' s'}</td><td class="mono">${sg(x.d, x.dec)}${x.unit === '°' ? `° <small>±${fmt(x.err, 0)}°</small>` : ` s <small>±${fmt(2 * (state.flight?.frameDur || 1 / 30), 3)} s</small>`}</td></tr>`).join('')}</table></div>`;
  else if (!c.flight) h += '<p class="fine">El otro intento no tiene despegue y entrada marcados: no hay vuelo para comparar.</p>';
  const rows = compareMoments(mine, c.moments, c.align), cols = cmpCols(rows);
  if (rows.length) h += `<div class="table-wrap"><table class="data sheet wide cmp-table"><tr><th>Momento</th><th>Tiempo</th>${cols.map(id => `<th title="${esc(lab[id])}">${esc(SHORT[id])}</th>`).join('')}</tr>${rows.map(m => `<tr><th scope="row">${esc(m.label)}</th><td class="mono">${sg(m.ta, 2)} s<small>${sg(m.dt, 2)} s</small></td>${cols.map(id => { const a = m.angles[id]; return `<td class="mono">${a?.a != null ? `${fmt(a.a, 0)}°` : '–'}<small>${a?.d != null ? `${sg(a.d)}°` : a?.b != null ? `otro ${fmt(a.b, 0)}°` : ''}</small></td>`; }).join('')}</tr>`).join('')}</table></div>
    <p class="fine">Arriba el valor de este intento; abajo, la diferencia con el otro (este − otro). Tiempo contado desde ${esc(c.align.label.toLowerCase())}. Cada ángulo 2D tiene su margen: diferencias de pocos grados pueden ser ruido de la detección o de un cambio en la posición de la cámara.</p>`;
  out.innerHTML = h;
  ghostUi(); ghostSync(true);
}

function chartPickUi(r) {
  const lab = SERIES_LABEL();
  const ids = [...ANGLE_DEFS.map(d => d.id), ...EXTRA_SERIES.map(d => d.id), 'armL', 'armR'];
  $('chart-pick').innerHTML = ids.map(id => {
    const has = seriesFor(r, id).values.some(Number.isFinite);
    return `<button type="button" class="chip-tg" data-id="${id}" aria-pressed="false" title="${esc(lab[id])}"${has ? '' : ' disabled'}><i></i>${esc(SHORT[id] || lab[id])}</button>`;
  }).join('');
  $('chart-pick').querySelectorAll('button').forEach(b => b.onclick = () => {
    const out = toggleSeries(state.chartSel, state.chartColors, b.dataset.id);
    state.chartSel = out.sel; state.chartColors = out.colors;
    $('chart-note').dataset.full = out.full ? '1' : '';
    drawChart();
    if (out.full) $('chart-note').textContent = `Hasta ${MAX_SERIES} variables juntas: sacá una para sumar otra.`;
  });
}

// ---------- momentos clave ----------
function momentsUi() {
  const r = state.result;
  queueMicrotask(cmpUi);
  const rows = momentRows(r, state.moments);
  if (!rows.length) {
    state.flight = null;
    $('mom-out').innerHTML = '<p class="fine">Pausá en un cuadro (por ejemplo el despegue) y tocá Marcar: se guardan los grados de todas las articulaciones en ese instante.</p>';
    return;
  }
  const cols = usedCols(rows), lab = SERIES_LABEL();
  const cell = (a) => a ? `${fmt(a.v, 0)}°${a.interp ? '<sup>*</sup>' : ''}` : '–';
  const head = `<tr><th>#</th><th>Momento</th><th>Tiempo</th><th>Δ anterior</th>${cols.map(id => `<th title="${esc(lab[id])}">${esc(SHORT[id])}</th>`).join('')}<th></th></tr>`;
  const body = rows.map(m => `<tr data-frame="${m.frame}"><td>${m.n}</td><th scope="row">${esc(m.label)}<small>cuadro ${m.frame + 1}</small></th><td class="mono">${fmt(m.t, 3)} s</td><td class="mono">${m.prev == null ? '–' : `${fmt(m.prev, 3)} s`}</td>${cols.map(id => `<td class="mono">${cell(m.angles[id])}</td>`).join('')}<td><button class="icon-x" type="button" data-del="${m.frame}" aria-label="Quitar momento">×</button></td></tr>`).join('');
  const frameDur = 1 / r.meta.fps;
  state.flight = flightOf(r, rows, camOf(r));
  $('mom-out').innerHTML = `${flightHtml(state.flight)}<div class="table-wrap"><table class="data sheet wide mom-table">${head}${body}</table></div>
    <p class="fine">Tiempos con precisión de un cuadro (±${fmt(frameDur, 3)} s a ${fmt(r.meta.fps, 0)} fps). Ángulos 2D en el plano de la imagen, solo con confianza ≥ ${r.meta.minVisibility}; – = articulación no vista con confianza en ese cuadro; * = punto interpolado. Tocá una fila para ir a ese cuadro.</p>`;
  const fc = $('mom-flight-show'); if (fc) fc.onchange = () => { state.showFlight = fc.checked; draw(); };
  $('mom-out').querySelectorAll('tr[data-frame]').forEach(tr => tr.onclick = (e) => {
    const del = e.target.closest('[data-del]');
    if (del) { state.moments = state.moments.filter(m => m.frame !== +del.dataset.del); momentsUi(); drawChart(); return; }
    seekFrame(+tr.dataset.frame);
  });
}
function flightHtml(fl) {
  if (!fl) return '<p class="fine">Para ver el vuelo, marcá <b>Despegue de los pies</b> y <b>Entrada de las manos</b>.</p>';
  if (fl.error) return `<div class="obs baja"><b>Vuelo</b>${esc(fl.error)}</div>`;
  const e = (d) => `±${fmt(Math.max(1, d.err), 0)}°`, g = (v) => `${fmt(Math.abs(v) < 0.5 ? 0 : v, 0)}°`;
  const kpi = (label, val, sub) => `<div class="fl-kpi"><span>${esc(label)}</span><b class="mono">${val}</b><small>${esc(sub)}</small></div>`;
  return `<div class="fl-box"><div class="fl-kpis">
    ${kpi('Tiempo de vuelo', `${fmt(fl.time, 2)} s`, `±${fmt(fl.frameDur, 3)} s (1 cuadro)`)}
    ${kpi('Ángulo de despegue', g(fl.takeoff.deg), `${e(fl.takeoff)} · cadera; + = subiendo`)}
    ${kpi('Ángulo de entrada', g(fl.entry.deg), `${e(fl.entry)} · cadera; − = bajando`)}
    ${fl.body ? kpi('Cuerpo al entrar', g(fl.body.deg), `${e(fl.body)} · cadera → mano; + = mano más abajo`) : ''}
  </div>
  ${fl.warn.map(w => `<div class="obs baja">${esc(w)}</div>`).join('')}
  <label class="check fl-show"><input type="checkbox" id="mom-flight-show"${state.showFlight ? ' checked' : ''}> Ver trayectoria en el video</label>
  <p class="fine">Cadera = punto medio de las dos caderas, como aproximación del centro de masa, en ${fl.pts.length} cuadros. Se ajusta una parábola (vuelo libre) y de ahí sale la dirección al despegar y al entrar; el margen sale del error de ese ajuste (${fmt(fl.rms, 1)} px). Ángulos en el plano de la imagen: valen con toma lateral, cámara fija y nivelada. Si la cámara se movió o está en diagonal, el ángulo real es otro.</p></div>`;
}
// Sugerencia automática: se muestra para revisar; se marca solo si el entrenador lo confirma.
$('mom-auto').onclick = () => {
  const r = state.result; if (!r) return;
  const sg = suggestStart(r), box = $('mom-sug');
  const item = (label, x) => x.error ? `<div class="sug-row"><b>${esc(label)}</b><span class="fine">${esc(x.error)}</span></div>`
    : `<div class="sug-row"><b>${esc(label)}</b><span class="mono">cuadro ${x.frame + 1} · ${fmt(r.times[x.frame], 3)} s${x.exact === false ? ` (entre ${x.from + 1} y ${x.to + 1})` : ''}</span><span class="fine">${esc(x.why)}</span>
      <span class="sug-act"><button class="btn ghost small" type="button" data-sgo="${x.frame}">Ver</button>${x.exact === false ? `<button class="btn ghost small" type="button" data-sgo="${x.from}">Cuadro ${x.from + 1}</button><button class="btn ghost small" type="button" data-sgo="${x.to}">Cuadro ${x.to + 1}</button>` : ''}<button class="btn small" type="button" data-smark="${x.frame}" data-label="${esc(label)}">Marcar</button></span></div>`;
  box.innerHTML = sg.error ? `<p class="fine">${esc(sg.error)}</p>` : `${item('Despegue de los pies', sg.takeoff)}${item('Entrada de las manos', sg.entry)}
    <p class="fine">Es una propuesta a partir de la pose: confirmala mirando el video cuadro a cuadro. Si no coincide, andá al cuadro correcto y marcalo con el botón de arriba.</p>`;
  box.hidden = false;
  box.querySelectorAll('[data-sgo]').forEach(b => b.onclick = () => seekFrame(+b.dataset.sgo));
  box.querySelectorAll('[data-smark]').forEach(b => b.onclick = () => {
    seekFrame(+b.dataset.smark);
    $('mom-kind').value = b.dataset.label;
    $('mom-add').click();
    b.textContent = 'Marcado'; b.disabled = true;
  });
};
$('mom-add').onclick = () => {
  const r = state.result; if (!r) return;
  video.pause();
  const label = $('mom-kind').value;
  state.moments = state.moments.filter(m => m.frame !== state.frame && !(m.label === label && label !== 'Otro'));
  state.moments.push({ frame: state.frame, label });
  momentsUi(); drawChart();
};

function chartSeek(e) {
  if (!chartGeom) return;
  const rect = chart.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const { pad, t0, t1, W } = chartGeom;
  const tt = t0 + (x - pad.l) / (W - pad.l - pad.r) * (t1 - t0);
  seekFrame(frameAt(tt));
}
let chartDrag = false;
chart.addEventListener('pointerdown', e => { chartDrag = true; chart.setPointerCapture(e.pointerId); chartSeek(e); });
chart.addEventListener('pointermove', e => { if (chartDrag) chartSeek(e); });
chart.addEventListener('pointerup', () => { chartDrag = false; });

// ---------- exportaciones ----------
// En claude.ai la descarga pasa por la capacidad "downloads"; fuera de ahí, enlace normal.
let downloadsCap = null;
function getDownloads() {
  if (!downloadsCap) downloadsCap = (window.claude && window.claude.use) ? window.claude.use('downloads').catch(() => null) : Promise.resolve(null);
  return downloadsCap;
}
setTimeout(getDownloads, 0);
function notify(msg, id = 'export-msg') {
  const el = $(id);
  el.textContent = msg; el.hidden = !msg;
}
async function download(blob, name, msgId = 'export-msg') {
  const notify2 = (m) => notify(m, msgId);
  notify2('');
  const cap = await getDownloads();
  if (cap) {
    try { await cap.save({ filename: name, data: blob }); notify2('Archivo guardado: ' + name); }
    catch (e) { if (e && e.code !== 'declined') notify2('No se pudo guardar el archivo (' + (e.code || e.message) + ').'); }
    return;
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
const baseName = () => `${state.result.meta.swimmer.replace(/[^\w\-]+/g, '_')}_${state.result.meta.date || 'analisis'}`;

// El otro intento dibujado encima (exportaciones): solo si ese instante existe en su video.
const ghostIn = (t) => { const g = ghostTime(t); return G.on && g >= 0 && g <= (ghost.duration || 0); };
async function ghostOnto(ctx, t, w, h) {
  if (!ghostIn(t)) return;
  await seekVideo(ghost, ghostTime(t));
  ctx.globalAlpha = +ghost.style.opacity || 0.45; ctx.drawImage(ghost, 0, 0, w, h); ctx.globalAlpha = 1;
}
// Captura el cuadro i con la superposición, en resolución original del video.
export async function captureFrame(i, opts = {}) {
  const r = state.result;
  await new Promise((resolve) => {
    const target = Math.min(video.duration - 1e-3, r.times[i] + 0.5 / r.meta.sourceFps);
    if (Math.abs(video.currentTime - target) < 1e-4) return resolve();
    video.addEventListener('seeked', () => setTimeout(resolve, 60), { once: true });
    video.currentTime = target;
  });
  const maxW = opts.maxWidth || r.meta.width;
  const sc = Math.min(1, maxW / r.meta.width);
  const c = document.createElement('canvas');
  c.width = Math.round(r.meta.width * sc); c.height = Math.round(r.meta.height * sc);
  const ctx = c.getContext('2d');
  ctx.drawImage(video, 0, 0, c.width, c.height);
  await ghostOnto(ctx, r.times[i] + 0.5 / r.meta.sourceFps, c.width, c.height);
  drawSkeleton(ctx, r, i, sc, { skel: true, ang: true, traj: true, head: $('t-head').checked, ghostHead: ghostHead(), cam: camOf(r), trajSide: state.trajSide, lineScale: Math.max(1, c.width / 900) });
  if (state.showFlight && state.flight && !opts.noFlight) drawFlight(ctx, state.flight, sc, Math.max(1, c.width / 900), undefined, flightMap(r, i));
  renderDrawings(ctx, state.drawings.filter(d => drawingVisible(d, r.times[i], 1 / r.meta.fps)), sc, Math.max(1, c.width / 900));
  ctx.font = `600 ${Math.max(12, c.width / 60)}px "Geist Mono", monospace`;
  const label = `t = ${r.times[i].toFixed(3)} s`;
  ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(8, 8, ctx.measureText(label).width + 12, Math.max(12, c.width / 60) + 10);
  ctx.fillStyle = '#fff'; ctx.fillText(label, 14, 8 + Math.max(12, c.width / 60) + 2);
  return c;
}

$('btn-png').onclick = async () => {
  video.pause();
  const i = state.frame;
  const c = await captureFrame(i);
  seekFrame(i);
  c.toBlob(b => download(b, `${baseName()}_t${state.result.times[i].toFixed(2)}s.png`), 'image/png');
};

$('btn-xlsx').onclick = () => {
  const r = state.result;
  download(xlsxBlob(techSheets(r, { moments: momentRows(r, state.moments), phases: state.phases, flight: state.flight, checks: state.angleChecks })), `${baseName()}.xlsx`);
};
$('btn-csv').onclick = () => {
  const sh = techSheets(state.result).find(x => x.name === 'Por cuadro');
  download(csvBlob(sh.rows), `${baseName()}_por_cuadro.csv`);
};
$('btn-json').onclick = () => {
  const r = state.result;
  const out = {
    meta: r.meta, metrics: r.metrics, quality: r.quality, observations: r.observations,
    cycles: r.arms, kicks: r.kicks, perCycle: r.perCycle, limitations: LIMITATIONS,
    frames: r.times.map((t, i) => ({
      t,
      joints: Object.fromEntries([[0, 'nariz'], [11, 'hombro_izq'], [12, 'hombro_der'], [13, 'codo_izq'], [14, 'codo_der'], [15, 'muneca_izq'], [16, 'muneca_der'], [23, 'cadera_izq'], [24, 'cadera_der'], [25, 'rodilla_izq'], [26, 'rodilla_der'], [27, 'tobillo_izq'], [28, 'tobillo_der']]
        .map(([j, n]) => [n, Number.isFinite(r.tracks[j].x[i]) ? { x: +r.tracks[j].x[i].toFixed(1), y: +r.tracks[j].y[i].toFixed(1), conf: +r.tracks[j].vis[i].toFixed(3), interpolado: r.tracks[j].interpolated[i] } : null])),
      angulos: Object.fromEntries(Object.entries(r.angles).map(([k, s]) => [k, Number.isFinite(s.values[i]) ? +s.values[i].toFixed(1) : null])),
    })),
  };
  download(new Blob([JSON.stringify(out, null, 1)], { type: 'application/json' }), `${baseName()}.json`);
};

$('btn-pdf').onclick = async () => {
  const btn = $('btn-pdf');
  btn.disabled = true; const label = btn.innerHTML; btn.textContent = 'Generando…';
  try {
    video.pause();
    const keep = state.frame;
    const blob = await buildReport(state.result, { captureFrame, renderChart, limitations: LIMITATIONS, styleLabel: STYLE_LABEL, moments: momentRows(state.result, state.moments), flight: state.flight, phases: state.phases, angleChecks: state.angleChecks, faults: faultsSaved(state.faults || [], state.faultDecisions || {}), velocity: velocitySaved(state.velRes, state.vel?.scale || null), chartSel: state.chartSel.length > 1 ? state.chartSel : null, chartColors: state.chartSel.length > 1 ? state.chartSel.map(id => SERIES_COLORS.light[state.chartColors[id]]) : null });
    seekFrame(keep);
    download(blob, `${baseName()}_informe.pdf`);
  } catch (e) {
    console.error(e);
    notify('No se pudo generar el PDF: ' + e.message);
  } finally { btn.disabled = false; btn.innerHTML = label; }
};

function phasesSaved() {
  const sp = state.phases;
  if (!sp || sp.error) return null;
  const arm = (a) => ({ n: a.n, cycleDur: a.cycleDur, summary: a.summary, cycles: a.cycles.filter(c => c.ok).map(c => ({ n: c.n, dur: c.dur, pct: c.phases.map(x => +x.pct.toFixed(1)) })) });
  return { best: sp.best, L: arm(sp.arms.L), R: arm(sp.arms.R), edits: state.phaseEdits };
}
$('btn-save-tech').onclick = () => saveTech();
// la evaluación guardada de este análisis (para agregarle la revisión); la guarda si todavía no está
const techSaved = async () => state.savedEval?.sourceKey === `tech:${state.result.meta.fileName}:${state.result.meta.analyzedAt}` ? state.savedEval : saveTech();
const techReview = (file, kind) => sendButton(file, kind, techSaved);
function saveTech() {
  const r = state.result, m = r.meta;
  const { detectedMask, ...quality } = r.quality;
  return saveToAthlete(m.athleteId, m.swimmer, {
    kind: 'tech', date: m.date, title: `Técnica · ${STYLE_LABEL[m.style]}`, event: m.event,
    sourceKey: `tech:${m.fileName}:${m.analyzedAt}`,
    summary: { cycleRate: r.metrics.find(x => x.id === 'cycleRate')?.value ?? null },
    data: { meta: m, metrics: r.metrics, observations: r.observations, perCycle: r.perCycle, quality, drawings: state.drawings, series: packSeries(r), flight: flightSaved(state.flight), phases: phasesSaved(), faults: faultsSaved(state.faults || [], state.faultDecisions || {}), velocity: velocitySaved(state.velRes, state.vel?.scale || null), cam2: state.cam2meta || null, angleChecks: state.angleChecks, pointEdits: state.pointEdits, foundSearch: !!state.found, moments: momentRows(r, state.moments).map(({ frame, label, t, angles }) => ({ frame, label, t, angles: Object.fromEntries(Object.entries(angles).filter(([, a]) => a).map(([k, a]) => [k, +a.v.toFixed(1)])) })) },
  }, 'export-msg', state.file).then(saved => { if (saved) { state.savedEval = saved; state.result.meta.athleteId = saved.athleteId; cmpOptions(); } return saved; });
}

const newAnalysisFor = (a) => { show('upload'); refreshSelect(a.id).then(() => { $('f-athlete').value = a.id; $('f-name').value = a.name; }); };
initAthletes({
  show, download, newAnalysisFor, localStore, cloud,
  // reabre una medición de Gym (barra o saltos) con su video
  openGym: async (ev, file) => {
    const m = await import('./gym-ui.js');
    m.initGym({ notify: (msg) => notify(msg, 'gy-msg') });
    show('gym');
    try { await m.openSaved(ev, file); } catch (err) { notify('No se pudo abrir: ' + (err.message || err), 'gy-msg'); }
  },
  // reabre una evaluación con su video guardado en la nube
  openWithVideo: async (athlete, ev, file) => {
    if (ev.kind === 'race') {
      const m = await import('./race-ui.js');
      state.raceFile = file;
      await m.startRace(file, { ...ev.data.cfg, athleteId: athlete.id }, { show, download, saveToAthlete, analyzeSegment }, { events: ev.data.events, cycles: ev.data.cycles || [], angles: ev.data.angles || [], video2: ev.data.video2 || null, square: ev.data.square || null, path: ev.data.path || null, cal: ev.data.cal || null, drawings: ev.data.drawings || [] });
    } else {
      newAnalysisFor(athlete);
      setFile(file);
      const d = ev.data.meta;
      $('f-style').value = d.style; $('f-view').value = d.view; $('f-event').value = d.event || ''; $('f-date').value = d.date || '';
      $('mode-tech').checked = true; applyMode();
      const faultDecisions = Object.fromEntries((ev.data.faults || []).filter(x => x.decision || x.note).map(x => [x.id, { ok: x.decision === 'confirmado' ? true : x.decision === 'descartado' ? false : null, note: x.note || '' }]));
      state.pendingMoments = ev.data.moments?.length || ev.data.drawings?.length || ev.data.phases?.edits || ev.data.angleChecks?.length || ev.data.pointEdits?.length || ev.data.foundSearch || Object.keys(faultDecisions).length || ev.data.velocity?.scale || ev.data.cam2 ? { fileName: d.fileName, cam2: ev.data.cam2 || null, velScale: ev.data.velocity?.scale || null, velPoint: ev.data.velocity?.point || 'hip', list: (ev.data.moments || []).map(m => ({ frame: m.frame, label: m.label })), drawings: ev.data.drawings || [], phaseEdits: ev.data.phases?.edits || {}, faultDecisions, angleChecks: ev.data.angleChecks || [], pointEdits: ev.data.pointEdits || [], found: !!ev.data.foundSearch } : null;
    }
  },
});

// arranque: con nube configurada pide ingresar; si no, abre directo
// dentro de Team Bull: cuando cambia la lista de alumnos, se actualizan las listas abiertas
window.addEventListener('teambull-alumnos', () => {
  refreshSelect();
  import('./gym-ui.js').then(m => m.refreshAthletes?.()).catch(() => {});
  if (document.body.dataset.view === 'athletes') $('btn-athletes').click();
});
initCloud({ show, onReady: async () => {
  // portal del nadador: si un entrenador compartió una ficha con este email, se ofrece "Mi ficha";
  // si además no tiene alumnos propios, la app abre directamente en su ficha (modo nadador)
  let sheets = [], own = [];
  try { [sheets, own] = await Promise.all([store.sharedSheets(), store.listAthletes()]); } catch {}
  const athleteMode = sheets.length > 0 && own.length === 0;
  document.body.dataset.role = athleteMode ? 'athlete' : 'coach';
  document.querySelectorAll('[data-nav="mine"]').forEach(b => { b.hidden = !sheets.length; });
  $('btn-mine').onclick = () => openAthlete(sheets[0].id);
  if (athleteMode) openAthlete(sheets[0].id); else { show('upload'); refreshSelect(); }
} });

// Acceso para pruebas automatizadas
window.__swimlab = { state, seekFrame };

// ---------- instalación como aplicación ----------
// Fuera de claude.ai: service worker para abrir sin conexión, botón "Instalar app" (Android y escritorio)
// y una indicación para iPhone, donde se instala desde Compartir.
const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const hosted = /claude|anthropic|usercontent/.test(location.hostname);
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost') && !hosted) navigator.serviceWorker.register('sw.js').catch(() => {});
let installEvt = null;
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installEvt = e; $('btn-install').hidden = false; });
window.addEventListener('appinstalled', () => { installEvt = null; $('btn-install').hidden = true; $('install-tip').hidden = true; });
$('btn-install').onclick = async () => { if (!installEvt) return; installEvt.prompt(); await installEvt.userChoice.catch(() => {}); installEvt = null; $('btn-install').hidden = true; };
$('install-tip-close').onclick = () => { $('install-tip').hidden = true; try { localStorage.setItem('swimbull-install-tip', '1'); } catch {} };
const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
let tipSeen = false; try { tipSeen = !!localStorage.getItem('swimbull-install-tip'); } catch {}
if (ios && !standalone && !hosted && !tipSeen) setTimeout(() => { $('install-tip').hidden = false; }, 2500);

// ---------- explicación con voz ----------
$('tc-voice').innerHTML = voicePanelHtml('tc-voice');
bindVoice('tc-voice', {
  reviewButton: techReview,
  size: () => [state.result.meta.width, state.result.meta.height],
  name: () => baseName(),
  download: (b, n) => download(b, n),
  paint: (ctx, W, H) => {
    ctx.drawImage(video, 0, 0, W, H);
    if (G.on && !ghost.hidden) { ctx.globalAlpha = +ghost.style.opacity || 0.45; ctx.drawImage(ghost, 0, 0, W, H); ctx.globalAlpha = 1; }
    ctx.drawImage(overlay, 0, 0, W, H);
    clipLabels(ctx, W, H, `${state.result.times[state.frame].toFixed(2)} s`, state.result.meta.swimmer);
  },
});

// ---------- clip de técnica con el esqueleto ----------
$('tc-clip').innerHTML = clipPanelHtml('tc-clip', null) + `<div class="clip-actions"><button class="btn ghost small" id="tc-frame-send" type="button" title="Foto del cuadro actual con el esqueleto y los dibujos">Agregar este cuadro a la revisión</button></div><p class="fine" id="tc-frame-info" role="status"></p>`;
$('tc-frame-send').onclick = async () => {
  video.pause();
  const i = state.frame, c = await captureFrame(i);
  const blob = await new Promise(res => c.toBlob(res, 'image/jpeg', 0.9));
  const file = new File([blob], `${baseName()}_cuadro${i + 1}.jpg`, { type: 'image/jpeg' });
  seekFrame(i);
  const b = sendButton(file, 'frame', techSaved, () => { $('tc-frame-info').textContent = `Cuadro ${i + 1} agregado a la revisión del nadador.`; });
  b.click();
};
const techClipUi = bindClipPanel('tc-clip', {
  reviewButton: techReview,
  now: () => state.result.times[state.frame],
  maxSpan: 30,
  extraHold: () => 0,
  download: (blob, name) => download(blob, name),
  run: async ({ a, b, slow }, onProgress, signal) => {
    const r = state.result, keep = state.frame;
    video.pause();
    const s1 = Math.min(1, 720 / r.meta.height, 1280 / r.meta.width), W = r.meta.width * s1, H = r.meta.height * s1;
    const opt = { skel: $('t-skel').checked, ang: $('t-ang').checked, traj: $('t-traj').checked, low: $('t-low').checked, head: $('t-head').checked, ghostHead: ghostHead(), cam: camOf(r), trajSide: state.trajSide, accent: css('--overlay') || '#ff9f1c', lineScale: Math.max(1, H / 430) };
    const frames = [];
    for (let i = frameAt(a); i <= frameAt(b); i++) {
      const t = r.times[i], tn = r.times[i + 1];
      frames.push({
        dur: (tn > t ? tn - t : 1 / r.meta.fps) * slow,
        prepare: async () => { await seekVideo(video, t + 0.5 / r.meta.sourceFps); if (G.on && ghostIn(t + 0.5 / r.meta.sourceFps)) await seekVideo(ghost, ghostTime(t + 0.5 / r.meta.sourceFps)); },
        draw: (ctx) => {
          ctx.drawImage(video, 0, 0, W, H);
          if (G.on && ghostIn(t + 0.5 / r.meta.sourceFps)) { ctx.globalAlpha = ghost.style.opacity || 0.45; ctx.drawImage(ghost, 0, 0, W, H); ctx.globalAlpha = 1; }
          drawSkeleton(ctx, r, i, s1, opt);
          if (state.showFlight && state.flight) drawFlight(ctx, state.flight, s1, Math.max(1, H / 430), undefined, flightMap(r, i));
          renderDrawings(ctx, state.drawings.filter(d => drawingVisible(d, t, 1 / r.meta.fps)), s1, Math.max(1, H / 430));
          clipLabels(ctx, W, H, `${t.toFixed(2)} s${slowTag(slow)}`, `${r.meta.swimmer} · ${r.meta.style || ''}`.replace(/ · $/, ''));
        },
      });
    }
    try {
      const out = await encodeClip({ width: Math.round(W), height: Math.round(H), frames, onProgress, signal });
      out.name = `${baseName()}_clip_${a.toFixed(2).replace('.', '-')}s.mp4`;
      return out;
    } finally { seekFrame(keep); }
  },
});

// ---------- elegir al nadador cuando aparece más de una persona ----------
const aspectOf = () => state.result.meta.width / state.result.meta.height;
function drawOthers(ctx, i, scale, dpr) {
  const r = state.result, W = r.meta.width, H = r.meta.height;
  const cur = state.cur && state.cur[i];
  for (const p of state.raw[i].cands || []) {
    if (p === cur) continue;
    ctx.strokeStyle = 'rgba(255,255,255,0.55)'; ctx.lineWidth = 1.6 * dpr; ctx.setLineDash([5 * dpr, 4 * dpr]);
    for (const [a, b] of SKELETON) {
      if ((p[a][2] ?? 0) < 0.3 || (p[b][2] ?? 0) < 0.3) continue;
      ctx.beginPath(); ctx.moveTo(p[a][0] * W * scale, p[a][1] * H * scale); ctx.lineTo(p[b][0] * W * scale, p[b][1] * H * scale); ctx.stroke();
    }
    ctx.setLineDash([]);
  }
}
function pickUi(on) {
  state.pick = !!on && !!state.raw;
  const b = $('t-pick');
  b.disabled = !state.raw;
  b.setAttribute('aria-pressed', state.pick);
  $('t-pick-undo').hidden = !(state.anchors && state.anchors.length);
  const multi = state.raw ? state.raw.filter(f => (f.cands || []).length > 1).length : 0;
  $('t-pick-hint').hidden = !state.pick && !(state.anchors && state.anchors.length);
  if (state.pick) $('t-pick-hint').textContent = multi
    ? `Tocá al nadador correcto. Se corrige desde este cuadro hasta la próxima corrección. Las otras personas se ven punteadas (hay más de una en ${multi} cuadros).`
    : 'En este video se detectó una sola persona por cuadro. Si el esqueleto está sobre otra persona, tocá al nadador correcto.';
  $('player').classList.toggle('picking', state.pick);
  if (state.result) draw();
}
// De las poses detectadas al análisis: nadador elegido, cuadros recuperados con el recorte, limpieza de
// cruces izquierda/derecha y saltos, y correcciones a mano.
function pipeline(meta) {
  const aspect = meta.width / meta.height;
  let frames = applyTrack(state.raw, state.anchors || [], aspect);
  state.cur = frames.map(f => f.lm);
  let found = 0;
  if (state.found) frames = frames.map((f, i) => (!f.lm && state.found[i] ? (found++, { ...f, lm: state.found[i] }) : f));
  const sw = fixSwaps(frames, aspect), sp = despike(sw.frames, aspect);
  frames = applyEdits(sp.frames, state.pointEdits, meta.fps);
  meta.cleanup = { swaps: sw.swaps.length, spikes: sp.spikes.length, found, searched: !!state.found, edits: state.pointEdits.length };
  meta.pointEdits = state.pointEdits.map(e => ({ ...e }));
  // movimiento de la cámara (filmación en mano): transformaciones de cada cuadro al primero
  const cam = frames.every(f => f.cam) ? { toBase: frames.map(f => f.cam.T), ok: frames.map(f => f.cam.ok) } : null;
  meta.camera = cam ? cameraSummary(cam, meta.width, meta.height) : null;
  state.result = analyze(frames, meta);
  state.result.cam = cam;
  return state.result;
}
function recompute(keepFrame) {
  const meta = state.result.meta;
  meta.subjectAnchors = state.anchors.map(a => ({ t: state.raw[a.i].t, x: a.x, y: a.y }));
  pipeline(meta);
  renderResults(state.result);
  seekFrame(keepFrame);
}
$('t-pick').onclick = () => { if (state.fix) fixUi(false); pickUi(!state.pick); };
// ---------- corregir puntos a mano ----------
// Con el video en pausa se arrastra un punto del esqueleto a su lugar (o se elige el punto y se toca donde
// va, si en ese cuadro no se detectó). La corrección se reparte a los cuadros vecinos y se recalcula todo.
const FIX_NAMES = { 0: 'nariz', 11: 'hombro izq.', 12: 'hombro der.', 13: 'codo izq.', 14: 'codo der.', 15: 'muñeca izq.', 16: 'muñeca der.', 23: 'cadera izq.', 24: 'cadera der.', 25: 'rodilla izq.', 26: 'rodilla der.', 27: 'tobillo izq.', 28: 'tobillo der.' };
const FIX_JOINTS = Object.keys(FIX_NAMES).map(Number);
function fixUi(on) {
  state.fix = !!on && !!state.result;
  if (state.fix && state.pick) pickUi(false);
  $('t-fix').setAttribute('aria-pressed', state.fix);
  $('t-fix').disabled = !state.result;
  $('t-fix-bar').hidden = !state.fix;
  $('player').classList.toggle('fixing', state.fix);
  const n = state.pointEdits.length;
  $('t-fix-undo').disabled = !n;
  const sel = $('t-fix-joint').value;
  $('t-fix-del').disabled = !(sel !== '' && state.pointEdits.some(e => e.j === +sel));
  if (state.fix) { video.pause(); $('t-fix-hint').textContent = `Pausá en el cuadro y arrastrá el punto a su lugar. Si el punto no aparece, elegilo en la lista y tocá donde va. La corrección se reparte a los cuadros cercanos (0,3 s) y entre dos correcciones del mismo punto se interpola. Correcciones: ${n}.`; }
  const c = state.result?.meta.cleanup;
  $('t-find').disabled = !state.raw;
  $('t-find').textContent = c?.searched ? `Cuadros recuperados: ${c.found}` : 'Buscar al nadador en cuadros perdidos';
  if (state.result) draw();
}
$('t-fix').onclick = () => fixUi(!state.fix);
$('t-fix-joint').onchange = () => fixUi(true);
$('t-fix-undo').onclick = () => { state.pointEdits.pop(); recompute(state.frame); fixUi(true); };
$('t-fix-del').onclick = () => { const j = +$('t-fix-joint').value; state.pointEdits = state.pointEdits.filter(e => e.j !== j); recompute(state.frame); fixUi(true); };
const fixPos = (e) => { const rc = overlay.getBoundingClientRect(); return [(e.clientX - rc.left) / rc.width, (e.clientY - rc.top) / rc.height, rc]; };
$('player').addEventListener('pointerdown', (e) => {
  if (!state.fix || !state.result || e.target.closest('button, .ov-chip')) return;
  e.stopPropagation(); e.preventDefault();
  video.pause();
  const r = state.result, i = state.frame, [x, y, rc] = fixPos(e);
  const sel = $('t-fix-joint').value;
  let j = sel === '' ? -1 : +sel;
  if (j < 0) {
    let bd = 28;
    for (const k of FIX_JOINTS) {
      const px = r.tracks[k].x[i], py = r.tracks[k].y[i];
      if (!Number.isFinite(px)) continue;
      const d = Math.hypot(px / r.meta.width * rc.width - x * rc.width, py / r.meta.height * rc.height - y * rc.height);
      if (d < bd) { bd = d; j = k; }
    }
  }
  if (j < 0) { $('t-fix-hint').textContent = 'No hay ningún punto cerca del toque. Si el punto falta en este cuadro, elegilo en la lista y tocá donde va.'; return; }
  state.fixDrag = { j, x, y };
  $('player').setPointerCapture(e.pointerId);
  draw();
}, true);
$('player').addEventListener('pointermove', (e) => {
  if (!state.fixDrag) return;
  e.stopPropagation();
  const [x, y] = fixPos(e);
  state.fixDrag.x = Math.min(1, Math.max(0, x)); state.fixDrag.y = Math.min(1, Math.max(0, y));
  draw();
}, true);
$('player').addEventListener('pointerup', (e) => {
  const d = state.fixDrag;
  if (!d) return;
  e.stopPropagation();
  state.fixDrag = null;
  const i = state.frame;
  state.pointEdits = state.pointEdits.filter(x => !(x.j === d.j && x.i === i)).concat({ j: d.j, i, t: state.result.times[i], x: d.x, y: d.y });
  recompute(i);
  fixUi(true);
  $('t-fix-hint').textContent = `Listo: ${FIX_NAMES[d.j]} corregido en el cuadro ${i + 1}. Recalculé ángulos y métricas. Correcciones: ${state.pointEdits.length}.`;
}, true);
$('t-find').onclick = async () => {
  const r = state.result, btn = $('t-find');
  if (!state.raw || !state.techFile) return;
  btn.disabled = true; btn.textContent = 'Buscando…';
  const keep = state.frame;
  try {
    const tracked = applyTrack(state.raw, state.anchors, aspectOf());
    const sample = document.createElement('canvas'); sample.width = r.meta.width; sample.height = r.meta.height;
    sample.getContext('2d').drawImage(video, 0, 0, sample.width, sample.height);
    const model = /Lite/.test(r.meta.model) ? 'lite' : 'full';
    const lm = await getLandmarker(model, BASE, sample, ':crop');
    state.found = await refinePose(video, tracked, lm, { frameDur: 1 / r.meta.sourceFps, onProgress: ({ done, total }) => { btn.textContent = `Buscando… ${done}/${total}`; } });
    recompute(keep);
    const c = state.result.meta.cleanup;
    notify(c.found ? `Encontré al nadador en ${c.found} cuadros donde antes no se veía. Revisalos: en cuadros con mucha espuma o bajo el agua los puntos son menos precisos.` : 'No encontré al nadador en ningún cuadro más.');
  } catch (e) { console.error(e); notify('No se pudo buscar: ' + e.message); seekFrame(keep); }
  fixUi(state.fix);
};

$('t-pick-undo').onclick = () => {
  state.anchors.pop(); state.found = null; recompute(state.frame); pickUi(state.pick);
  if (!state.pick) $('t-pick-hint').textContent = state.anchors.length ? `Correcciones: ${state.anchors.length}.` : '';
};
$('player').addEventListener('click', (e) => {
  if (!state.pick || !state.raw || techDraw.tool || state.fix) return;
  const rc = $('stage').getBoundingClientRect();
  const x = (e.clientX - rc.left) / rc.width, y = (e.clientY - rc.top) / rc.height;
  const i = state.frame, cands = state.raw[i].cands || [];
  if (candidateAt(cands, x, y, aspectOf()) < 0) { $('t-pick-hint').textContent = 'No detecté a ninguna persona ahí en este cuadro. Probá en otro cuadro donde se vea mejor.'; return; }
  state.anchors = state.anchors.filter(a => a.i !== i).concat({ i, x, y }).sort((a, b) => a.i - b.i);
  state.found = null; // la búsqueda en cuadros perdidos seguía a la persona anterior
  recompute(i);
  pickUi(true);
  $('t-pick-hint').textContent = `Listo: desde el cuadro ${i + 1} se sigue a la persona que tocaste. Correcciones: ${state.anchors.length}. Recalculé todas las métricas.`;
});
