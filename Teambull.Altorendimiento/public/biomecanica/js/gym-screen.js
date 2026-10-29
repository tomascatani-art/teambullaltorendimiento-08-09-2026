// Pantalla del deportista (por ejemplo, una tablet de frente): se ve en vivo, como en un espejo, y muestra
// grande la velocidad media de cada repetición que mide el celular que filma de costado.
// La imagen puede ser la cámara de esta pantalla (espejo) o el video del celular (WebRTC, misma red).
import { openLink } from './gym-link.js';
import { EXERCISES, zoneOf, DEFICIT_LIMIT } from './gym.js';
import { unlock, beep } from './beep.js';

const $ = (id) => document.getElementById(id);
const f = (v, d = 2) => (Number.isFinite(v) ? v.toLocaleString('es-AR', { minimumFractionDigits: d, maximumFractionDigits: d }) : '–');
const X = { link: null, cam: null, pc: null, last: '', lastN: 0, ready: false, timer: 0 };
window.__swimGymScreen = X; // para las pruebas automáticas

export function openScreen() {
  $('gy-work').hidden = true;
  $('gy-show').hidden = false;
  if (!X.ready) {
    X.ready = true;
    $('gy-join').onclick = () => join();
    $('gy-code').onkeydown = (e) => { if (e.key === 'Enter') join(); };
    $('gy-view').onchange = () => { if (X.link) setView(); };
    // pantalla completa con estilos (el iPhone no deja poner en pantalla completa algo que no sea un video);
    // dentro de Team Bull se le pide que esconda su barra. Se sale con la ✕ o con Escape.
    const full = (on) => {
      const st = $('gy-show-stage');
      st.classList.toggle('gs-full', on);
      document.documentElement.classList.toggle('vb-full-on', on);
      try { if (window.parent !== window) window.parent.postMessage({ tb: 'bio', type: 'pantallaCompleta', on }, location.origin); } catch {}
    };
    $('gy-full').onclick = () => full(true);
    const salir = document.createElement('button');
    salir.type = 'button'; salir.className = 'gs-salir'; salir.textContent = '✕'; salir.setAttribute('aria-label', 'Salir de pantalla completa');
    salir.onclick = () => full(false);
    $('gy-show-stage').appendChild(salir);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') full(false); });
    document.addEventListener('vb-salir', () => full(false));
  }
  $('gy-show-stage').dataset.image = X.link ? $('gy-view').value : 'none';
  render(null);
  $('gy-show').scrollIntoView({ block: 'start' });
  $('gy-code').focus();
}

export function closeScreen() {
  X.link?.close(); X.link = null;
  stopImage();
}

const status = (t) => { $('gy-show-status').textContent = t; };

async function join() {
  unlock();
  const code = $('gy-code').value.trim();
  X.link?.close(); X.link = null; X.last = ''; X.lastN = 0;
  try {
    X.link = await openLink(code, onMsg);
  } catch (err) { status(err.message); return; }
  status(X.link.kind === 'local' ? 'Conectado (solo con otra pestaña de este dispositivo).' : 'Conectado. Esperando la serie…');
  X.link.send({ type: 'hello' });
  setView();
  // en la tablet, dejar a la vista el número (y no los controles de arriba)
  $('gy-show-stage').scrollIntoView({ block: 'end' });
}

function stopImage() {
  clearTimeout(X.timer);
  X.cam?.getTracks().forEach(t => t.stop()); X.cam = null;
  X.pc?.close(); X.pc = null;
  const v = $('gy-show-video');
  v.srcObject = null; v.classList.remove('mirror');
}

async function setView() {
  stopImage();
  const mode = $('gy-view').value, v = $('gy-show-video');
  $('gy-show-stage').dataset.image = mode;
  if (mode === 'mirror') {
    try {
      X.cam = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } } });
      v.srcObject = X.cam; v.classList.add('mirror'); v.play().catch(() => {});
    } catch (err) { status('No pude abrir la cámara de esta pantalla: ' + (err.message || err.name)); }
  } else if (mode === 'remote') {
    if (typeof RTCPeerConnection === 'undefined') { status('Este navegador no puede recibir el video. Usá Espejo.'); return; }
    X.link?.send({ type: 'want-video' });
    X.timer = setTimeout(() => { if (!v.srcObject) status('No llegó el video del celular (tienen que estar en la misma red wifi). Probá con Espejo.'); }, 15000);
  }
}

async function onOffer(sdp) {
  X.pc?.close();
  const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
  X.pc = pc;
  pc.ontrack = (e) => { const v = $('gy-show-video'); v.srcObject = e.streams[0]; v.play().catch(() => {}); clearTimeout(X.timer); };
  pc.onicecandidate = (e) => { if (e.candidate) X.link?.send({ type: 'ice', c: e.candidate.toJSON() }); };
  await pc.setRemoteDescription({ type: 'offer', sdp });
  const ans = await pc.createAnswer();
  await pc.setLocalDescription(ans);
  X.link?.send({ type: 'answer', sdp: ans.sdp });
}

function onMsg(m) {
  if (!m || typeof m !== 'object') return;
  if (m.type === 'state') render(m);
  else if (m.type === 'offer' && typeof m.sdp === 'string' && $('gy-view').value === 'remote') onOffer(m.sdp).catch(() => status('No se pudo recibir el video del celular. Probá con Espejo.'));
  else if (m.type === 'ice' && X.pc && m.c) X.pc.addIceCandidate(m.c).catch(() => {});
}

// Lo que se ve: la última repetición en grande, su zona, y las anteriores.
function render(st) {
  const reps = Array.isArray(st?.reps) ? st.reps.filter(r => Number.isFinite(r?.mv)) : [];
  const last = reps[reps.length - 1];
  const big = $('gy-show-big'), zone = $('gy-show-zone'), rep = $('gy-show-rep'), list = $('gy-show-list');
  const ex = EXERCISES[st?.ex]?.label || '';
  rep.textContent = last ? `Rep ${last.n}${ex ? ' · ' + ex : ''}${Number.isFinite(st.load) ? ` · ${f(st.load, 1)} kg` : ''}` : st ? (st.done ? 'Serie terminada' : 'Esperando la primera repetición…') : 'Escribí el código que muestra el celular';
  big.innerHTML = last ? `${f(last.mv)}<small> m/s</small>` : '–';
  const z = last ? zoneOf(last.mv) : null;
  zone.textContent = z ? (z.zone ? z.zone.label : z.out === 'below' ? 'Debajo de la tabla' : 'Arriba de la tabla') : '';
  $('gy-show-stage').dataset.zone = z?.zone?.id || '';
  const d = st?.deficit;
  list.textContent = reps.length > 1 ? reps.slice(0, -1).map(r => f(r.mv)).join('  ·  ') + (Number.isFinite(d) ? `   ·   déficit ${f(d)} %` : '') : '';
  $('gy-show-stage').classList.toggle('stop', Number.isFinite(d) && d < DEFICIT_LIMIT);
  // destello al llegar una repetición nueva
  const key = last ? `${last.n}:${last.mv}` : '';
  if (key && key !== X.last) {
    big.classList.remove('flash'); void big.offsetWidth; big.classList.add('flash');
    // pitido solo cuando llega una repetición nueva (no al corregirse una anterior)
    if ($('gy-sound')?.checked && last.n > X.lastN && !st.done) beep(Number.isFinite(d) && d < DEFICIT_LIMIT ? 'stop' : 'rep');
  }
  X.lastN = last ? last.n : 0;
  X.last = key;
  if (st?.done) status('Serie terminada.');
  else if (last) status('Conectado.');
}
