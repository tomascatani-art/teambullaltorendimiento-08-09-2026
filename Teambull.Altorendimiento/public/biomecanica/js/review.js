// Revisión para el nadador: el entrenador junta en la evaluación los clips con el esqueleto, las
// explicaciones con voz y cuadros con dibujos; el nadador los ve en su ficha, en orden, y queda marcado
// cuándo los vio. En modo sin cuenta quedan en este dispositivo (como notas del entrenador).
import { store } from './store.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const KIND_LABEL = { clip: 'Clip', voice: 'Explicación con voz', frame: 'Cuadro con dibujos' };
const when = (t) => { const d = new Date(t); return Number.isNaN(+d) ? '' : d.toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }); };

// Botón "Agregar a la revisión" junto a un clip o una explicación ya generados.
// getSaved: () => Promise<evaluación guardada | null> (guarda la evaluación si hace falta).
export function sendButton(file, kind, getSaved, onDone) {
  const b = document.createElement('button');
  b.type = 'button'; b.className = 'btn ghost small'; b.textContent = 'Agregar a la revisión del nadador';
  b.onclick = async () => {
    b.disabled = true; b.textContent = 'Guardando…';
    try {
      const saved = await getSaved();
      if (!saved) { b.textContent = 'Primero guardá la evaluación en un alumno'; b.disabled = false; return; }
      const title = prompt('Título para el nadador (por ejemplo: "Codo alto en la tracción")', KIND_LABEL[kind]) ?? KIND_LABEL[kind];
      await store.addReviewItem(saved.id, file, { kind, title: title.trim() || KIND_LABEL[kind] });
      b.textContent = 'Agregado a la revisión ✓';
      onDone?.(saved);
    } catch (e) { b.textContent = 'No se pudo agregar: ' + e.message; b.disabled = false; }
  };
  return b;
}

// Lista de la revisión dentro de una evaluación (ficha del alumno o del nadador).
export async function renderReview(box, e, { readOnly = false, onError } = {}) {
  let items = [];
  try { items = await store.listReviewItems(e.id); } catch (err) { onError?.(err); return; }
  if (!items.length) { box.innerHTML = readOnly ? '' : `<div class="mgroup">Revisión para el nadador</div><p class="fine">Desde el análisis, los clips, las explicaciones con voz y los cuadros con dibujos se agregan acá con "Agregar a la revisión del nadador".${store.backend === 'cloud' ? ' El nadador los ve en su ficha si la evaluación está visible.' : ' Sin cuenta quedan en este dispositivo.'}</p>`; return; }
  const unseen = items.filter(i => !i.seenAt).length;
  box.innerHTML = `<div class="mgroup">Revisión ${readOnly ? 'de tu entrenador' : 'para el nadador'}${readOnly && unseen ? ` <span class="tag hi">${unseen} nuevo${unseen === 1 ? '' : 's'}</span>` : ''}</div>
    <ol class="review-list">${items.map(i => `<li data-id="${i.id}"><div class="rv-head"><b>${esc(i.title)}</b><span class="fine">${KIND_LABEL[i.kind] || ''} · ${when(i.createdAt)}${i.seenAt ? ` · visto ${when(i.seenAt)}` : readOnly ? ' · <b>nuevo</b>' : ' · todavía no lo vio'}</span>${readOnly ? '' : `<button class="linkish" data-del="${i.id}" type="button">Quitar</button>`}</div>
      <div class="rv-media" data-media="${i.id}"><button class="btn ghost small" type="button" data-open="${i.id}">${i.kind === 'frame' ? 'Ver imagen' : 'Ver video'}</button></div></li>`).join('')}</ol>`;
  box.querySelectorAll('[data-open]').forEach(b => b.onclick = async () => {
    const it = items.find(x => x.id === b.dataset.open), slot = box.querySelector(`[data-media="${it.id}"]`);
    b.disabled = true; b.textContent = 'Cargando…';
    try {
      const blob = await store.reviewFile(it), url = URL.createObjectURL(blob);
      slot.innerHTML = it.kind === 'frame' ? `<img class="take-video" alt="${esc(it.title)}" src="${url}">` : `<video class="take-video" controls playsinline src="${url}"></video>`;
      if (readOnly && !it.seenAt) { await store.markReviewSeen(it.id, e.id); it.seenAt = new Date().toISOString(); }
    } catch (err) { b.disabled = false; b.textContent = 'No se pudo abrir: ' + err.message; }
  });
  box.querySelectorAll('[data-del]').forEach(b => b.onclick = async () => {
    try { await store.deleteReviewItem(b.dataset.del, e.id); await renderReview(box, e, { readOnly, onError }); } catch (err) { onError?.(err); }
  });
}
