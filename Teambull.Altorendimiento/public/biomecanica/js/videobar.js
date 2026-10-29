// Controles dentro del video (Técnica, Competencia y Gym): una barra para deslizar a cualquier
// momento y botones grandes de cuadro por cuadro, hacia atrás y hacia adelante. Si se mantiene
// apretado un botón, sigue avanzando o retrocediendo solo. Los botones usan los de cada pantalla
// (los mismos que ya estaban), así cada una sigue calculando el cuadro a su manera.

const $ = (id) => document.getElementById(id);
const ICON = {
  prev: '<svg viewBox="0 0 24 24" width="18" height="18"><path d="M6 5h2v14H6zM19 5v14L9 12z" fill="currentColor"/></svg>',
  next: '<svg viewBox="0 0 24 24" width="18" height="18"><path d="M16 5h2v14h-2zM5 5v14l10-7z" fill="currentColor"/></svg>',
  play: '<svg viewBox="0 0 24 24" width="20" height="20"><path d="M7 5l12 7-12 7z" fill="currentColor"/></svg>',
  pause: '<svg viewBox="0 0 24 24" width="20" height="20"><path d="M7 5h4v14H7zM13 5h4v14h-4z" fill="currentColor"/></svg>',
  full: '<svg viewBox="0 0 24 24" width="18" height="18"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" fill="none" stroke="currentColor" stroke-width="2"/></svg>',
  salir: '<svg viewBox="0 0 24 24" width="18" height="18"><path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" fill="none" stroke="currentColor" stroke-width="2"/></svg>',
};

// Pantalla completa: el video ocupa todo el celular. Se hace con estilos (en iPhone Safari no deja
// poner en pantalla completa nada que no sea el video solo, y ahí se perderían las marcas y los
// botones) y, dentro de Team Bull, se le pide a la app que esconda su encabezado y su barra de abajo.
function pantallaCompleta(pl, v, on) {
  if (on) document.querySelectorAll('.player.vb-full').forEach(o => { if (o !== pl) pantallaCompleta(o, o.querySelector('video'), false); });
  pl.classList.toggle('vb-full', on);
  volverTodos(pl); // al cambiar el tamaño, los controles movidos vuelven a su lugar
  document.documentElement.classList.toggle('vb-full-on', !!document.querySelector('.player.vb-full'));
  if (v?.videoWidth && v.videoHeight) pl.style.setProperty('--vb-ar', v.videoWidth / v.videoHeight);
  const b = pl.querySelector('[data-vb="full"]');
  if (b) { b.innerHTML = on ? ICON.salir : ICON.full; b.setAttribute('aria-label', on ? 'Salir de pantalla completa' : 'Pantalla completa'); }
  try { if (window.parent !== window) window.parent.postMessage({ tb: 'bio', type: 'pantallaCompleta', on }, location.origin); } catch {}
  // las marcas se vuelven a dibujar con el tamaño nuevo (también cuando Team Bull agranda el cuadro)
  [60, 350, 800].forEach(ms => setTimeout(() => window.dispatchEvent(new Event('resize')), ms));
}
const salirTodas = () => document.querySelectorAll('.player.vb-full').forEach(o => pantallaCompleta(o, o.querySelector('video'), false));
document.addEventListener('vb-salir', salirTodas);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') salirTodas(); });

// Mantener apretado: un paso al tocar y, si sigue apretado, uno cada ~0,1 s.
function repetir(btn, paso) {
  let t1 = null, t2 = null;
  const parar = () => { clearTimeout(t1); clearInterval(t2); t1 = t2 = null; };
  btn.addEventListener('pointerdown', (e) => {
    e.preventDefault(); e.stopPropagation();
    paso();
    t1 = setTimeout(() => { t2 = setInterval(paso, 110); }, 380);
  });
  ['pointerup', 'pointerleave', 'pointercancel'].forEach(ev => btn.addEventListener(ev, parar));
  btn.addEventListener('click', (e) => { e.stopPropagation(); if (e.detail === 0) paso(); }); // teclado
  btn.addEventListener('contextmenu', (e) => e.preventDefault());
}

function montar({ player, video, prev, next, play, back10, fwd10, speed, dentro, zoomSel }) {
  const pl = $(player), v = $(video);
  if (!pl || !v || pl.querySelector('.vb')) return;
  const sel = speed ? $(speed) : null;
  const bar = document.createElement('div');
  bar.className = 'vb';
  bar.innerHTML = `<div class="vb-jog" role="slider" aria-label="Deslizá para pasar cuadro por cuadro"><span class="vb-jog-txt">◀ deslizá cuadro por cuadro ▶</span></div>
    <div class="vb-fila"><input type="range" class="vb-seek" min="0" max="1000" step="1" value="0" aria-label="Mover el video"><button type="button" class="vb-min" aria-label="Achicar los controles" title="Achicar o agrandar los controles">▾</button></div>
    <div class="vb-btns">
      ${back10 ? '<button type="button" class="vb-btn vb-txt" data-vb="b10" aria-label="Retroceder 10 cuadros">−10</button>' : ''}
      <button type="button" class="vb-btn" data-vb="prev" aria-label="Cuadro anterior">${ICON.prev}<span>1</span></button>
      <button type="button" class="vb-btn vb-play" data-vb="play" aria-label="Reproducir o pausar">${ICON.play}</button>
      <button type="button" class="vb-btn" data-vb="next" aria-label="Cuadro siguiente"><span>1</span>${ICON.next}</button>
      ${fwd10 ? '<button type="button" class="vb-btn vb-txt" data-vb="f10" aria-label="Avanzar 10 cuadros">+10</button>' : ''}
      ${sel ? '<button type="button" class="vb-btn vb-txt vb-vel" data-vb="vel" aria-label="Velocidad de reproducción"></button>' : ''}
      <button type="button" class="vb-btn vb-txt vb-tam" data-vb="tam" aria-label="Tamaño del video" title="Entero: el video entra completo en la pantalla. Grande: ocupa todo el ancho.">Entero</button>
      <button type="button" class="vb-btn" data-vb="full" aria-label="Pantalla completa">${ICON.full}</button>
    </div>`;
  const caja = dentro ? pl.querySelector(dentro) : null;
  if (caja) { bar.classList.add('vb-dentro'); caja.prepend(bar); } else pl.appendChild(bar);
  pl.classList.add('con-vb');
  // ✕ arriba a la derecha: cierra el video para elegir otro. Gym lo cierra en su pantalla; Técnica y
  // Competencia vuelven a «Nuevo análisis».
  const cerrar = document.createElement('button');
  cerrar.type = 'button'; cerrar.className = 'vb-cerrar'; cerrar.setAttribute('aria-label', 'Cerrar el video'); cerrar.title = 'Cerrar el video y elegir otro'; cerrar.textContent = '✕';
  ['pointerdown', 'touchstart'].forEach(ev => cerrar.addEventListener(ev, (e) => e.stopPropagation()));
  cerrar.addEventListener('click', (e) => {
    e.stopPropagation();
    if (pl.classList.contains('vb-full')) pantallaCompleta(pl, v, false);
    if (!v.paused) v.pause();
    if (pl.id === 'gy-player') pl.dispatchEvent(new Event('vb-cerrar'));
    else document.getElementById('btn-new')?.click();
  });
  pl.appendChild(cerrar);
  // «Quitar zoom»: aparece cuando el video está agrandado (Técnica y Competencia) y lo deja como estaba
  if (zoomSel && $(zoomSel)) {
    const qz = document.createElement('button');
    qz.type = 'button'; qz.className = 'vb-zoomoff'; qz.textContent = '🔍 Quitar zoom';
    ['pointerdown', 'touchstart'].forEach(ev => qz.addEventListener(ev, (e) => e.stopPropagation()));
    qz.addEventListener('click', (e) => { e.stopPropagation(); const z = $(zoomSel); z.value = '1'; z.dispatchEvent(new Event('change', { bubbles: true })); });
    pl.appendChild(qz);
  }
  // que los toques en la barra no marquen nada en el video
  ['pointerdown', 'click', 'touchstart'].forEach(ev => bar.addEventListener(ev, (e) => e.stopPropagation()));

  const clic = (id, veces = 1) => () => { const b = $(id); if (b && !b.disabled) for (let k = 0; k < veces; k++) b.click(); };
  const q = (k) => bar.querySelector(`[data-vb="${k}"]`);
  repetir(q('prev'), clic(prev));
  repetir(q('next'), clic(next));
  if (back10) repetir(q('b10'), back10 === prev ? clic(prev, 10) : clic(back10));
  if (fwd10) repetir(q('f10'), fwd10 === next ? clic(next, 10) : clic(fwd10));
  q('play').addEventListener('click', (e) => { e.stopPropagation(); clic(play)(); });
  q('full').addEventListener('click', (e) => { e.stopPropagation(); pantallaCompleta(pl, v, !pl.classList.contains('vb-full')); });
  // tamaño: «Entero» achica el video para que entre completo en la pantalla (sin cortarse abajo);
  // «Grande» lo deja a todo el ancho. Arranca en Entero.
  const stage = v.closest('.stage');
  const ponerAr = () => { if (stage && v.videoWidth && v.videoHeight) stage.style.setProperty('--vb-ar', v.videoWidth / v.videoHeight); };
  v.addEventListener('loadedmetadata', ponerAr); ponerAr();
  pl.classList.add('vb-entero');
  q('tam').addEventListener('click', (e) => {
    e.stopPropagation();
    const entero = pl.classList.toggle('vb-entero');
    pl.classList.toggle('vb-grande', !entero);
    q('tam').textContent = entero ? 'Entero' : 'Grande';
    [0, 120].forEach(ms => setTimeout(() => window.dispatchEvent(new Event('resize')), ms));
  });
  // velocidad: cada toque pasa a la siguiente del selector de la pantalla (0,1× → 0,25× → …)
  const velTxt = () => { if (sel) q('vel').textContent = sel.options[sel.selectedIndex]?.text.replace(/\s+/g, '') || ''; };
  if (sel) {
    q('vel').addEventListener('click', (e) => {
      e.stopPropagation();
      sel.selectedIndex = (sel.selectedIndex + 1) % sel.options.length;
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      if (!v.paused) v.playbackRate = +sel.value;
      velTxt();
    });
    sel.addEventListener('change', velTxt);
    velTxt();
  }

  // Achicar: deja solo la barra para deslizar (el video queda casi libre); el mismo botón la vuelve a abrir.
  // Se recuerda en este celular.
  const minBtn = bar.querySelector('.vb-min');
  const ponerMini = (on) => { bar.classList.toggle('vb-mini', on); minBtn.textContent = on ? '▴' : '▾'; minBtn.setAttribute('aria-label', on ? 'Mostrar los controles' : 'Achicar los controles'); };
  try { ponerMini(localStorage.getItem('vb-mini') === '1'); } catch { ponerMini(false); }
  minBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    const on = !bar.classList.contains('vb-mini');
    document.querySelectorAll('.vb').forEach(b => { b.classList.toggle('vb-mini', on); const m = b.querySelector('.vb-min'); if (m) { m.textContent = on ? '▴' : '▾'; m.setAttribute('aria-label', on ? 'Mostrar los controles' : 'Achicar los controles'); } });
    try { localStorage.setItem('vb-mini', on ? '1' : '0'); } catch {}
  });

  // Ruedita: deslizando el dedo sobre la franja pasa de a un cuadro (unos 14 px por cuadro),
  // hacia la derecha adelante y hacia la izquierda atrás. Usa los botones de cuadro de cada pantalla.
  const jog = bar.querySelector('.vb-jog');
  let jx = null, jresto = 0, jdesp = 0;
  const PASO = 14;
  jog.addEventListener('pointerdown', (e) => {
    e.preventDefault(); e.stopPropagation();
    jx = e.clientX; jresto = 0; jog.classList.add('on');
    if (!v.paused) clic(play)();
    try { jog.setPointerCapture(e.pointerId); } catch {}
  });
  jog.addEventListener('pointermove', (e) => {
    if (jx == null) return;
    e.preventDefault();
    const dx = e.clientX - jx; jx = e.clientX; jresto += dx; jdesp += dx;
    jog.style.backgroundPositionX = jdesp + 'px';
    while (jresto >= PASO) { jresto -= PASO; clic(next)(); }
    while (jresto <= -PASO) { jresto += PASO; clic(prev)(); }
  });
  const jfin = () => { jx = null; jog.classList.remove('on'); };
  ['pointerup', 'pointercancel'].forEach(ev => jog.addEventListener(ev, jfin));

  const seek = bar.querySelector('.vb-seek');
  let arrastrando = false;
  // tramo que cubre la barra: todo el video o, si la pantalla lo recortó (pl.__rango = {a, b}), solo ese tramo
  const tramo = () => { const d = Number.isFinite(v.duration) && v.duration > 0 ? v.duration : 0; const r = pl.__rango; return r && r.b > r.a ? { a: r.a, b: Math.min(r.b, d || r.b) } : { a: 0, b: d }; };
  seek.addEventListener('input', () => {
    arrastrando = true;
    if (!v.paused) v.pause();
    const { a, b } = tramo();
    if (b > a) v.currentTime = a + (seek.value / 1000) * (b - a);
  });
  seek.addEventListener('change', () => { arrastrando = false; });
  const sync = () => {
    const { a, b } = tramo();
    // recortado: al reproducir, vuelve a empezar el tramo (en loop)
    if (pl.__rango && !v.paused && v.currentTime >= b) v.currentTime = a;
    if (!arrastrando && b > a) seek.value = Math.round(Math.max(0, Math.min(1, (v.currentTime - a) / (b - a))) * 1000);
    q('play').innerHTML = v.paused ? ICON.play : ICON.pause;
  };
  ['timeupdate', 'seeked', 'loadedmetadata', 'play', 'pause', 'emptied'].forEach(ev => v.addEventListener(ev, sync));
  pl.addEventListener('vb-rango', () => { bar.classList.toggle('vb-recortado', !!pl.__rango); sync(); });
  sync();
}

// Mover los controles que están sobre el video, para que no tapen lo que hay que tocar:
// se arrastran desde la manijita ⋮⋮ (o manteniendo apretado un espacio libre de la barra) a
// cualquier lugar del video. Dos toques en la manijita los devuelven a su lugar.
const MOVIBLES = '#gy-tools, #gy-player .gy-ov-bottom, #player .vb, #rc-player .vb, #rc-qt';
function movible(el) {
  // algunas barras se vuelven a armar seguido (Gym): si se borró la manijita, se vuelve a poner
  if (el.__mov) { if (el.__grip && el.firstElementChild !== el.__grip) el.prepend(el.__grip); return; }
  el.__mov = true;
  el.classList.add('vb-movible');
  const grip = document.createElement('span');
  grip.className = 'vb-grip'; grip.setAttribute('role', 'button'); grip.setAttribute('aria-label', 'Mover estos controles'); grip.textContent = '⋮⋮';
  el.__grip = grip;
  el.prepend(grip);
  const original = el.getAttribute('style') || '';
  el.__volver = () => { el.setAttribute('style', original); el.classList.remove('vb-movido'); };
  let espera = null, drag = null, x0 = 0, y0 = 0, ultimoToque = 0;
  const empezar = (e) => {
    const pl = el.closest('.player') || el.parentElement;
    const r = el.getBoundingClientRect(), pr = pl.getBoundingClientRect();
    drag = { dx: x0 - r.left, dy: y0 - r.top, w: r.width, h: r.height, pr };
    Object.assign(el.style, { position: 'absolute', width: r.width + 'px', right: 'auto', bottom: 'auto', transform: 'none', left: (r.left - pr.left) + 'px', top: (r.top - pr.top) + 'px' });
    el.classList.add('vb-moviendo', 'vb-movido');
    try { el.setPointerCapture(e.pointerId); } catch {}
    navigator.vibrate?.(15);
  };
  el.addEventListener('pointerdown', (e) => {
    if (e.button > 0) return;
    x0 = e.clientX; y0 = e.clientY;
    if (e.target === grip) {
      e.preventDefault(); e.stopPropagation();
      const ahora = Date.now();
      if (ahora - ultimoToque < 350) { el.__volver(); ultimoToque = 0; return; }
      ultimoToque = ahora;
      empezar(e);
    } else if (!e.target.closest('button, input, select, label, a, [role="button"]')) {
      espera = setTimeout(() => { espera = null; empezar(e); }, 450);
    }
  }, true);
  el.addEventListener('pointermove', (e) => {
    if (!drag) { if (espera && Math.hypot(e.clientX - x0, e.clientY - y0) > 8) { clearTimeout(espera); espera = null; } return; }
    e.preventDefault(); e.stopPropagation();
    const { pr } = drag;
    const x = Math.max(0, Math.min(pr.width - drag.w, e.clientX - drag.dx - pr.left));
    const y = Math.max(0, Math.min(pr.height - drag.h, e.clientY - drag.dy - pr.top));
    el.style.left = x + 'px'; el.style.top = y + 'px';
  }, true);
  const soltar = (e) => {
    clearTimeout(espera); espera = null;
    if (!drag) return;
    drag = null; el.classList.remove('vb-moviendo');
    e.stopPropagation();
    // que soltar no cuente como toque en un botón
    const comer = (ev) => { ev.stopPropagation(); ev.preventDefault(); };
    el.addEventListener('click', comer, { capture: true, once: true });
    setTimeout(() => el.removeEventListener('click', comer, { capture: true }), 400);
  };
  el.addEventListener('pointerup', soltar, true);
  el.addEventListener('pointercancel', soltar, true);
}
const volverTodos = (pl) => pl.querySelectorAll('.vb-movido').forEach(el => el.__volver?.());
function buscarMovibles() { document.querySelectorAll(MOVIBLES).forEach(movible); }

function iniciar() {
  montar({ player: 'player', video: 'video', prev: 'c-prev', next: 'c-next', play: 'c-play', speed: 'c-speed', zoomSel: 'c-zoom' });
  montar({ player: 'rc-player', video: 'rc-video', prev: 'rc-prev', next: 'rc-next', play: 'rc-play', back10: 'rc-back10', fwd10: 'rc-fwd10', speed: 'rc-speed', zoomSel: 'rc-zoom' });
  // en Gym los controles ya estaban sobre el video: la barra va en esa misma franja de abajo
  montar({ player: 'gy-player', video: 'gy-video', prev: 'gy-prev', next: 'gy-next', play: 'gy-play', back10: 'gy-prev', fwd10: 'gy-next', dentro: '.gy-ov-bottom' });
  buscarMovibles();
  // las herramientas de Competencia se arman después, cuando se abre esa pantalla
  new MutationObserver(buscarMovibles).observe(document.body, { childList: true, subtree: true });
}
// Team Bull avisa cuando se sale del apartado Biomecánica: todos los videos quedan en pausa.
window.addEventListener('message', (e) => {
  if (e.origin === location.origin && e.data?.tb === 'bio' && e.data.type === 'pausar') { document.querySelectorAll('video').forEach(v => { if (!v.paused) v.pause(); }); salirTodas(); }
});
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', iniciar); else iniciar();
