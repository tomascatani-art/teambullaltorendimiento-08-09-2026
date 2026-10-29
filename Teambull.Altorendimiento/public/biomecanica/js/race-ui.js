// Modo competencia: reproductor, marcado asistido de eventos, cálculo en vivo y exportaciones.
import { bindClipPanel, clipPanelHtml, encodeClip, seekVideo, clipLabels, slowTag } from './clip.js';
import { buildSlots, computeRace, compare, measureAlongLine, angleValue, angleError, ANGLE_TYPE_LABEL, secPerCycle, strokesPerMin } from './race.js';
import { findStartSignal } from './audio.js';
import { readFrameTimes } from './pose.js';
import { planeH, applyH, planeMpp } from './homography.js';
import { voicePanelHtml, bindVoice } from './voice.js';
import { sendButton } from './review.js';
import { raceFatigue, fatigueTable } from './fatigue.js';
import { distanceCheck, checkSummary, checkText } from './accuracy.js';
import { xlsxBlob } from './xlsx.js';
import { raceSheets } from './exports.js';
import { trackForward, TRACK_W, PATH_COLORS } from './track.js';
import { cameraTracker, rescale, compose, apply as camApply, IDENT } from './camera.js';
import { store } from './store.js';
import { isReport, reportToResults } from './reports.js';
import { findRecords, recordToResults, recordLabel, recordWhere, fmtTime, gapText, SEX_NAME } from './records.js';
import { buildRaceReport } from './race-report.js';
import { distanceSeries, speedSeries, segmentSpeeds, metersPerPx, speedChart } from './speed.js';
import { bindEvoChart } from './evolution.js';
import { parseTime, targetToResults } from './target.js';
import { renderDrawings, drawingVisible, drawPanelHtml, bindDrawing } from './draw.js';

const $ = (id) => document.getElementById(id);
const STYLE = { crol: 'Crol', espalda: 'Espalda', pecho: 'Pecho', mariposa: 'Mariposa', medley: 'Medley' };
const f = (v, d = 2) => (Number.isFinite(v) ? v.toLocaleString('es-AR', { minimumFractionDigits: d, maximumFractionDigits: d }) : '–');
const fs = (v, d = 2) => (Number.isFinite(v) ? (v > 0 ? '+' : '') + f(v, d) : '–');
const esc = (s) => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// Colores para los ángulos: cada uno puede ir de un color distinto (por ejemplo, uno por articulación).
const ANG_COLORS = [['#FFD60A', 'Amarillo'], ['#FF6B35', 'Naranja'], ['#ff4d4d', 'Rojo'], ['#38d9ff', 'Celeste'], ['#5cff7a', 'Verde'], ['#ffffff', 'Blanco']];
const S = {
  file: null, cfg: null, slots: [], ev: {}, cycles: [], cur: 0, frameDur: 1 / 30, times: null,
  res: null, ref: null, measure: null, helpers: null, url: null,
  angles: [], angTool: null, angDrag: null, angColor: ANG_COLORS[0][0],
};
let drawUi = null;

export async function startRace(file, cfg, helpers, initial) {
  S.file = file; S.cfg = cfg; S.helpers = helpers;
  S.slots = buildSlots(cfg);
  S.ev = {}; S.cycles = []; S.cur = 0; S.ref = null; S.measure = null; S.angles = []; S.angTool = null; S.v2meta = null; S.square = null; S.path = null; S.pathTool = false; S.cmpPaths = []; S.cal = null; S.calWait = null; S.drawings = [];
  if (initial) { S.ev = JSON.parse(JSON.stringify(initial.events || {})); S.cycles = (initial.cycles || []).slice(); S.angles = JSON.parse(JSON.stringify(initial.angles || [])); S.v2meta = initial.video2 || null; S.square = initial.square || null; S.path = initial.path || null; S.cal = initial.cal || null; S.drawings = JSON.parse(JSON.stringify(initial.drawings || [])); }
  else restoreAutosave();
  const video = $('rc-video');
  if (S.url) URL.revokeObjectURL(S.url);
  S.url = URL.createObjectURL(file);
  await new Promise((resolve, reject) => {
    video.onloadeddata = resolve;
    video.onerror = () => reject(new Error('Este navegador no puede decodificar el video. Probá exportarlo como MP4 (H.264).'));
    video.src = S.url; video.load();
  });
  const timing = await readFrameTimes(file).catch(() => null);
  if (timing && timing.times.length) { S.times = timing.times; S.frameDur = timing.frameDur; }
  else { S.times = null; S.frameDur = 1 / 30; }
  $('rc-title').textContent = `${cfg.swimmer} · ${cfg.distance} m ${STYLE[cfg.style].toLowerCase()}`;
  $('rc-meta').textContent = [cfg.date, cfg.event, `pileta de ${cfg.poolLength} m`, `${f(1 / S.frameDur, 1)} fps${S.times ? '' : ' (estimado)'}`, `${video.videoWidth}×${video.videoHeight}`].filter(Boolean).join('  ·  ');
  S.sex = '';
  if (cfg.athleteId) store.getAthlete(cfg.athleteId).then(a => { S.sex = a?.sex || ''; if (S.res) { renderSheet(); renderCompare(); } }).catch(() => {});
  $('rc-cycle-hint').textContent = cfg.style === 'medley'
    ? 'Marcá según el estilo de cada largo: en mariposa y pecho, una vez por cada entrada simultánea de las manos; en espalda y crol, por cada entrada de la misma mano (1 ciclo). Atajo: tecla C.'
    : (cfg.style === 'pecho' || cfg.style === 'mariposa')
    ? 'Tocá una vez por cada entrada simultánea de las manos (1 ciclo). Atajo: tecla C.'
    : 'Tocá una vez por cada entrada de la misma mano, siempre la misma (1 ciclo = 2 brazadas). Atajo: tecla C.';
  if (V2.on) $('rc-v2-remove').click();
  clipUi.reset(); dock('mark'); drawUi.refresh(); pathUi(); calUi(); loadCmpPaths(); rateTaps = []; rateUi();
  if (S.v2meta) $('rc-v2-hint').textContent = `Este análisis se hizo con un segundo video (${S.v2meta.fileName}). Cargalo de nuevo y se sincroniza solo con el desfase guardado.`;
  helpers.show('race');
  stage.style.aspectRatio = `${video.videoWidth} / ${video.videoHeight}`;
  $('rc-dual').style.setProperty('--ar', video.videoWidth / video.videoHeight);
  if (!S.ev[S.slots[S.cur]?.id]) S.cur = Math.max(0, S.slots.findIndex(s => !S.ev[s.id]));
  render();
  resizeCanvases();
}

// ---------- reproductor ----------
const video = $('rc-video');
const overlay = $('rc-overlay');
const stage = $('rc-stage');
const player = $('rc-player');
const tl = $('rc-timeline');
let zoom = 1, pan = { x: 0, y: 0 };

function frameIndexAt(t) {
  if (!S.times) return Math.round(t / S.frameDur);
  let lo = 0, hi = S.times.length - 1;
  while (lo < hi) { const m = (lo + hi + 1) >> 1; if (S.times[m] <= t + S.frameDur * 0.5) lo = m; else hi = m - 1; }
  return lo;
}
function timeOfFrame(i) {
  if (!S.times) return i * S.frameDur;
  return S.times[Math.max(0, Math.min(S.times.length - 1, i))];
}
// tiempo del cuadro que se está mostrando (inicio del cuadro)
function currentFrameTime() { return timeOfFrame(frameIndexAt(video.currentTime)); }

function step(n) {
  video.pause();
  const i = frameIndexAt(video.currentTime) + n;
  video.currentTime = Math.max(0, Math.min(video.duration - 1e-3, timeOfFrame(i) + S.frameDur * 0.5));
}
function seek(t) { video.pause(); video.currentTime = Math.max(0, Math.min(video.duration - 1e-3, t + S.frameDur * 0.5)); }

$('rc-prev').onclick = () => step(-1);
$('rc-next').onclick = () => step(1);
$('rc-back10').onclick = () => step(-10);
$('rc-fwd10').onclick = () => step(10);
$('rc-play').onclick = () => { if (video.paused) { video.playbackRate = +$('rc-speed').value; video.play(); } else video.pause(); };
$('rc-speed').onchange = () => { video.playbackRate = +$('rc-speed').value; };
$('rc-zoom').onchange = () => { zoom = +$('rc-zoom').value; pan = { x: 0, y: 0 }; applyZoom(); };
video.addEventListener('play', () => { $('rc-play-ico').innerHTML = '<path d="M7 5h3v14H7zM14 5h3v14h-3z" fill="currentColor"/>'; loop(); });
video.addEventListener('pause', () => { $('rc-play-ico').innerHTML = '<path d="M7 5l12 7-12 7z" fill="currentColor"/>'; hud(); });
video.addEventListener('seeked', hud);
function loop() { if (video.paused) return; hud(); v2Sync(); requestAnimationFrame(loop); }

function applyZoom() {
  const w = stage.clientWidth, h = stage.clientHeight;
  pan.x = Math.min(0, Math.max(w - w * zoom, pan.x));
  pan.y = Math.min(0, Math.max(h - h * zoom, pan.y));
  stage.style.transform = zoom === 1 ? '' : `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`;
  player.classList.toggle('zoomed', zoom > 1);
}
let drag = null;
player.addEventListener('pointerdown', e => {
  if (S.measure && S.measure.waiting != null) return; // el toque es una medición
  if (S.calWait != null) return; // el toque es una referencia de distancia
  if (S.angTool || S.angDrag) return; // el toque marca o ajusta un ángulo
  if (zoom > 1) { drag = { x: e.clientX, y: e.clientY, px: pan.x, py: pan.y, moved: false }; player.setPointerCapture(e.pointerId); }
});
player.addEventListener('pointermove', e => { if (drag) { drag.moved = true; pan.x = drag.px + e.clientX - drag.x; pan.y = drag.py + e.clientY - drag.y; applyZoom(); } });
player.addEventListener('pointerup', () => { drag = null; });

// Zoom con dos dedos: el punto que está entre los dedos queda debajo de los dedos mientras se agranda.
// Con zoom, un dedo mueve el video (arrastre de arriba) y «Quitar zoom» lo devuelve a su lugar.
{
  let pz = null;
  const dd = (t) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
  const mm = (t) => { const r = player.getBoundingClientRect(); return [(t[0].clientX + t[1].clientX) / 2 - r.left - stage.offsetLeft, (t[0].clientY + t[1].clientY) / 2 - r.top - stage.offsetTop]; };
  player.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 2) return;
    e.preventDefault(); drag = null;
    const m = mm(e.touches);
    pz = { d: dd(e.touches), z: zoom, ux: (m[0] - pan.x) / zoom, uy: (m[1] - pan.y) / zoom };
  }, { passive: false });
  player.addEventListener('touchmove', (e) => {
    if (!pz || e.touches.length !== 2) return;
    e.preventDefault();
    const m = mm(e.touches);
    zoom = Math.max(1, Math.min(6, pz.z * dd(e.touches) / Math.max(1, pz.d)));
    if (zoom < 1.05) zoom = 1;
    pan = { x: m[0] - zoom * pz.ux, y: m[1] - zoom * pz.uy };
    applyZoom();
  }, { passive: false });
  player.addEventListener('touchend', (e) => { if (e.touches.length < 2) pz = null; });
  ['gesturestart', 'gesturechange'].forEach(ev => player.addEventListener(ev, (e) => e.preventDefault()));
}

// toque para medir: convierte a píxeles del video teniendo en cuenta zoom
overlay.addEventListener('click', e => {
  if (S.calWait != null) {
    const rect = overlay.getBoundingClientRect();
    const p = [(e.clientX - rect.left) / rect.width * video.videoWidth, (e.clientY - rect.top) / rect.height * video.videoHeight];
    if (typeof S.calWait === 'string' && S.calWait[0] === 'c') CHK.pts[+S.calWait.slice(1)] = p;
    // se guarda el instante del toque: con la cámara en mano hace falta saber en qué cuadro se marcó
    else if (typeof S.calWait === 'string') { const P = planeOf(), k = +S.calWait.slice(1); P.pts[k] = p; (P.ts ||= [null, null, null, null])[k] = video.currentTime; }
    else { S.cal.refs[S.calWait].p = p; S.cal.refs[S.calWait].t = video.currentTime; }
    S.calWait = null; autosave(); calUi(); drawOverlay(); return;
  }
  if (!S.measure || S.measure.waiting == null) return;
  const rect = overlay.getBoundingClientRect();
  const x = (e.clientX - rect.left) / rect.width * video.videoWidth;
  const y = (e.clientY - rect.top) / rect.height * video.videoHeight;
  const k = S.measure.waiting;
  if (k === 'head') S.measure.head = [x, y]; else S.measure.refs[k].p = [x, y];
  S.measure.waiting = null;
  renderMeasure(); drawOverlay();
});

function resizeCanvases() {
  const dpr = window.devicePixelRatio || 1;
  overlay.width = Math.round(stage.clientWidth * dpr); overlay.height = Math.round(stage.clientHeight * dpr);
  if (V2.on) { overlay2.width = Math.round(stage2.clientWidth * dpr); overlay2.height = Math.round(stage2.clientHeight * dpr); }
  drawOverlay(); drawTimeline();
}
window.addEventListener('resize', () => { if (!$('view-race').hidden) resizeCanvases(); });

// Tramo de nado de un largo (en tiempo del video): del break out (o la entrada al agua en el primero, o la
// salida de la pared) hasta la pared o la llegada. null si falta alguna marca.
function lapWindow(k) {
  const t = (id) => S.ev[id]?.t;
  const n = Math.round(S.cfg.distance / S.cfg.poolLength);
  const t0 = [t(`bo${k}`), k === 0 ? t('entry') : t(`off${k - 1}`), k > 0 ? t(`wall${k - 1}`) : NaN].find(Number.isFinite);
  const t1 = k < n - 1 ? t(`wall${k}`) : t('finish');
  return Number.isFinite(t0) && Number.isFinite(t1) && t1 - t0 > 1 ? { t0, t1 } : null;
}
// estilo de un largo (en el medley: mariposa, espalda, pecho y crol, en partes iguales)
function lapStyle(k) {
  if (S.cfg.style !== 'medley') return S.cfg.style;
  const n = Math.round(S.cfg.distance / S.cfg.poolLength);
  return ['mariposa', 'espalda', 'pecho', 'crol'][Math.min(3, Math.floor(4 * k / n))];
}
function raceTime(tVideo) {
  const t0 = S.res?.sync?.t0;
  return Number.isFinite(t0) ? tVideo - t0 : NaN;
}
function hud() {
  if ($('view-race').hidden) return;
  const tv = currentFrameTime();
  const tr = raceTime(tv);
  $('rc-hud').textContent = Number.isFinite(tr) ? `${tr < 0 ? '−' : ''}${f(Math.abs(tr), 2)} s` : `video ${f(tv, 3)} s`;
  $('rc-readout').textContent = `cuadro ${frameIndexAt(video.currentTime) + 1} · video ${f(tv, 3)} s`;
  drawTimeline();
  drawOverlay();
  markAngleRows();
}

// Botones con cruz sobre el video para sacar lo que está puesto (escuadra, segundo video, línea, medición).
const CHIPS = [
  { k: 'square', label: 'Escuadra', on: () => !!S.square, off: () => $('rc-square').click() },
  { k: 'v2', label: 'Video 2', on: () => V2.on, off: () => $('rc-v2-remove').click() },
  { k: 'path', label: 'Línea', on: () => !!S.path?.pts?.length && !trackAbort, off: () => $('rc-path-clear').click() },
  { k: 'measure', label: 'Medición', on: () => !!S.measure, off: () => { S.measure = null; renderMeasure(); drawOverlay(); } },
  { k: 'ang', label: 'Ángulo sin terminar', on: () => !!S.angTool, off: () => $('rc-ang-cancel').click() },
  { k: 'draw', label: 'Lápiz', on: () => !!drawUi?.tool, off: () => drawUi.off() },
];
let chipKey = '';
function chipsUi() {
  const act = CHIPS.filter(c => c.on());
  const key = act.map(c => c.k).join();
  if (key === chipKey) return;
  chipKey = key;
  const box = $('rc-chips');
  box.innerHTML = act.map(c => `<button type="button" class="ov-chip" data-k="${c.k}" aria-label="Quitar ${c.label.toLowerCase()}">${c.label}<span aria-hidden="true">×</span></button>`).join('');
  box.querySelectorAll('button').forEach(b => {
    b.onpointerdown = (e) => e.stopPropagation();
    b.onclick = (e) => { e.stopPropagation(); CHIPS.find(c => c.k === b.dataset.k).off(); chipsUi(); };
  });
}

function drawOverlay() {
  chipsUi();
  const ctx = overlay.getContext('2d');
  ctx.clearRect(0, 0, overlay.width, overlay.height);
  const sc = overlay.width / video.videoWidth;
  const dpr = window.devicePixelRatio || 1;
  drawPaths(ctx, sc, dpr, currentFrameTime());
  drawSquare(ctx, sc, dpr);
  renderDrawings(ctx, S.drawings.filter(d => drawingVisible(d, currentFrameTime(), S.frameDur)), sc, dpr);
  drawAngles(ctx, sc, dpr, visibleAngles());
  drawPending(ctx, sc, dpr);
  drawOverlay2();
  if (S.cal && (S.calWait != null || !document.querySelector('.path-panel').hidden)) drawCal(ctx, sc, dpr);
  const m = S.measure;
  if (!m) return;
  ctx.font = `600 ${12 * dpr}px "Geist Mono", monospace`;
  const dot = (p, color, label) => {
    ctx.fillStyle = color; ctx.strokeStyle = '#000'; ctx.lineWidth = 1.5 * dpr;
    ctx.beginPath(); ctx.arc(p[0] * sc, p[1] * sc, 6 * dpr, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    const w = ctx.measureText(label).width;
    ctx.fillStyle = 'rgba(0,0,0,0.7)'; ctx.fillRect(p[0] * sc + 9 * dpr, p[1] * sc - 16 * dpr, w + 8 * dpr, 18 * dpr);
    ctx.fillStyle = '#fff'; ctx.fillText(label, p[0] * sc + 13 * dpr, p[1] * sc - 3 * dpr);
  };
  const refs = m.refs.filter(r => r.p);
  if (refs.length >= 2) {
    ctx.strokeStyle = 'rgba(255,159,28,0.85)'; ctx.lineWidth = 2 * dpr; ctx.setLineDash([6 * dpr, 4 * dpr]);
    ctx.beginPath(); ctx.moveTo(refs[0].p[0] * sc, refs[0].p[1] * sc);
    ctx.lineTo(refs[refs.length - 1].p[0] * sc, refs[refs.length - 1].p[1] * sc); ctx.stroke(); ctx.setLineDash([]);
  }
  for (const r of refs) dot(r.p, '#ff9f1c', `${f(r.m, 1)} m`);
  if (m.head) dot(m.head, '#ffffff', m.result ? `${f(m.result.meters, 2)} m` : 'cabeza');
}

function drawTimeline() {
  const dpr = window.devicePixelRatio || 1;
  const W = tl.clientWidth, H = tl.clientHeight;
  if (!W) return;
  tl.width = Math.round(W * dpr); tl.height = Math.round(H * dpr);
  const ctx = tl.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const css = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  ctx.fillStyle = css('--surface'); ctx.fillRect(0, 0, W, H);
  const D = video.duration || 1;
  const X = (t) => 6 + (t / D) * (W - 12);
  ctx.strokeStyle = css('--line'); ctx.beginPath(); ctx.moveTo(6, H / 2 + 0.5); ctx.lineTo(W - 6, H / 2 + 0.5); ctx.stroke();
  ctx.strokeStyle = css('--text-3');
  for (const t of S.cycles) { ctx.beginPath(); ctx.moveTo(X(t), H / 2 - 5); ctx.lineTo(X(t), H / 2 + 5); ctx.stroke(); }
  for (const s of S.slots) {
    const e = S.ev[s.id];
    if (!e) continue;
    ctx.fillStyle = s === S.slots[S.cur] ? css('--text') : css('--accent');
    ctx.fillRect(X(e.t) - 1.5, 6, 3, H - 12);
  }
  ctx.fillStyle = css('--text');
  const x = X(video.currentTime);
  ctx.beginPath(); ctx.moveTo(x - 5, 0); ctx.lineTo(x + 5, 0); ctx.lineTo(x, 7); ctx.fill();
  ctx.fillRect(x - 0.5, 0, 1, H);
}
let tlDrag = false;
const tlSeek = (e) => { const r = tl.getBoundingClientRect(); seek(Math.max(0, (e.clientX - r.left - 6) / (r.width - 12)) * video.duration); };
tl.addEventListener('pointerdown', e => { tlDrag = true; tl.setPointerCapture(e.pointerId); tlSeek(e); });
tl.addEventListener('pointermove', e => { if (tlDrag) tlSeek(e); });
tl.addEventListener('pointerup', () => { tlDrag = false; });

// ---------- marcado ----------
function markCurrent() {
  const s = S.slots[S.cur];
  if (!s) return;
  const prevDist = S.ev[s.id]?.dist;
  S.ev[s.id] = { t: currentFrameTime(), ...(Number.isFinite(prevDist) ? { dist: prevDist } : {}) };
  // avanza al siguiente evento sin marcar
  const next = S.slots.findIndex((x, i) => i > S.cur && !S.ev[x.id]);
  if (!s.needsDist) S.cur = next >= 0 ? next : S.cur;
  changed();
}
$('rc-mark').onclick = markCurrent;
$('rc-cycle').onclick = () => { S.cycles.push(currentFrameTime()); S.cycles.sort((a, b) => a - b); changed(); };
$('rc-cycle-undo').onclick = () => {
  if (!S.cycles.length) return;
  // deshace el ciclo más cercano antes del cuadro actual (o el último)
  const t = currentFrameTime();
  let k = -1;
  for (let i = 0; i < S.cycles.length; i++) if (S.cycles[i] <= t + 1e-6) k = i;
  S.cycles.splice(k >= 0 ? k : S.cycles.length - 1, 1);
  changed();
};

document.addEventListener('keydown', (e) => {
  if ($('view-race').hidden || /INPUT|SELECT|TEXTAREA/.test(e.target.tagName)) return;
  const k = e.key.toLowerCase();
  if (k === 'arrowright') { step(e.shiftKey ? 10 : 1); e.preventDefault(); }
  else if (k === 'arrowleft') { step(e.shiftKey ? -10 : -1); e.preventDefault(); }
  else if (k === ' ') { $('rc-play').click(); e.preventDefault(); }
  else if (k === 'm') { markCurrent(); }
  else if (k === 'c') { $('rc-cycle').click(); }
  else if (k === 'a') { startAngle('3p'); }
  else if (k === 'escape' && S.angTool) { $('rc-ang-cancel').click(); }
});

// señal automática
$('rc-auto').onclick = async () => {
  const btn = $('rc-auto');
  btn.disabled = true; const lbl = btn.textContent; btn.textContent = 'Analizando el audio…';
  $('rc-cands').innerHTML = '';
  try {
    const out = await findStartSignal(S.file);
    if (out.error) { $('rc-cands').innerHTML = `<span class="fine">${esc(out.error)}</span>`; return; }
    if (!out.candidates.length) { $('rc-cands').innerHTML = '<span class="fine">No se encontró un sonido tipo bocina. Marcá la señal a mano.</span>'; return; }
    const best = out.candidates[0].score;
    $('rc-cands').innerHTML = out.candidates.map((c, i) => `<button class="chip" data-t="${c.t}">${f(c.t, 3)} s · ${i === 0 ? 'más probable' : c.score > best * 0.7 ? 'posible' : 'débil'}</button>`).join('')
      + '<span class="fine">Tocá un candidato para ir a ese cuadro, verificá y marcá la señal.</span>';
    $('rc-cands').querySelectorAll('.chip').forEach(b => b.onclick = () => {
      S.cur = S.slots.findIndex(s => s.id === 'signal');
      seek(+b.dataset.t);
      render();
    });
  } catch (e) {
    $('rc-cands').innerHTML = `<span class="fine">No se pudo leer el audio: ${esc(e.message)}</span>`;
  } finally { btn.disabled = false; btn.textContent = lbl; }
};

// medición de distancia
function openMeasure(slotId) {
  const isStart = slotId === 'bo0';
  S.measure = { slotId, refs: [{ m: 5, p: null }, { m: 15, p: null }, { m: isStart ? 25 : 25, p: null }], head: null, waiting: null, result: null };
  $('rc-measure').hidden = false;
  dock('mark');
  renderMeasure(); drawOverlay();
  $('rc-measure').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}
function renderMeasure() {
  const m = S.measure;
  if (!m) { $('rc-measure').hidden = true; return; }
  const rows = m.refs.map((r, i) => `<div class="mrow"><span class="fine">Ref. ${i + 1}${i === 2 ? ' (opcional)' : ''}</span>
      <input type="text" inputmode="decimal" id="rc-mref-${i}" value="${r.m}" aria-label="Distancia de la referencia ${i + 1} en metros"><span class="fine">m</span>
      <button class="btn ghost small" data-k="${i}">${m.waiting === i ? 'Tocá en el video…' : r.p ? 'Volver a tocar' : 'Tocar en el video'}</button></div>`).join('')
    + `<div class="mrow"><span class="fine">Cabeza</span><span></span><span></span><button class="btn ghost small" data-k="head">${m.waiting === 'head' ? 'Tocá en el video…' : m.head ? 'Volver a tocar' : 'Tocar en el video'}</button></div>`;
  $('rc-measure-rows').innerHTML = rows;
  $('rc-measure-rows').querySelectorAll('button').forEach(b => b.onclick = () => { m.waiting = b.dataset.k === 'head' ? 'head' : +b.dataset.k; renderMeasure(); });
  m.refs.forEach((r, i) => { $('rc-mref-' + i).onchange = (e) => { const v = parseFloat(e.target.value.replace(',', '.')); if (Number.isFinite(v)) r.m = v; compute(); }; });
  const compute = () => {
    const refs = m.refs.filter(r => r.p);
    const H = planeH(S.cal?.plane);
    // con el plano de la pileta marcado, la distancia sale de la homografía (no hace falta marcar referencias acá)
    m.result = H && m.head ? { meters: applyH(H, m.head)[0], method: 'plano de la pileta (4 puntos, corrige la perspectiva)' } : refs.length >= 2 && m.head ? measureAlongLine(refs, m.head) : null;
    $('rc-measure-out').textContent = m.result ? `${f(m.result.meters, 2)} m · ${m.result.method}` : 'Faltan puntos.';
    $('rc-measure-use').disabled = !m.result;
    drawOverlay();
  };
  compute();
}
$('rc-measure-use').onclick = () => {
  const m = S.measure;
  if (!m?.result) return;
  const id = m.slotId;
  S.ev[id] = { ...(S.ev[id] || { t: currentFrameTime() }), dist: Math.round(m.result.meters * 100) / 100, distMethod: m.result.method };
  S.measure = null; renderMeasure(); drawOverlay();
  changed();
};
$('rc-measure-cancel').onclick = () => { S.measure = null; renderMeasure(); drawOverlay(); };

// ---------- ángulos sobre el cuadro (tipo Kinovea) ----------
// Cada ángulo queda atado al cuadro donde se marcó; los puntos se guardan en píxeles del video.
const ANG_NEED = { '3p': 3, h: 2, v: 2 };
const ANG_HINT = {
  '3p': ['Tocá el primer extremo (por ejemplo, el hombro).', 'Tocá el vértice (por ejemplo, el codo).', 'Tocá el otro extremo (por ejemplo, la muñeca).'],
  h: ['Tocá el primer punto del segmento (por ejemplo, la cadera).', 'Tocá el segundo punto (por ejemplo, el hombro). Se mide contra la horizontal del cuadro.'],
  v: ['Tocá el primer punto del segmento (por ejemplo, la cadera).', 'Tocá el segundo punto (por ejemplo, el hombro). Se mide contra la vertical del cuadro.'],
};
const ANG_IDLE = 'Pausá en el cuadro que quieras y marcá los puntos sobre el video: mantené apretado, ubicá el punto con la lupa y soltá. Después podés arrastrarlos para ajustarlos. Con zoom 2× o más el margen baja. La escuadra se mueve desde el vértice y se gira desde el otro extremo.';
// un ángulo pertenece al cuadro donde se midió; si está "fijo" (lo normal) se sigue viendo en todos los
// cuadros, para pausar en otro momento, ajustarlo y leer los grados ahí
const atFrame = (a) => Math.abs(a.t - currentFrameTime()) < S.frameDur * 0.5;
const isHere = (a) => a.pin !== false || atFrame(a);
function visibleAngles(v = 1) { return S.angles.filter(a => (a.v || 1) === v && isHere(a)); }
// pestañas de herramientas debajo del video: una a la vez, para no tener que subir y bajar
function dock(name) {
  if (name !== 'draw' && drawUi?.tool) drawUi.off();
  document.querySelectorAll('#rc-dock-tabs [data-dock]').forEach(b => b.setAttribute('aria-selected', b.dataset.dock === name));
  let shown = null;
  document.querySelectorAll('#view-race .player-col > .panel[data-dock]').forEach(p => { p.hidden = p.dataset.dock !== name; if (!p.hidden) shown = p; });
  // si el panel quedó tapado por el video fijo, se acomoda justo debajo
  const stick = $('rc-stick').getBoundingClientRect();
  if (shown) { const r = shown.getBoundingClientRect(); if (r.top < stick.bottom - 1) window.scrollBy({ top: r.top - stick.bottom - 8 }); }
  if (S.file && video.videoWidth) drawOverlay(); // las referencias de distancia se ven con la pestaña Línea
}
$('rc-dock-tabs').addEventListener('click', (e) => { const b = e.target.closest('[data-dock]'); if (b) dock(b.dataset.dock); });
function startAngle(type) {
  dock('ang');
  video.pause();
  if (S.measure) { S.measure.waiting = null; renderMeasure(); }
  S.angTool = S.angTool?.type === type ? null : { type, pts: [] };
  angToolUi(); drawOverlay();
  if (S.angTool) showPlayer();
}
function showPlayer() {
  const r = player.getBoundingClientRect(), top = (document.querySelector('.topbar')?.offsetHeight || 0) + 8;
  if (r.top < top || r.bottom > innerHeight) window.scrollBy({ top: r.top - top, behavior: 'smooth' });
}
function angToolUi() {
  const t = S.angTool;
  $('rc-ang3').setAttribute('aria-pressed', t?.type === '3p');
  $('rc-angh').setAttribute('aria-pressed', t?.type === 'h');
  $('rc-angv').setAttribute('aria-pressed', t?.type === 'v');
  $('rc-square').setAttribute('aria-pressed', !!S.square);
  $('rc-ang-cancel').hidden = !t;
  overlay.classList.toggle('tool', !!t);
  document.querySelector('.angle-box').classList.toggle('active', !!t);
  $('rc-ang-hint').textContent = t ? `Punto ${t.pts.length + 1} de ${ANG_NEED[t.type]}: ${ANG_HINT[t.type][t.pts.length]}` : ANG_IDLE;
}
$('rc-ang-colors').innerHTML = ANG_COLORS.map(([c, l]) => `<button type="button" class="draw-sw" data-angcolor="${c}" role="radio" aria-checked="${c === S.angColor}" aria-label="${l}" style="--c:${c}"></button>`).join('');
document.querySelectorAll('[data-angcolor]').forEach(b => b.onclick = () => { S.angColor = b.dataset.angcolor; document.querySelectorAll('[data-angcolor]').forEach(x => x.setAttribute('aria-checked', x === b)); drawOverlay(); });
$('rc-ang3').onclick = () => startAngle('3p');
$('rc-angh').onclick = () => startAngle('h');
$('rc-angv').onclick = () => startAngle('v');
// escuadra: referencia de 90° que se mueve desde el vértice y se gira desde el extremo; queda en todos los cuadros
$('rc-square').onclick = () => {
  if (S.square) S.square = null;
  else {
    const W = video.videoWidth, H = video.videoHeight, L = Math.min(W, H) * 0.3;
    S.square = { c: [W * 0.35, H * 0.7], r: [W * 0.35 + L, H * 0.7] };
  }
  autosave(); angToolUi(); drawOverlay();
  if (S.square) showPlayer();
};
$('rc-ang-cancel').onclick = () => { S.angTool = null; angToolUi(); drawOverlay(); };

// toques sobre un video (1 = principal, 2 = segundo video): marcar o arrastrar puntos
function bindAngleCanvas(cv, vid, v) {
  const px = (e) => { const r = cv.getBoundingClientRect(); return [(e.clientX - r.left) / r.width * vid.videoWidth, (e.clientY - r.top) / r.height * vid.videoHeight]; };
  // el punto más cerca del toque (de un ángulo o de la escuadra), a menos de `radio` píxeles de pantalla
  const buscarPunto = (p, radio) => {
    const r = cv.getBoundingClientRect();
    const tol = radio / (r.width / vid.videoWidth);
    let best = null;
    for (const a of visibleAngles(v)) a.pts.forEach((q, k) => {
      const d = Math.hypot(q[0] - p[0], q[1] - p[1]);
      if (d < tol && (!best || d < best.d)) best = { a, k, d };
    });
    if (!best && v === 1 && S.square) {
      for (const k of ['r', 'c']) { const q = S.square[k]; const d = Math.hypot(q[0] - p[0], q[1] - p[1]); if (d < tol * 1.2) { best = { sq: k, d }; break; } }
      if (!best && sqArmHit(p, tol)) best = { sq: 'c', d: 0, grab: [p[0] - S.square.c[0], p[1] - S.square.c[1]] };
    }
    return best;
  };
  // con el dedo: si el toque agarra un punto (o hay una herramienta elegida), que la página no se
  // desplace; si no, el navegador corta el arrastre a mitad de camino y el punto queda trabado
  cv.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 1) return;
    if (S.angTool || (v === 1 && S.pathTool) || buscarPunto(px(e.touches[0]), 30)) e.preventDefault();
  }, { passive: false });
  cv.addEventListener('touchmove', (e) => { if (S.angDrag || S.angPlace) e.preventDefault(); }, { passive: false });
  // el dibujo (lupa y líneas) se hace una vez por cuadro de pantalla, así el punto sigue al dedo sin trabarse
  let rafP = 0, lupaEn = null;
  const pintar = (p) => {
    lupaEn = p;
    if (rafP) return;
    rafP = requestAnimationFrame(() => { rafP = 0; loupe(cv, vid, (S.angDrag && !S.angDrag.sq) || S.angPlace ? lupaEn : null); drawOverlay(); });
  };
  cv.addEventListener('pointerdown', (e) => {
    if (v === 1 && ((S.measure && S.measure.waiting != null) || S.calWait != null)) return;
    const p = px(e);
    if (v === 1 && S.pathTool) { e.preventDefault(); e.stopPropagation(); startTrack(p); return; }
    if (S.angTool) {
      e.preventDefault(); e.stopPropagation();
      const t = S.angTool;
      if (t.pts.length && t.v !== v) return; // los puntos de un ángulo van en el mismo video
      // el punto queda donde se suelta el dedo: mientras está apretado se ajusta con la lupa
      t.v = v; t.pts.push(p); S.angPlace = { k: t.pts.length - 1 };
      cv.setPointerCapture(e.pointerId);
      loupe(cv, vid, p); drawOverlay();
      return;
    }
    const best = buscarPunto(p, e.pointerType === 'mouse' ? 16 : 30);
    if (best) { e.preventDefault(); e.stopPropagation(); S.angDrag = best; cv.setPointerCapture(e.pointerId); }
  });
  cv.addEventListener('pointermove', (e) => {
    if (S.angPlace && S.angTool) {
      const p = clampP(px(e)); S.angTool.pts[S.angPlace.k] = p; pintar(p); return;
    }
    if (!S.angDrag) return;
    const p = px(e);
    if (S.angDrag.sq) {
      if (v !== 1) return;
      const sq = S.square;
      if (S.angDrag.sq === 'r') sq.r = p;
      else { const g = S.angDrag.grab || [0, 0], dx = p[0] - g[0] - sq.c[0], dy = p[1] - g[1] - sq.c[1]; sq.c = [sq.c[0] + dx, sq.c[1] + dy]; sq.r = [sq.r[0] + dx, sq.r[1] + dy]; }
      pintar(null); return;
    }
    if ((S.angDrag.a.v || 1) !== v) return;
    // ajustar un ángulo fijo en otro cuadro lo pasa a medir ese cuadro
    if (!atFrame(S.angDrag.a)) { S.angDrag.a.t = currentFrameTime(); S.angDrag.moved = true; }
    S.angDrag.a.pts[S.angDrag.k] = clampP(p);
    pintar(S.angDrag.a.pts[S.angDrag.k]);
    const el = document.querySelector(`[data-angval="${S.angDrag.a.id}"]`);
    if (el) el.innerHTML = `${f(angleValue(S.angDrag.a), 1)}°<small>${angErrTxt(S.angDrag.a)}</small>`;
  });
  const clampP = (p) => [Math.max(0, Math.min(vid.videoWidth, p[0])), Math.max(0, Math.min(vid.videoHeight, p[1]))];
  const endDrag = () => {
    loupe(cv, vid, null);
    if (S.angPlace) {
      S.angPlace = null;
      const t = S.angTool;
      if (t && t.pts.length === ANG_NEED[t.type]) {
        const n = S.angles.length + 1;
        S.angles.push({ id: Math.random().toString(36).slice(2, 9), type: t.type, t: currentFrameTime(), v, pin: true, pts: t.pts, color: S.angColor, res: vid.videoWidth / cv.getBoundingClientRect().width, label: t.type === '3p' ? `Ángulo ${n}` : `Inclinación ${n}` });
        S.angTool = null;
        angleChanged(true);
      }
      angToolUi(); drawOverlay();
      return;
    }
    if (S.angDrag) { if (!S.angDrag.sq) S.angDrag.a.res = vid.videoWidth / cv.getBoundingClientRect().width; const sq = S.angDrag.sq, moved = S.angDrag.moved; S.angDrag = null; if (sq) autosave(); else { angleChanged(false); if (moved) renderAngles(); } } };
  cv.addEventListener('pointerup', endDrag);
  cv.addEventListener('pointercancel', endDrag);
}
// dibujo y texto: se registra antes que los ángulos para quedarse con el toque cuando hay herramienta elegida
$('rc-draw').innerHTML = `<div class="eyebrow">Dibujo y texto</div>${drawPanelHtml('rc-draw')}`;
drawUi = bindDrawing(overlay, $('rc-draw'), 'rc-draw', {
  list: () => S.drawings, now: currentFrameTime, frameDur: () => S.frameDur, videoSize: () => [video.videoWidth, video.videoHeight],
  editing: () => !$('rc-draw').hidden, changed: autosave, redraw: drawOverlay, pause: () => video.pause(),
});
bindAngleCanvas(overlay, video, 1);

// Herramientas dentro del video: un botón abre una tira sobre el video con lo más usado (ángulos, dibujo,
// color, cuadro a cuadro y clip), para no tener que bajar hasta los paneles. Usa los mismos botones de abajo.
const QT_COLORS = [['#FFD60A', '#ffb020', 'Amarillo'], ['#ffffff', '#ffffff', 'Blanco'], ['#ff4d4d', '#ff4d4d', 'Rojo'], ['#38d9ff', '#38d9ff', 'Celeste'], ['#5cff7a', '#5cff7a', 'Verde']];
const drawBtn = (k) => $('rc-draw').querySelector(`[data-draw="${k}"]`);
const drawOn = (k) => !$('rc-draw').hidden && drawBtn(k).getAttribute('aria-pressed') === 'true';
function quickDraw(k) {
  if (S.angTool) $('rc-ang-cancel').click();
  if (k === 'text' && !drawOn('text')) {
    const t = prompt('Texto de la nota (después tocá el video donde va)', $('rc-draw-text').value || '');
    if (!t) return;
    $('rc-draw-text').value = t;
  }
  if ($('rc-draw').hidden) { const y = scrollY; dock('draw'); scrollTo(0, y); }
  drawBtn(k).click();
}
const QT = [
  ['ang', 'Ángulo', () => $('rc-ang3').click(), () => S.angTool?.type === '3p'],
  ['angh', 'Horizontal', () => $('rc-angh').click(), () => S.angTool?.type === 'h'],
  ...['line', 'arrow', 'circle', 'text', 'free'].map(k => [k, { line: 'Línea', arrow: 'Flecha', circle: 'Círculo', text: 'Texto', free: 'Mano' }[k], () => quickDraw(k), () => drawOn(k)]),
];
const qtState = { color: 0 };
player.insertAdjacentHTML('beforeend', `<button type="button" class="qt-fab" id="rc-qt-fab" aria-expanded="false"><svg width="16" height="16"><use href="#i-angle"/></svg>Herramientas</button>
  <div class="qt-wrap" id="rc-qt" hidden><p class="qt-hint" id="rc-qt-hint" hidden></p><div class="qt-bar" role="toolbar" aria-label="Herramientas sobre el video">
  <button type="button" class="qt-color" id="rc-qt-color" aria-label="Cambiar color"><i></i></button>
  ${QT.map(([id, l]) => `<button type="button" class="qt-btn" data-qt="${id}" aria-pressed="false">${l}</button>`).join('')}
  <button type="button" class="qt-btn" data-qtstep="-1" aria-label="Cuadro anterior">◀</button><button type="button" class="qt-btn" data-qtstep="1" aria-label="Cuadro siguiente">▶</button>
  <button type="button" class="qt-btn" id="rc-qt-clip">Clip</button>
  <button type="button" class="qt-btn qt-close" id="rc-qt-close" aria-label="Cerrar herramientas">✕</button></div></div>`);
function qtSync() {
  if ($('rc-qt').hidden) return;
  let on = false;
  for (const [id, , , act] of QT) { const a = !!act(); on ||= a; $('rc-qt').querySelector(`[data-qt="${id}"]`).setAttribute('aria-pressed', a); }
  const h = S.angTool ? $('rc-ang-hint').textContent : on ? $('rc-draw-hint').textContent : '';
  $('rc-qt-hint').textContent = h; $('rc-qt-hint').hidden = !h;
  $('rc-qt-color').style.setProperty('--c', QT_COLORS[qtState.color][0]);
}
function qtColor(i) {
  qtState.color = i;
  const [ca, cd] = QT_COLORS[i];
  document.querySelector(`[data-angcolor="${ca}"]`)?.click();
  $('rc-draw').querySelector(`[data-color="${cd}"]`)?.click();
  qtSync();
}
function qtOpen(open) {
  $('rc-qt').hidden = !open; $('rc-qt-fab').hidden = open; $('rc-qt-fab').setAttribute('aria-expanded', open);
  if (!open) { if (S.angTool) $('rc-ang-cancel').click(); if (drawUi?.tool) drawUi.off(); chipsUi(); }
  qtSync();
}
$('rc-qt-fab').onclick = () => qtOpen(true);
$('rc-qt-close').onclick = () => qtOpen(false);
$('rc-qt-color').onclick = () => qtColor((qtState.color + 1) % QT_COLORS.length);
$('rc-qt-clip').onclick = () => { qtOpen(false); dock('clip'); };
$('rc-qt').querySelectorAll('[data-qt]').forEach(b => b.onclick = () => { video.pause(); QT.find(q => q[0] === b.dataset.qt)[2](); qtSync(); });
$('rc-qt').querySelectorAll('[data-qtstep]').forEach(b => b.onclick = () => { step(+b.dataset.qtstep); qtSync(); });
overlay.addEventListener('pointerup', () => setTimeout(qtSync, 0));

// Lupa: muestra ampliada la zona del punto que se está marcando, arriba del dedo, con una cruz en el
// centro (sin las marcas encima, para ver la articulación), para ubicar el punto con precisión de píxel.
function loupe(cv, vid, p) {
  const host = cv.closest('.player');
  let L = host.querySelector('.loupe');
  if (!p) { if (L) L.hidden = true; return; }
  if (!L) { L = document.createElement('canvas'); L.className = 'loupe'; L.setAttribute('aria-hidden', 'true'); host.appendChild(L); }
  const dpr = window.devicePixelRatio || 1, size = 132, zoom = 4;
  L.width = L.height = size * dpr; L.hidden = false;
  const r = cv.getBoundingClientRect(), hr = host.getBoundingClientRect();
  const scr = r.width / vid.videoWidth; // píxeles de pantalla por píxel de video
  const half = size / 2 / (scr * zoom); // medio lado de la zona, en píxeles de video
  const ctx = L.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, L.width, L.height);
  ctx.drawImage(vid, p[0] - half, p[1] - half, half * 2, half * 2, 0, 0, L.width, L.height);
  const c = L.width / 2;
  ctx.strokeStyle = 'rgba(0,0,0,.8)'; ctx.lineWidth = 3 * dpr;
  ctx.beginPath(); ctx.moveTo(c - 14 * dpr, c); ctx.lineTo(c + 14 * dpr, c); ctx.moveTo(c, c - 14 * dpr); ctx.lineTo(c, c + 14 * dpr); ctx.stroke();
  ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.2 * dpr; ctx.stroke();
  // arriba del punto; si no entra, abajo
  const x = r.left - hr.left + p[0] * scr, y = r.top - hr.top + p[1] * scr;
  const top = y - size - 36 >= 0 ? y - size - 36 : y + 36;
  L.style.left = `${Math.max(4, Math.min(hr.width - size - 4, x - size / 2))}px`;
  L.style.top = `${Math.max(4, Math.min(hr.height - size - 4, top))}px`;
}

function sqGeom(sq) {
  const ux = sq.r[0] - sq.c[0], uy = sq.r[1] - sq.c[1];
  return { a: sq.r, b: [sq.c[0] + uy, sq.c[1] - ux] }; // segundo brazo: perpendicular, mismo largo, hacia arriba
}
function sqArmHit(p, tol) {
  const sq = S.square, { a, b } = sqGeom(sq);
  const near = (q) => { const vx = q[0] - sq.c[0], vy = q[1] - sq.c[1], L = vx * vx + vy * vy || 1; const t = Math.max(0, Math.min(1, ((p[0] - sq.c[0]) * vx + (p[1] - sq.c[1]) * vy) / L)); return Math.hypot(sq.c[0] + t * vx - p[0], sq.c[1] + t * vy - p[1]) < tol * 0.6; };
  return near(a) || near(b);
}
function drawSquare(ctx, sc, dpr, clean) {
  const sq = S.square;
  if (!sq) return;
  const P = (q) => [q[0] * sc, q[1] * sc];
  const c = P(sq.c), { a: a0, b: b0 } = sqGeom(sq), a = P(a0), b = P(b0);
  const col = '#ffffff';
  ctx.save();
  ctx.lineCap = 'round';
  // brazos con sombra y marcas cada 10% del largo
  for (const [w, s] of [[4.5 * dpr, 'rgba(0,0,0,0.55)'], [2 * dpr, col]]) {
    ctx.strokeStyle = s; ctx.lineWidth = w;
    ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(c[0], c[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
  }
  ctx.strokeStyle = 'rgba(255,255,255,0.75)'; ctx.lineWidth = 1 * dpr;
  for (const q of [a, b]) for (let k = 1; k < 10; k++) {
    const x = c[0] + (q[0] - c[0]) * k / 10, y = c[1] + (q[1] - c[1]) * k / 10;
    const nx = -(q[1] - c[1]), ny = q[0] - c[0], n = Math.hypot(nx, ny) || 1, m = (k === 5 ? 7 : 4) * dpr;
    ctx.beginPath(); ctx.moveTo(x - nx / n * m, y - ny / n * m); ctx.lineTo(x + nx / n * m, y + ny / n * m); ctx.stroke();
  }
  // marca de ángulo recto
  const s = 12 * dpr, ua = [(a[0] - c[0]), (a[1] - c[1])], ub = [(b[0] - c[0]), (b[1] - c[1])], na = Math.hypot(...ua) || 1, nb = Math.hypot(...ub) || 1;
  ctx.strokeStyle = col; ctx.lineWidth = 1.5 * dpr; ctx.beginPath();
  ctx.moveTo(c[0] + ua[0] / na * s, c[1] + ua[1] / na * s); ctx.lineTo(c[0] + ua[0] / na * s + ub[0] / nb * s, c[1] + ua[1] / na * s + ub[1] / nb * s); ctx.lineTo(c[0] + ub[0] / nb * s, c[1] + ub[1] / nb * s); ctx.stroke();
  // giro respecto de la horizontal
  const rot = Math.atan2(-(sq.r[1] - sq.c[1]), sq.r[0] - sq.c[0]) * 180 / Math.PI;
  ctx.font = `600 ${12 * dpr}px "Geist Mono", monospace`;
  const txt = `escuadra ${rot >= 0 ? '' : '−'}${f(Math.abs(rot), 1)}°`, w = ctx.measureText(txt).width;
  const lx = Math.max(4 * dpr, Math.min(ctx.canvas.width - w - 10 * dpr, c[0] + 10 * dpr)), ly = Math.min(ctx.canvas.height - 6 * dpr, c[1] + 22 * dpr);
  ctx.fillStyle = 'rgba(4,10,16,0.78)'; ctx.fillRect(lx - 5 * dpr, ly - 14 * dpr, w + 10 * dpr, 19 * dpr);
  ctx.fillStyle = col; ctx.fillText(txt, lx, ly);
  // agarres: vértice (mover) y extremo (girar y estirar)
  if (!clean) for (const [q, r] of [[c, 7], [a, 6]]) { ctx.fillStyle = '#fff'; ctx.strokeStyle = '#000'; ctx.lineWidth = 1.5 * dpr; ctx.beginPath(); ctx.arc(q[0], q[1], r * dpr, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); }
  ctx.restore();
}

function drawAngles(ctx, sc, dpr, list) {
  const def = getComputedStyle(document.documentElement).getPropertyValue('--overlay').trim() || '#ff9f1c';
  const P = (q) => [q[0] * sc, q[1] * sc];
  const lw = 2.2 * dpr;
  const handle = (q) => { ctx.fillStyle = '#fff'; ctx.strokeStyle = '#000'; ctx.lineWidth = 1.5 * dpr; ctx.beginPath(); ctx.arc(q[0], q[1], 5.5 * dpr, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); };
  // etiqueta centrada en (x, y), sin salirse del cuadro
  const label = (txt, x, y) => {
    ctx.font = `600 ${14 * dpr}px "Geist Mono", monospace`;
    const w = ctx.measureText(txt).width;
    x = Math.max(6 * dpr, Math.min(ctx.canvas.width - w - 6 * dpr, x - w / 2));
    y = Math.max(18 * dpr, Math.min(ctx.canvas.height - 8 * dpr, y));
    ctx.fillStyle = 'rgba(4,10,16,0.78)'; ctx.fillRect(x - 5 * dpr, y - 15 * dpr, w + 10 * dpr, 21 * dpr);
    ctx.fillStyle = col; ctx.fillText(txt, x, y);
  };
  const shadow = (fn) => { ctx.save(); ctx.strokeStyle = 'rgba(0,0,0,0.55)'; ctx.lineWidth = lw + 2.5 * dpr; fn(); ctx.restore(); ctx.strokeStyle = col; ctx.lineWidth = lw; fn(); };
  let col = def;
  for (const a of list) {
    col = a.color || def; // cada ángulo con su color
    const pts = a.pts.map(P);
    if (a.type === 'v') {
      const [p, q] = pts;
      if (q) {
        shadow(() => { ctx.beginPath(); ctx.moveTo(p[0], p[1]); ctx.lineTo(q[0], q[1]); ctx.stroke(); });
        const dir = q[1] >= p[1] ? 1 : -1, len = Math.max(40 * dpr, Math.abs(q[1] - p[1]) * 0.7);
        ctx.setLineDash([5 * dpr, 4 * dpr]); ctx.strokeStyle = 'rgba(255,255,255,0.8)'; ctx.lineWidth = 1.5 * dpr;
        ctx.beginPath(); ctx.moveTo(p[0], p[1]); ctx.lineTo(p[0], p[1] + dir * len); ctx.stroke(); ctx.setLineDash([]);
        const ang = Math.atan2(q[1] - p[1], q[0] - p[0]), base = dir > 0 ? Math.PI / 2 : -Math.PI / 2, rad = 30 * dpr;
        let d = ang - base; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI;
        ctx.strokeStyle = col; ctx.lineWidth = 1.8 * dpr; ctx.beginPath(); ctx.arc(p[0], p[1], rad, base, base + d, d < 0); ctx.stroke();
        const mid = base + d / 2;
        label(`${f(angleValue(a), 1)}°`, p[0] + Math.cos(mid) * (rad + 26 * dpr), p[1] + Math.sin(mid) * (rad + 20 * dpr) + 5 * dpr);
      }
    } else if (a.type === 'h') {
      const [p, q] = pts;
      if (q) {
        shadow(() => { ctx.beginPath(); ctx.moveTo(p[0], p[1]); ctx.lineTo(q[0], q[1]); ctx.stroke(); });
        // referencia horizontal y arco
        const dir = q[0] >= p[0] ? 1 : -1, len = Math.max(40 * dpr, Math.abs(q[0] - p[0]) * 0.7);
        ctx.setLineDash([5 * dpr, 4 * dpr]); ctx.strokeStyle = 'rgba(255,255,255,0.8)'; ctx.lineWidth = 1.5 * dpr;
        ctx.beginPath(); ctx.moveTo(p[0], p[1]); ctx.lineTo(p[0] + dir * len, p[1]); ctx.stroke(); ctx.setLineDash([]);
        const ang = Math.atan2(q[1] - p[1], q[0] - p[0]), base = dir > 0 ? 0 : Math.PI, rad = 30 * dpr;
        let d = ang - base; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI;
        ctx.strokeStyle = col; ctx.lineWidth = 1.8 * dpr; ctx.beginPath(); ctx.arc(p[0], p[1], rad, base, base + d, d < 0); ctx.stroke();
        const mid = base + d / 2;
        label(`${f(angleValue(a), 1)}°`, p[0] + Math.cos(mid) * (rad + 26 * dpr), p[1] + Math.sin(mid) * (rad + 14 * dpr) + 5 * dpr);
      }
    } else {
      const [p, v, q] = pts;
      if (!v) { pts.forEach(handle); continue; }
      shadow(() => { ctx.beginPath(); ctx.moveTo(p[0], p[1]); ctx.lineTo(v[0], v[1]); if (q) ctx.lineTo(q[0], q[1]); ctx.stroke(); });
      if (q) {
        const a1 = Math.atan2(p[1] - v[1], p[0] - v[0]), a2 = Math.atan2(q[1] - v[1], q[0] - v[0]);
        let d = a2 - a1; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI;
        const rad = 28 * dpr;
        ctx.strokeStyle = col; ctx.lineWidth = 1.8 * dpr; ctx.beginPath(); ctx.arc(v[0], v[1], rad, a1, a1 + d, d < 0); ctx.stroke();
        const mid = a1 + d / 2;
        label(`${f(angleValue(a), 1)}°`, v[0] + Math.cos(mid) * (rad + 30 * dpr), v[1] + Math.sin(mid) * (rad + 22 * dpr) + 5 * dpr);
      }
    }
    pts.forEach(handle);
  }
}
// ángulo en curso (puntos tocados sin completar)
function drawPending(ctx, sc, dpr, v = 1) {
  const t = S.angTool;
  if (!t || !t.pts.length || (t.v || 1) !== v) return;
  drawAngles(ctx, sc, dpr, [{ type: t.type, pts: t.pts, color: S.angColor }]);
}

function angleChanged(created) {
  autosave(); renderAngles();
  if (created) $('rc-tabs').querySelector('[data-tab="ang"]').click();
}
// margen de marcado en grados (un píxel de pantalla al marcar, o el del zoom con que se marcó)
function angErrTxt(a) {
  const err = angleError(a, Math.max(0.5, a.res || 1));
  return Number.isFinite(err) ? ` ±${f(Math.max(0.1, err), 1)}°` : '';
}
function renderAngles() {
  $('rc-ang-count').textContent = S.angles.length || '';
  const box = $('rc-tab-ang');
  if (!S.angles.length) {
    box.innerHTML = `<p class="metric-detail">Todavía no hay ángulos. Pausá el video, tocá "Ángulo (3 puntos)" o "Contra la horizontal" y marcá los puntos sobre el cuadro.</p>
      <p class="fine">Son ángulos 2D en el plano de la imagen: dependen del ángulo de la cámara. Con la cámara perpendicular al nadador el error es menor.</p>`;
    return;
  }
  const list = S.angles.slice().sort((a, b) => a.t - b.t);
  box.innerHTML = `<ul class="ang-list">${list.map(a => {
    const tr = raceTime(a.t);
    return `<li class="ang-item${atFrame(a) ? ' here' : ''}" data-ang="${a.id}"${a.color ? ` style="--ac:${a.color}"` : ''}>
      <input type="text" value="${esc(a.label)}" list="ang-labels" data-anglabel="${a.id}" aria-label="Nombre del ángulo" maxlength="60">
      <span class="ang-val" data-angval="${a.id}">${f(angleValue(a), 1)}°<small>${angErrTxt(a)}</small></span>
      <span class="ang-meta"><span class="mono">${Number.isFinite(tr) ? `${f(tr, 2)} s de carrera` : `video ${f(a.t, 3)} s`}</span> · ${ANGLE_TYPE_LABEL[a.type]}${a.v === 2 ? ' · segundo video' : ''}
        <button class="btn ghost small" data-anggo="${a.id}">Ir al cuadro</button><button class="btn ghost small" data-angpin="${a.id}" aria-pressed="${a.pin !== false}">${a.pin !== false ? 'Fijo en el video' : 'Solo en su cuadro'}</button><button class="btn ghost small danger" data-angdel="${a.id}">Borrar</button></span>
    </li>`;
  }).join('')}</ul>
  <p class="fine">Ángulos 2D en el plano de la imagen, medidos por el analista. Arrastrá los puntos sobre el video para ajustarlos. Un ángulo "fijo" se ve en todos los cuadros: pausá donde quieras (por ejemplo, en la salida), ajustalo y se guarda en ese cuadro. El ± es el margen por el marcado: un corrimiento de un píxel de pantalla en cada punto, con el zoom que usaste. Baja con más zoom y con brazos más largos (marcá puntos alejados del vértice sobre el mismo segmento). No incluye el error por la perspectiva de la cámara.</p>`;
  const find = (id) => S.angles.find(a => a.id === id);
  box.querySelectorAll('[data-anglabel]').forEach(i => i.onchange = () => { const a = find(i.dataset.anglabel); if (a) { a.label = i.value.trim() || a.label; autosave(); } });
  box.querySelectorAll('[data-anggo]').forEach(b => b.onclick = () => { const a = find(b.dataset.anggo); if (a) seek(a.t); });
  box.querySelectorAll('[data-angpin]').forEach(b => b.onclick = () => { const a = find(b.dataset.angpin); if (a) { a.pin = a.pin === false; autosave(); renderAngles(); drawOverlay(); } });
  box.querySelectorAll('[data-angdel]').forEach(b => b.onclick = () => { S.angles = S.angles.filter(a => a.id !== b.dataset.angdel); angleChanged(false); drawOverlay(); });
}
function markAngleRows() {
  document.querySelectorAll('.ang-item').forEach(li => { const a = S.angles.find(x => x.id === li.dataset.ang); li.classList.toggle('here', !!a && atFrame(a)); });
}

// Fotograma del video con los ángulos de ese cuadro dibujados, para el PDF.
async function captureAngleFrame(a, maxW = 1100) {
  await new Promise((resolve) => {
    const target = Math.max(0, Math.min(video.duration - 1e-3, a.t + S.frameDur * 0.5));
    if (Math.abs(video.currentTime - target) < 1e-4) return resolve();
    video.addEventListener('seeked', () => setTimeout(resolve, 80), { once: true });
    video.currentTime = target;
  });
  const sc = Math.min(1, maxW / video.videoWidth);
  const c = document.createElement('canvas');
  c.width = Math.round(video.videoWidth * sc); c.height = Math.round(video.videoHeight * sc);
  const ctx = c.getContext('2d');
  ctx.drawImage(video, 0, 0, c.width, c.height);
  renderDrawings(ctx, S.drawings.filter(d => drawingVisible(d, a.t, S.frameDur)), sc, Math.max(1, c.width / 700));
  drawAngles(ctx, sc, Math.max(1, c.width / 700), S.angles.filter(x => (x.v || 1) === 1 && Math.abs(x.t - a.t) < S.frameDur * 0.5));
  return c;
}

// ---------- segundo video sincronizado ----------
// Se muestra junto al principal con un desfase fijo: t2 = t1 + offset. Sigue al principal al reproducir y al ir cuadro a cuadro.
const video2 = $('rc-video2'), overlay2 = $('rc-overlay2'), stage2 = $('rc-stage2'), dual = $('rc-dual');
const V2 = { on: false, file: null, url: null, offset: 0, frameDur: 1 / 30, mode: 'side' };
bindAngleCanvas(overlay2, video2, 2);

function v2Target() { return Math.max(0, Math.min((video2.duration || 0) - 1e-3, video.currentTime + V2.offset)); }
function v2Sync(force) {
  if (!V2.on || !video2.duration) return;
  const target = v2Target();
  if (video.paused) { if (force || Math.abs(video2.currentTime - target) > 1e-3) { video2.pause(); video2.currentTime = target; } }
  else if (Math.abs(video2.currentTime - target) > 0.06) video2.currentTime = target;
  const t2 = video.currentTime + V2.offset;
  $('rc-hud2').textContent = t2 < 0 || t2 > video2.duration ? 'fuera del segundo video' : `video 2 · ${f(t2, 3)} s`;
}
video.addEventListener('play', () => { if (V2.on) { video2.playbackRate = video.playbackRate; v2Sync(true); video2.play().catch(() => {}); } });
video.addEventListener('pause', () => { if (V2.on) { video2.pause(); v2Sync(true); } });
video.addEventListener('ratechange', () => { video2.playbackRate = video.playbackRate; });
video.addEventListener('seeked', () => v2Sync(true));
video2.addEventListener('seeked', () => drawOverlay2());

async function loadV2(file) {
  if (V2.url) URL.revokeObjectURL(V2.url);
  V2.file = file; V2.url = URL.createObjectURL(file);
  await new Promise((resolve, reject) => {
    video2.onloadeddata = resolve;
    video2.onerror = () => reject(new Error('Este navegador no puede decodificar el segundo video.'));
    video2.src = V2.url; video2.load();
  });
  const timing = await readFrameTimes(file).catch(() => null);
  V2.frameDur = timing?.frameDur || 1 / 30;
  stage2.style.aspectRatio = `${video2.videoWidth} / ${video2.videoHeight}`;
  V2.on = true;
  // si es el mismo archivo que antes, recupera el desfase guardado
  if (S.v2meta && S.v2meta.fileName === file.name) { V2.offset = S.v2meta.offset; V2.mode = S.v2meta.mode || 'side'; }
  else V2.offset = 0;
  v2Ui(); setV2Mode(V2.mode); v2Sync(true); v2Saved();
  requestAnimationFrame(() => { resizeCanvases(); });
}
function v2Saved() { S.v2meta = V2.on ? { fileName: V2.file.name, offset: V2.offset, mode: V2.mode } : S.v2meta; autosave(); }
function v2Ui() {
  chipsUi();
  $('rc-v2-empty').hidden = V2.on; $('rc-v2-ctrl').hidden = !V2.on; $('rc-dock-v2dot').hidden = !V2.on; $('rc-player2').hidden = !V2.on;
  $('rc-v2-name').textContent = V2.file ? V2.file.name : '';
  $('rc-v2-off').textContent = `${V2.offset >= 0 ? '+' : '−'}${f(Math.abs(V2.offset), 3)} s`;
  if (!V2.on) dual.dataset.mode = 'single';
}
function setV2Mode(m) {
  V2.mode = m; dual.dataset.mode = V2.on ? m : 'single';
  document.querySelectorAll('[data-v2mode]').forEach(b => b.setAttribute('aria-selected', b.dataset.v2mode === m));
  $('rc-v2-oplabel').hidden = m !== 'blend';
  requestAnimationFrame(() => { resizeCanvases(); });
}
$('rc-v2-file').onchange = async (e) => {
  const file = e.target.files[0]; e.target.value = '';
  if (!file) return;
  try { await loadV2(file); msg(''); } catch (err) { msg(err.message); }
};
$('rc-v2-remove').onclick = () => { V2.on = false; video2.pause(); video2.removeAttribute('src'); video2.load(); S.v2meta = null; autosave(); v2Ui(); resizeCanvases(); };
document.querySelectorAll('[data-v2mode]').forEach(b => b.onclick = () => { setV2Mode(b.dataset.v2mode); v2Saved(); });
$('rc-v2-op').oninput = (e) => dual.style.setProperty('--v2op', e.target.value / 100);
document.querySelectorAll('[data-v2step]').forEach(b => b.onclick = () => {
  video.pause();
  V2.offset = Math.round((V2.offset + (+b.dataset.v2step) * V2.frameDur) * 1e4) / 1e4;
  v2Ui(); v2Sync(true); v2Saved();
});
$('rc-v2-auto').onclick = async () => {
  const btn = $('rc-v2-auto'); btn.disabled = true; const l = btn.textContent; btn.textContent = 'Buscando la bocina en los dos videos…';
  try {
    const [a, b] = await Promise.all([findStartSignal(S.file), findStartSignal(V2.file)]);
    const c1 = a.candidates?.[0], c2 = b.candidates?.[0];
    if (!c1 || !c2) { $('rc-v2-hint').textContent = `No se encontró la bocina en ${!c1 && !c2 ? 'ninguno de los dos videos' : !c1 ? 'el video principal' : 'el segundo video'}. Sincronizá a mano con los botones de cuadro.`; return; }
    V2.offset = Math.round((c2.t - c1.t) * 1e4) / 1e4;
    v2Ui(); seek(c1.t); v2Saved();
    $('rc-v2-hint').textContent = `Bocina a los ${f(c1.t, 3)} s del principal y a los ${f(c2.t, 3)} s del segundo. Verificá en un momento visible en los dos y corregí cuadro a cuadro si hace falta. Bajo el agua el sonido llega casi 4 veces más rápido, así que la diferencia de distancia a la bocina cambia poco el resultado.`;
  } catch (err) { $('rc-v2-hint').textContent = 'No se pudo leer el audio: ' + err.message; }
  finally { btn.disabled = false; btn.textContent = l; }
};
function drawOverlay2() {
  if (!V2.on) return;
  const ctx = overlay2.getContext('2d');
  ctx.clearRect(0, 0, overlay2.width, overlay2.height);
  if (!video2.videoWidth) return;
  const sc = overlay2.width / video2.videoWidth, dpr = (window.devicePixelRatio || 1) * Math.min(1, Math.max(0.55, stage2.clientWidth / 420));
  drawAngles(ctx, sc, dpr, visibleAngles(2));
  drawPending(ctx, sc, dpr, 2);
}
async function captureAngleFrame2(a, maxW = 1100) {
  await new Promise((resolve) => {
    const target = Math.max(0, Math.min(video2.duration - 1e-3, a.t + S.frameDur * 0.5 + V2.offset));
    if (Math.abs(video2.currentTime - target) < 1e-4) return resolve();
    video2.addEventListener('seeked', () => setTimeout(resolve, 80), { once: true });
    video2.currentTime = target;
  });
  const sc = Math.min(1, maxW / video2.videoWidth);
  const c = document.createElement('canvas');
  c.width = Math.round(video2.videoWidth * sc); c.height = Math.round(video2.videoHeight * sc);
  const ctx = c.getContext('2d');
  ctx.drawImage(video2, 0, 0, c.width, c.height);
  drawAngles(ctx, sc, Math.max(1, c.width / 700), S.angles.filter(x => x.v === 2 && Math.abs(x.t - a.t) < S.frameDur * 0.5));
  return c;
}

// ---------- render ----------
function changed() { recompute(); render(); autosave(); }
function recompute() { S.res = computeRace(S.cfg, S.ev, S.cycles); }

function render() {
  recompute();
  const s = S.slots[S.cur];
  $('rc-cur-label').textContent = s ? s.label : 'Todos los eventos marcados';
  $('rc-cur-hint').textContent = s ? s.hint : '';
  $('rc-mark').textContent = s && S.ev[s.id] ? 'Volver a marcar aquí' : 'Marcar en este cuadro';
  $('rc-cycle-n').textContent = S.cycles.length;
  renderEvents();
  renderSheet();
  renderAngles();
  angToolUi();
  hud();
}

function renderEvents() {
  const ol = $('rc-events');
  ol.innerHTML = S.slots.map((s, i) => {
    const e = S.ev[s.id];
    const tr = e ? raceTime(e.t) : NaN;
    const time = e ? (Number.isFinite(tr) ? `${f(tr, 2)} s` : `video ${f(e.t, 3)}`) : '–';
    const dist = s.needsDist ? `<span class="ev-dist"><input type="text" inputmode="decimal" data-dist="${s.id}" value="${e && Number.isFinite(e.dist) ? String(e.dist).replace('.', ',') : ''}" placeholder="m" aria-label="Distancia del break out en metros"><button class="btn ghost small" data-measure="${s.id}">Medir</button></span>` : '';
    return `<li class="${i === S.cur ? 'cur' : ''} ${e ? 'done' : ''}" data-i="${i}"><button class="ev-main" data-sel="${i}"><span class="ev-label">${esc(s.label)}</span><span class="ev-time mono">${time}</span></button>${dist}${e ? `<button class="icon-btn mini" data-clear="${s.id}" aria-label="Borrar marca">×</button>` : ''}</li>`;
  }).join('');
  ol.querySelectorAll('[data-sel]').forEach(b => b.onclick = () => {
    S.cur = +b.dataset.sel;
    const e = S.ev[S.slots[S.cur].id];
    if (e) seek(e.t);
    render();
  });
  ol.querySelectorAll('[data-clear]').forEach(b => b.onclick = () => { delete S.ev[b.dataset.clear]; changed(); });
  ol.querySelectorAll('[data-dist]').forEach(inp => inp.onchange = () => {
    const v = parseFloat(inp.value.replace(',', '.'));
    const id = inp.dataset.dist;
    if (!S.ev[id]) S.ev[id] = { t: NaN };
    if (Number.isFinite(v)) { S.ev[id].dist = v; S.ev[id].distMethod = 'ingresada por el analista'; } else delete S.ev[id].dist;
    if (!Number.isFinite(S.ev[id].t) && !Number.isFinite(S.ev[id].dist)) delete S.ev[id];
    changed();
  });
  ol.querySelectorAll('[data-measure]').forEach(b => b.onclick = () => openMeasure(b.dataset.measure));
  const cur = ol.querySelector('li.cur');
  if (cur && document.activeElement?.tagName !== 'INPUT') cur.scrollIntoView({ block: 'nearest' });
}

function th(cells) { return `<tr>${cells.map(c => `<th>${c}</th>`).join('')}</tr>`; }
function td(cells) { return `<tr>${cells.map((c, i) => i === 0 ? `<th scope="row">${c}</th>` : `<td>${c}</td>`).join('')}</tr>`; }

function renderSheet() {
  const r = S.res;
  const syncTxt = {
    oficial: `Tiempo cero sincronizado con el tiempo oficial (${f(S.cfg.officialTime, 2)} s) en la llegada.`,
    sonido: `Tiempo cero en la señal sonora, corregida ${f(r.sync.delay * 1000, 0)} ms por la distancia de la cámara (${f(S.cfg.cameraDistance, 0)} m).`,
    visual: 'Tiempo cero en la señal marcada.',
    ninguno: 'Sin tiempo cero todavía: marcá la señal de salida.',
  }[r.sync.method];
  let h = wrLine() + `<p class="fine sync">${esc(syncTxt)} Resolución temporal: ±${f(S.frameDur * 1000, 0)} ms por evento (1 cuadro).</p>`;
  if (r.warnings.length) h += r.warnings.map(w => `<div class="obs media">${esc(w)}</div>`).join('');
  const st = r.start;
  h += `<div class="mgroup">Salida</div><div class="table-wrap"><table class="data sheet">
    ${th(['', 'Valor'])}
    ${td(['Reacción oficial', Number.isFinite(st.reaction) ? f(st.reaction) + ' s' : 'no cargada'])}
    ${td(['Tiempo de bloque', Number.isFinite(st.blockTime) ? f(st.blockTime) + ' s' : '–'])}
    ${td(['Tiempo de vuelo', Number.isFinite(st.flightTime) ? f(st.flightTime) + ' s' : '–'])}
    ${td(['Distancia de break out', Number.isFinite(st.breakoutDist) ? f(st.breakoutDist) + ' m' : '–'])}
    ${td(['Tiempo de break out', Number.isFinite(st.breakoutTime) ? f(st.breakoutTime) + ' s' : '–'])}
    ${td(['Velocidad bloque–break out', Number.isFinite(st.underwaterSpeed) ? f(st.underwaterSpeed) + ' m/s' : '–'])}
  </table></div>`;
  const secs = r.sections;
  h += `<div class="mgroup">Parciales</div><div class="table-wrap"><table class="data sheet wide">
    ${th(['', ...secs.map(s => `${s.dist} m${s.kind === 'wall' ? ' ↺' : s.kind === 'finish' ? ' ⏹' : ''}`)])}
    ${td(['T total (s)', ...secs.map(s => f(s.cumulative))])}
    ${td(['T parcial (s)', ...secs.map(s => f(s.partial))])}
    ${td(['Velocidad (m/s)', ...secs.map(s => f(s.speed))])}
    ${td(['Ciclos', ...secs.map(s => s.cycles ?? '–')])}
    ${td(['Frecuencia (ciclos/min)', ...secs.map(s => f(s.strokeRate, 1))])}
    ${td(['Tiempo por ciclo (s)', ...secs.map(s => f(secPerCycle(s.strokeRate)))])}
    ${td(['Brazadas/min', ...secs.map(s => f(strokesPerMin(s.strokeRate, S.cfg.style), 1))])}
    ${td(['Dist. por ciclo (m)', ...secs.map(s => f(s.dps))])}
  </table></div>`;
  if (r.turns.length) {
    h += `<div class="mgroup">Virajes</div><div class="table-wrap"><table class="data sheet wide">
      ${th(['', ...r.turns.map(t => `${t.wall} m`)])}
      ${td(['5 m in (s)', ...r.turns.map(t => f(t.in5))])}
      ${td(['15 m out (s)', ...r.turns.map(t => f(t.out15))])}
      ${td(['Giro 5+15 (s)', ...r.turns.map(t => f(t.turnTime))])}
      ${td(['Contacto en pared (s)', ...r.turns.map(t => f(t.contact))])}
      ${td(['Break out (m)', ...r.turns.map(t => f(t.breakoutDist))])}
      ${td(['T pared–break out (s)', ...r.turns.map(t => f(t.breakoutTime))])}
      ${td(['Vel. subacuática (m/s)', ...r.turns.map(t => f(t.underwaterSpeed))])}
    </table></div>`;
  }
  h += `<p class="fine">↺ pared de viraje · ⏹ llegada. La distancia por ciclo solo se calcula en tramos de nado limpio (después del break out y sin pared). Las secciones sin marcas quedan vacías: no se interpolan tiempos.</p>`;
  $('rc-tab-sheet').innerHTML = h;

  let lh = `<div class="table-wrap"><table class="data sheet wide">${th(['Largo', 'Parcial (s)', 'Acumulado (s)', 'Ciclos', 'Vel. nado limpio (m/s)', 'Frecuencia (c/min)', 'Dist. por ciclo (m)', 'Técnica'])}`;
  for (const l of r.laps) { const w = lapWindow(l.lap - 1); lh += td([l.lap, f(l.split), f(l.cumulative), l.cycles ?? '–', f(l.cleanSpeed), f(l.strokeRate, 1), f(l.dps), w ? `<button class="btn ghost small" type="button" data-lap-tech="${l.lap - 1}" title="Analizar la técnica de ${f(w.t0, 1)} a ${f(w.t1, 1)} s del video">Analizar</button>` : '<small>falta marcar</small>']); }
  lh += `</table></div><p class="fine">Técnica: abre el análisis de técnica solo con el nado de ese largo (del break out a la pared, o desde la entrada en el primero), con los datos de la prueba. Sirve si la toma muestra al nadador lo bastante grande.</p>`;
  lh += `<p class="fine">Velocidad de nado limpio: tramos entre marcas posteriores al break out, sin contar la llegada a la pared.</p>`;
  const fat = raceFatigue(r, S.frameDur);
  lh += `<div class="mgroup">Fatiga: primer largo contra el último</div>` + (fat.error ? `<p class="metric-detail">${esc(fat.error)}</p>`
    : fatigueTable(fat.rows, f, [`Largo ${fat.first}`, `Largo ${fat.last}`]) + `<p class="fine">Nado limpio de cada largo. ± = intervalo del 95 % por marcar cada evento con ±½ cuadro (${f(S.frameDur * 1000, 0)} ms por cuadro). "Cambio real" = la diferencia supera ese margen.</p>`);
  $('rc-tab-laps').innerHTML = lh;
  $('rc-tab-laps').querySelectorAll('[data-lap-tech]').forEach(b => b.onclick = () => {
    const k = +b.dataset.lapTech, w = lapWindow(k);
    if (!w) return;
    video.pause();
    S.helpers.analyzeSegment(S.file, S.cfg, w.t0, w.t1, `largo ${k + 1}`, lapStyle(k));
  });

  renderCompare();
  $('rc-tab-defs').innerHTML = `<ul class="limits">
    <li><b>Tiempo cero:</b> con tiempo oficial cargado, la llegada marcada se iguala al tiempo oficial (como sincronizar con el tablero). Si no, se usa la señal; si se marcó por sonido se resta el retraso del sonido entre los bloques y la cámara (343 m/s).</li>
    <li><b>Tiempo de bloque:</b> de la señal hasta que los pies dejan el bloque. Incluye la reacción.</li>
    <li><b>Tiempo de vuelo:</b> de que los pies dejan el bloque a la entrada de las manos.</li>
    <li><b>Break out:</b> la cabeza rompe la superficie. La distancia la ingresa o mide el analista sobre el cuadro; con tres referencias se corrige la perspectiva.</li>
    <li><b>Parcial y velocidad:</b> entre marcas consecutivas, con la cabeza como referencia.</li>
    <li><b>Frecuencia:</b> ciclos por minuto entre ciclos marcados dentro del tramo (se suma el último ciclo del tramo anterior para cubrir el borde). Un ciclo = una vuelta completa de un brazo (crol y espalda) o una brazada simultánea (pecho y mariposa).</li>
    <li><b>Distancia por ciclo:</b> velocidad del tramo dividida por la frecuencia (en ciclos por segundo).</li>
    <li><b>Giro 5+15:</b> desde la marca de 5 m antes de la pared hasta la de 15 m después.</li>
    <li><b>Error de medición:</b> cada evento tiene ±1 cuadro (±${f(S.frameDur * 1000, 0)} ms). La lectura de la marca depende del ángulo de la cámara: con una sola cámara en los 25 m, las marcas lejanas se ven con paralaje.</li>
  </ul>`;
}

// Récord mundial de la prueba (según el sexo del alumno; si no está cargado, los dos) y la diferencia.
function wrLine() {
  const recs = findRecords({ ...S.cfg, sex: S.sex });
  if (!recs.length) return '';
  const t = S.res?.finalTime;
  return `<div class="wr-line">${recs.map(r => `<div><span class="fine-label">Récord mundial ${esc(SEX_NAME[r.sex].toLowerCase())}</span><b>${esc(r.name)}</b> <small>${esc(r.nation)}</small> <b class="mono">${fmtTime(r.time)}</b><small> · ${esc(recordWhere(r))}${r.note ? ` · ${esc(r.note)}` : ''}</small>${Number.isFinite(t) ? `<span class="wr-gap mono">Este análisis ${fmtTime(t)}: ${esc(gapText(t, r))}</span>` : ''}</div>`).join('')}</div>`;
}

function renderCompare() {
  const box = $('rc-tab-cmp');
  if (!S.ref) {
    box.innerHTML = wrLine() + `<p class="metric-detail">Elegí con quién comparar: otra prueba guardada (del mismo nadador o de otro) o un informe de prueba cargado en la base. Se comparan las marcas en común, tramo por tramo.</p>
      <label class="cmp-base">Referencia guardada<select id="rc-ref-pick"><option value="">Buscando en la base…</option></select></label>
      <div class="meta-form" id="rc-meta-form" hidden></div>
      <label class="btn ghost file-btn">Cargar archivo (JSON)<input type="file" id="rc-ref" accept="application/json,.json"></label>`;
    $('rc-ref').onchange = loadRef;
    fillRefPick();
    return;
  }
  const ref = S.ref.res || computeRace(S.ref.cfg, S.ref.events, S.ref.cycles || []);
  const c = compare(S.res, ref);
  const cls = (v, lowerBetter) => (Number.isFinite(v) && Math.abs(v) > 1e-9 ? ((v < 0) === lowerBetter ? 'better' : 'worse') : '');
  const R0 = S.ref.record;
  const T0 = S.ref.target;
  let h = (R0 ? '' : wrLine()) + `<p class="metric-detail">Referencia: ${T0 ? `<b>Tiempo meta ${fmtTime(T0.time)}</b> ${esc(T0.how)}. En Δ T total, rojo = estás por encima de la meta en esa marca (falta bajar), verde = por debajo` : R0 ? `<b>${esc(recordLabel(R0))}</b> · ${esc(recordWhere(R0))}${R0.note ? ` · ${esc(R0.note)}` : ''}` : `<b>${esc(S.ref.cfg.swimmer)}</b> · ${esc(S.ref.cfg.date || '')} ${esc(S.ref.cfg.event || '')}`}${S.ref.report ? ` · informe de ${esc(S.ref.report.source || 'fuente sin indicar')}` : ''}. Diferencia = este análisis − referencia. Verde: mejor; rojo: peor.</p>
    <div class="table-wrap"><table class="data sheet wide">${th(['Marca', 'Δ T total', 'Δ T parcial', 'Δ Vel.', 'Δ Frec.', 'Δ DPC'])}`;
  for (const row of c.rows) {
    h += `<tr><th scope="row">${row.dist} m</th><td class="${cls(row.cumulative, true)}">${fs(row.cumulative)}</td><td class="${cls(row.partial, true)}">${fs(row.partial)}</td><td class="${cls(row.speed, false)}">${fs(row.speed)}</td><td>${fs(row.strokeRate, 1)}</td><td class="${cls(row.dps, false)}">${fs(row.dps)}</td></tr>`;
  }
  h += `</table></div><p class="fine">La frecuencia no se colorea: más alta no es mejor ni peor por sí sola.${R0 ? ` Del récord se conocen ${R0.splits50 ? 'los parciales cada 50 m' : 'solo el tiempo final'}: no hay datos públicos de frecuencia, distancia por ciclo ni subacuáticos.` : ''}</p>`;
  if (ref.laps?.length) {
    const R = S.ref.report?.reference;
    const lr = (label, a, b, d = 2) => `<tr><th scope="row">${label}</th>${S.res.laps.map((l, k) => `<td>${f(a(l, k), d)}<small> / ${f(b(k), d)}</small></td>`).join('')}</tr>`;
    h += `<div class="mgroup">Por largo (este / referencia)</div><div class="table-wrap"><table class="data sheet wide">${th(['', ...S.res.laps.map(l => `${l.lap * S.cfg.poolLength} m`)])}
      ${lr('Parcial (s)', l => l.split, k => ref.laps[k]?.split)}
      ${lr('Frecuencia (c/min)', l => l.strokeRate, k => ref.laps[k]?.strokeRate, 1)}
      ${lr('Dist. por ciclo (m)', l => l.dps, k => ref.laps[k]?.dps)}
      ${lr('Vel. nado limpio (m/s)', l => l.cleanSpeed, k => ref.laps[k]?.cleanSpeed)}
      </table></div>`;
    if (R) h += `<p class="fine">El informe trae además una "${esc(R.label || 'referencia')}": ${['rate', 'dps', 'uwDist'].filter(x => R[x]).map(x => `${{ rate: 'frecuencia', dps: 'dist. por ciclo', uwDist: 'subacuático' }[x]} ${R[x].map(v => f(v, x === 'rate' ? 1 : 2)).join(' · ')}`).join('; ')}.</p>`;
  }
  h += `<button class="btn ghost small" id="rc-ref-clear">Quitar referencia</button>`;
  box.innerHTML = h;
  $('rc-ref-clear').onclick = () => { S.ref = null; renderCompare(); };
}
// referencias de la base: pruebas guardadas e informes de cualquier alumno, misma distancia y pileta
// Formulario del tiempo meta: objetivo y de dónde sale el reparto por marca.
function metaForm(recs) {
  const box = $('rc-meta-form');
  const withSplits = recs.filter(r => r.splits50);
  const own = Number.isFinite(S.res?.finalTime);
  box.innerHTML = `<div class="meta-row"><label>Tiempo objetivo<input id="rc-meta-time" inputmode="decimal" placeholder="${S.cfg.distance >= 100 ? '1:02,50' : '27,80'}"></label>
    <label>Repartido<select id="rc-meta-mode">${own ? '<option value="own">Como esta prueba</option>' : ''}${withSplits.map((r, k) => `<option value="r${recs.indexOf(r)}">Como el récord de ${esc(r.name)}</option>`).join('')}<option value="even">En largos iguales</option></select></label>
    <button class="btn small" id="rc-meta-go" type="button">Comparar</button></div>
    <p class="fine" id="rc-meta-msg">${own ? 'Como esta prueba: cada marca se escala en la misma proporción que el tiempo final.' : 'Cuando esta prueba tenga tiempo final, también vas a poder repartir la meta como ella.'} Largos iguales no tiene en cuenta que el primero es más rápido por la salida.</p>`;
  $('rc-meta-go').onclick = () => {
    const t = parseTime($('rc-meta-time').value), m = $('rc-meta-mode').value;
    if (!Number.isFinite(t)) { $('rc-meta-msg').textContent = 'Escribí el tiempo como 1:02,50 o 27,80.'; return; }
    try {
      const res = m === 'own' ? targetToResults(S.cfg, t, 'own', { res: S.res }) : m === 'even' ? targetToResults(S.cfg, t, 'even') : targetToResults(S.cfg, t, 'record', { rec: recs[+m.slice(1)] });
      S.ref = { cfg: res.cfg, res, target: { time: t, how: res.how } };
      renderCompare();
    } catch (e) { $('rc-meta-msg').textContent = e.message; }
  };
}
async function fillRefPick() {
  const sel = $('rc-ref-pick');
  const opts = [];
  try {
    for (const a of await store.listAthletes()) {
      for (const e of await store.listEvaluations(a.id)) {
        if (e.kind !== 'race' && e.kind !== 'report') continue;
        const c = e.kind === 'report' ? e.data : e.data.cfg;
        if (c.distance !== S.cfg.distance || c.poolLength !== S.cfg.poolLength) continue;
        if (e.kind === 'race' && c.fileName === S.cfg.fileName && c.date === S.cfg.date) continue;
        const same = (e.kind === 'report' ? e.data.style : c.style) === S.cfg.style;
        opts.push({ e, a, same, label: `${a.name} · ${e.date || ''} · ${e.event || STYLE[c.style] || c.style || ''}${e.kind === 'report' ? ' · informe' : ''}${Number.isFinite(e.summary?.finalTime) ? ` · ${f(e.summary.finalTime)} s` : ''}` });
      }
    }
  } catch {}
  opts.sort((x, y) => (y.same - x.same) || String(y.e.date).localeCompare(String(x.e.date)));
  const recs = findRecords({ ...S.cfg, sex: '' }).sort((a, b) => (b.sex === S.sex) - (a.sex === S.sex));
  const recOpts = recs.map((r, k) => `<option value="r${k}">${esc(recordLabel(r))}${r.note && /Pendiente/.test(r.note) ? ' (pendiente de ratificación)' : ''}</option>`).join('');
  sel.innerHTML = `<option value="">Elegir…</option><option value="meta">Tiempo meta (escribís el objetivo)</option>${recOpts ? `<optgroup label="Récords mundiales">${recOpts}</optgroup>` : ''}${opts.length ? `<optgroup label="Pruebas e informes guardados">${opts.map((o, k) => `<option value="${k}">${esc(o.label)}${o.same ? '' : ' (otro estilo)'}</option>`).join('')}</optgroup>` : ''}`;
  sel.onchange = () => {
    $('rc-meta-form').hidden = sel.value !== 'meta';
    if (sel.value === 'meta') { metaForm(recs); return; }
    if (sel.value[0] === 'r') { const r = recs[+sel.value.slice(1)]; const res = recordToResults(r, S.cfg.poolLength); S.ref = { cfg: res.cfg, res, record: r }; renderCompare(); return; }
    const o = opts[+sel.value];
    if (!o) return;
    if (o.e.kind === 'report') { const res = reportToResults(o.e.data); S.ref = { cfg: res.cfg, res, report: o.e.data }; }
    else S.ref = { ...o.e.data };
    renderCompare();
  };
}
async function loadRef(e) {
  const file = e.target.files[0];
  if (!file) return;
  try {
    let j = JSON.parse(await file.text());
    if (isReport(j)) { const res = reportToResults(j); j = { cfg: res.cfg, res, report: j }; }
    else if (!j.cfg || !j.events) throw new Error('El archivo no es un análisis de competencia ni un informe de SwimBull.');
    if (j.cfg.distance !== S.cfg.distance || j.cfg.poolLength !== S.cfg.poolLength) msg('La referencia es de otra distancia o pileta: solo se comparan las marcas en común.');
    S.ref = j; renderCompare();
  } catch (err) { msg('No se pudo leer la referencia: ' + err.message); }
}

document.querySelectorAll('#rc-tabs button').forEach(b => b.onclick = () => {
  document.querySelectorAll('#rc-tabs button').forEach(x => x.setAttribute('aria-selected', x === b));
  for (const t of ['sheet', 'laps', 'cmp', 'ang', 'vel', 'defs']) $('rc-tab-' + t).hidden = t !== b.dataset.tab;
  if (b.dataset.tab === 'vel') renderSpeed();
});

function msg(t) { const el = $('rc-msg'); el.textContent = t; el.hidden = !t; }

// ---------- guardado ----------
const saveKey = () => `swimlab-race:${S.file.name}:${S.file.size}:${S.cfg.distance}:${S.cfg.poolLength}`;
function autosave() { try { localStorage.setItem(saveKey(), JSON.stringify({ events: S.ev, cycles: S.cycles, angles: S.angles, video2: S.v2meta || null, square: S.square || null, path: S.path || null, cal: S.cal || null, drawings: S.drawings })); } catch {} }
function restoreAutosave() {
  try {
    const j = JSON.parse(localStorage.getItem(saveKey()) || 'null');
    if (j && j.events) { S.ev = j.events; S.cycles = j.cycles || []; S.angles = j.angles || []; S.v2meta = j.video2 || null; S.square = j.square || null; S.path = j.path || null; S.cal = j.cal || null; S.drawings = j.drawings || []; }
  } catch {}
}
function exportJSON() {
  return { app: 'SwimBull', kind: 'competencia', version: 1, cfg: S.cfg, events: S.ev, cycles: S.cycles, angles: S.angles, video2: S.v2meta || null, square: S.square || null, path: S.path || null, cal: S.cal || null, drawings: S.drawings, frameDur: S.frameDur, results: S.res, savedAt: new Date().toISOString() };
}
const base = () => `${S.cfg.swimmer.replace(/[^\w\-]+/g, '_')}_${S.cfg.distance}${S.cfg.style}_${S.cfg.date || 'competencia'}`;
$('rc-store').onclick = () => raceSave();
const raceKey = () => `race:${S.cfg.fileName}:${S.file.size}:${S.cfg.distance}:${S.cfg.poolLength}:${S.cfg.date}:${S.cfg.event}`;
const raceReview = (file, kind) => sendButton(file, kind, async () => (S.saved?.sourceKey === raceKey() ? S.saved : raceSave()));
function raceSave() {
  const c = S.cfg;
  return S.helpers.saveToAthlete(c.athleteId, c.swimmer, {
    kind: 'race', date: c.date, title: `${c.distance} m ${STYLE[c.style].toLowerCase()}`, event: c.event,
    sourceKey: raceKey(),
    summary: { finalTime: S.res.finalTime },
    data: { cfg: c, events: S.ev, cycles: S.cycles, angles: S.angles, video2: S.v2meta || null, square: S.square || null, path: S.path || null, cal: S.cal || null, drawings: S.drawings, frameDur: S.frameDur },
  }, 'rc-msg', S.file).then(saved => { if (saved) S.saved = saved; return saved; });
}
$('rc-save').onclick = () => S.helpers.download(new Blob([JSON.stringify(exportJSON(), null, 1)], { type: 'application/json' }), `${base()}.json`, 'rc-msg');
$('rc-load').onchange = async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    const j = JSON.parse(await file.text());
    if (!j.events) throw new Error('El archivo no tiene marcas.');
    S.ev = j.events; S.cycles = j.cycles || []; S.angles = j.angles || [];
    changed(); msg('Marcas cargadas.');
  } catch (err) { msg('No se pudo cargar: ' + err.message); }
  e.target.value = '';
};
$('rc-xlsx').onclick = () => {
  S.helpers.download(xlsxBlob(raceSheets(S.cfg, S.res, { angles: S.angles, raceTime, speed: speedData(), angleType: ANGLE_TYPE_LABEL, checks: S.cal?.checks || [] })), `${base()}.xlsx`, 'rc-msg');
};
$('rc-csv').onclick = () => {
  const r = S.res;
  const q = (v, d = 2) => (Number.isFinite(v) ? v.toFixed(d).replace('.', ',') : '');
  const rows = [];
  rows.push(['Nadador', S.cfg.swimmer], ['Prueba', `${S.cfg.distance} m ${STYLE[S.cfg.style]}`], ['Fecha', S.cfg.date || ''], ['Evento', S.cfg.event || ''], ['Tiempo final', q(r.finalTime)], []);
  rows.push(['Salida'], ['Reacción oficial', q(r.start.reaction)], ['Tiempo de bloque', q(r.start.blockTime)], ['Tiempo de vuelo', q(r.start.flightTime)], ['Break out (m)', q(r.start.breakoutDist)], ['T break out', q(r.start.breakoutTime)], []);
  rows.push(['Marca (m)', ...r.sections.map(s => s.dist)]);
  rows.push(['T total', ...r.sections.map(s => q(s.cumulative))]);
  rows.push(['T parcial', ...r.sections.map(s => q(s.partial))]);
  rows.push(['Velocidad (m/s)', ...r.sections.map(s => q(s.speed))]);
  rows.push(['Ciclos', ...r.sections.map(s => s.cycles ?? '')]);
  rows.push(['Frecuencia (ciclos/min)', ...r.sections.map(s => q(s.strokeRate, 1))]);
  rows.push(['Tiempo por ciclo (s)', ...r.sections.map(s => q(secPerCycle(s.strokeRate)))]);
  rows.push(['Brazadas/min', ...r.sections.map(s => q(strokesPerMin(s.strokeRate, S.cfg.style), 1))]);
  rows.push(['Distancia por ciclo (m)', ...r.sections.map(s => q(s.dps))]);
  if (r.turns.length) {
    rows.push([], ['Viraje (m)', ...r.turns.map(t => t.wall)]);
    rows.push(['5 m in', ...r.turns.map(t => q(t.in5))], ['15 m out', ...r.turns.map(t => q(t.out15))], ['Giro 5+15', ...r.turns.map(t => q(t.turnTime))], ['Contacto', ...r.turns.map(t => q(t.contact))], ['Break out (m)', ...r.turns.map(t => q(t.breakoutDist))], ['Vel. subacuática', ...r.turns.map(t => q(t.underwaterSpeed))]);
  }
  if (S.angles.length) {
    rows.push([], ['Ángulo', 'Tiempo de carrera (s)', 'Tiempo de video (s)', 'Valor (°)', 'Tipo']);
    for (const a of S.angles.slice().sort((x, y) => x.t - y.t)) rows.push([a.label, q(raceTime(a.t)), q(a.t, 3), q(angleValue(a), 1), ANGLE_TYPE_LABEL[a.type]]);
  }
  const csv = '﻿' + rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(';')).join('\r\n');
  S.helpers.download(new Blob([csv], { type: 'text/csv' }), `${base()}.csv`, 'rc-msg');
};
$('rc-pdf').onclick = async () => {
  const btn = $('rc-pdf'); btn.disabled = true; const l = btn.innerHTML; btn.textContent = 'Generando…';
  try {
    const ref = S.ref ? { cfg: S.ref.cfg, res: S.ref.res || computeRace(S.ref.cfg, S.ref.events, S.ref.cycles || []) } : null;
    const keep = video.currentTime;
    const angleFrames = [];
    const seen = new Set();
    for (const a of S.angles.slice().sort((x, y) => x.t - y.t)) {
      const k = `${a.v || 1}:${Math.round(a.t / S.frameDur)}`;
      if (seen.has(k) || angleFrames.length >= 8) continue;
      seen.add(k);
      angleFrames.push({ t: a.t, v: a.v || 1, canvas: (a.v === 2 && V2.on) ? await captureAngleFrame2(a) : (a.v === 2 ? null : await captureAngleFrame(a)) });
    }
    for (let i = angleFrames.length - 1; i >= 0; i--) if (!angleFrames[i].canvas) angleFrames.splice(i, 1);
    if (angleFrames.length) seek(keep - S.frameDur * 0.5);
    const speed = speedData();
    const blob = await buildRaceReport(S.cfg, S.res, ref, { frameDur: S.frameDur, compare, angles: S.angles, angleFrames, speed: speed.sp.length >= 2 ? speed : null, checks: S.cal?.checks || [] });
    await S.helpers.download(blob, `${base()}_informe.pdf`, 'rc-msg');
  } catch (e) { console.error(e); msg('No se pudo generar el PDF: ' + e.message); }
  finally { btn.disabled = false; btn.innerHTML = l; }
};

window.__swimlabRace = S;

// ---------- explicación con voz ----------
$('rc-voice').innerHTML = voicePanelHtml('rc-voice');
bindVoice('rc-voice', {
  reviewButton: raceReview,
  size: () => [video.videoWidth || 1280, video.videoHeight || 720],
  name: () => `${(S.cfg.swimmer || 'prueba').replace(/[^\w\-]+/g, '_')}_${S.cfg.distance}${S.cfg.style}`,
  download: (b, n) => S.helpers.download(b, n, 'rc-msg'),
  paint: (ctx, W, H) => {
    ctx.drawImage(video, 0, 0, W, H);
    ctx.drawImage(overlay, 0, 0, W, H);
    clipLabels(ctx, W, H, `${currentFrameTime().toFixed(2)} s`, S.cfg.swimmer || '');
  },
});

// Micrófono en el medio del video: apagado se ve transparente; grabando se pone rojo con el tiempo.
// Usa el mismo botón de «Grabar explicación»; al terminar se muestra el video para compartir.
if (!$('rc-voice-go').disabled) {
  player.insertAdjacentHTML('beforeend', `<button type="button" class="qt-mic" id="rc-mic" aria-pressed="false" aria-label="Grabar explicación con voz"><svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3" fill="currentColor"/><path d="M6 11a6 6 0 0 0 12 0M12 17v4M9 21h6" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"/></svg><span class="mono" id="rc-mic-time"></span></button><div class="qt-done" id="rc-voice-done" hidden><span>Explicación lista</span><b role="button" tabindex="0"></b><button type="button" aria-label="Cerrar">✕</button></div>`);
  $('rc-voice-done').querySelector('button').onclick = () => { $('rc-voice-done').hidden = true; };
  $('rc-mic').onclick = () => $('rc-voice-go').click();
  let was = false;
  const micSync = () => {
    const on = $('rc-voice-go').classList.contains('danger-fill');
    $('rc-mic').setAttribute('aria-pressed', on);
    $('rc-mic-time').textContent = on ? $('rc-voice-time').textContent.replace('● ', '') : '';
    if (was && !on && $('rc-voice-out').querySelector('video')) {
      // terminó: dentro del video, un botón para mandarlo (y abajo, en Clip, el video para verlo)
      const sh = $('rc-voice-out').querySelector('[data-a="share"]') || $('rc-voice-out').querySelector('[data-a="dl"]');
      $('rc-voice-done').hidden = false;
      $('rc-voice-done').querySelector('b').textContent = sh?.dataset.a === 'share' ? 'Compartir' : 'Descargar';
      $('rc-voice-done').querySelector('b').onclick = () => sh?.click();
      dock('clip');
    }
    if (on) $('rc-voice-done').hidden = true;
    was = on;
  };
  new MutationObserver(micSync).observe($('rc-voice'), { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['class'] });
}

// ---------- clip con los dibujos ----------
$('rc-clip').innerHTML = clipPanelHtml('rc-clip', 'Pausar 2 s en cada cuadro con ángulos');
const angleTimesIn = (a, b) => new Set(S.angles.filter(x => x.t >= a - S.frameDur / 2 && x.t <= b + S.frameDur / 2).map(x => frameIndexAt(x.t + S.frameDur * 0.5))).size;
const clipUi = bindClipPanel('rc-clip', {
  reviewButton: raceReview,
  now: () => currentFrameTime(),
  maxSpan: 30,
  extraHold: (a, b) => ($('rc-clip-hold').checked ? 2 * angleTimesIn(a, b) : 0),
  download: (blob, name) => S.helpers.download(blob, name, 'rc-msg'),
  run: raceClip,
});

async function raceClip({ a, b, slow, hold }, onProgress, signal) {
  video.pause(); video2.pause();
  const keep = video.currentTime;
  const W1 = video.videoWidth, H1 = video.videoHeight;
  const mode2 = V2.on && video2.videoWidth ? V2.mode : null;
  // tamaño de salida: el video principal hasta 720 de alto y 1280 de ancho
  const s1 = Math.min(1, 720 / H1, 1280 / W1), Wm = W1 * s1, Hm = H1 * s1;
  let W = Wm, H = Hm, r2 = null;
  if (mode2 === 'stack') { const h2 = video2.videoHeight * Wm / video2.videoWidth; r2 = { x: 0, y: Hm, w: Wm, h: h2 }; H = Hm + h2; }
  else if (mode2 === 'side') { const w2 = video2.videoWidth * Hm / video2.videoHeight; r2 = { x: Wm, y: 0, w: w2, h: Hm }; W = Wm + w2; }
  else if (mode2 === 'pip') { const w2 = Wm * 0.34, h2 = w2 * video2.videoHeight / video2.videoWidth; r2 = { x: Wm - w2 - 12, y: Hm - h2 - 12, w: w2, h: h2 }; }
  else if (mode2 === 'blend') r2 = { x: 0, y: 0, w: Wm, h: Hm };
  const g = Math.min(1, 1920 / W);
  const op = +$('rc-v2-op').value / 100;
  const k = Hm / 430; // grosor de líneas y rótulos relativo a la vista en pantalla
  const i0 = frameIndexAt(a + S.frameDur * 0.5), i1 = frameIndexAt(b + S.frameDur * 0.5);
  const frames = [];
  for (let i = i0; i <= i1; i++) {
    const t = timeOfFrame(i), tn = timeOfFrame(i + 1);
    const here = (x) => Math.abs(x.t - t) < S.frameDur * 0.5;
    const show = (x) => x.pin !== false || here(x);
    const list1 = S.angles.filter(x => (x.v || 1) === 1 && show(x)), list2 = S.angles.filter(x => x.v === 2 && show(x));
    const measured = S.angles.some(here);
    const t2 = t + S.frameDur * 0.5 + V2.offset, in2 = mode2 && t2 >= 0 && t2 <= video2.duration;
    frames.push({
      dur: ((tn > t ? tn - t : S.frameDur)) * slow,
      hold: hold && measured ? hold : 0,
      prepare: async () => { await seekVideo(video, t + S.frameDur * 0.5); if (in2) await seekVideo(video2, t2); },
      draw: (ctx) => {
        ctx.scale(g, g);
        ctx.drawImage(video, 0, 0, Wm, Hm);
        ctx.save(); drawPaths(ctx, s1, k, t); drawSquare(ctx, s1, k, true); renderDrawings(ctx, S.drawings.filter(d => drawingVisible(d, t, S.frameDur)), s1, k); drawAngles(ctx, s1, k, list1); ctx.restore();
        if (r2) {
          ctx.save();
          if (mode2 === 'blend') ctx.globalAlpha = op;
          if (in2) ctx.drawImage(video2, r2.x, r2.y, r2.w, r2.h);
          else if (mode2 !== 'blend') { ctx.fillStyle = '#0b1118'; ctx.fillRect(r2.x, r2.y, r2.w, r2.h); ctx.fillStyle = '#9aa7b4'; ctx.font = `500 ${14 * k}px system-ui`; ctx.fillText('fuera del segundo video', r2.x + 12 * k, r2.y + r2.h / 2); }
          ctx.globalAlpha = 1;
          if (mode2 === 'pip') { ctx.strokeStyle = '#fff'; ctx.lineWidth = 2; ctx.strokeRect(r2.x, r2.y, r2.w, r2.h); }
          if (in2 && list2.length) { ctx.translate(r2.x, r2.y); drawAngles(ctx, r2.w / video2.videoWidth, mode2 === 'pip' ? k * 0.6 : k, list2); }
          ctx.restore();
        }
        const tr = raceTime(t);
        clipLabels(ctx, W, Hm, (Number.isFinite(tr) ? `${tr < 0 ? '−' : ''}${f(Math.abs(tr), 2)} s` : `video ${f(t, 2)} s`) + slowTag(slow), `${S.cfg.swimmer} · ${S.cfg.distance} m ${STYLE[S.cfg.style].toLowerCase()}`);
      },
    });
  }
  try {
    const out = await encodeClip({ width: Math.round(W * g), height: Math.round(H * g), frames, onProgress, signal });
    const tr = raceTime(a);
    out.name = `${S.cfg.swimmer.replace(/[^\w\-]+/g, '_')}_${S.cfg.distance}m_clip_${f(Number.isFinite(tr) ? tr : a, 2).replace(',', '-')}s.mp4`;
    return out;
  } finally {
    await seekVideo(video, keep); v2Sync(true); drawOverlay(); hud();
  }
}

// ---------- línea que sigue al nadador (salida) y comparación con otros días ----------
const fmtDate = (d) => (d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d.split('-').reverse().join('/') : (d || 'sin fecha'));
const PATH_MAX_S = 30; // segundos de video por cada seguimiento
let trackAbort = null;

// ---------- velocidad continua ----------
const calDefault = () => ({ refs: [{ m: 5, p: null }, { m: 15, p: null }, { m: 25, p: null }] });
function calUi() {
  if (!S.cal) S.cal = calDefault();
  const c = S.cal;
  $('rc-cal-rows').innerHTML = c.refs.map((r, i) => `<div class="mrow"><span class="fine">Ref. ${i + 1}${i === 2 ? ' (opcional)' : ''}</span>
    <input type="text" inputmode="decimal" id="rc-cal-${i}" value="${String(r.m).replace('.', ',')}" aria-label="Distancia de la referencia ${i + 1} en metros"><span class="fine">m</span>
    <button class="btn ghost small" data-cal="${i}">${S.calWait === i ? 'Tocá en el video…' : r.p ? 'Volver a tocar' : 'Tocar en el video'}</button></div>`).join('');
  $('rc-cal-rows').querySelectorAll('[data-cal]').forEach(b => b.onclick = () => { S.calWait = S.calWait === +b.dataset.cal ? null : +b.dataset.cal; calUi(); drawOverlay(); if (S.calWait != null) showPlayer(); });
  c.refs.forEach((r, i) => { $('rc-cal-' + i).onchange = (e) => { const v = parseFloat(e.target.value.replace(',', '.')); if (Number.isFinite(v)) { r.m = v; autosave(); calUi(); drawOverlay(); } }; });
  const n = c.refs.filter(r => r.p).length, hasPath = S.path?.pts?.length > 3;
  planeUi(); checkUi();
  const H = planeH(c.plane);
  $('rc-cal-out').textContent = H ? (hasPath ? 'Se usa el plano de la pileta (4 puntos). Mirá la pestaña Velocidad.' : 'Plano de la pileta listo. Falta la línea sobre la cabeza del nadador.')
    : n < 2 ? 'Faltan referencias (mínimo dos), o marcá el plano de la pileta.' : !hasPath ? 'Referencias listas. Falta la línea sobre la cabeza del nadador.' : `Listo: ${n} referencias${n === 3 ? ' (con corrección de perspectiva a lo largo del andarivel)' : ' (sin corrección de perspectiva: agregá la tercera)'}. Mirá la pestaña Velocidad.`;
  overlay.classList.toggle('tool', !!(S.pathTool || S.angTool || S.calWait != null));
}
// Plano de la pileta: 4 puntos sobre dos corcheras, a dos distancias conocidas.
const PLANE_LABELS = ['Corchera cercana, distancia A', 'Corchera cercana, distancia B', 'Corchera lejana, distancia B', 'Corchera lejana, distancia A'];
function planeOf() { if (!S.cal.plane) S.cal.plane = { a: 15, b: 25, w: 2.5, pts: [null, null, null, null] }; return S.cal.plane; }
function planeUi() {
  const P = planeOf(), num = (v) => String(v).replace('.', ',');
  $('rc-plane-rows').innerHTML = `<div class="fields plane-fields">
      <label>Distancia A (m)<input type="text" inputmode="decimal" id="rc-plane-a" value="${num(P.a)}"></label>
      <label>Distancia B (m)<input type="text" inputmode="decimal" id="rc-plane-b" value="${num(P.b)}"></label>
      <label>Entre corcheras (m)<input type="text" inputmode="decimal" id="rc-plane-w" value="${num(P.w)}"></label></div>`
    + P.pts.map((p, i) => `<div class="mrow"><span class="fine">${i + 1}. ${PLANE_LABELS[i]}</span><span></span><span></span>
      <button class="btn ghost small" data-plane="${i}">${S.calWait === 'q' + i ? 'Tocá en el video…' : p ? 'Volver a tocar' : 'Tocar en el video'}</button></div>`).join('')
    + (P.pts.some(Boolean) ? '<button class="btn ghost small" id="rc-plane-clear" type="button">Borrar el plano</button>' : '');
  $('rc-plane-rows').querySelectorAll('[data-plane]').forEach(b => b.onclick = () => { const k = 'q' + b.dataset.plane; S.calWait = S.calWait === k ? null : k; calUi(); drawOverlay(); if (S.calWait != null) showPlayer(); });
  for (const k of ['a', 'b', 'w']) $('rc-plane-' + k).onchange = (e) => { const v = parseFloat(e.target.value.replace(',', '.')); if (Number.isFinite(v)) { P[k] = v; autosave(); calUi(); drawOverlay(); } };
  if ($('rc-plane-clear')) $('rc-plane-clear').onclick = () => { P.pts = [null, null, null, null]; S.calWait = null; autosave(); calUi(); drawOverlay(); };
  const all = P.pts.every(Boolean), H = planeH(P);
  $('rc-plane-out').textContent = !P.pts.some(Boolean) ? '' : !all ? `Faltan ${P.pts.filter(p => !p).length} puntos.` : !H ? 'Los 4 puntos no forman un rectángulo de pileta válido: revisá el orden (1 y 2 en la corchera cercana, 3 y 4 en la lejana).' : `Plano listo: ${f(P.a, 1)} a ${f(P.b, 1)} m, ${f(P.w, 2)} m de ancho.`;
}
// Verificación con una distancia conocida (dos marcas que no se usaron para calibrar).
const CHK = { real: 10, pts: [null, null] };
function toMetersFn() {
  const H = planeH(S.cal?.plane), refs = (S.cal?.refs || []).filter(r => r.p);
  if (H) return { fn: (p) => applyH(H, p)?.[0], method: 'con el plano de la pileta' };
  if (refs.length >= 2) return { fn: (p) => measureAlongLine(refs, p)?.meters, method: refs.length >= 3 ? 'con 3 referencias' : 'con 2 referencias' };
  return null;
}
function checkUi() {
  const box = $('rc-chk'), cal = toMetersFn();
  if (!box) return;
  const list = S.cal.checks || [];
  const sum = checkSummary(list);
  box.innerHTML = `<p class="fine">Filmá con la misma cámara dos marcas a distancia conocida que <b>no</b> usaste para calibrar (por ejemplo dos conos a 10 m, o las marcas de 20 y 30 m). La app mide esa distancia con la calibración y te dice el error real de esta toma.</p>
    ${cal ? `<div class="mrow"><span class="fine">Distancia real</span><input type="text" inputmode="decimal" id="rc-chk-real" value="${String(CHK.real).replace('.', ',')}" aria-label="Distancia real en metros"><span class="fine">m</span><span></span></div>
    ${CHK.pts.map((p, i) => `<div class="mrow"><span class="fine">Marca ${i + 1}</span><span></span><span></span><button class="btn ghost small" data-chk="${i}" type="button">${S.calWait === 'c' + i ? 'Tocá en el video…' : p ? 'Volver a tocar' : 'Tocar en el video'}</button></div>`).join('')}
    <button class="btn small" id="rc-chk-save" type="button"${CHK.pts.every(Boolean) ? '' : ' disabled'}>Guardar verificación</button>` : '<p class="fine">Primero calibrá (referencias o plano de la pileta).</p>'}
    ${list.length ? `<ul class="limits chk-list">${list.map((c, i) => `<li>${esc(checkText(c))} <button class="linkish" data-chk-del="${i}" type="button">Borrar</button></li>`).join('')}</ul>${sum.n > 1 ? `<p class="fine">Error medio ${f(sum.mean, 1)} %, máximo ${f(sum.max, 1)} % en ${sum.n} verificaciones.</p>` : ''}` : ''}`;
  box.querySelectorAll('[data-chk]').forEach(b => b.onclick = () => { const k = 'c' + b.dataset.chk; S.calWait = S.calWait === k ? null : k; calUi(); drawOverlay(); if (S.calWait != null) showPlayer(); });
  if ($('rc-chk-real')) $('rc-chk-real').onchange = (e) => { const v = parseFloat(e.target.value.replace(',', '.')); if (v > 0) CHK.real = v; };
  if ($('rc-chk-save')) $('rc-chk-save').onclick = () => {
    const c = distanceCheck(CHK.real, CHK.pts[0], CHK.pts[1], cal.fn, cal.method);
    if (!c) return;
    S.cal.checks = [...(S.cal.checks || []), c]; CHK.pts = [null, null]; autosave(); calUi(); drawOverlay();
  };
  box.querySelectorAll('[data-chk-del]').forEach(b => b.onclick = () => { S.cal.checks.splice(+b.dataset.chkDel, 1); autosave(); calUi(); });
}

// Contorno del plano marcado y sus 4 puntos numerados.
function drawPlane(ctx, sc, dpr) {
  const P = S.cal?.plane;
  if (!P) return;
  ctx.save();
  ctx.font = `600 ${11 * dpr}px "Geist Mono", monospace`;
  const H = planeH(P);
  if (H) {
    ctx.strokeStyle = 'rgba(124,255,107,0.55)'; ctx.lineWidth = 1 * dpr;
    const [p0, p1, p2, p3] = P.pts;
    ctx.beginPath(); ctx.moveTo(p0[0] * sc, p0[1] * sc); ctx.lineTo(p1[0] * sc, p1[1] * sc); ctx.lineTo(p2[0] * sc, p2[1] * sc); ctx.lineTo(p3[0] * sc, p3[1] * sc); ctx.closePath(); ctx.stroke();
  }
  P.pts.forEach((p, i) => {
    if (!p) return;
    ctx.fillStyle = '#7cff6b'; ctx.strokeStyle = '#000'; ctx.lineWidth = 1.5 * dpr;
    ctx.beginPath(); ctx.arc(p[0] * sc, p[1] * sc, 6 * dpr, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.fillStyle = 'rgba(0,0,0,0.7)'; ctx.fillRect(p[0] * sc + 9 * dpr, p[1] * sc - 15 * dpr, 16 * dpr, 17 * dpr);
    ctx.fillStyle = '#fff'; ctx.fillText(String(i + 1), p[0] * sc + 13 * dpr, p[1] * sc - 2 * dpr);
  });
  ctx.restore();
}
function drawCal(ctx, sc, dpr) {
  drawPlane(ctx, sc, dpr);
  CHK.pts.forEach((p, i) => {
    if (!p) return;
    ctx.save(); ctx.fillStyle = '#ffd23f'; ctx.strokeStyle = '#000'; ctx.lineWidth = 1.5 * dpr;
    ctx.beginPath(); ctx.arc(p[0] * sc, p[1] * sc, 6 * dpr, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    if (i === 1 && CHK.pts[0]) { ctx.strokeStyle = '#ffd23f'; ctx.setLineDash([4 * dpr, 3 * dpr]); ctx.beginPath(); ctx.moveTo(CHK.pts[0][0] * sc, CHK.pts[0][1] * sc); ctx.lineTo(p[0] * sc, p[1] * sc); ctx.stroke(); }
    ctx.restore();
  });
  const refs = S.cal.refs.filter(r => r.p);
  ctx.save();
  ctx.font = `600 ${12 * dpr}px "Geist Mono", monospace`;
  if (refs.length >= 2) {
    ctx.strokeStyle = 'rgba(76,201,240,0.9)'; ctx.lineWidth = 2 * dpr; ctx.setLineDash([6 * dpr, 4 * dpr]);
    ctx.beginPath(); ctx.moveTo(refs[0].p[0] * sc, refs[0].p[1] * sc); ctx.lineTo(refs[refs.length - 1].p[0] * sc, refs[refs.length - 1].p[1] * sc); ctx.stroke(); ctx.setLineDash([]);
  }
  for (const r of refs) {
    const x = r.p[0] * sc, y = r.p[1] * sc, label = `${f(r.m, 1)} m`;
    ctx.fillStyle = '#4cc9f0'; ctx.strokeStyle = '#000'; ctx.lineWidth = 1.5 * dpr;
    ctx.beginPath(); ctx.arc(x, y, 6 * dpr, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    const w = ctx.measureText(label).width;
    ctx.fillStyle = 'rgba(0,0,0,0.7)'; ctx.fillRect(x + 9 * dpr, y - 16 * dpr, w + 8 * dpr, 18 * dpr);
    ctx.fillStyle = '#fff'; ctx.fillText(label, x + 13 * dpr, y - 3 * dpr);
  }
  ctx.restore();
}
// Curva de velocidad de la línea, con margen por el seguimiento (±1 píxel de trabajo en cada punto).
// Serie de distancia, velocidad continua y tramos cada 5 m a partir de la línea y las referencias.
// Cámara en mano: si se movió, la línea y las referencias se llevan al primer cuadro de la línea (las
// referencias necesitan haberse marcado en un instante que la línea cubra).
function pathCamera() {
  const pts = S.path?.pts || [];
  if (!S.path?.cam || pts.length < 4 || pts.some(q => !q.c)) return { moved: false, known: !!S.path?.cam };
  const W = video.videoWidth, H = video.videoHeight, c = [W / 2, H / 2];
  let max = 0;
  for (const q of pts) { const p = camApply(q.c, c); max = Math.max(max, Math.hypot(p[0] - c[0], p[1] - c[1])); }
  const at = (t) => (t == null ? null : pts.reduce((b, q) => (Math.abs(q.t - t) < Math.abs(b.t - t) ? q : b), pts[0]));
  const near = (t) => { const q = at(t); return q && Math.abs(q.t - t) <= S.frameDur * 0.75 ? q.c : null; };
  return { moved: max > 0.01 * Math.max(W, H), known: true, max, bad: pts.filter(q => q.cbad).length, n: pts.length, near };
}
function speedData() {
  let refs = (S.cal?.refs || []).filter(r => r.p);
  let plane = S.cal?.plane;
  let pts = S.path?.pts || [];
  if ((refs.length < 2 && !planeH(plane)) || pts.length < 4) return { series: [], sp: [], segs: [] };
  const pxErr = video.videoWidth / TRACK_W; // un píxel del seguimiento, en píxeles del video
  const frame = { w: video.videoWidth, h: video.videoHeight, margin: 14 * pxErr }; // el molde del seguimiento mide 25 píxeles de trabajo
  const cam = pathCamera();
  let camUsed = false, camMissing = false;
  if (cam.moved) {
    const usePlane = !!planeH(plane);
    const cs = usePlane ? plane.pts.map((p, k) => cam.near(plane.ts?.[k])) : refs.map(r => cam.near(r.t));
    if (cs.every(Boolean)) {
      if (usePlane) plane = { ...plane, pts: plane.pts.map((p, k) => camApply(cs[k], p)) };
      else refs = refs.map((r, k) => ({ ...r, p: camApply(cs[k], r.p) }));
      // el borde se juzga en la imagen de cada cuadro; después cada punto pasa al primer cuadro
      pts = pts.filter(q => q.x >= frame.margin && q.y >= frame.margin && q.x <= frame.w - frame.margin && q.y <= frame.h - frame.margin)
        .map(q => { const [x, y] = camApply(q.c, [q.x, q.y]); return { ...q, x, y }; });
      frame.margin = -Infinity;
      camUsed = true;
    } else camMissing = true;
  }
  const H = planeH(plane);
  const extra = { cam, camUsed, camMissing };
  if (H) {
    const series = pts.filter(q => q.x >= frame.margin && q.y >= frame.margin && q.x <= frame.w - frame.margin && q.y <= frame.h - frame.margin)
      .map(q => { const m = applyH(H, [q.x, q.y]); return m ? { t: q.t, d: m[0], x: q.x, y: q.y } : null; }).filter(Boolean);
    const sp = speedSeries(series, { win: 0.4, sigmaD: (s) => planeMpp(H, [s.x, s.y]) * pxErr });
    return { series, sp, segs: segmentSpeeds(series, 5), method: 'plane', ...extra };
  }
  const series = distanceSeries(pts, refs, frame);
  const sp = speedSeries(series, { win: 0.4, sigmaD: (s) => metersPerPx(refs, [s.x, s.y]) * pxErr });
  return { series, sp, segs: segmentSpeeds(series, 5), method: refs.length >= 3 ? 'line3' : 'line2', ...extra };
}
function renderSpeed() {
  const box = $('rc-tab-vel');
  const refs = (S.cal?.refs || []).filter(r => r.p);
  const pts = S.path?.pts || [];
  if ((refs.length < 2 && !planeH(S.cal?.plane)) || pts.length < 4) {
    box.innerHTML = `<p class="metric-detail">Para la curva de velocidad hacen falta dos cosas, en la pestaña Línea de abajo del video: la línea sobre la cabeza del nadador (Marcar punto y seguir) y dos o tres referencias de distancia del andarivel.</p>
      <p class="fine">Ahora: ${pts.length >= 4 ? 'línea lista' : 'falta la línea'} · ${refs.length} de 2 referencias como mínimo.</p>`;
    return;
  }
  const { series, sp, segs, method, cam, camUsed, camMissing } = speedData();
  if (sp.length < 2) { box.innerHTML = '<p class="metric-detail">La línea es demasiado corta para calcular velocidad (hace falta más de medio segundo seguido).</p>'; return; }
  const vmax = sp.reduce((a, s) => (s.v > a.v ? s : a), sp[0]);
  const rt = (t) => { const r = raceTime(t); return Number.isFinite(r) ? `${f(r, 2)} s de carrera` : `video ${f(t, 2)} s`; };
  const mErr = sp.reduce((a, s) => a + s.sv, 0) / sp.length;
  let h = `<p class="metric-detail">Velocidad de la cabeza (o del punto seguido) según la distancia, de ${f(series[0].d, 1)} m a ${f(series[series.length - 1].d, 1)} m. Cada punto es la pendiente de la distancia en una ventana de 0,4 s. La banda es el margen por el seguimiento: ±${f(mErr)} m/s en promedio.</p>
    <div class="kpis board"><div><span>Velocidad máxima</span><b class="mono">${f(vmax.v)} m/s</b><small>${f(vmax.d, 1)} m · ${rt(vmax.t)}</small></div><div><span>Media del tramo</span><b class="mono">${f((series[series.length - 1].d - series[0].d) / (series[series.length - 1].t - series[0].t))} m/s</b></div></div>
    <div class="evo-title">Velocidad (m/s) según la distancia</div>
    <div id="rc-speed-chart"></div>`;
  if (segs.length) h += `<div class="mgroup">Cada 5 m</div><div class="table-wrap"><table class="data sheet wide">${th(['Tramo', 'Tiempo (s)', 'Velocidad (m/s)'])}${segs.map(g => `<tr><th scope="row">${f(g.from, 0)}–${f(g.to, 0)} m</th><td>${f(g.time)}</td><td>${f(g.speed)}</td></tr>`).join('')}</table></div>`;
  const camLi = camUsed ? `<li><b>Cámara en mano:</b> la cámara se movió hasta ${f(cam.max, 0)} px durante la línea; se compensó siguiendo el fondo (corcheras, bordes), con un error típico de 1 a 3 px por cuadro en un video real de prueba${cam.bad ? `. En ${cam.bad} de ${cam.n} cuadros no había fondo con detalle y se supuso la cámara quieta` : ''}. Las referencias se llevaron al mismo cuadro según el instante en que las tocaste.</li>`
    : camMissing ? `<li class="warn"><b>Cámara en mano:</b> la cámara se movió hasta ${f(cam.max, 0)} px, pero alguna referencia se marcó en un instante que la línea no cubre (o antes de esta versión). Volvé a tocar las referencias en cuadros dentro del tramo seguido para compensar el movimiento; así, la velocidad puede estar mal.</li>`
    : cam?.known ? '<li><b>Cámara fija:</b> se verificó siguiendo el fondo que la cámara no se movió durante la línea (menos de 1 % de la imagen).</li>'
    : '<li><b>Cámara fija:</b> si la cámara se mueve o hace zoom durante el tramo, la calibración deja de valer y la velocidad sale mal. Volvé a seguir la línea para que se estime el movimiento de la cámara.</li>';
  h += `<ul class="limits">${camLi}
    <li><b>Perspectiva:</b> ${method === 'plane' ? 'se usa el plano de la pileta (4 puntos): la distancia se corrige a lo largo y a lo ancho del andarivel, para puntos sobre la superficie del agua. Fuera del rectángulo marcado el error crece; bajo el agua no vale.' : 'con tres referencias se corrige a lo largo del andarivel; el punto seguido se proyecta sobre la línea de las referencias, así que conviene marcarlas sobre la corchera más cercana al nadador. Con el plano de la pileta (4 puntos) se corrige también a lo ancho.'}</li>
    ${S.cal?.checks?.length ? `<li><b>Verificación de esta cámara:</b> ${S.cal.checks.map(c => esc(checkText(c))).join(' ')} La velocidad tiene, como mínimo, el mismo error relativo.</li>` : '<li><b>Precisión:</b> todavía no verificaste esta toma con una distancia conocida (en la pestaña Línea, Verificar la precisión).</li>'}
    <li><b>Qué mide:</b> la velocidad del punto seguido (la cabeza), no la del centro de masa. En la salida y los virajes la cabeza se adelanta o se atrasa respecto del cuerpo.</li></ul>`;
  box.innerHTML = h;
  $('rc-speed-chart').innerHTML = speedChart(sp, $('rc-speed-chart').clientWidth || 600);
  bindEvoChart($('rc-speed-chart'));
}

function pathUi(msg) {
  const has = !!(S.path && S.path.pts.length);
  $('rc-path-start').textContent = S.pathTool ? 'Tocá el punto en el video…' : has ? 'Corregir desde este cuadro' : 'Marcar punto y seguir';
  $('rc-path-start').setAttribute('aria-pressed', S.pathTool);
  $('rc-path-start').hidden = !!trackAbort;
  $('rc-path-stop').hidden = !trackAbort;
  $('rc-path-clear').hidden = !has || !!trackAbort;
  overlay.classList.toggle('tool', !!(S.pathTool || S.angTool));
  if (msg != null) $('rc-path-hint').textContent = msg;
  else if (!trackAbort) $('rc-path-hint').textContent = S.pathTool
    ? 'Tocá en el video la parte del cuerpo a seguir (la cabeza o la cadera se siguen mejor). La app la sigue sola cuadro a cuadro.'
    : has ? `Línea del ${fmtDate(S.path.date)}: ${S.path.pts.length} cuadros, de ${f(S.path.pts[0].t, 2)} s a ${f(S.path.pts[S.path.pts.length - 1].t, 2)} s del video. Si en algún cuadro se fue de lugar, pausá ahí, tocá Corregir y marcá el punto correcto.`
      : 'Pausá en el cuadro donde arranca la salida, tocá Marcar punto y seguir, y tocá la cabeza o la cadera del nadador. Queda una línea detrás de él, guardada con la fecha de la medición.';
}
$('rc-path-start').onclick = () => {
  video.pause();
  S.pathTool = !S.pathTool;
  if (S.pathTool && S.angTool) { S.angTool = null; angToolUi(); }
  pathUi(); showPlayer();
};
$('rc-path-stop').onclick = () => { if (trackAbort) trackAbort.abort(); };
$('rc-path-clear').onclick = () => { S.path = null; autosave(); pathUi(); calUi(); drawOverlay(); };

async function startTrack(pVideo) {
  S.pathTool = false;
  const W = video.videoWidth, H = video.videoHeight, sc = TRACK_W / W;
  const cw = TRACK_W, ch = Math.round(H * sc);
  const cv = document.createElement('canvas'); cv.width = cw; cv.height = ch;
  const cx = cv.getContext('2d', { willReadFrequently: true });
  const i0 = frameIndexAt(video.currentTime), t0 = timeOfFrame(i0);
  const keep = S.path && S.path.date === S.cfg.date ? S.path.pts.filter(q => q.t < t0 - S.frameDur * 0.5) : [];
  // movimiento de la cámara: cada punto guarda c, la transformación de su cuadro al primero de la línea.
  // Al corregir desde un cuadro se sigue en la misma base, si ese cuadro ya tenía estimación.
  const prevC = keep.length ? S.path.pts.find(q => Math.abs(q.t - t0) < S.frameDur * 0.5)?.c : IDENT;
  const camOn = !!prevC && (!keep.length || S.path.cam);
  S.path = { pts: keep.concat({ t: t0, x: pVideo[0], y: pVideo[1], ...(camOn ? { c: prevC } : {}) }), w: W, h: H, date: S.cfg.date || '', label: `${S.cfg.swimmer} · ${S.cfg.distance} m ${STYLE[S.cfg.style].toLowerCase()}`, cam: camOn };
  const camTr = camOn ? cameraTracker(cw, ch) : null, camAt = new Map();
  const round = (T) => [+T[0].toFixed(5), +T[1].toFixed(5), +T[2].toFixed(2), +T[3].toFixed(2)];
  const iMax = frameIndexAt(Math.min(video.duration - S.frameDur, t0 + PATH_MAX_S));
  const getGray = async (i) => {
    if (i > iMax) return null;
    await seekVideo(video, timeOfFrame(i) + S.frameDur * 0.5);
    cx.drawImage(video, 0, 0, cw, ch);
    const d = cx.getImageData(0, 0, cw, ch).data, G = new Float32Array(cw * ch);
    for (let k = 0, q = 0; k < G.length; k++, q += 4) G[k] = 0.299 * d[q] + 0.587 * d[q + 1] + 0.114 * d[q + 2];
    if (camTr) {
      // el nadador (alrededor del último punto seguido) no es fondo
      const lp = S.path.pts[S.path.pts.length - 1], x = lp.x * sc, y = lp.y * sc, R = 0.12 * cw;
      const r = camTr.push(G, [[x - 2 * R, y - R, x + 2 * R, y + R]]);
      camAt.set(i, { c: round(compose(prevC, rescale(r.toBase, 1 / sc))), ok: r.ok });
    }
    return { G, w: cw, h: ch };
  };
  trackAbort = new AbortController();
  pathUi('Siguiendo el punto…');
  let res;
  try {
    res = await trackForward(getGray, i0, [pVideo[0] * sc, pVideo[1] * sc], {
      maxFrames: iMax - i0, signal: trackAbort.signal,
      onPoint: (pt, k) => {
        const cm = camAt.get(pt.i);
        S.path.pts.push({ t: timeOfFrame(pt.i), x: pt.x / sc, y: pt.y / sc, ...(cm ? { c: cm.c, ...(cm.ok ? {} : { cbad: 1 }) } : {}) });
        if (camOn && !cm) S.path.cam = false;
        if (k % 2 === 0) { drawOverlay(); $('rc-path-hint').textContent = `Siguiendo el punto… ${f(timeOfFrame(pt.i) - t0, 2)} s`; }
      },
    });
  } finally { trackAbort = null; }
  autosave();
  const last = S.path.pts[S.path.pts.length - 1];
  await seekVideo(video, last.t + S.frameDur * 0.5);
  hud(); drawOverlay();
  if (res.lost) {
    S.pathTool = true;
    pathUi(`Perdí el punto después de ${f(last.t - t0, 2)} s (por la espuma o porque cambió mucho de forma). El video quedó en ese cuadro: tocá dónde está el punto para seguir desde ahí, o dejalo así.`);
  } else { calUi(); pathUi(`Listo: ${S.path.pts.length} cuadros seguidos. Revisá la línea con el reproductor; si se fue de lugar en algún cuadro, pausá ahí y tocá Corregir.`); }
}

// líneas guardadas en otras evaluaciones del mismo alumno
async function loadCmpPaths() {
  const box = $('rc-path-list');
  box.innerHTML = '';
  S.cmpPaths = [];
  try {
    let id = S.cfg.athleteId;
    if (!id) {
      const list = await store.listAthletes();
      id = list.find(a => a.name.trim().toLowerCase() === (S.cfg.swimmer || '').trim().toLowerCase())?.id;
    }
    const evs = id ? await store.listEvaluations(id) : [];
    S.cmpPaths = evs.filter(e => e.data?.path?.pts?.length > 1 && !(e.data.cfg?.fileName === S.cfg.fileName && e.data.cfg?.date === S.cfg.date))
      .sort((a, b) => String(a.data.path.date).localeCompare(String(b.data.path.date)))
      .map((e, k) => ({ id: e.id, on: false, color: PATH_COLORS[(k + 1) % PATH_COLORS.length], ...e.data.path }));
  } catch {}
  if (!S.cmpPaths.length) { box.innerHTML = `<p class="fine">Todavía no hay otras salidas guardadas de ${esc(S.cfg.swimmer)}. Cuando guardes esta evaluación con su línea, vas a poder superponerla en el próximo video.</p>`; return; }
  box.innerHTML = S.cmpPaths.map((c, k) => `<label class="check path-item"><input type="checkbox" data-cmp="${k}"><span class="swatch" style="background:${c.color}"></span>${esc(fmtDate(c.date))}<small>${esc(c.label || '')}</small></label>`).join('');
  box.querySelectorAll('[data-cmp]').forEach(el => el.onchange = () => { S.cmpPaths[+el.dataset.cmp].on = el.checked; drawOverlay(); });
}
$('rc-path-align').onchange = () => drawOverlay();

function drawPaths(ctx, sc, dpr, tNow) {
  const W = video.videoWidth, H = video.videoHeight;
  const cur = S.path && S.path.pts.length ? S.path : null;
  const cmps = (S.cmpPaths || []).filter(c => c.on);
  if (!cur && !cmps.length) return;
  const align = $('rc-path-align').checked && cur;
  const rel = cur ? tNow - cur.pts[0].t : Infinity;
  const line = (pts, color, label, mapX, mapY) => {
    if (pts.length < 1) return;
    const P = pts.map(q => [mapX(q.x) * sc, mapY(q.y) * sc]);
    ctx.save(); ctx.lineJoin = ctx.lineCap = 'round';
    for (const [w, c] of [[6 * dpr, 'rgba(0,0,0,0.5)'], [3 * dpr, color]]) {
      ctx.strokeStyle = c; ctx.lineWidth = w; ctx.beginPath();
      P.forEach(([x, y], k) => (k ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.stroke();
    }
    const [lx, ly] = P[P.length - 1];
    ctx.fillStyle = color; ctx.strokeStyle = '#000'; ctx.lineWidth = 1.5 * dpr;
    ctx.beginPath(); ctx.arc(lx, ly, 5 * dpr, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.font = `600 ${11 * dpr}px "Geist Mono", monospace`;
    const tw = ctx.measureText(label).width, bx = Math.min(ctx.canvas.width - tw - 12 * dpr, lx + 9 * dpr), by = Math.max(16 * dpr, ly - 9 * dpr);
    ctx.fillStyle = 'rgba(4,10,16,0.75)'; ctx.fillRect(bx - 4 * dpr, by - 12 * dpr, tw + 8 * dpr, 16 * dpr);
    ctx.fillStyle = color; ctx.fillText(label, bx, by);
    ctx.restore();
  };
  for (const c of cmps) {
    const kx = W / (c.w || W), ky = H / (c.h || H);
    const dx = align ? cur.pts[0].x - c.pts[0].x * kx : 0, dy = align ? cur.pts[0].y - c.pts[0].y * ky : 0;
    const pts = c.pts.filter(q => q.t - c.pts[0].t <= rel + 1e-6);
    line(pts, c.color, fmtDate(c.date), (x) => x * kx + dx, (y) => y * ky + dy);
  }
  if (cur) line(cur.pts.filter(q => q.t <= tNow + S.frameDur * 0.5), PATH_COLORS[0], fmtDate(cur.date), (x) => x, (y) => y);
}

// ---------- cronómetro de frecuencia (tiempo del video, base 3 ciclos) ----------
let rateTaps = [];
function rateUi() {
  const n = rateTaps.length;
  $('rc-rate-n').textContent = n ? `${n}` : '';
  $('rc-rate-reset').hidden = !n;
  const out = $('rc-rate-out');
  if (n < 2) { out.hidden = !n; out.textContent = n ? 'Seguí tocando en cada entrada de la misma mano…' : ''; return; }
  const last = rateTaps.slice(-4), cyc = last.length - 1, spc = (last[cyc] - last[0]) / cyc;
  if (!(spc > 0)) { out.hidden = false; out.textContent = 'Los toques tienen que ir hacia adelante en el video.'; return; }
  const sr = 60 / spc;
  out.hidden = false;
  out.innerHTML = `${cyc} ciclo${cyc > 1 ? 's' : ''} en ${f(last[cyc] - last[0], 2)} s<br>${f(spc, 2)} s/ciclo · ${f(sr, 1)} ciclos/min · ${f(strokesPerMin(sr, S.cfg.style), 1)} brazadas/min${cyc < 3 ? '<br><span class="fine-label">Con 3 ciclos el valor es más estable.</span>' : ''}`;
}
$('rc-rate-tap').onclick = () => { rateTaps.push(video.paused ? currentFrameTime() : video.currentTime); rateUi(); };
$('rc-rate-reset').onclick = () => { rateTaps = []; rateUi(); };
