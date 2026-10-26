// Exportación de clips con los dibujos encima: cada cuadro se busca en el video, se dibuja en un canvas
// y se codifica con WebCodecs. Sale un MP4 (H.264 si el navegador lo permite) con los tiempos reales
// de cada cuadro multiplicados por el factor de cámara lenta.
import { Muxer, ArrayBufferTarget } from '../vendor/mp4-muxer.js';

const CANDIDATES = [
  { codec: 'avc1.640028', mux: 'avc' }, // H.264 High: lo que mejor reproducen WhatsApp y los celulares
  { codec: 'avc1.4d0028', mux: 'avc' },
  { codec: 'avc1.42001f', mux: 'avc' },
  { codec: 'vp09.00.10.08', mux: 'vp9' },
  { codec: 'av01.0.04M.08', mux: 'av1' },
];

export const canExportClip = () => typeof window.VideoEncoder === 'function' && typeof window.VideoFrame === 'function';

async function pickCodec(width, height, fps) {
  for (const c of CANDIDATES) {
    const cfg = { codec: c.codec, width, height, bitrate: Math.round(width * height * fps * 0.12), framerate: fps };
    if (c.mux === 'avc') cfg.avc = { format: 'avc' };
    try { if ((await VideoEncoder.isConfigSupported(cfg)).supported) return { ...c, cfg }; } catch {}
  }
  return null;
}

// Busca el tiempo t en el video y espera a que el cuadro esté listo para dibujar.
export function seekVideo(v, t) {
  return new Promise((resolve) => {
    t = Math.max(0, Math.min((v.duration || t) - 1e-3, t));
    if (Math.abs(v.currentTime - t) < 1e-4 && v.readyState >= 2) return resolve();
    const done = () => { v.removeEventListener('seeked', done); clearTimeout(to); resolve(); };
    const to = setTimeout(done, 3000);
    v.addEventListener('seeked', done);
    v.currentTime = t;
  });
}

// frames: [{ dur (segundos de salida), prepare: async () => {}, draw: (ctx) => {}, hold (segundos extra quieto) }]
export async function encodeClip({ width, height, frames, onProgress, signal }) {
  if (!canExportClip()) throw new Error('Este navegador no puede generar video. Probá con Chrome o con Safari actualizado.');
  width -= width % 2; height -= height % 2;
  const fps = 30;
  const pick = await pickCodec(width, height, fps);
  if (!pick) throw new Error('Este navegador no tiene un codificador de video compatible.');
  const target = new ArrayBufferTarget();
  const muxer = new Muxer({ target, video: { codec: pick.mux, width, height, frameRate: fps }, fastStart: 'in-memory', firstTimestampBehavior: 'offset' });
  let failure = null;
  const enc = new VideoEncoder({ output: (chunk, meta) => muxer.addVideoChunk(chunk, meta), error: (e) => { failure = e; } });
  enc.configure(pick.cfg);
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext('2d');
  let ts = 0, n = 0, lastKey = -1e9;
  const push = async (dur) => {
    if (failure) throw failure;
    while (enc.encodeQueueSize > 6) await new Promise(r => setTimeout(r, 5));
    const us = Math.round(ts * 1e6), d = Math.max(1, Math.round(dur * 1e6));
    const vf = new VideoFrame(canvas, { timestamp: us, duration: d });
    const key = ts - lastKey >= 2;
    if (key) lastKey = ts;
    enc.encode(vf, { keyFrame: key });
    vf.close();
    ts += dur; n++;
  };
  try {
    for (let k = 0; k < frames.length; k++) {
      if (signal?.aborted) throw new DOMException('Cancelado', 'AbortError');
      const fr = frames[k];
      await fr.prepare();
      ctx.save(); ctx.fillStyle = '#000'; ctx.fillRect(0, 0, width, height); fr.draw(ctx); ctx.restore();
      await push(fr.dur);
      if (fr.hold) for (let h = Math.round(fr.hold * fps); h > 0; h--) await push(1 / fps);
      onProgress?.((k + 1) / frames.length);
    }
    await enc.flush();
    if (failure) throw failure;
    muxer.finalize();
  } finally {
    if (enc.state !== 'closed') enc.close();
  }
  return { blob: new Blob([target.buffer], { type: 'video/mp4' }), codec: pick.mux, frames: n, seconds: ts };
}

// Panel común de clip: inicio, fin, velocidad y pausa en los dibujos.
export function bindClipPanel(prefix, api) {
  const $ = (id) => document.getElementById(`${prefix}-${id}`);
  const st = { a: null, b: null, busy: null };
  const fmt = (t) => Number.isFinite(t) ? `${t.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} s` : '–';
  const ui = () => {
    $('a').textContent = fmt(st.a); $('b').textContent = fmt(st.b);
    const ok = Number.isFinite(st.a) && Number.isFinite(st.b) && st.b > st.a;
    const span = ok ? st.b - st.a : NaN, slow = +$('speed').value;
    $('go').disabled = !ok || !!st.busy;
    $('info').textContent = !ok
      ? (Number.isFinite(st.a) && Number.isFinite(st.b) ? 'El fin tiene que ser posterior al inicio.' : 'Pausá en el cuadro donde empieza y tocá Inicio; después en el cuadro donde termina y tocá Fin.')
      : span > api.maxSpan ? `El tramo dura ${fmt(span)}; el máximo es ${api.maxSpan} s de video.` : `Tramo de ${fmt(span)} de video; el clip dura unos ${fmt(span * slow + api.extraHold(st.a, st.b))}.`;
    if (ok && span > api.maxSpan) $('go').disabled = true;
  };
  $('seta').onclick = () => { st.a = api.now(); if (Number.isFinite(st.b) && st.b <= st.a) st.b = null; ui(); };
  $('setb').onclick = () => { st.b = api.now(); ui(); };
  $('speed').onchange = ui;
  if ($('hold')) $('hold').onchange = ui;
  $('go').onclick = async () => {
    if (st.busy) { st.busy.abort(); return; }
    st.busy = new AbortController();
    const go = $('go'), label = go.innerHTML;
    let msg = '';
    go.disabled = false; go.textContent = 'Cancelar';
    $('share').hidden = true; $('send').innerHTML = '';
    try {
      const out = await api.run({ a: st.a, b: st.b, slow: +$('speed').value, hold: $('hold')?.checked ? 2 : 0 },
        (p) => { $('info').textContent = `Generando el clip… ${Math.round(p * 100)} %`; }, st.busy.signal);
      const mb = (out.blob.size / 1048576).toLocaleString('es-AR', { maximumFractionDigits: 1 });
      msg = `Clip listo: ${out.seconds.toLocaleString('es-AR', { maximumFractionDigits: 1 })} s, ${mb} MB${out.codec === 'avc' ? '' : ' (formato VP9/AV1: si WhatsApp no lo abre, generalo desde Chrome o Safari en el celular)'}.`;
      const file = new File([out.blob], out.name, { type: 'video/mp4' });
      if (navigator.canShare?.({ files: [file] })) {
        $('share').hidden = false;
        $('share').onclick = () => navigator.share({ files: [file], title: out.name }).catch(() => {});
      }
      $('send').innerHTML = '';
      if (api.reviewButton) $('send').append(api.reviewButton(file, 'clip'));
      await api.download(out.blob, out.name);
    } catch (e) {
      msg = e.name === 'AbortError' ? 'Clip cancelado.' : 'No se pudo generar el clip: ' + (e.message || e);
    } finally {
      st.busy = null; go.innerHTML = label; ui();
      if (msg) $('info').textContent = msg;
    }
  };
  ui();
  return { reset: () => { st.a = st.b = null; $('share').hidden = true; ui(); }, refresh: ui };
}

// HTML del panel (mismo marcado en competencia y técnica).
export function clipPanelHtml(prefix, holdLabel) {
  return `
  <div class="eyebrow">Clip para compartir</div>
  <div class="clip-range">
    <button class="btn ghost small" id="${prefix}-seta" type="button">Inicio <b class="mono" id="${prefix}-a">–</b></button>
    <button class="btn ghost small" id="${prefix}-setb" type="button">Fin <b class="mono" id="${prefix}-b">–</b></button>
    <select id="${prefix}-speed" aria-label="Velocidad del clip">
      <option value="1">Velocidad normal</option>
      <option value="2" selected>Cámara lenta ×½</option>
      <option value="4">Cámara lenta ×¼</option>
      <option value="8">Cámara lenta ×⅛</option>
    </select>
  </div>
  ${holdLabel ? `<label class="check"><input type="checkbox" id="${prefix}-hold" checked> ${holdLabel}</label>` : ''}
  <div class="clip-actions">
    <button class="btn primary small" id="${prefix}-go" type="button" disabled><svg width="16" height="16"><use href="#i-video"/></svg>Exportar clip</button>
    <button class="btn ghost small" id="${prefix}-share" type="button" hidden>Compartir</button>
    <span id="${prefix}-send"></span>
  </div>
  <p class="fine" id="${prefix}-info" role="status"></p>`;
}

// Rótulos comunes del clip: tiempo arriba a la izquierda y marca de la app abajo.
export function clipLabels(ctx, W, H, top, sub) {
  const u = Math.max(1, H / 540);
  ctx.save();
  ctx.font = `600 ${18 * u}px "Geist Mono", ui-monospace, monospace`;
  const w = ctx.measureText(top).width;
  ctx.fillStyle = 'rgba(4,10,16,0.78)'; ctx.fillRect(12 * u, 12 * u, w + 20 * u, 32 * u);
  ctx.fillStyle = '#fff'; ctx.fillText(top, 22 * u, 34 * u);
  if (sub) {
    ctx.font = `500 ${13 * u}px "Instrument Sans", system-ui, sans-serif`;
    const w2 = ctx.measureText(sub).width;
    ctx.fillStyle = 'rgba(4,10,16,0.66)'; ctx.fillRect(12 * u, 48 * u, w2 + 16 * u, 22 * u);
    ctx.fillStyle = 'rgba(255,255,255,0.92)'; ctx.fillText(sub, 20 * u, 64 * u);
  }
  ctx.font = `700 ${13 * u}px "Instrument Sans", system-ui, sans-serif`;
  ctx.fillStyle = 'rgba(255,255,255,0.7)'; ctx.fillText('SwimBull', 14 * u, H - 14 * u);
  ctx.restore();
}
export const slowTag = (slow) => ({ 1: '', 2: ' · ×½', 4: ' · ×¼', 8: ' · ×⅛' })[slow] ?? '';
