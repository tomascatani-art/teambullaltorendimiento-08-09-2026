// Dibujo y texto sobre el video (como en Kinovea): flechas, líneas, círculos, trazos a mano alzada y notas.
// Las coordenadas se guardan en píxeles del video, así quedan en su lugar con cualquier tamaño o zoom.
// Son marcas del entrenador: no miden nada y no entran en ningún cálculo.

export const DRAW_KINDS = { arrow: 'Flecha', line: 'Línea', circle: 'Círculo', free: 'A mano alzada', text: 'Texto' };
export const DRAW_COLORS = [['#ffb020', 'Ámbar'], ['#ffffff', 'Blanco'], ['#ff4d4d', 'Rojo'], ['#38d9ff', 'Celeste'], ['#5cff7a', 'Verde']];

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Visible en el cuadro actual: fija en todo el video, o solo en el cuadro donde se dibujó.
export const drawingVisible = (d, tNow, frameDur) => d.pin !== false || Math.abs(d.t - tNow) < frameDur * 0.5;

// sc: píxeles del lienzo por píxel de video; k: escala de trazo (densidad de pantalla o tamaño de exportación).
export function renderDrawings(ctx, list, sc, k = 1) {
  ctx.save();
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  for (const d of list) {
    const P = d.pts.map(([x, y]) => [x * sc, y * sc]);
    if (!P.length) continue;
    const lw = 3 * k;
    const stroke = (path) => {
      // contorno oscuro debajo para que se vea sobre el agua clara o la espuma
      ctx.strokeStyle = 'rgba(0,0,0,0.55)'; ctx.lineWidth = lw + 2.5 * k; path(); ctx.stroke();
      ctx.strokeStyle = d.color; ctx.lineWidth = lw; path(); ctx.stroke();
    };
    if (d.kind === 'text') {
      const fs = Math.round(17 * k);
      ctx.font = `600 ${fs}px "Geist", system-ui, sans-serif`;
      const lines = String(d.text || '').split('\n');
      const w = Math.max(...lines.map(l => ctx.measureText(l).width)), h = lines.length * fs * 1.25;
      const [x, y] = P[0];
      ctx.fillStyle = 'rgba(4,10,16,0.78)'; ctx.fillRect(x - 6 * k, y - fs - 4 * k, w + 12 * k, h + 8 * k);
      ctx.fillStyle = d.color; ctx.fillRect(x - 6 * k, y - fs - 4 * k, 3 * k, h + 8 * k);
      ctx.fillStyle = '#fff';
      lines.forEach((l, i) => ctx.fillText(l, x + 2 * k, y + i * fs * 1.25));
      continue;
    }
    if (P.length < 2) continue;
    if (d.kind === 'circle') {
      const r = Math.hypot(P[1][0] - P[0][0], P[1][1] - P[0][1]);
      stroke(() => { ctx.beginPath(); ctx.arc(P[0][0], P[0][1], r, 0, Math.PI * 2); });
      continue;
    }
    if (d.kind === 'free') {
      stroke(() => { ctx.beginPath(); P.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); });
      continue;
    }
    const [a, b] = [P[0], P[P.length - 1]];
    stroke(() => { ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); });
    if (d.kind === 'arrow') {
      const ang = Math.atan2(b[1] - a[1], b[0] - a[0]), hl = Math.min(18 * k, Math.hypot(b[0] - a[0], b[1] - a[1]) * 0.5);
      const head = () => {
        ctx.beginPath();
        ctx.moveTo(b[0], b[1]); ctx.lineTo(b[0] - hl * Math.cos(ang - 0.45), b[1] - hl * Math.sin(ang - 0.45));
        ctx.moveTo(b[0], b[1]); ctx.lineTo(b[0] - hl * Math.cos(ang + 0.45), b[1] - hl * Math.sin(ang + 0.45));
      };
      stroke(head);
    }
  }
  ctx.restore();
}

// Distancia de un punto a un segmento.
function segDist(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy;
  const u = L2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L2)) : 0;
  return Math.hypot(p[0] - a[0] - u * dx, p[1] - a[1] - u * dy);
}

// Dibujo tocado en p (píxeles de video), con tolerancia tol; el de más arriba gana. textW estima el ancho de una nota.
export function hitDrawing(list, p, tol, textW = (d) => 9 * String(d.text || '').length) {
  for (let i = list.length - 1; i >= 0; i--) {
    const d = list[i], P = d.pts;
    if (!P.length) continue;
    if (d.kind === 'text') {
      const [x, y] = P[0], lines = String(d.text || '').split('\n').length;
      if (p[0] > x - tol && p[0] < x + textW(d) + tol && p[1] > y - 24 - tol && p[1] < y + lines * 22 + tol) return i;
      continue;
    }
    if (d.kind === 'circle') {
      const r = Math.hypot(P[1][0] - P[0][0], P[1][1] - P[0][1]);
      if (Math.abs(Math.hypot(p[0] - P[0][0], p[1] - P[0][1]) - r) < tol) return i;
      continue;
    }
    for (let j = 1; j < P.length; j++) if (segDist(p, P[j - 1], P[j]) < tol) return i;
  }
  return -1;
}

// Panel de herramientas: tipo, color, texto de la nota y lista de lo dibujado.
export function drawPanelHtml(id) {
  return `<div class="draw-tools" role="group" aria-label="Herramienta de dibujo">${Object.entries(DRAW_KINDS).map(([k, l]) => `<button type="button" class="btn ghost small" data-draw="${k}" aria-pressed="false">${l}</button>`).join('')}</div>
    <div class="draw-colors" role="radiogroup" aria-label="Color">${DRAW_COLORS.map(([c, l], i) => `<button type="button" class="draw-sw" data-color="${c}" role="radio" aria-checked="${i === 0}" aria-label="${l}" style="--c:${c}"></button>`).join('')}</div>
    <label class="draw-text" hidden><span class="fine">Texto de la nota</span><textarea id="${id}-text" rows="2" maxlength="160" placeholder="Ej.: rodillas a 90° antes del impulso"></textarea></label>
    <p class="fine" id="${id}-hint">Elegí una herramienta y dibujá sobre el video. Sin herramienta elegida, arrastrá un dibujo para moverlo.</p>
    <div id="${id}-list"></div>`;
}

// Controlador: cv es el lienzo encima del video; api da el estado de la pantalla que lo usa.
// api: { list(): [], now(): s, frameDur(): s, videoSize(): [w,h], editing(): bool, changed(), redraw() }
export function bindDrawing(cv, panel, id, api) {
  const D = { tool: null, color: DRAW_COLORS[0][0], cur: null, drag: null };
  const px = (e) => { const r = cv.getBoundingClientRect(), [w, h] = api.videoSize(); return [Math.max(0, Math.min(w, (e.clientX - r.left) / r.width * w)), Math.max(0, Math.min(h, (e.clientY - r.top) / r.height * h))]; };
  const tolPx = () => { const r = cv.getBoundingClientRect(); return 16 / (r.width / api.videoSize()[0]); };
  const textEl = () => panel.querySelector(`#${id}-text`);
  const hint = () => panel.querySelector(`#${id}-hint`);

  function toolUi() {
    panel.querySelectorAll('[data-draw]').forEach(b => b.setAttribute('aria-pressed', b.dataset.draw === D.tool));
    panel.querySelector('.draw-text').hidden = D.tool !== 'text';
    cv.classList.toggle('tool', !!D.tool);
    hint().textContent = !D.tool ? 'Elegí una herramienta y dibujá sobre el video. Sin herramienta elegida, arrastrá un dibujo para moverlo.'
      : D.tool === 'text' ? 'Escribí la nota y tocá el video donde va.'
      : D.tool === 'free' ? 'Arrastrá el dedo sobre el video para trazar.'
      : D.tool === 'circle' ? 'Apoyá en el centro y arrastrá hasta el borde.'
      : 'Apoyá donde empieza y arrastrá hasta donde termina.';
  }
  function listUi() {
    const L = api.list();
    const box = panel.querySelector(`#${id}-list`);
    if (!L.length) { box.innerHTML = ''; return; }
    box.innerHTML = `<ul class="draw-list">${L.map((d, i) => `<li><i style="background:${d.color}"></i><span>${esc(DRAW_KINDS[d.kind])}${d.kind === 'text' ? `: ${esc(String(d.text).slice(0, 40))}` : ''}</span>
      <button type="button" class="btn ghost small" data-pin="${i}">${d.pin === false ? 'Solo en su cuadro' : 'Fijo en el video'}</button>
      <button type="button" class="icon-x" data-del="${i}" aria-label="Borrar dibujo">×</button></li>`).join('')}</ul>
      <button type="button" class="linkish" data-clear>Borrar todos los dibujos</button>`;
    box.querySelectorAll('[data-del]').forEach(b => b.onclick = () => { L.splice(+b.dataset.del, 1); api.changed(); listUi(); api.redraw(); });
    box.querySelectorAll('[data-pin]').forEach(b => b.onclick = () => { const d = L[+b.dataset.pin]; d.pin = d.pin === false; if (!d.pin) d.t = api.now(); api.changed(); listUi(); api.redraw(); });
    box.querySelector('[data-clear]').onclick = () => { L.length = 0; api.changed(); listUi(); api.redraw(); };
  }
  panel.querySelectorAll('[data-draw]').forEach(b => b.onclick = () => { D.tool = D.tool === b.dataset.draw ? null : b.dataset.draw; toolUi(); if (D.tool === 'text') textEl().focus(); });
  panel.querySelectorAll('[data-color]').forEach(b => b.onclick = () => { D.color = b.dataset.color; panel.querySelectorAll('[data-color]').forEach(x => x.setAttribute('aria-checked', x === b)); });

  cv.addEventListener('pointerdown', (e) => {
    if (!api.editing() && !D.tool) return;
    const p = px(e);
    if (D.tool) {
      e.preventDefault(); e.stopImmediatePropagation(); e.stopPropagation();
      api.pause?.();
      if (D.tool === 'text') {
        const txt = textEl().value.trim();
        if (!txt) { hint().textContent = 'Primero escribí el texto de la nota.'; textEl().focus(); return; }
        api.list().push({ id: Math.random().toString(36).slice(2, 9), kind: 'text', pts: [p], text: txt, color: D.color, t: api.now(), pin: true });
        textEl().value = ''; api.changed(); listUi(); api.redraw();
        return;
      }
      D.cur = { id: Math.random().toString(36).slice(2, 9), kind: D.tool, pts: [p, p], color: D.color, t: api.now(), pin: true };
      if (D.tool === 'free') D.cur.pts = [p];
      api.list().push(D.cur);
      cv.setPointerCapture(e.pointerId);
      api.redraw();
      return;
    }
    const L = api.list(), vis = L.filter(d => drawingVisible(d, api.now(), api.frameDur()));
    const k = hitDrawing(vis, p, tolPx());
    if (k < 0) return;
    e.preventDefault(); e.stopImmediatePropagation(); e.stopPropagation();
    D.drag = { d: vis[k], last: p };
    cv.setPointerCapture(e.pointerId);
  }, true);
  cv.addEventListener('pointermove', (e) => {
    if (D.cur) {
      const p = px(e);
      if (D.cur.kind === 'free') { const q = D.cur.pts[D.cur.pts.length - 1]; if (Math.hypot(p[0] - q[0], p[1] - q[1]) > 2) D.cur.pts.push(p); }
      else D.cur.pts[1] = p;
      api.redraw(); e.stopImmediatePropagation();
    } else if (D.drag) {
      const p = px(e), dx = p[0] - D.drag.last[0], dy = p[1] - D.drag.last[1];
      D.drag.d.pts = D.drag.d.pts.map(([x, y]) => [x + dx, y + dy]); D.drag.last = p;
      api.redraw(); e.stopImmediatePropagation();
    }
  }, true);
  const end = (e) => {
    if (D.cur) {
      const P = D.cur.pts, tiny = P.length < 2 || Math.hypot(P[P.length - 1][0] - P[0][0], P[P.length - 1][1] - P[0][1]) < 3;
      if (tiny && D.cur.kind !== 'free') api.list().splice(api.list().indexOf(D.cur), 1);
      else if (D.cur.kind === 'free' && P.length < 2) api.list().splice(api.list().indexOf(D.cur), 1);
      D.cur = null; api.changed(); listUi(); api.redraw(); e.stopImmediatePropagation();
    } else if (D.drag) { D.drag = null; api.changed(); e.stopImmediatePropagation(); }
  };
  cv.addEventListener('pointerup', end, true);
  cv.addEventListener('pointercancel', end, true);
  return { refresh: () => { toolUi(); listUi(); }, off: () => { D.tool = null; toolUi(); }, get tool() { return D.tool; } };
}
