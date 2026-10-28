// Explicación con voz: graba lo que se ve en el reproductor (video, esqueleto, ángulos y dibujos) junto con el
// micrófono, mientras el entrenador reproduce, pausa, avanza cuadro a cuadro y dibuja. Sale un video para mandar.
const MAX_S = 180;
const TYPES = ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
export const canRecordVoice = () => typeof MediaRecorder === 'function' && !!navigator.mediaDevices?.getUserMedia && typeof HTMLCanvasElement.prototype.captureStream === 'function';

export function voicePanelHtml(p) {
  return `<div class="eyebrow">Explicación con voz</div>
  <p class="fine" id="${p}-hint">Grabá tu voz mientras reproducís, pausás, avanzás cuadro a cuadro y dibujás. Se graba lo que se ve en el video, con el esqueleto y los dibujos, para mandarlo al nadador.</p>
  <div class="clip-actions">
    <button class="btn primary small" id="${p}-go" type="button">● Grabar explicación</button>
    <span class="mono fine" id="${p}-time" aria-live="polite"></span>
  </div>
  <div id="${p}-out"></div>`;
}

// api: { size: () => [w, h] del video, paint: (ctx, W, H) => dibuja el cuadro actual, name: () => nombre base, download }
export function bindVoice(p, api) {
  const $ = (id) => document.getElementById(`${p}-${id}`);
  let rec = null;
  if (!canRecordVoice()) { $('go').disabled = true; $('hint').textContent = 'Este navegador no puede grabar audio y video juntos. Probá con Chrome o Safari actualizado.'; return { stop() {} }; }
  // Terminar: en iPhone a veces el grabador no avisa que paró (onstop no llega) y la grabación
  // parecía no cortarse. Ahora se cortan también las pistas y, si en 1,5 s no avisó, se cierra igual
  // con lo que ya se grabó.
  let cortar = null;
  const stop = () => cortar?.();
  $('go').onclick = async () => {
    if (rec) { stop(); return; }
    let mic;
    try { mic = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }); }
    catch (e) { $('hint').textContent = e.name === 'NotAllowedError' ? 'No se dio permiso para usar el micrófono. Habilitalo en el navegador y probá de nuevo.' : 'No se pudo abrir el micrófono: ' + (e.message || e.name); return; }
    const [vw, vh] = api.size();
    const k = Math.min(1, 1280 / vw, 720 / vh), W = Math.round(vw * k / 2) * 2, H = Math.round(vh * k / 2) * 2;
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const ctx = cv.getContext('2d');
    const stream = cv.captureStream(30);
    mic.getAudioTracks().forEach(t => stream.addTrack(t));
    const type = TYPES.find(t => MediaRecorder.isTypeSupported(t)) || '';
    const mr = new MediaRecorder(stream, { ...(type ? { mimeType: type } : {}), videoBitsPerSecond: 5e6, audioBitsPerSecond: 128e3 });
    const parts = [];
    mr.ondataavailable = (e) => { if (e.data.size) parts.push(e.data); };
    const t0 = performance.now();
    let raf = 0;
    const loop = () => {
      ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
      try { api.paint(ctx, W, H); } catch {}
      const s = (performance.now() - t0) / 1000;
      $('time').textContent = `● ${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
      if (s > MAX_S) { stop(); return; }
      raf = requestAnimationFrame(loop);
    };
    rec = mr;
    let listo = false;
    cortar = () => {
      cortar = null;
      cancelAnimationFrame(raf);
      $('go').textContent = 'Terminando…';
      try { if (mr.state === 'recording') mr.requestData(); } catch {}
      try { if (mr.state !== 'inactive') mr.stop(); } catch {}
      setTimeout(() => { stream.getTracks().forEach(t => t.stop()); }, 300);
      setTimeout(() => mr.onstop(), 1500);
    };
    mr.onstop = () => {
      if (listo) return;
      listo = true;
      cortar = null;
      cancelAnimationFrame(raf);
      mic.getTracks().forEach(t => t.stop());
      rec = null;
      $('go').textContent = '● Grabar explicación'; $('go').classList.remove('danger-fill');
      const mime = mr.mimeType || type || 'video/webm', ext = mime.includes('mp4') ? 'mp4' : 'webm';
      const blob = new Blob(parts, { type: mime }), secs = (performance.now() - t0) / 1000;
      const file = new File([blob], `${api.name()}_explicacion.${ext}`, { type: mime });
      $('time').textContent = `${Math.round(secs)} s · ${(blob.size / 1048576).toFixed(1).replace('.', ',')} MB`;
      $('out').innerHTML = `<video class="take-video" controls playsinline></video><div class="clip-actions"><button class="btn small" type="button" data-a="dl">Descargar</button>${navigator.canShare?.({ files: [file] }) ? '<button class="btn ghost small" type="button" data-a="share">Compartir</button>' : ''}</div>${ext === 'webm' ? '<p class="fine">Formato WebM: se ve en computadoras y Android; para iPhone mandalo desde Safari o convertilo.</p>' : ''}`;
      const v = $('out').querySelector('video'); v.src = URL.createObjectURL(file);
      $('out').querySelector('[data-a="dl"]').onclick = () => api.download(file, file.name);
      if (api.reviewButton) $('out').querySelector('.clip-actions').append(api.reviewButton(file, 'voice'));
      const sh = $('out').querySelector('[data-a="share"]'); if (sh) sh.onclick = () => navigator.share({ files: [file], title: file.name }).catch(() => {});
    };
    mr.start(1000);
    $('go').textContent = '■ Terminar'; $('go').classList.add('danger-fill');
    $('out').innerHTML = '';
    loop();
  };
  return { stop };
}
