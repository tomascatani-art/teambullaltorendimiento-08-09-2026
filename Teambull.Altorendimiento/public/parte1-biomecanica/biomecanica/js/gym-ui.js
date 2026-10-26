// Pantalla Gym: velocidad de la barra (seguimiento del disco) y saltos (tiempo de vuelo) sobre un video
// ya filmado, con guardado en la ficha del deportista. El cálculo está en gym.js.
import { store } from './store.js';
import { readFrameTimes, probeFrameTimes } from './pose.js';
import { seekVideo } from './clip.js';
import { trackForward } from './track.js';
import { openLink, newCode } from './gym-link.js';
import { fpsHint, fpsVerdict, GUIDE, halfFrameMs, jumpErrCm } from './fpsguide.js';
import { unlock, beep } from './beep.js';
import { detectJump } from './jumpauto.js';
import { filmGuide } from './filmguide.js';
import { EXERCISES, ZONES, PRACTICE, DEFICIT_LIMIT, zoneOf, practiceOf, seriesDeficit, effectiveSet, PLATE_MM, barScale, barPath, analyzeBar, barSaved, jumpHeight, dropJump, fvProfile, loadVelocity } from './gym.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const f = (v, d = 2) => (Number.isFinite(v) ? v.toLocaleString('es-AR', { minimumFractionDigits: d, maximumFractionDigits: d }) : '–');
const num = (s) => { const v = parseFloat(String(s ?? '').replace(',', '.')); return Number.isFinite(v) ? v : NaN; };
const today = () => new Date().toISOString().slice(0, 10);

export const JUMPS = {
  cmj: { label: 'Con contramovimiento (CMJ)' },
  sj: { label: 'Sin contramovimiento (SJ)' },
  abk: { label: 'Con brazos (Abalakov)' },
  drop: { label: 'Con caída desde cajón (drop jump)' },
  loaded: { label: 'Con carga (para el perfil fuerza-velocidad)' },
};

let H = null, ready = false;
const S = { mode: 'bar', sound: true, live: null, file: null, url: null, times: null, frameDur: 1 / 30, W: 0, Hh: 0, tool: null, scale: null, scalePts: [], pts: [], res: null, abort: null, jumps: [], marks: {}, hint: '', auto: null, lupa: true, lupaPt: null, comprimido: '', evId: null, date: '', keepVid: false };
const video = () => $('gy-video'), overlay = () => $('gy-overlay');
// Deshacer: copia de lo marcado antes de cada cambio (disco, punto seguido, correcciones, saltos)
const hist = [];
function snap() {
  hist.push(JSON.stringify({ scalePts: S.scalePts, scale: S.scale, pts: S.pts, marks: S.marks, jumps: S.jumps }));
  if (hist.length > 40) hist.shift();
}
function undo() {
  const h = hist.pop();
  if (!h || S.abort) return;
  Object.assign(S, JSON.parse(h));
  S.tool = null; S.hint = 'Se deshizo el último cambio.';
  compute(); panel(); draw();
}
window.__swimGym = S; // para las pruebas automáticas

const frameAt = (t) => {
  if (!S.times) return Math.floor(t / S.frameDur + 1e-4);
  let lo = 0, hi = S.times.length - 1;
  // el cuadro que se ve: el último que empezó (al buscar se va a la mitad del cuadro)
  while (lo < hi) { const m = (lo + hi + 1) >> 1; if (S.times[m] <= t + 1e-4) lo = m; else hi = m - 1; }
  return lo;
};
const timeOf = (i) => (S.times ? S.times[Math.max(0, Math.min(S.times.length - 1, i))] : i * S.frameDur);
const nFrames = () => (S.times ? S.times.length : Math.floor((video().duration || 0) / S.frameDur));
const curFrame = () => frameAt(video().currentTime);
const seekFrame = (i) => seekVideo(video(), timeOf(Math.max(0, Math.min(nFrames() - 1, i))) + S.frameDur * 0.5).then(draw);

export function initGym(helpers) {
  H = helpers;
  if (ready) return;
  ready = true;
  const groups = [...new Set(Object.values(EXERCISES).map(e => e.group))];
  $('gy-ex').innerHTML = groups.map(g => `<optgroup label="${esc(g)}">${Object.entries(EXERCISES).filter(([, e]) => e.group === g).map(([k, e]) => `<option value="${k}">${esc(e.label)}</option>`).join('')}</optgroup>`).join('');
  $('gy-ex').onchange = () => { if (S.mode === 'bar' && S.res) panel(); };
  $('gy-jtype').innerHTML = Object.entries(JUMPS).map(([k, j]) => `<option value="${k}">${esc(j.label)}</option>`).join('');
  document.querySelectorAll('[data-gymode]').forEach(b => b.onclick = () => setMode(b.dataset.gymode));
  $('gy-file').onchange = $('gy-rec').onchange = async (e) => { const file = e.target.files[0]; e.target.value = ''; if (file) await load(file); };
  $('gy-prev').onclick = () => { video().pause(); seekFrame(curFrame() - 1); };
  $('gy-next').onclick = () => { video().pause(); seekFrame(curFrame() + 1); };
  $('gy-play').onclick = () => { const v = video(); if (v.paused) { v.playbackRate = +$('gy-speed').value; v.play().catch(() => {}); } else v.pause(); };
  $('gy-speed').onchange = () => { video().playbackRate = +$('gy-speed').value; };
  const v = video();
  ['timeupdate', 'seeked', 'play', 'pause'].forEach(ev => v.addEventListener(ev, draw));
  v.addEventListener('play', () => { const tick = () => { if (!v.paused) { draw(); requestAnimationFrame(tick); } }; requestAnimationFrame(tick); });
  overlay().addEventListener('pointerdown', onTap);
  window.addEventListener('resize', () => { if (S.file) draw(); });
  $('gy-jtype').onchange = () => panel();
  $('gy-live').onclick = () => startLive();
  $('gy-fullscreen').onclick = () => {
    const pl = $('gy-player');
    if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
    else {
      const r = (pl.requestFullscreen || pl.webkitRequestFullscreen)?.call(pl);
      // en el celular, un video horizontal se ve mejor acostado
      Promise.resolve(r).then(() => { if (S.W > S.Hh) screen.orientation?.lock?.('landscape').catch(() => {}); }).catch(() => {});
    }
  };
  document.addEventListener('fullscreenchange', () => setTimeout(draw, 50));
  $('gy-screen').onclick = async () => { stopLive(); const m = await import('./gym-screen.js'); m.openScreen(); };
  $('gy-athlete').addEventListener('change', () => { cargarDatos().then(() => { if (S.mode === 'jump') panel(); }); });
  setMode('bar');
}

// ---------- datos del deportista (peso, pierna, cadera): se recuerdan por deportista ----------
const DATOS_KEY = 'tb-gym-datos-v1';
const leerDatos = () => { try { return JSON.parse(localStorage.getItem(DATOS_KEY) || '{}'); } catch { return {}; } };
function guardarDatos() {
  const aid = $('gy-athlete')?.value;
  if (!aid) return;
  const d = leerDatos();
  d[aid] = { mass: S.mass ?? '', leg: S.leg ?? '', squat: S.squat ?? '' };
  try { localStorage.setItem(DATOS_KEY, JSON.stringify(d)); } catch { /* sin espacio: no se recuerda */ }
}
async function cargarDatos() {
  const aid = $('gy-athlete')?.value;
  if (!aid) return;
  const g = leerDatos()[aid] || {};
  let ult = null, ath = null;
  try {
    const evs = await store.listEvaluations(aid);
    ult = (evs || []).filter(e => e.kind === 'gym' && e.data?.type === 'jump' && (e.data.mass || e.data.hpo)).sort((a, b) => String(b.date).localeCompare(String(a.date)))[0]?.data || null;
  } catch { /* sin evaluaciones */ }
  try { ath = await store.getAthlete(aid); } catch { /* sin ficha */ }
  const txt = (v) => (Number.isFinite(+v) && +v > 0 ? String(v).replace('.', ',') : '');
  S.mass = g.mass || txt(ult?.mass) || txt(ath?.mass) || '';
  S.leg = g.leg || txt(ult?.leg) || '';
  S.squat = g.squat || txt(ult?.squat) || '';
  S.hpoGuardado = ult?.hpo ? String(ult.hpo) : '';
  S.hpo = hpoDe(S.leg, S.squat);
}

// ---------- marcado automático ----------
async function autoMarcar() {
  if (!S.file || S.auto?.busy) return;
  const v = video(); v.pause();
  const drop = $('gy-jtype').value === 'drop';
  const abort = new AbortController();
  S.auto = { busy: true, prog: 0, abort };
  panel();
  const vuelta = curFrame();
  try {
    const r = await detectJump(v, S.times, S.frameDur, {
      drop, signal: abort.signal, landmarker: window.__jumpTestLandmarker || null,
      onProgress: (p) => { S.auto.prog = p; const b = $('gy-jauto'); if (b) b.textContent = `Buscando los pies… ${f(100 * p, 0)} %`; },
    });
    if (r.error) { S.auto = null; S.hint = r.error; await seekFrame(vuelta); panel(); return; }
    snap();
    S.marks = { take: timeOf(r.take), land: timeOf(r.land), ...(drop && r.contact != null ? { contact: timeOf(r.contact) } : {}) };
    S.auto = { ok: true, pies: r.pies };
    S.hint = `Propuesta: despegue en el cuadro ${r.take + 1} y caída en el ${r.land + 1}${drop && r.contact != null ? `, contacto en el ${r.contact + 1}` : ''}. Revisalas antes de agregar el salto.`;
    await seekFrame(r.take);
  } catch (err) {
    S.auto = null;
    S.hint = err?.name === 'AbortError' ? 'Búsqueda cancelada.' : 'No se pudo marcar automático: ' + (err?.message || err) + '. Marcá a mano.';
    await seekFrame(vuelta);
  }
  panel(); draw();
}

// dónde están los pies en el cuadro i (lo más cercano que se midió), en píxeles del video
function piesEn(i) {
  if (S.lupaPt) return S.lupaPt;
  const ps = S.auto?.pies;
  if (!ps?.length) return null;
  let best = ps[0];
  for (const q of ps) if (Math.abs(q.i - i) < Math.abs(best.i - i)) best = q;
  return [best.x, best.y];
}

export async function refreshAthletes(selectId) {
  const list = await store.listAthletes();
  const sel = $('gy-athlete'), prev = selectId || sel.value;
  sel.innerHTML = `<option value="">Sin elegir (no se guarda)</option>${list.map(a => `<option value="${a.id}">${esc(a.name)}</option>`).join('')}`;
  if (list.some(a => a.id === prev)) sel.value = prev;
}

function setMode(m) {
  S.mode = m;
  calidadVideo();
  document.querySelectorAll('[data-gymode]').forEach(b => b.setAttribute('aria-selected', b.dataset.gymode === m));
  document.querySelectorAll('.gy-bar').forEach(el => { el.hidden = m !== 'bar'; });
  document.querySelectorAll('.gy-jump').forEach(el => { el.hidden = m !== 'jump'; });
  $('gy-tip').textContent = m === 'bar'
    ? `Filmá de costado, con el celular quieto (trípode o apoyado), a la altura de la barra y perpendicular a su recorrido, con el disco entero a la vista. ${fpsHint('bar')}`
    : `Filmá con el celular quieto y los pies a la vista, al nivel del piso. ${fpsHint('jump')}`;
  $('gy-guide').innerHTML = filmGuide(m === 'bar' ? 'bar' : 'jump');
  S.tool = null;
  panel(); draw();
}

// Videos que pasaron por WhatsApp u otra app de mensajes: vienen a 30 cuadros por segundo y muy
// comprimidos, aunque se hayan filmado en cámara lenta. Se reconoce por el nombre del archivo o por
// pocos cuadros con poco peso por segundo.
function videoComprimido(file, dur, fps) {
  const n = file?.name || '';
  if (fps >= 50) return '';
  if (/WA\d{4}|whatsapp/i.test(n)) return 'whatsapp';
  const mbps = dur > 0 ? (file.size * 8) / dur / 1e6 : NaN;
  if (fps < 40 && Number.isFinite(mbps) && mbps < 2.5 && Math.max(S.W, S.Hh) <= 1280) return 'comprimido';
  return '';
}
function avisoComprimido() {
  if (!S.comprimido) return '';
  const de = S.comprimido === 'whatsapp' ? 'Este video pasó por WhatsApp' : 'Este video parece comprimido por una app de mensajes';
  return `<p class="notice">${de}: queda en ${f(S.fps, 0)} cuadros por segundo aunque lo hayas filmado en cámara lenta, y cada marca puede quedar corrida hasta ${f(500 / S.fps, 0)} milésimas de segundo para un lado o para el otro. Usá el video original del celular que filmó (por cable, Drive, AirDrop o en WhatsApp con "Enviar como documento").</p>`;
}

// Calidad del video apenas se carga: cuadros por segundo, definición y cuánto error de tiempo suma.
// Barra: cada repetición tiene dos marcas (inicio y fin de la subida), cada una ±½ cuadro.
// Salto: el error de la altura sale del tiempo de vuelo (jumpErrCm, en un salto de 30 cm).
function calidadVideo() {
  const box = $('gy-calidad');
  if (!box) return;
  if (!S.file || !(S.fps > 0)) { box.hidden = true; return; }
  const kind = S.mode === 'jump' ? 'jump' : 'bar';
  const g = GUIDE[kind], fps = S.fps;
  const corto = Math.min(S.W, S.Hh), defi = `${S.W}×${S.Hh}${corto >= 2000 ? ' (4K)' : corto >= 1060 ? ' (Full HD)' : corto >= 700 ? ' (HD)' : ''}`;
  const fpsOk = fps >= g.min * 0.97, fpsIdeal = fps >= g.rec * 0.97, defiOk = corto >= 700;
  const nivel = !fpsOk || S.comprimido ? 'mal' : !fpsIdeal || !defiOk ? 'medio' : 'bien';
  const ms = halfFrameMs(fps);
  let error;
  if (kind === 'bar') {
    const pct = (2 * ms) / 600 * 100; // en una subida de 0,6 s
    error = `Cada marca ±${f(ms, 0)} ms; en una subida de 0,6 s la velocidad puede variar hasta ±${f(pct, 0)} %.`;
  } else {
    error = `Cada marca ±${f(ms, 0)} ms; en un salto de 30 cm la altura puede variar hasta ±${f(jumpErrCm(fps), 1)} cm.`;
  }
  const consejo = [];
  if (!fpsIdeal) consejo.push(kind === 'jump' ? `Filmá en cámara lenta (${g.rec}, mínimo ${g.min}).` : `Filmá a ${g.rec} cuadros por segundo (mínimo ${g.min}).`);
  if (!defiOk) consejo.push('Definición baja: los puntos se marcan con menos precisión; usá 720p o más.');
  if (S.comprimido) consejo.push('Pasó por WhatsApp o una app de mensajes: usá el video original del celular.');
  const icono = { bien: '✓', medio: '⚠', mal: '⚠' }[nivel];
  box.dataset.nivel = nivel;
  box.innerHTML = `<b>${icono} ${f(fps, 0)} fps · ${defi}</b><span>${nivel === 'bien' ? 'Calidad ideal. ' : ''}${error}</span>${consejo.length ? `<span>${consejo.join(' ')}</span>` : ''}`;
  box.hidden = false;
}

async function load(file) {
  stopLive();
  video().srcObject = null;
  $('gy-show').hidden = true;
  if (S.url) URL.revokeObjectURL(S.url);
  S.file = file; S.url = URL.createObjectURL(file);
  S.scale = null; S.scalePts = []; S.pts = []; S.res = null; S.jumps = []; S.marks = {}; S.tool = null; S.hint = ''; S.auto = null; S.lupaPt = null; S.evId = null; S.date = ''; hist.length = 0;
  const v = video();
  await new Promise((resolve, reject) => { v.onloadeddata = resolve; v.onerror = () => reject(new Error('Este navegador no puede leer el video.')); v.src = S.url; v.load(); }).catch(err => { H?.notify?.(err.message); throw err; });
  S.W = v.videoWidth; S.Hh = v.videoHeight;
  $('gy-stage').style.aspectRatio = `${S.W} / ${S.Hh}`; $('gy-stage').style.setProperty('--ar', S.W / S.Hh);
  // tiempos de cada cuadro: del contenedor (MP4/MOV) o, si no se puede, midiendo la reproducción
  let timing = await readFrameTimes(file).catch(() => null);
  if (!timing?.times?.length) timing = await probeFrameTimes(v).catch(() => null);
  if (!timing?.times?.length) { H?.notify?.('No pude leer los cuadros por segundo de este video. Probá con un MP4 o MOV.'); return; }
  S.times = timing.times.filter(t => t < v.duration); S.frameDur = timing.frameDur;
  S.fps = 1 / timing.frameDur;
  S.comprimido = videoComprimido(file, v.duration, S.fps);
  calidadVideo();
  H?.notify?.('');
  $('gy-work').hidden = false;
  await seekFrame(0);
  panel();
  ($('gy-calidad')?.hidden ? $('gy-player') : $('gy-calidad')).scrollIntoView({ block: 'start', behavior: 'smooth' });
}

// toque sobre el video: escala, punto a seguir
function toVideo(e) { const r = overlay().getBoundingClientRect(); return [(e.clientX - r.left) / r.width * S.W, (e.clientY - r.top) / r.height * S.Hh]; }
function onTap(e) {
  if (S.mode === 'jump' && S.file && S.lupa && !S.tool) { S.lupaPt = toVideo(e); draw(); return; }
  if (!S.tool || !S.file) return;
  e.preventDefault();
  if (!S.live) video().pause();
  const p = toVideo(e);
  if (S.tool === 'scale') {
    snap();
    S.scalePts.push(p);
    if (S.scalePts.length === 2) {
      const D = num($('gy-plate')?.value) / 1000;
      S.scale = barScale(S.scalePts[0], S.scalePts[1], D);
      S.tool = null; S.hint = S.scale ? '' : 'Los dos puntos quedaron muy juntos: volvé a marcar los bordes del disco.';
      if (S.pts.length > 1) compute();
    }
    panel(); draw();
  } else if (S.tool === 'center') { snap(); S.tool = null; if (S.live) liveTrack(p); else track(p); }
  else if (S.tool === 'fix') {
    snap();
    fixAt(p);
    const cv = overlay();
    cv.setPointerCapture?.(e.pointerId);
    const move = (ev) => fixAt(toVideo(ev));
    const up = () => { cv.removeEventListener('pointermove', move); cv.removeEventListener('pointerup', up); cv.removeEventListener('pointercancel', up); compute(); panel(); draw(); };
    cv.addEventListener('pointermove', move); cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
  }
}

async function track(p0) {
  const v = video(), i0 = curFrame();
  const Wk = Math.min(960, S.W), sc = Wk / S.W, Hk = Math.round(S.Hh * sc);
  const cv = document.createElement('canvas'); cv.width = Wk; cv.height = Hk;
  const cx = cv.getContext('2d', { willReadFrequently: true });
  const getGray = async (i) => {
    if (i >= nFrames()) return null;
    await seekVideo(v, timeOf(i) + S.frameDur * 0.5);
    cx.drawImage(v, 0, 0, Wk, Hk);
    const d = cx.getImageData(0, 0, Wk, Hk).data, G = new Float32Array(Wk * Hk);
    for (let k = 0, q = 0; k < G.length; k++, q += 4) G[k] = 0.299 * d[q] + 0.587 * d[q + 1] + 0.114 * d[q + 2];
    return { G, w: Wk, h: Hk };
  };
  // si se retoma después de perder el punto, se conserva lo seguido antes de este cuadro
  const t0 = timeOf(i0);
  S.pts = S.pts.filter(q => q.t < t0 - S.frameDur * 0.5);
  S.pts.push({ t: t0, x: p0[0], y: p0[1] });
  S.res = null;
  S.abort = new AbortController();
  S.hint = 'Siguiendo el disco…'; panel();
  const half = Math.max(10, Math.round(14 * Wk / 720)), search = Math.max(24, Math.round(40 * Wk / 720));
  let res;
  try {
    res = await trackForward(getGray, i0, [p0[0] * sc, p0[1] * sc], {
      maxFrames: nFrames() - 1 - i0, half, search, minScore: 0.6, subpixel: true, signal: S.abort.signal,
      onPoint: (pt, k) => { S.pts.push({ t: timeOf(pt.i), x: pt.x / sc, y: pt.y / sc }); if (k % 3 === 0) { draw(); $('gy-hint').textContent = `Siguiendo el disco… ${f(timeOf(pt.i) - t0, 1)} s`; } },
    });
  } finally { S.abort = null; }
  const last = S.pts[S.pts.length - 1];
  await seekVideo(v, last.t + S.frameDur * 0.5);
  if (res.lost) { S.tool = 'center'; S.hint = `Perdí el disco a los ${f(last.t, 2)} s (se tapó o cambió mucho). El video quedó en ese cuadro: tocá el centro del disco para seguir desde ahí.`; }
  else S.hint = `Listo: ${S.pts.length} cuadros seguidos. Revisá la línea con el reproductor; si se fue del disco en algún cuadro, pausá ahí y volvé a tocar el centro.`;
  compute(); panel(); draw();
}

function compute() {
  S.res = S.scale && S.pts.length > 10 ? analyzeBar(barPath(S.pts, S.scale), S.scale) : null;
}

// ---------- dibujo ----------
function draw() {
  const cv = overlay(), st = $('gy-stage');
  if (!cv || !S.file) return;
  const w = st.clientWidth, h = st.clientHeight, dpr = window.devicePixelRatio || 1;
  if (cv.width !== Math.round(w * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
  cv.classList.toggle('tool', !!S.tool);
  const fb = $('gy-from'); if (fb) fb.disabled = !curPoint();
  const ctx = cv.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, w, h);
  const k = w / S.W, X = (p) => [p[0] * k, p[1] * k];
  const t = S.live ? Infinity : video().currentTime, i = S.live ? -1 : curFrame();
  if (S.mode === 'bar') {
    if (S.scalePts.length) {
      ctx.strokeStyle = '#4cc9f0'; ctx.fillStyle = '#4cc9f0'; ctx.lineWidth = 2;
      const [a, b] = [X(S.scalePts[0]), S.scalePts[1] ? X(S.scalePts[1]) : null];
      ctx.beginPath(); ctx.arc(a[0], a[1], 4, 0, 7); ctx.fill();
      if (b) { ctx.beginPath(); ctx.arc(b[0], b[1], 4, 0, 7); ctx.fill(); ctx.setLineDash([5, 4]); ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke(); ctx.setLineDash([]); }
    }
    if (S.pts.length > 1) {
      // recorrido hasta el instante actual; las subidas en color
      const reps = S.res?.reps || [];
      const upAt = (tt) => reps.some(r => tt >= r.t0 && tt <= r.t1);
      ctx.lineWidth = 2.5;
      for (let j = 1; j < S.pts.length && S.pts[j].t <= t + 1e-6; j++) {
        const a = X([S.pts[j - 1].x, S.pts[j - 1].y]), b = X([S.pts[j].x, S.pts[j].y]);
        ctx.strokeStyle = upAt(S.pts[j].t) ? '#ff9f1c' : 'rgba(255,255,255,.75)';
        ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
      }
      const cur = S.live ? S.pts[S.pts.length - 1] : S.pts.find(q => Math.abs(q.t - timeOf(i)) < S.frameDur * 0.5);
      if (cur) {
        const c = X([cur.x, cur.y]), big = S.tool === 'fix';
        ctx.strokeStyle = cur.fixed ? '#80ed99' : '#fff'; ctx.fillStyle = '#ff9f1c'; ctx.lineWidth = big ? 3 : 2;
        ctx.beginPath(); ctx.arc(c[0], c[1], big ? 10 : 6, 0, 7); ctx.fill(); ctx.stroke();
        if (big) { ctx.beginPath(); ctx.moveTo(c[0] - 18, c[1]); ctx.lineTo(c[0] + 18, c[1]); ctx.moveTo(c[0], c[1] - 18); ctx.lineTo(c[0], c[1] + 18); ctx.stroke(); }
      }
    }
  }
  if (S.mode === 'jump' && S.lupa && !S.live) {
    // lupa: la zona de los pies ampliada, para elegir el cuadro exacto del despegue y del contacto
    const c = piesEn(i) || [S.W / 2, S.Hh * 0.88];
    const zoom = 3, R = Math.round(Math.min(w, h) * 0.42), src = R / k / zoom;
    const sx = Math.max(0, Math.min(S.W - src, c[0] - src / 2)), sy = Math.max(0, Math.min(S.Hh - src, c[1] - src / 2));
    const tb = $('gy-tools')?.getBoundingClientRect(), sr = st.getBoundingClientRect();
    const dx = c[0] * k > w / 2 ? 8 : w - R - 8, dy = Math.min(h - R - 8, Math.max(8, tb && tb.height ? tb.bottom - sr.top + 6 : 48));
    ctx.save();
    ctx.fillStyle = '#121017'; ctx.fillRect(dx - 2, dy - 2, R + 4, R + 4);
    try { ctx.imageSmoothingEnabled = false; ctx.drawImage(video(), sx, sy, src, src, dx, dy, R, R); } catch { /* cuadro todavía sin cargar */ }
    ctx.strokeStyle = '#FF6B35'; ctx.lineWidth = 2; ctx.strokeRect(dx, dy, R, R);
    const px = dx + (c[0] - sx) / src * R, py = dy + (c[1] - sy) / src * R;
    ctx.strokeStyle = 'rgba(255,255,255,.75)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(px - 12, py); ctx.lineTo(px + 12, py); ctx.moveTo(px, py - 12); ctx.lineTo(px, py + 12); ctx.stroke();
    ctx.strokeStyle = 'rgba(255,107,53,.85)'; ctx.setLineDash([4, 3]); ctx.strokeRect(sx * k, sy * k, src * k, src * k); ctx.setLineDash([]);
    ctx.fillStyle = '#FF6B35'; ctx.font = '700 10px Inter, sans-serif'; ctx.fillText('LUPA ×3', dx + 6, dy + R - 7);
    ctx.restore();
  }
  if (S.live) {
    const last = S.res?.reps?.[S.res.reps.length - 1];
    $('gy-hud').textContent = `en vivo · ${f(1 / S.frameDur, 0)} cuadros/s${last ? ` · rep ${last.n}: ${f(last.mv)} m/s` : ''}`;
    return;
  }
  // HUD: cuadro, tiempo y velocidad de la barra en este cuadro
  let hud = `cuadro ${i + 1} / ${nFrames()} · ${f(timeOf(i), 3)} s`;
  if (S.mode === 'bar' && S.res?.curve) {
    const c = S.res.curve; let j = 0; while (j < c.t.length - 1 && c.t[j + 1] <= t) j++;
    if (Number.isFinite(c.v[j]) && Math.abs(c.t[j] - t) < 2 * S.frameDur) hud += ` · barra ${f(c.v[j], 2)} m/s`;
  }
  if (S.mode === 'bar' && S.res?.reps?.length) { const rs = S.res.reps; hud += ` · ${rs.length} rep · mejor ${f(S.res.best.mv)} m/s`; }
  if (S.mode === 'jump') { const m = S.marks; hud += [m.contact != null && ' · contacto ✓', m.take != null && ' · despegue ✓', m.land != null && ' · caída ✓'].filter(Boolean).join(''); }
  $('gy-hud').textContent = hud;
  $('gy-play').setAttribute('aria-label', video().paused ? 'Reproducir' : 'Pausar');
  $('gy-play-ico').setAttribute('d', video().paused ? 'M7 5l12 7-12 7z' : 'M7 5h4v14H7zM13 5h4v14h-4z');
}

// ---------- en vivo: la cámara de este dispositivo, con las velocidades hacia la pantalla del deportista ----------
async function startLive() {
  if (!navigator.mediaDevices?.getUserMedia) { H?.notify?.('Este navegador no deja usar la cámara. Probá con Chrome o Safari actualizado.'); return; }
  stopLive();
  unlock();
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 60 } } });
  } catch (err) { H?.notify?.('No pude abrir la cámara: ' + (err.message || err.name)); return; }
  const v = video();
  if (S.url) { URL.revokeObjectURL(S.url); S.url = null; }
  v.removeAttribute('src'); v.srcObject = stream;
  await v.play().catch(() => {});
  if (!v.videoWidth) await new Promise(r => v.addEventListener('loadedmetadata', r, { once: true }));
  H?.notify?.('');
  $('gy-show').hidden = true;
  S.live = { stream, code: newCode(), link: null, kind: '', T0: null, times: [], peer: null, done: false };
  S.file = { name: 'en vivo' }; S.times = null; S.W = v.videoWidth; S.Hh = v.videoHeight;
  S.scale = null; S.scalePts = []; S.pts = []; S.res = null; S.tool = 'scale'; S.hint = ''; hist.length = 0;
  $('gy-stage').style.aspectRatio = `${S.W} / ${S.Hh}`; $('gy-stage').style.setProperty('--ar', S.W / S.Hh);
  $('gy-work').hidden = false;
  panel();
  const tick = () => { if (S.live && !S.live.done) { draw(); requestAnimationFrame(tick); } };
  requestAnimationFrame(tick);
  const L = S.live;
  try { L.link = await openLink(L.code, onLinkMsg); L.kind = L.link.kind; } catch (err) { L.kind = 'error'; S.hint = err.message; }
  if (S.live === L) panel();
}

function liveBox() {
  const L = S.live, where = { room: '', cloud: '', local: ' (solo en otra pestaña de este mismo dispositivo: para usar otro dispositivo hace falta la nube o la app publicada)', error: ' (sin conexión)' }[L.kind] ?? ' (conectando…)';
  const fps = S.pts.length > 10 ? 1 / S.frameDur : NaN;
  return `<div class="gy-live"><span class="fine-label">Código para la pantalla del deportista</span><b class="mono gy-code">${L.code}</b><span class="fine">${esc(where)}</span>
    ${Number.isFinite(fps) && fps < 50 ? `<span class="fine">Se están procesando ${f(fps, 0)} cuadros por segundo: cada punta de la subida puede correrse hasta un cuadro, y por eso el margen de cada repetición es más grande que filmando a 60.</span>` : ''}</div>`;
}

// mensajes de la pantalla del deportista
function onLinkMsg(m) {
  const L = S.live;
  if (!L || !m || typeof m !== 'object') return;
  if (m.type === 'hello') sendState(true);
  else if (m.type === 'want-video') startPeer();
  else if (m.type === 'answer' && L.peer && typeof m.sdp === 'string') L.peer.setRemoteDescription({ type: 'answer', sdp: m.sdp }).catch(() => {});
  else if (m.type === 'ice' && L.peer && m.c) L.peer.addIceCandidate(m.c).catch(() => {});
}
async function startPeer() {
  const L = S.live;
  if (!L || L.done || typeof RTCPeerConnection === 'undefined') return;
  L.peer?.close();
  const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
  L.peer = pc;
  L.stream.getTracks().forEach(tr => pc.addTrack(tr, L.stream));
  pc.onicecandidate = (e) => { if (e.candidate) L.link?.send({ type: 'ice', c: e.candidate.toJSON() }); };
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  L.link?.send({ type: 'offer', sdp: offer.sdp });
}

// Estado que ve el deportista: cada repetición terminada, la zona de la serie y el déficit.
function sendState(force = false) {
  const L = S.live;
  if (!L?.link) return;
  const reps = (S.res?.reps || []).map(r => ({ n: r.n, mv: +r.mv.toFixed(3), se: +r.se.toFixed(3) }));
  const key = reps.map(r => r.mv).join(',') + (L.done ? '|fin' : '');
  if (!force && key === L.sentKey) return;
  L.sentKey = key;
  const d = seriesDeficit(reps);
  L.link.send({ type: 'state', reps, deficit: d ? +d.v.toFixed(2) : null, ex: $('gy-ex').value, load: num($('gy-load').value) || null, done: L.done, tracking: !!S.abort });
}

// Siguiente cuadro de la cámara, con su hora (s). requestVideoFrameCallback da la hora de captura.
function nextFrame(v) {
  return new Promise((resolve) => {
    if ('requestVideoFrameCallback' in v) v.requestVideoFrameCallback((now, m) => resolve((m.captureTime ?? m.expectedDisplayTime ?? now) / 1000));
    else requestAnimationFrame((now) => resolve(now / 1000));
  });
}

async function liveTrack(p0) {
  const L = S.live, v = video();
  if (!L || L.done) return;
  // en vivo cada cuadro tiene que procesarse antes del siguiente: copia más chica y búsqueda más corta
  const Wk = Math.min(480, S.W), sc = Wk / S.W, Hk = Math.round(S.Hh * sc);
  const cv = document.createElement('canvas'); cv.width = Wk; cv.height = Hk;
  const cx = cv.getContext('2d', { willReadFrequently: true });
  const times = [];
  const getGray = async (i) => {
    if (!S.live || S.live.done || L !== S.live) return null;
    const t = await nextFrame(v);
    if (L.T0 == null) L.T0 = t;
    times[i] = t - L.T0;
    cx.drawImage(v, 0, 0, Wk, Hk);
    const d = cx.getImageData(0, 0, Wk, Hk).data, G = new Float32Array(Wk * Hk);
    for (let k = 0, q = 0; k < G.length; k++, q += 4) G[k] = 0.299 * d[q] + 0.587 * d[q + 1] + 0.114 * d[q + 2];
    return { G, w: Wk, h: Hk };
  };
  S.res = S.pts.length ? S.res : null;
  S.abort = new AbortController();
  S.hint = 'Siguiendo el disco en vivo…'; panel();
  const half = Math.max(8, Math.round(14 * Wk / 720)), search = Math.max(16, Math.round(30 * Wk / 720));
  let first = true, k0 = 0, res;
  try {
    res = await trackForward(getGray, 0, [p0[0] * sc, p0[1] * sc], {
      maxFrames: 60 * 600, half, search, minScore: 0.6, subpixel: true, signal: S.abort.signal,
      onPoint: (pt, k) => {
        if (first) { S.pts.push({ t: times[0], x: p0[0], y: p0[1] }); first = false; }
        S.pts.push({ t: times[pt.i], x: pt.x / sc, y: pt.y / sc });
        if (k - k0 >= 2) { k0 = k; liveUpdate(); }
      },
    });
  } finally { S.abort = null; }
  if (L !== S.live) return;
  if (res?.lost && !L.done) { S.tool = 'center'; S.hint = 'Perdí el disco (se tapó o se movió mucho). Tocá el centro del disco para seguir.'; }
  liveUpdate(true);
  panel();
}

function liveUpdate(force = false) {
  if (S.pts.length < 3) return;
  const ts = S.pts.map(p => p.t), d = [];
  for (let i = 1; i < ts.length; i++) d.push(ts[i] - ts[i - 1]);
  d.sort((a, b) => a - b);
  if (d[d.length >> 1] > 0) S.frameDur = d[d.length >> 1];
  if (!S.scale) return;
  const before = (S.res?.reps || []).length;
  const r = analyzeBar(barPath(S.pts, S.scale), S.scale);
  if (r.error && !force) return;
  S.res = r.error ? (S.res || r) : r;
  const now = (S.res.reps || []).length;
  if (now > before && S.live && !S.live.done) {
    // demora entre el final real de la subida y el aviso (para las pruebas y para saber cuánto tarda)
    const lastRep = S.res.reps[now - 1];
    if (S.live.T0 != null) (S.live.lags ||= []).push(performance.now() / 1000 - (S.live.T0 + lastRep.t1));
    if (S.sound) { const d = seriesDeficit(S.res.reps); beep(d?.stop ? 'stop' : 'rep'); }
  }
  sendState();
  if ((S.res.reps || []).length !== before || force) panel();
}

function endLive() {
  const L = S.live;
  if (!L || L.done) return;
  L.done = true;
  S.abort?.abort();
  L.stream.getTracks().forEach(tr => tr.stop());
  L.peer?.close(); L.peer = null;
  video().srcObject = null;
  S.tool = null;
  compute();
  S.hint = S.pts.length ? `Serie terminada: ${S.pts.length} cuadros seguidos a ${f(1 / S.frameDur, 0)} cuadros por segundo.` : '';
  sendState(true);
  panel(); draw();
}

function stopLive() {
  const L = S.live;
  if (!L) return;
  if (!L.done) { L.done = true; S.abort?.abort(); L.stream.getTracks().forEach(tr => tr.stop()); L.peer?.close(); }
  L.link?.close();
  S.live = null;
  video().srcObject = null;
}
export function leaveGym() { stopLive(); import('./gym-screen.js').then(m => m.closeScreen()).catch(() => {}); }

// ---------- panel de la derecha ----------
function panel() {
  const box = $('gy-panel');
  if (!box) return;
  box.innerHTML = (S.file ? avisoComprimido() : '') + (S.mode === 'bar' ? barPanel() : jumpPanel());
  renderTools();
  bindPanel();
}

// ---------- herramientas sobre el video ----------
const curPoint = () => (S.live ? null : S.pts.find(q => Math.abs(q.t - timeOf(curFrame())) < S.frameDur * 0.5) || null);
function renderTools() {
  const bar = $('gy-tools');
  if (!bar) return;
  if (!S.file) { bar.innerHTML = ''; return; }
  const b = (id, label, { on = false, primary = false, attr = '' } = {}) => `<button class="btn small${on ? ' on' : primary ? ' primary' : ' ghost'}" id="${id}" type="button"${attr}>${label}</button>`;
  let h = (S.live && !S.live.done) ? '' : b('gy-undo', '↶ Deshacer', { attr: hist.length && !S.abort ? ' title="Deshacer el último cambio"' : ' disabled' }), tip = '';
  if (S.mode === 'bar') {
    const tracking = !!S.abort, done = !!S.live?.done;
    if (!done) h += b('gy-scale', S.tool === 'scale' ? `Borde ${S.scalePts.length + 1} de 2…` : S.scale ? 'Disco ✓' : '1 · Marcar disco', { on: S.tool === 'scale', primary: !S.scale });
    if (tracking) h += b('gy-stop', 'Detener', { primary: true });
    else if (!done) h += b('gy-center', S.tool === 'center' ? 'Tocá el centro…' : S.pts.length ? (S.live ? 'Tocar el centro de nuevo' : 'Tocar el centro') : '2 · Seguir la barra', { on: S.tool === 'center', primary: !!S.scale && !S.pts.length });
    if (S.pts.length > 1 && !S.live && !tracking) {
      h += b('gy-fix', S.tool === 'fix' ? 'Listo' : 'Corregir punto', { on: S.tool === 'fix' });
      h += b('gy-from', 'Seguir desde acá', { attr: curPoint() ? '' : ' disabled title="En este cuadro no hay punto: tocá el centro"' });
    }
    if (S.live && !done) h += b('gy-live-sound', S.sound ? 'Sonido ✓' : 'Sin sonido', { on: S.sound }) + b('gy-live-end', 'Terminar la serie', { primary: true });
    tip = S.tool === 'scale' ? 'Tocá un borde del disco y después el opuesto, pasando por el centro.'
      : S.tool === 'center' ? 'Tocá el centro del disco.'
      : S.tool === 'fix' ? 'Arrastrá el punto naranja al centro del disco (o tocá donde va). Pasá de cuadro con ◀ ▶ y corregí los que haga falta.'
      : '';
  } else {
    h += ['contact', 'take', 'land'].filter(k => k !== 'contact' || $('gy-jtype').value === 'drop').map(k => `<button class="btn small${S.marks[k] != null ? ' on' : ' ghost'}" type="button" data-gymark="${k}">${{ contact: 'Contacto', take: 'Despegue', land: 'Caída' }[k]}${S.marks[k] != null ? ' ✓' : ''}</button>`).join('');
    h += b('gy-jadd2', 'Agregar salto', { primary: true });
    h += b('gy-lupa', S.lupa ? 'Lupa ✓' : 'Lupa', { on: S.lupa });
    tip = S.lupa ? 'Mové el video cuadro a cuadro con ◀ ▶ y marcá cada momento. Tocá el video para poner la lupa sobre los pies.' : 'Mové el video cuadro a cuadro con ◀ ▶ y marcá cada momento.';
  }
  bar.innerHTML = h + (tip ? `<span class="gy-tip-line">${esc(tip)}</span>` : '');
}

function fixAt(p) {
  const i = curFrame(), t = timeOf(i);
  let q = S.pts.find(z => Math.abs(z.t - t) < S.frameDur * 0.5);
  if (!q) { q = { t, x: p[0], y: p[1] }; S.pts.push(q); S.pts.sort((a, c) => a.t - c.t); }
  q.x = p[0]; q.y = p[1]; q.fixed = true;
  draw();
}

function barPanel() {
  if (!S.file) return '<p class="fine">Elegí el video de la serie para empezar.</p>';
  const sc = S.scale, r = S.res;
  let h = `<div class="gy-step"><div class="gy-step-n">1</div><div><b>Escala</b>
    <p class="fine">Tocá los dos bordes del disco, de lado a lado pasando por el centro. Los discos de competencia miden ${PLATE_MM} mm (reglamento IWF); medí el tuyo si es de otro tipo.</p>
    <div class="gy-row"><label>Diámetro del disco (mm)<input type="text" id="gy-plate" inputmode="decimal" value="${esc(sc ? Math.round(sc.D * 1000) : PLATE_MM)}"></label></div>
    ${sc ? `<p class="fine ok-line">Disco: ${f(sc.px, 0)} px = ${f(sc.D * 1000, 0)} mm. Error de la escala ±${f(100 * sc.rel, 1)} % (1 px en cada borde).</p>` : ''}</div></div>
    <div class="gy-step"><div class="gy-step-n">2</div><div><b>Seguir la barra</b>
    <p class="fine">${S.live ? 'Con el deportista quieto antes de empezar, tocá el centro del disco: lo sigo en vivo y cada repetición aparece al terminar la subida.' : 'Pausá antes de que empiece la serie y tocá el centro del disco: lo sigo cuadro a cuadro hasta el final del video.'}</p>
    ${S.live && !S.live.done ? `<div class="gy-row">${liveBox()}</div>` : ''}
    <p class="fine">Los botones están arriba del video. Si la línea se va del disco en algún cuadro, tocá <b>Corregir punto</b> y arrastralo (o tocá donde va); <b>Seguir desde acá</b> vuelve a seguir desde el punto corregido.</p>
    <p class="fine" id="gy-hint">${esc(S.hint)}</p></div></div>`;
  if (!S.live && S.fps) { const fv = fpsVerdict('bar', S.fps); if (fv.text) h = `<p class="${fv.ok ? 'fine ok-line' : 'notice'}">${esc(fv.text)}</p>` + h; }
  if (S.pts.length > 10 && !sc) h += '<p class="notice">Falta la escala (paso 1) para pasar el recorrido a metros.</p>';
  if (r?.error) h += `<p class="notice">${esc(r.error)}</p>`;
  if (r && !r.error) {
    const ex = EXERCISES[$('gy-ex').value]?.label || '', load = num($('gy-load').value);
    h += `<div class="kpis gy-kpis">
      <div class="kpi"><span class="fine-label">Repeticiones</span><b class="mono">${r.reps.length}</b></div>
      <div class="kpi"><span class="fine-label">Mejor velocidad media</span><b class="mono">${f(r.best.mv)} <small>m/s</small></b><small>±${f(1.96 * r.best.se)} · rep ${r.best.n}</small></div>
      <div class="kpi"><span class="fine-label">Pérdida de velocidad</span><b class="mono">${r.vl ? `${f(r.vl.v, 1)} <small>%</small>` : '–'}</b><small>${r.vl ? `±${f(1.96 * r.vl.se, 1)} · rep ${r.vl.from} a ${r.vl.to}` : 'hace falta más de una'}</small></div>
      ${deficitKpi(seriesDeficit(r.reps))}
    </div>
    ${zoneHtml(r.reps, $('gy-ex').value)}
    ${velChart(r)}
    <div class="table-wrap"><table class="data sheet"><tr><th>Rep</th><th>Vel. media <small>(m/s)</small></th><th>Pico <small>(m/s)</small></th><th>Recorrido <small>(cm)</small></th><th>Subida <small>(s)</small></th><th>Bajada <small>(s)</small></th><th>Desvío horiz. <small>(cm)</small></th><th>Calidad</th></tr>
    ${r.reps.map(x => `<tr><th scope="row"><button class="linkish" type="button" data-gyrep="${x.n}">${x.n}</button></th><td class="mono">${f(x.mv)}<span class="ci">±${f(1.96 * x.se)}</span></td><td class="mono">${f(x.pv)}</td><td class="mono">${f(100 * x.rom, 0)}</td><td class="mono">${f(x.dur)}</td><td class="mono">${x.ecc != null ? f(x.ecc) : '–'}</td><td class="mono">${f(100 * x.dx, 1)}</td><td>${esc(zoneName(x.mv))}</td></tr>`).join('')}</table></div>
    <p class="fine">Velocidad media: lo que sube la barra dividido por lo que dura la subida (de velocidad cero a velocidad cero). Pérdida de velocidad: de la repetición más rápida a la última. El número chico con ± (más o menos) es el margen de error: el valor real está entre el número menos ese margen y el número más ese margen. Sale del ruido del seguimiento medido en este video (${f(1000 * r.sigmaX, 1)} mm), escala (±${f(100 * r.scaleRel, 1)} %) y hasta un cuadro en cada punta de la subida. Vale solo si la cámara estuvo quieta y perpendicular al recorrido: si el disco se acerca o se aleja de la cámara, la escala cambia.${r.cut ? ' La última subida quedó cortada por el final del video y no se cuenta.' : ''}</p>
    ${saveRow('Guardar la serie en la ficha', `${esc(ex)}${Number.isFinite(load) ? ` · ${f(load, 1)} kg` : ' · sin carga anotada'}`)}`;
  }
  return h;
}

// ---------- zonas de velocidad (tabla de Prilepin adaptada) ----------
const rng = (z) => (z.hi === Infinity ? `más de ${f(z.lo, 2)}` : z.lo === 0 ? `menos de ${f(z.hi, 2)}` : `${f(z.lo, 2)} a ${f(z.hi, 2)}`);
function zoneName(v) {
  const z = zoneOf(v);
  return !z ? '' : z.zone ? z.zone.label : z.out === 'below' ? 'debajo de la tabla' : 'arriba de la tabla';
}
function setMean(reps) {
  const v = reps.map(x => x.mv).filter(Number.isFinite), n = v.length;
  return { v: n ? v.reduce((a, b) => a + b, 0) / n : NaN, se: n ? Math.sqrt(reps.reduce((a, x) => a + (Number.isFinite(x.se) ? x.se ** 2 : 0), 0)) / n : NaN };
}
function deficitKpi(d) {
  return `<div class="kpi"><span class="fine-label">Déficit de la serie</span><b class="mono">${d ? `${f(d.v, 2)} <small>%</small>` : '–'}</b><small>${d ? `±${f(1.96 * d.se, 1)} · 1.ª ${f(d.first)} / media ${f(d.mean)}` : 'hace falta más de una'}</small></div>`;
}
// Qué calidad trabaja la serie según la velocidad media de sus repeticiones.
export function zoneHtml(reps, exKey) {
  const { v, se } = setMean(reps);
  const z = zoneOf(v, se), p = practiceOf(v, se), d = seriesDeficit(reps), ex = EXERCISES[exKey] || EXERCISES.other;
  if (!z) return '';
  const zr = z.zone;
  let h = `<div class="gy-zone"><div class="gy-zone-head"><span class="fine-label">Trabaja</span><b>${zr ? esc(zr.label) : z.out === 'below' ? 'Por debajo de la tabla (menos de 0,15 m/s)' : 'Por encima de la tabla (más de 1,30 m/s)'}</b>
    <span class="mono">velocidad media de la serie ${f(v)} ±${f(1.96 * se)} m/s</span></div>`;
  if (z.near) h += `<p class="fine">Con el margen de la medición también podría ser ${esc(z.near.label)}.</p>`;
  if (zr) h += `<p>${esc(zr.pct)} de un día normal · ${esc(zr.reps)} repeticiones por serie · ${esc(zr.sets)} series · ${esc(zr.total)} repeticiones en total.</p>`;
  if (p?.zone) h += `<p>En la práctica: <b>${esc(p.zone.label)}</b> (${rng(p.zone)} m/s) · ${esc(p.zone.reps)} repeticiones por serie · ${esc(p.zone.sets)} series · ${esc(p.zone.total)} en total.</p>`;
  if (d?.stop) h += `<p class="notice">El déficit de la serie pasó de ${DEFICIT_LIMIT} %: según la tabla, solo una serie más.</p>`;
  if (ex.table === 'other') h += `<p class="fine">Las velocidades de la tabla salen de la sentadilla. En ${esc(ex.label.toLowerCase())} la misma velocidad corresponde a otro porcentaje del máximo (por ejemplo, el 1RM se alcanza a unos 0,30 m/s en sentadilla completa y a unos 0,15 m/s en press de banca), así que tomalo como orientación o usá el perfil carga-velocidad del deportista.</p>`;
  if (ex.table === 'olympic') h += `<p class="fine">En los levantamientos olímpicos la referencia habitual es la velocidad pico, no la media: la zona de la tabla (velocidad media, hecha con sentadilla) no se aplica directamente.</p>`;
  h += `<details class="gy-table"><summary>Ver la tabla</summary><div class="table-wrap"><table class="data sheet"><tr><th>Calidad</th><th>Velocidad (m/s)</th><th>% de un día normal</th><th>Reps por serie</th><th>Series</th><th>Reps totales</th></tr>${ZONES.map(x => `<tr${x === zr ? ' class="hl"' : ''}><th scope="row">${esc(x.label)}</th><td class="mono">${rng(x)}</td><td>${esc(x.pct)}</td><td>${esc(x.reps)}</td><td>${esc(x.sets)}</td><td>${esc(x.total)}</td></tr>`).join('')}</table></div>
    <div class="table-wrap"><table class="data sheet"><tr><th>En la práctica</th><th>Velocidad (m/s)</th><th>Reps por serie</th><th>Series</th><th>Reps totales</th></tr>${PRACTICE.map(x => `<tr${x === p?.zone ? ' class="hl"' : ''}><th scope="row">${esc(x.label)}</th><td class="mono">${rng(x)}</td><td>${esc(x.reps)}</td><td>${esc(x.sets)}</td><td>${esc(x.total)}</td></tr>`).join('')}</table></div>
    <p class="fine">Tabla de Prilepin adaptada al entrenamiento basado en la velocidad (Medvedyev, 1986; D. Baker y col., 2000). Adaptación a la práctica: Prof. Jorge González Guedes, con datos de sentadilla. Si el déficit de la serie supera −10 %, solo se sigue una serie más. Déficit de la serie = (velocidad media de las repeticiones − velocidad de la 1.ª) / velocidad media.</p></details></div>`;
  return h;
}

function velChart(r) {
  const c = r.curve, W = 380, Hc = 170, L = 34, R = 10, T = 10, B = 24;
  const ts = c.t, vs = c.v.map(v => (Number.isFinite(v) ? v : null));
  const vmax = Math.max(0.2, ...vs.filter(v => v != null)), vmin = Math.min(0, ...vs.filter(v => v != null));
  const X = (t) => L + (t - ts[0]) / (ts[ts.length - 1] - ts[0] || 1) * (W - L - R), Y = (v) => T + (1 - (v - vmin) / (vmax - vmin)) * (Hc - T - B);
  const path = vs.map((v, i) => (v == null ? '' : `${i && vs[i - 1] != null ? 'L' : 'M'}${X(ts[i]).toFixed(1)},${Y(v).toFixed(1)}`)).join('');
  const bands = r.reps.map(x => `<rect x="${X(x.t0).toFixed(1)}" y="${T}" width="${Math.max(1, X(x.t1) - X(x.t0)).toFixed(1)}" height="${Hc - T - B}" class="gy-band"/><text x="${((X(x.t0) + X(x.t1)) / 2).toFixed(1)}" y="${T + 12}" text-anchor="middle" class="evo-tick">${x.n}</text>`).join('');
  const step = vmax - vmin > 1.5 ? 0.5 : vmax - vmin > 0.6 ? 0.2 : 0.1, ticks = [];
  for (let v = Math.ceil(vmin / step) * step; v <= vmax + 1e-9; v += step) ticks.push(v);
  return `<div class="gy-chart"><svg viewBox="0 0 ${W} ${Hc}" role="img" aria-label="Velocidad vertical de la barra en el tiempo">${bands}${ticks.map(v => `<line x1="${L}" x2="${W - R}" y1="${Y(v)}" y2="${Y(v)}" class="evo-grid"/><text x="${L - 6}" y="${Y(v) + 4}" text-anchor="end" class="evo-tick">${f(v, 1)}</text>`).join('')}<path d="${path}" class="evo-line"/><text x="${W - R}" y="${Hc - 6}" text-anchor="end" class="evo-tick">velocidad vertical (m/s) · subidas sombreadas</text></svg></div>`;
}

function jumpPanel() {
  if (!S.file) return '<p class="fine">Elegí el video del salto para empezar.</p>';
  const type = $('gy-jtype').value, drop = type === 'drop', m = S.marks, fd = S.frameDur;
  const fps = 1 / fd, errCm = 100 * jumpHeight(0, 0.5, fd).se * 1.96;
  const mk = (k, label) => `<span class="gy-mk"><button class="btn small${m[k] != null ? '' : ' ghost'}" type="button" data-gymark="${k}">${label}${m[k] != null ? `: cuadro ${frameAt(m[k]) + 1}` : ''}</button>${m[k] != null ? `<button class="linkish" type="button" data-gygo="${k}">ver</button>` : ''}</span>`;
  const autoBtn = `<div class="gy-row"><button class="btn small ${S.auto?.busy ? 'ghost' : m.take == null ? 'primary' : 'ghost'}" id="gy-jauto" type="button"${S.auto?.busy ? ' disabled' : ''}>${S.auto?.busy ? `Buscando los pies… ${f(100 * (S.auto.prog || 0), 0)} %` : '✨ Marcar automático'}</button>${S.auto?.busy ? '<button class="linkish" id="gy-jauto-stop" type="button">Cancelar</button>' : ''}</div>
    <p class="fine">${S.auto?.ok ? '<b>Marcas propuestas por la app.</b> Revisalas con «ver» y ◀ ▶. Si alguna no cae justo, parate en el cuadro correcto y tocá su botón: la marca pasa a ese cuadro.' : 'La app sigue los pies y propone las marcas; después podés corregirlas o marcarlas vos a mano.'}</p>`;
  let h = autoBtn + `<p class="fine">Buscá con los botones de cuadro a cuadro y marcá en el cuadro justo. <b>Despegue</b>: el primer cuadro con los dos pies en el aire. <b>Caída</b>: el primer cuadro con un pie tocando el piso.${drop ? ' <b>Contacto</b>: el primer cuadro en que toca el piso al bajar del cajón.' : ''}</p>
    ${fps < 100 ? `<p class="notice">Este video tiene ${f(fps, 0)} cuadros por segundo: la altura de cada salto puede dar hasta ${f(errCm, 1)} cm de más o de menos. En cámara lenta (120 o 240) ese margen baja a la mitad o a la cuarta parte.</p>` : `<p class="fine">${f(fps, 0)} cuadros por segundo: la altura puede dar hasta ${f(errCm, 1)} cm de más o de menos (en un salto de 30 cm).</p>`}
    <div class="gy-row">${drop ? mk('contact', 'Contacto') : ''}${mk('take', 'Despegue')}${mk('land', 'Caída')}</div>
    ${type === 'loaded' ? `<div class="gy-row"><label>Carga agregada (kg)<input type="text" id="gy-jload" inputmode="decimal" placeholder="0"></label></div>` : ''}
    <div class="gy-row"><button class="btn primary small" id="gy-jadd" type="button">Agregar el salto</button><button class="linkish" id="gy-jclear" type="button">Borrar marcas</button></div>
    <p class="fine" id="gy-hint">${esc(S.hint)}</p>`;
  if (S.jumps.length) {
    h += `<div class="table-wrap"><table class="data sheet"><tr><th>#</th><th>Tipo</th><th>Vuelo <small>(ms)</small></th><th>Altura <small>(cm)</small></th>${S.jumps.some(j => j.rsi != null) ? '<th>Contacto <small>(ms)</small></th><th>RSI <small>(m/s)</small></th>' : ''}${S.jumps.some(j => j.load) ? '<th>Carga <small>(kg)</small></th>' : ''}${potOk() ? '<th>Potencia <small>(W)</small></th><th>Fuerza <small>(N)</small></th><th>Vel. <small>(m/s)</small></th>' : ''}<th></th></tr>
      ${S.jumps.map((j, k) => `<tr><th scope="row">${k + 1}</th><td>${esc(JUMPS[j.type].label.split(' (')[0])}</td><td class="mono">${f(1000 * j.ft, 0)}</td><td class="mono">${f(100 * j.h, 1)}</td>${S.jumps.some(x => x.rsi != null) ? `<td class="mono">${j.tc != null ? f(1000 * j.tc, 0) : '–'}</td><td class="mono">${j.rsi != null ? f(j.rsi, 2) : '–'}</td>` : ''}${S.jumps.some(x => x.load) ? `<td class="mono">${f(j.load || 0, 1)}</td>` : ''}${potOk() ? (() => { const q = potencia(j); return `<td class="mono">${f(q.P, 0)}</td><td class="mono">${f(q.F, 0)}</td><td class="mono">${f(q.v, 2)}</td>`; })() : ''}<td>${j.take != null && j.land != null && S.file ? `<button class="linkish" type="button" data-gyjfix="${k}">Corregir</button> ` : ''}<button class="linkish" type="button" data-gyjdel="${k}">Quitar</button></td></tr>`).join('')}</table></div>
      <p class="fine">Altura por tiempo de vuelo: h = g·t²/8. Supone que despega y cae con el cuerpo en la misma posición (piernas extendidas); si cae con las rodillas flexionadas, la altura sale más alta de lo real. RSI = altura / tiempo de contacto. Margen de error de la altura: unos ${f(Math.max(...S.jumps.map(j => 196 * j.se)), 1)} cm de más o de menos.</p>`;
    h += `<div class="mgroup">Datos del deportista</div>
      <p class="fine">Con el peso y la distancia de empuje salen la potencia, la fuerza y la velocidad de cada salto (método de Samozino, como My Jump). Largo de pierna: de la cadera (trocánter) a la punta del pie, con la pierna estirada y en puntas. Altura de cadera: del piso a la cadera en la posición de arranque del salto (sentadilla a 90°). Quedan guardados para la próxima vez.</p>
      <div class="gy-row"><label>Peso (kg)<input type="text" id="gy-mass" inputmode="decimal" value="${esc(S.mass ?? '')}"></label><label>Largo de pierna (cm)<input type="text" id="gy-leg" inputmode="decimal" value="${esc(S.leg ?? '')}" placeholder="95"></label><label>Altura de cadera (cm)<input type="text" id="gy-squat" inputmode="decimal" value="${esc(S.squat ?? '')}" placeholder="55"></label></div>
      <p class="fine" id="gy-hpo-line">${Number.isFinite(num(S.hpo)) ? `Distancia de empuje: ${f(num(S.hpo), 2)} m.` : ''}</p>`;
    if (S.jumps.some(j => j.type === 'loaded')) h += `<div class="mgroup">Perfil fuerza-velocidad</div><div id="gy-fv">${fvHtml()}</div>`;
    h += saveRow('Guardar los saltos en la ficha');
  }
  return h;
}

// Fila de guardar: fecha (se puede cambiar), video en este celular y, si es una medición ya guardada, reemplazarla.
function saveRow(txt, extra = '') {
  return `<div class="gy-row gy-save-row"><label>Fecha<input type="date" id="gy-date" value="${esc(S.date || today())}"></label><button class="btn primary" id="gy-save" type="button">${S.evId ? 'Guardar los cambios' : txt}</button>${extra ? `<span class="fine">${extra}</span>` : ''}</div>
    ${S.file instanceof Blob ? '<p class="fine">Se guardan solo los datos, no el video. Para corregir después, abrí la medición en la ficha y cargá el mismo video del celular.</p>' : ''}
    ${S.evId ? '<p class="fine">Es una medición guardada: al guardar se reemplaza por esta versión.</p>' : ''}`;
}

// Reabre una medición guardada con su video, con las marcas y los datos como quedaron.
export async function openSaved(ev, file) {
  const d = ev.data || {};
  setMode(d.type === 'jump' ? 'jump' : 'bar');
  await refreshAthletes(ev.athleteId);
  await cargarDatos();
  if (d.type === 'bar') { if (d.exercise && EXERCISES[d.exercise]) $('gy-ex').value = d.exercise; $('gy-load').value = d.load != null ? String(d.load).replace('.', ',') : ''; }
  await load(file);
  S.evId = ev.id; S.date = ev.date || '';
  const txt = (v) => (Number.isFinite(+v) && +v > 0 ? String(v).replace('.', ',') : '');
  if (d.type === 'jump') {
    S.jumps = (d.jumps || []).map(j => ({ ...j, contact: j.contact ?? null, load: j.load || 0 }));
    if (S.jumps[0]?.type && JUMPS[S.jumps[0].type]) $('gy-jtype').value = S.jumps[0].type;
    S.mass = txt(d.mass) || S.mass; S.leg = txt(d.leg) || S.leg; S.squat = txt(d.squat) || S.squat;
    if (d.hpo) S.hpoGuardado = String(d.hpo);
    S.hpo = hpoDe(S.leg, S.squat);
    S.hint = S.jumps.length ? 'Medición guardada. Para mover una marca tocá «Corregir» en el salto; para sumar otro, marcalo y tocá «Agregar el salto».' : '';
  } else {
    if (d.scale?.p1 && d.scale?.p2 && d.scale.D) { S.scalePts = [d.scale.p1, d.scale.p2]; S.scale = barScale(d.scale.p1, d.scale.p2, d.scale.D); S.tool = 'center'; }
    S.hint = 'Medición guardada: tocá el centro del disco en el primer cuadro para volver a seguirlo y corregir la serie.';
  }
  panel(); draw();
}

// Potencia, fuerza y velocidad media del empuje de un salto (Samozino y col., 2008).
const G0 = 9.81;
const potOk = () => num(S.mass) > 0 && num(S.hpo) > 0.05;
function potencia(j) {
  const m = num(S.mass) + (j.load || 0), hpo = num(S.hpo);
  const F = m * G0 * (j.h / hpo + 1), v = Math.sqrt(G0 * j.h / 2);
  return { F, v, P: F * v };
}
function hpoDe(leg, squat) { const L = num(leg), Q = num(squat); return L > 0 && Q > 0 && L > Q ? String((L - Q) / 100) : (S.hpoGuardado ?? ''); }

function fvHtml() {
  const jl = S.jumps.filter(j => j.type === 'loaded');
  const fv = fvProfile(num(S.mass), num(S.hpo), jl.map(j => ({ h: j.h, load: j.load || 0 })));
  if (fv.error) return `<p class="fine">${esc(fv.error)}</p>`;
  return `<div class="kpis gy-kpis"><div class="kpi"><span class="fine-label">F0</span><b class="mono">${f(fv.F0, 1)} <small>N/kg</small></b></div><div class="kpi"><span class="fine-label">V0</span><b class="mono">${f(fv.V0, 2)} <small>m/s</small></b></div><div class="kpi"><span class="fine-label">Potencia máxima</span><b class="mono">${f(fv.Pmax, 1)} <small>W/kg</small></b></div></div>
    <p class="fine">Método de Samozino (2008), con ${fv.n} saltos (R² ${f(fv.r2, 3)}). F0 y V0 son prolongaciones de la recta fuera de lo medido: cuanto más separadas las cargas, más confiables.</p>`;
}

function bindPanel() {
  const on = (id, fn) => { const el = $(id); if (el) el.onclick = fn; };
  on('gy-scale', () => { if (S.tool !== 'scale' && S.scalePts.length) snap(); S.tool = S.tool === 'scale' ? null : 'scale'; S.scalePts = []; if (!S.live) video().pause(); panel(); draw(); });
  on('gy-center', () => { S.tool = S.tool === 'center' ? null : 'center'; if (!S.live) video().pause(); panel(); });
  on('gy-live-end', () => endLive());
  on('gy-fix', () => { S.tool = S.tool === 'fix' ? null : 'fix'; video().pause(); panel(); draw(); });
  on('gy-from', () => { const q = curPoint(); if (q) { snap(); S.tool = null; track([q.x, q.y]); } });
  on('gy-undo', undo);
  on('gy-jadd2', () => $('gy-jadd')?.click());
  on('gy-lupa', () => { S.lupa = !S.lupa; panel(); draw(); });
  on('gy-live-sound', () => { S.sound = !S.sound; unlock(); panel(); });
  on('gy-stop', () => S.abort?.abort());
  const pl = $('gy-plate');
  if (pl) pl.onchange = () => { if (S.scalePts.length === 2) { S.scale = barScale(S.scalePts[0], S.scalePts[1], num(pl.value) / 1000); compute(); panel(); } };
  document.querySelectorAll('[data-gyrep]').forEach(b => b.onclick = () => { if (S.live) return; const r = S.res.reps[+b.dataset.gyrep - 1]; video().pause(); seekFrame(frameAt(r.t0)); });
  document.querySelectorAll('[data-gymark]').forEach(b => b.onclick = () => { snap(); video().pause(); S.marks[b.dataset.gymark] = timeOf(curFrame()); S.hint = ''; panel(); draw(); });
  on('gy-jclear', () => { snap(); S.marks = {}; S.hint = ''; panel(); draw(); });
  on('gy-jadd', () => {
    const type = $('gy-jtype').value, m = S.marks;
    const j = type === 'drop' ? (m.contact != null && m.take != null && m.land != null ? dropJump(m.contact, m.take, m.land, S.frameDur) : null) : (m.take != null && m.land != null ? jumpHeight(m.take, m.land, S.frameDur) : null);
    if (!j) { S.hint = type === 'drop' ? 'Marcá el contacto, el despegue y la caída, en ese orden.' : 'Marcá el despegue y después la caída.'; panel(); return; }
    snap();
    S.jumps.push({ type, ...j, take: m.take, land: m.land, contact: m.contact ?? null, load: type === 'loaded' ? (num($('gy-jload')?.value) || 0) : 0 });
    S.marks = {}; S.auto = S.auto?.pies ? { pies: S.auto.pies } : null; S.hint = `Salto ${S.jumps.length}: ${f(100 * j.h, 1)} cm.`; panel(); draw();
  });
  document.querySelectorAll('[data-gyjdel]').forEach(b => b.onclick = () => { snap(); S.jumps.splice(+b.dataset.gyjdel, 1); panel(); });
  // corregir un salto ya agregado: vuelve a sus marcas para moverlas y agregarlo de nuevo
  document.querySelectorAll('[data-gyjfix]').forEach(b => b.onclick = async () => {
    snap();
    const [j] = S.jumps.splice(+b.dataset.gyjfix, 1);
    $('gy-jtype').value = j.type;
    S.marks = { take: j.take, land: j.land, ...(j.contact != null ? { contact: j.contact } : {}) };
    S.hint = 'Corregí las marcas (◀ ▶ y tocá Despegue o Caída en el cuadro justo) y tocá «Agregar el salto».';
    panel(); video().pause(); await seekFrame(frameAt(j.take));
    $('gy-player').scrollIntoView({ block: 'start', behavior: 'smooth' });
  });
  const dt = $('gy-date'); if (dt) dt.onchange = () => { S.date = dt.value; };
  const kv = $('gy-keepvid'); if (kv) kv.onchange = () => { S.keepVid = kv.checked; };
  const mass = $('gy-mass'), leg = $('gy-leg'), squat = $('gy-squat');
  const cambio = () => {
    S.mass = mass.value; S.leg = leg.value; S.squat = squat.value; S.hpo = hpoDe(S.leg, S.squat);
    guardarDatos();
    clearTimeout(cambio.t); cambio.t = setTimeout(() => { const el = document.activeElement?.id; panel(); if (el) { const x = $(el); x?.focus(); try { x.setSelectionRange(x.value.length, x.value.length); } catch {} } }, 700);
  };
  [mass, leg, squat].forEach(el => { if (el) el.oninput = cambio; });
  on('gy-jauto', autoMarcar);
  on('gy-jauto-stop', () => S.auto?.abort?.abort());
  document.querySelectorAll('[data-gygo]').forEach(b => b.onclick = () => { const t = S.marks[b.dataset.gygo]; if (t != null) { video().pause(); seekFrame(frameAt(t)); } });
  on('gy-save', save);
}

async function save() {
  const aid = $('gy-athlete').value;
  if (!aid) { H?.notify?.('Elegí el deportista arriba para guardar.'); $('gy-athlete').focus(); return; }
  const btn = $('gy-save'); btn.disabled = true;
  try {
    const meta = { fileName: S.file.name, fps: +(1 / S.frameDur).toFixed(2), width: S.W, height: S.Hh };
    const date = $('gy-date')?.value || today();
    let ev;
    if (S.mode === 'bar') {
      const ex = $('gy-ex').value, load = num($('gy-load').value);
      const data = barSaved(S.res, { exercise: ex, load: Number.isFinite(load) ? load : null, meta, scale: { p1: S.scalePts[0], p2: S.scalePts[1], D: S.scale.D } });
      ev = { athleteId: aid, kind: 'gym', date, title: `Gym · ${EXERCISES[ex].label}`, event: Number.isFinite(load) ? `${f(load, 1)} kg` : '', summary: { mv: data.best.mv }, data };
    } else {
      const fv = fvProfile(num(S.mass), num(S.hpo), S.jumps.filter(j => j.type === 'loaded').map(j => ({ h: j.h, load: j.load || 0 })));
      const r4 = (v) => (Number.isFinite(v) ? +v.toFixed(4) : null);
      const data = { type: 'jump', meta, jumps: S.jumps.map(j => ({ type: j.type, ft: r4(j.ft), h: r4(j.h), se: r4(j.se), tc: r4(j.tc), rsi: r4(j.rsi), rsiSe: r4(j.rsiSe), load: j.load || 0, take: r4(j.take), land: r4(j.land), contact: r4(j.contact), ...(potOk() ? (() => { const q = potencia(j); return { P: r4(q.P), F: r4(q.F), v: r4(q.v) }; })() : {}) })), mass: num(S.mass) || null, hpo: num(S.hpo) || null, leg: num(S.leg) || null, squat: num(S.squat) || null, fv: fv.error ? null : { F0: r4(fv.F0), V0: r4(fv.V0), Pmax: r4(fv.Pmax), r2: r4(fv.r2), n: fv.n } };
      const best = Math.max(...S.jumps.map(j => j.h));
      ev = { athleteId: aid, kind: 'gym', date, title: `Gym · Saltos`, event: [...new Set(S.jumps.map(j => JUMPS[j.type].label.split(' (')[0]))].join(', '), summary: { jump: best }, data };
    }
    // el video queda en este dispositivo (no viaja a la nube) para reabrir la medición y corregirla
    if (S.evId) ev.id = S.evId;
    ev.videoLocal = store.backend !== 'cloud' && S.keepVid && S.file instanceof Blob ? S.file : null;
    const rec = await store.saveEvaluation(ev);
    const nuevo = !S.evId;
    S.evId = rec.id; S.date = date;
    panel();
    H?.notify?.(nuevo ? `Guardado en la ficha con fecha ${date.split('-').reverse().join('/')}. Para corregirlo después: Alumnos → la ficha → tocá la medición.` : 'Cambios guardados.');
  } catch (err) { H?.notify?.('No se pudo guardar: ' + err.message); btn.disabled = false; }
}

// ---------- ficha del deportista ----------
const day = (d) => (d || '').split('-').reverse().join('/');

// Resumen de una evaluación de gimnasio (detalle en la ficha).
export function gymSummary(d) {
  if (d.type === 'bar') {
    return `<div class="kpis"><div class="kpi"><span class="fine-label">Ejercicio</span><b>${esc(EXERCISES[d.exercise]?.label || '')}</b><small>${d.load != null ? `${f(d.load, 1)} kg` : 'sin carga anotada'}</small></div><div class="kpi"><span class="fine-label">Mejor velocidad media</span><b class="mono">${f(d.best?.mv)} m/s</b><small>±${f(1.96 * (d.best?.se ?? NaN))}</small></div><div class="kpi"><span class="fine-label">Pérdida de velocidad</span><b class="mono">${d.vl ? `${f(d.vl.v, 1)} %` : '–'}</b></div>${deficitKpi(seriesDeficit(d.reps || []))}</div>
      ${zoneHtml(d.reps || [], d.exercise)}
      <div class="table-wrap"><table class="data sheet"><tr><th>Rep</th><th>Vel. media (m/s)</th><th>Pico (m/s)</th><th>Recorrido (cm)</th><th>Subida (s)</th></tr>${d.reps.map(x => `<tr><th scope="row">${x.n}</th><td class="mono">${f(x.mv)}<span class="ci">±${f(1.96 * x.se)}</span></td><td class="mono">${f(x.pv)}</td><td class="mono">${f(100 * x.rom, 0)}</td><td class="mono">${f(x.dur)}</td></tr>`).join('')}</table></div>
      <p class="fine">Video ${esc(d.meta?.fileName || '')} a ${f(d.meta?.fps, 0)} cuadros/s. Escala con disco de ${f(1000 * (d.scale?.D ?? NaN), 0)} mm.</p>`;
  }
  const js = d.jumps || [];
  return `<div class="table-wrap"><table class="data sheet"><tr><th>#</th><th>Tipo</th><th>Altura (cm)</th><th>Vuelo (ms)</th><th>RSI</th><th>Carga (kg)</th></tr>${js.map((j, k) => `<tr><th scope="row">${k + 1}</th><td>${esc(JUMPS[j.type]?.label.split(' (')[0] || j.type)}</td><td class="mono">${f(100 * j.h, 1)}</td><td class="mono">${f(1000 * j.ft, 0)}</td><td class="mono">${j.rsi != null ? f(j.rsi, 2) : '–'}</td><td class="mono">${f(j.load || 0, 1)}</td></tr>`).join('')}</table></div>
    ${d.fv ? `<p>Perfil fuerza-velocidad: F0 ${f(d.fv.F0, 1)} N/kg · V0 ${f(d.fv.V0, 2)} m/s · potencia máxima ${f(d.fv.Pmax, 1)} W/kg (${d.fv.n} saltos, masa ${f(d.mass, 1)} kg, empuje ${f(d.hpo, 2)} m).</p>` : ''}
    <p class="fine">Video ${esc(d.meta?.fileName || '')} a ${f(d.meta?.fps, 0)} cuadros/s. Altura por tiempo de vuelo.</p>`;
}

// Sección Gym de la ficha: perfil carga-velocidad por ejercicio y saltos por fecha.
// RM estimado: la carga de la recta carga-velocidad a la velocidad del 1RM del ejercicio. Usa las series del
// último día con dos cargas distintas o más (la fuerza cambia de un día a otro); si no hay, todas las fechas.
function rmHtml(ex, rows, lvAll) {
  const v1 = EXERCISES[ex]?.v1rm;
  if (!v1) return '';
  let lv = lvAll, cuando = 'con todas las fechas';
  for (const dte of [...new Set(rows.map(e => e.date))].reverse()) {
    const sets = rows.filter(e => e.date === dte);
    if (new Set(sets.map(e => e.data.load)).size < 2) continue;
    const l = loadVelocity(sets.map(e => ({ load: e.data.load, v: e.data.best.mv })));
    if (!l.error) { lv = l; cuando = `con las series del ${day(dte)}`; }
    break;
  }
  const r = !lv.error && lv.loadAt(v1);
  if (!r || !(r.load > 0)) return '';
  return `<div class="kpis gy-kpis"><div class="kpi gy-rm"><span class="fine-label">RM estimado</span><b class="mono">${f(r.load, 1)} <small>kg</small></b><small>${Number.isFinite(r.se) ? `margen de error de ${f(1.96 * r.se, 1)} kg de más o de menos · ` : ''}${cuando}</small></div></div>
    <p class="fine">Es la carga con la que la barra subiría a ${f(v1)} m/s, la velocidad típica del 1RM en ${esc(EXERCISES[ex].label.toLowerCase())}. Sale sin hacer el máximo: con 2 o más series a cargas distintas. Más cargas, y más pesadas, dan un RM más preciso.</p>`;
}

export function gymSheet(evs) {
  const gym = evs.filter(e => e.kind === 'gym' && e.data);
  if (!gym.length) return '';
  let h = '';
  const bars = gym.filter(e => e.data.type === 'bar' && e.data.load != null && Number.isFinite(e.data.best?.mv));
  for (const ex of Object.keys(EXERCISES)) {
    const rows = bars.filter(e => e.data.exercise === ex).sort((a, b) => String(a.date).localeCompare(String(b.date)) || String(a.createdAt || '').localeCompare(String(b.createdAt || '')));
    if (!rows.length) continue;
    const lv = loadVelocity(rows.map(e => ({ load: e.data.load, v: e.data.best.mv })));
    // carga efectiva por día: la serie posterior a la mayor pérdida
    const eff = new Set();
    for (const dte of new Set(rows.map(e => e.date))) {
      const sets = rows.filter(e => e.date === dte);
      const k = effectiveSet(sets.map(e => seriesDeficit(e.data.reps || [])?.v ?? NaN));
      if (k >= 0) eff.add(sets[k]);
    }
    h += `<div class="mgroup">${esc(EXERCISES[ex].label)}: carga y velocidad</div>
      <div class="table-wrap"><table class="data sheet"><tr><th>Fecha</th><th>Carga (kg)</th><th>Mejor vel. media (m/s)</th><th>Pérdida de vel.</th><th>Déficit</th><th>Calidad</th></tr>${rows.map(e => { const d = seriesDeficit(e.data.reps || []); return `<tr${eff.has(e) ? ' class="hl"' : ''}><th scope="row">${esc(day(e.date))}${eff.has(e) ? ' <span class="pill">carga efectiva</span>' : ''}</th><td class="mono">${f(e.data.load, 1)}</td><td class="mono">${f(e.data.best.mv)}<span class="ci">±${f(1.96 * e.data.best.se)}</span></td><td class="mono">${e.data.vl ? f(e.data.vl.v, 1) + ' %' : '–'}</td><td class="mono">${d ? f(d.v, 2) + ' %' : '–'}</td><td>${esc(zoneName(setMean(e.data.reps || []).v))}</td></tr>`; }).join('')}</table></div>
      ${eff.size ? '<p class="fine">Carga efectiva: la serie posterior a la de mayor déficit del mismo día (series en el orden en que se guardaron).</p>' : ''}
      ${lv.error ? `<p class="fine">${esc(lv.error)}</p>` : `<p class="fine">Recta carga-velocidad con ${lv.n} series: velocidad = ${f(lv.a)} ${lv.b < 0 ? '−' : '+'} ${f(Math.abs(lv.b), 4)} × carga (R² ${f(lv.r2, 3)}). Mezcla todas las fechas: si el deportista cambió de fuerza, conviene usar series del mismo día.</p>
      ${rmHtml(ex, rows, lv)}
      <div class="gy-row"><label>Carga estimada a una velocidad de (m/s)<input type="text" inputmode="decimal" data-gylv="${ex}" placeholder="por ejemplo, su velocidad en el 1RM"></label><span class="mono" data-gylvout="${ex}"></span></div>`}`;
  }
  const jumps = gym.filter(e => e.data.type === 'jump').sort((a, b) => String(a.date).localeCompare(String(b.date)));
  if (jumps.length) {
    h += `<div class="mgroup">Saltos</div><div class="table-wrap"><table class="data sheet"><tr><th>Fecha</th><th>Tipo</th><th>Mejor altura (cm)</th><th>Saltos</th><th>F0 / V0 / Pmax</th></tr>${jumps.map(e => { const js = e.data.jumps || []; const b = js.reduce((a, j) => (j.h > (a?.h ?? -1) ? j : a), null); return `<tr><th scope="row">${esc(day(e.date))}</th><td>${esc(e.event || '')}</td><td class="mono">${b ? f(100 * b.h, 1) : '–'}</td><td class="mono">${js.length}</td><td class="mono">${e.data.fv ? `${f(e.data.fv.F0, 1)} / ${f(e.data.fv.V0, 2)} / ${f(e.data.fv.Pmax, 1)}` : '–'}</td></tr>`; }).join('')}</table></div>`;
  }
  return h;
}
export function bindGymSheet(root, evs) {
  root.querySelectorAll('[data-gylv]').forEach(inp => inp.oninput = () => {
    const ex = inp.dataset.gylv, out = root.querySelector(`[data-gylvout="${ex}"]`);
    const rows = evs.filter(e => e.kind === 'gym' && e.data?.type === 'bar' && e.data.exercise === ex && e.data.load != null && Number.isFinite(e.data.best?.mv));
    const lv = loadVelocity(rows.map(e => ({ load: e.data.load, v: e.data.best.mv }))), v = num(inp.value);
    const r = Number.isFinite(v) && !lv.error ? lv.loadAt(v) : null;
    out.textContent = r ? `${f(r.load, 1)} kg${Number.isFinite(r.se) ? ` ±${f(1.96 * r.se, 1)}` : ' (con 2 series no hay margen)'}${r.extrapolated ? ' · fuera de las cargas medidas' : ''}` : '';
  });
}
