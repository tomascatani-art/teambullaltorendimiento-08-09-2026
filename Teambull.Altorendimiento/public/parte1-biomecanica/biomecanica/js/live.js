// En la pileta: cámara del dispositivo con retraso (el nadador se ve al salir del agua) y grabación de
// intentos para analizarlos al momento. Todo queda en este dispositivo.
// El retraso guarda cada cuadro como JPEG reducido en memoria; la grabación codifica los cuadros de la
// cámara con su hora real de captura (WebCodecs + MP4), así el análisis lee los tiempos exactos de cada cuadro.
import { Muxer, ArrayBufferTarget } from '../vendor/mp4-muxer.js';

const $ = (id) => document.getElementById(id);
const BUF_W = 960;          // ancho de los cuadros guardados para el retraso
const MAX_DELAY = 30;       // segundos
const MAX_TAKE = 120;       // segundos por intento
const fmt = (v, d = 1) => v.toLocaleString('es-AR', { minimumFractionDigits: d, maximumFractionDigits: d });

const S = { stream: null, frames: [], pending: 0, delay: 0, mirror: false, rec: null, takes: [], n: 0, fpsT: [], raf: 0, shownFrame: null, frozen: false };
let api = null;

// Cuadro a mostrar para un retraso: el último capturado hasta (ahora − retraso). Exportado para las pruebas.
export function pickDelayed(frames, now, delayS) {
  const target = now - delayS * 1000;
  let lo = 0, hi = frames.length - 1, best = -1;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (frames[m].t <= target) { best = m; lo = m + 1; } else hi = m - 1; }
  return best;
}
// Cuadros por segundo medidos con las últimas horas de captura.
export function measuredFps(ts) {
  if (ts.length < 5) return NaN;
  const d = [];
  for (let i = 1; i < ts.length; i++) d.push(ts[i] - ts[i - 1]);
  d.sort((a, b) => a - b);
  return 1000 / d[d.length >> 1];
}

export function initLive(a) {
  api = a;
  $('live-on').onclick = async () => { if (S.stream) { if (S.rec) await stopTake(); stop(); } else start(); };
  $('live-delay').onchange = () => { S.delay = +$('live-delay').value; S.shownFrame = null; ui(); };
  $('live-mirror').onchange = () => { S.mirror = $('live-mirror').checked; S.shownFrame = null; };
  $('live-facing').onchange = () => { if (S.stream) { stop(); start(); } };
  $('live-quality').onchange = () => { if (S.stream) { stop(); start(); } };
  $('live-freeze').onclick = () => { S.frozen = !S.frozen; ui(); };
  $('live-rec').onclick = () => (S.rec ? stopTake() : startTake());
  // para mostrarlo en una tele o tablet al costado de la pileta
  $('live-full').onclick = () => { const el = $('live-stage'); (el.requestFullscreen || el.webkitRequestFullscreen)?.call(el)?.catch?.(() => {}); };
  document.addEventListener('visibilitychange', () => { if (document.hidden && S.rec) stopTake(); });
  ui(); renderTakes();
}
// al salir de la pantalla se apaga la cámara (y se cierra el intento si se estaba grabando)
export async function leaveLive() { if (S.rec) await stopTake(); if (S.stream) stop(); }

async function start() {
  const err = $('live-err'); err.hidden = true;
  if (!navigator.mediaDevices?.getUserMedia) { err.textContent = 'Este navegador no deja usar la cámara. Probá con Chrome o Safari actualizado.'; err.hidden = false; return; }
  const [w, h, fps] = $('live-quality').value.split('x').map(Number);
  try {
    S.stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: $('live-facing').value, width: { ideal: w }, height: { ideal: h }, frameRate: { ideal: fps } } });
  } catch (e) {
    err.textContent = e.name === 'NotAllowedError' ? 'No se dio permiso para usar la cámara. Habilitalo en el navegador y volvé a tocar Encender.' : 'No se pudo abrir la cámara: ' + (e.message || e.name);
    err.hidden = false; S.stream = null; ui(); return;
  }
  const v = $('live-cam');
  v.srcObject = S.stream; v.muted = true;
  await v.play().catch(() => {});
  S.frames = []; S.fpsT = []; S.shownFrame = null;
  const onFrame = (now, meta) => { if (!S.stream) return; capture(v, meta); v.requestVideoFrameCallback(onFrame); };
  if ('requestVideoFrameCallback' in HTMLVideoElement.prototype) v.requestVideoFrameCallback(onFrame);
  else { const tick = () => { if (!S.stream) return; capture(v, null); setTimeout(tick, 1000 / 30); }; tick(); }
  const loop = () => { if (!S.stream) return; paint(); S.raf = requestAnimationFrame(loop); };
  S.raf = requestAnimationFrame(loop);
  ui();
}
function stop() {
  cancelAnimationFrame(S.raf);
  S.stream?.getTracks().forEach(t => t.stop());
  S.stream = null; S.frames = []; S.frozen = false;
  $('live-cam').srcObject = null;
  ui();
}

// Cada cuadro de la cámara: al búfer del retraso (JPEG reducido) y, si se graba, al codificador.
const bufCanvas = document.createElement('canvas');
function capture(v, meta) {
  if (!v.videoWidth) return;
  const t = performance.now();
  S.fpsT.push(t); if (S.fpsT.length > 40) S.fpsT.shift();
  if (S.rec) S.rec.add(v, meta);
  if (S.pending > 4) return; // el celular no da abasto: se saltea este cuadro del retraso
  const k = Math.min(1, BUF_W / v.videoWidth);
  bufCanvas.width = Math.round(v.videoWidth * k); bufCanvas.height = Math.round(v.videoHeight * k);
  bufCanvas.getContext('2d').drawImage(v, 0, 0, bufCanvas.width, bufCanvas.height);
  S.pending++;
  bufCanvas.toBlob((b) => {
    S.pending--;
    if (!b || !S.stream) return;
    S.frames.push({ t, blob: b });
    // se guarda solo lo que el retraso máximo necesita
    while (S.frames.length && S.frames[0].t < t - (MAX_DELAY + 1) * 1000) S.frames.shift();
  }, 'image/jpeg', 0.72);
}

let painting = false;
async function paint() {
  const out = $('live-view'), v = $('live-cam');
  if (S.frozen || painting) return;
  const ctx = out.getContext('2d');
  if (S.delay === 0) {
    if (!v.videoWidth) return;
    if (out.width !== v.videoWidth) { out.width = v.videoWidth; out.height = v.videoHeight; }
    draw(ctx, v, out.width, out.height);
  } else {
    const i = pickDelayed(S.frames, performance.now(), S.delay);
    if (i < 0 || S.frames[i] === S.shownFrame) { hud(i); return; }
    painting = true;
    try {
      const bmp = await createImageBitmap(S.frames[i].blob);
      if (out.width !== bmp.width) { out.width = bmp.width; out.height = bmp.height; }
      draw(ctx, bmp, out.width, out.height); bmp.close?.();
      S.shownFrame = S.frames[i];
    } catch {} finally { painting = false; }
  }
  hud();
}
function draw(ctx, src, W, H) {
  ctx.save();
  if (S.mirror) { ctx.translate(W, 0); ctx.scale(-1, 1); }
  ctx.drawImage(src, 0, 0, W, H);
  ctx.restore();
}
function hud(i) {
  const fps = measuredFps(S.fpsT), el = $('live-hud');
  const have = S.frames.length ? (performance.now() - S.frames[0].t) / 1000 : 0;
  let s = S.delay === 0 ? 'En vivo' : have + 0.2 < S.delay ? `Llenando el retraso… faltan ${fmt(S.delay - have)} s` : `Retraso ${S.delay} s`;
  if (Number.isFinite(fps)) s += ` · ${Math.round(fps)} cuadros/s`;
  if (S.frozen) s += ' · en pausa';
  if (S.rec) s += ` · ● grabando ${fmt((performance.now() - S.rec.t0) / 1000)} s`;
  el.textContent = s;
  el.classList.toggle('rec', !!S.rec);
  if (S.rec && performance.now() - S.rec.t0 > MAX_TAKE * 1000) stopTake();
}

function ui() {
  const on = !!S.stream;
  $('live-on').textContent = on ? 'Apagar cámara' : 'Encender cámara';
  $('live-on').classList.toggle('primary', !on);
  $('live-rec').disabled = !on;
  $('live-rec').innerHTML = S.rec ? '■ Terminar intento' : '● Grabar intento';
  $('live-rec').classList.toggle('danger-fill', !!S.rec);
  $('live-freeze').disabled = !on;
  $('live-full').disabled = !on || !($('live-stage').requestFullscreen || $('live-stage').webkitRequestFullscreen);
  $('live-freeze').textContent = S.frozen ? 'Seguir' : 'Pausar imagen';
  $('live-stage').hidden = !on;
  $('live-empty').hidden = on;
  if (!on) $('live-hud').textContent = '';
}

// ---------- grabación ----------
const CODECS = [{ codec: 'avc1.640028', mux: 'avc' }, { codec: 'avc1.4d0028', mux: 'avc' }, { codec: 'avc1.42001f', mux: 'avc' }, { codec: 'vp09.00.10.08', mux: 'vp9' }];
async function encoderFor(w, h, fps) {
  if (typeof VideoEncoder !== 'function') return null;
  for (const c of CODECS) {
    const cfg = { codec: c.codec, width: w, height: h, bitrate: Math.round(w * h * fps * 0.15), framerate: fps, latencyMode: 'realtime' };
    if (c.mux === 'avc') cfg.avc = { format: 'avc' };
    try { if ((await VideoEncoder.isConfigSupported(cfg)).supported) return { ...c, cfg }; } catch {}
  }
  return null;
}

async function startTake() {
  const v = $('live-cam');
  const w = v.videoWidth - (v.videoWidth % 2), h = v.videoHeight - (v.videoHeight % 2);
  const fps = Math.round(measuredFps(S.fpsT)) || 30;
  const pick = await encoderFor(w, h, fps);
  S.n++;
  const name = `Intento ${S.n}`, started = new Date();
  if (pick) {
    const target = new ArrayBufferTarget();
    const muxer = new Muxer({ target, video: { codec: pick.mux, width: w, height: h, frameRate: fps }, fastStart: 'in-memory', firstTimestampBehavior: 'offset' });
    let failure = null, t0 = null, last = null, frames = 0, lastKey = -1e9, dropped = 0;
    const enc = new VideoEncoder({ output: (c, m) => muxer.addVideoChunk(c, m), error: (e) => { failure = e; } });
    enc.configure(pick.cfg);
    S.rec = {
      t0: performance.now(), name, started, kind: 'mp4',
      add(src, meta) {
        if (failure || enc.state !== 'configured') return;
        // hora de captura del cuadro (la de la cámara si el navegador la da)
        const ts = meta?.captureTime ?? meta?.expectedDisplayTime ?? performance.now();
        if (t0 == null) t0 = ts;
        const us = Math.round((ts - t0) * 1000);
        if (last != null && us <= last) return;
        if (enc.encodeQueueSize > 8) { dropped++; return; } // no se encolan cuadros que no se llegan a codificar
        let vf;
        try { vf = new VideoFrame(src, { timestamp: us }); } catch { return; }
        const key = us - lastKey >= 2e6;
        if (key) lastKey = us;
        enc.encode(vf, { keyFrame: key }); vf.close();
        last = us; frames++;
      },
      async finish() {
        await enc.flush().catch(() => {});
        if (enc.state !== 'closed') enc.close();
        if (failure) throw failure;
        muxer.finalize();
        return { blob: new Blob([target.buffer], { type: 'video/mp4' }), ext: 'mp4', frames, dropped, seconds: (last || 0) / 1e6, exact: true, codec: pick.mux };
      },
    };
  } else if (typeof MediaRecorder === 'function') {
    // respaldo: el navegador graba a su manera; el análisis estima los tiempos de cuadro
    const type = ['video/mp4', 'video/webm;codecs=vp9', 'video/webm'].find(t => MediaRecorder.isTypeSupported?.(t)) || '';
    const mr = new MediaRecorder(S.stream, type ? { mimeType: type, videoBitsPerSecond: 8e6 } : undefined);
    const parts = [];
    mr.ondataavailable = (e) => { if (e.data.size) parts.push(e.data); };
    mr.start(1000);
    const t0 = performance.now();
    S.rec = {
      t0, name, started, kind: 'mr', add() {},
      finish: () => new Promise((res) => { mr.onstop = () => { const t = mr.mimeType || type || 'video/webm'; res({ blob: new Blob(parts, { type: t }), ext: t.includes('mp4') ? 'mp4' : 'webm', seconds: (performance.now() - t0) / 1000, exact: false }); }; mr.stop(); }),
    };
  } else {
    $('live-err').textContent = 'Este navegador no puede grabar video. Grabá con la cámara del celular y subí el archivo en Nuevo análisis.';
    $('live-err').hidden = false; S.n--; return;
  }
  ui();
}
async function stopTake() {
  const r = S.rec;
  if (!r) return;
  S.rec = null; ui();
  try {
    const out = await r.finish();
    const hh = r.started.toTimeString().slice(0, 8).replace(/:/g, '-');
    const file = new File([out.blob], `${r.name.replace(' ', '-').toLowerCase()}_${r.started.toISOString().slice(0, 10)}_${hh}.${out.ext}`, { type: out.blob.type });
    S.takes.unshift({ name: r.name, at: r.started, file, ...out });
  } catch (e) {
    $('live-err').textContent = 'No se pudo cerrar el intento: ' + (e.message || e); $('live-err').hidden = false;
  }
  renderTakes();
}

function renderTakes() {
  const box = $('live-takes');
  if (!S.takes.length) { box.innerHTML = '<p class="fine">Todavía no grabaste intentos. Cada intento queda acá para verlo, descargarlo o analizarlo. Se borran al cerrar la app: descargá los que quieras guardar.</p>'; return; }
  box.innerHTML = S.takes.map((t, i) => `<div class="take" data-i="${i}">
    <div class="take-head"><b>${t.name}</b><span class="mono fine">${t.at.toTimeString().slice(0, 5)} · ${fmt(t.seconds)} s · ${fmt(t.blob.size / 1048576)} MB${t.frames ? ` · ${t.frames} cuadros` : ''}</span></div>
    ${t.exact ? '' : '<p class="fine">Grabado por el navegador sin tiempos exactos de cada cuadro: el análisis los estima.</p>'}
    ${t.dropped ? `<p class="fine">Se perdieron ${t.dropped} cuadros porque el dispositivo no llegó a codificarlos; los tiempos de los que quedaron son reales.</p>` : ''}
    <div class="take-actions">
      <button class="btn ghost small" data-act="see" type="button">Ver</button>
      <button class="btn ghost small" data-act="dl" type="button">Descargar</button>
      <button class="btn small" data-act="tech" type="button">Analizar técnica</button>
      <button class="btn ghost small" data-act="race" type="button">Marcar competencia</button>
    </div>
    <div class="take-see"></div></div>`).join('');
  box.querySelectorAll('.take').forEach(el => {
    const t = S.takes[+el.dataset.i];
    el.querySelectorAll('[data-act]').forEach(b => b.onclick = () => {
      const act = b.dataset.act;
      if (act === 'see') {
        const s = el.querySelector('.take-see');
        if (s.firstChild) { URL.revokeObjectURL(s.firstChild.src); s.innerHTML = ''; return; }
        const vv = document.createElement('video');
        vv.controls = true; vv.playsInline = true; vv.src = URL.createObjectURL(t.file); vv.className = 'take-video';
        s.appendChild(vv);
      } else if (act === 'dl') api.download(t.file, t.file.name);
      else { leaveLive(); api.analyze(t.file, act); }
    });
  });
}
