// Sugerencia automática del despegue de los pies y de la entrada de las manos en una salida, a partir de
// la pose. Es solo una propuesta: el entrenador la mira cuadro a cuadro y la confirma. Cuando el modelo
// no vio los pies o las manos justo en el momento, se informa el rango de cuadros en que ocurrió.

const med = (a) => { const v = a.filter(Number.isFinite).sort((x, y) => x - y); return v.length ? v[v.length >> 1] : NaN; };

export function suggestStart(r) {
  const T = r.tracks, n = r.times.length, fps = r.meta.fps;
  const ok = (j, i) => T[j].rawValid?.[i] && Number.isFinite(T[j].x[i]);
  const hipX = (i) => (Number.isFinite(T[23].x[i]) && Number.isFinite(T[24].x[i]) ? (T[23].x[i] + T[24].x[i]) / 2 : NaN);
  // velocidad horizontal de la cadera (px/s), diferencia centrada sobre la serie suavizada
  // solo con la cadera vista en los dos cuadros vecinos (no interpolada), para no tomar un salto a otra persona
  const seen = (i) => ok(23, i) && ok(24, i);
  const vx = Array.from({ length: n }, (_, i) => (i > 0 && i < n - 1 && seen(i - 1) && seen(i + 1) ? (hipX(i + 1) - hipX(i - 1)) * fps / 2 : NaN));
  let p = -1;
  for (let i = 0; i < n; i++) if (Number.isFinite(vx[i]) && (p < 0 || Math.abs(vx[i]) > Math.abs(vx[p]))) p = i;
  if (p < 0) return { error: 'No se vio la cadera lo suficiente para encontrar el impulso.' };
  const dir = Math.sign(vx[p]) || 1, peak = Math.abs(vx[p]);
  // largo del tronco como escala
  const trunk = med(Array.from({ length: n }, (_, i) => (ok(11, i) && ok(23, i) ? Math.hypot(T[11].x[i] - T[23].x[i], T[11].y[i] - T[23].y[i]) : NaN)));
  if (!Number.isFinite(trunk)) return { error: 'No se vio el tronco lo suficiente.' };
  // tobillo más atrasado en el sentido del movimiento (el que queda en la pared o el banco)
  const ank = (i) => { const xs = [27, 28].filter(j => ok(j, i)).map(j => T[j].x[i]); return xs.length ? (dir > 0 ? Math.min(...xs) : Math.max(...xs)) : NaN; };
  // posición de los pies mientras el nadador está casi quieto antes del impulso
  const still = [];
  let m0 = 0; // último cuadro casi quieto antes del pico: el despegue se busca desde ahí
  for (let i = 0; i < p; i++) if (Number.isFinite(vx[i]) && Math.abs(vx[i]) < 0.25 * peak) { still.push(ank(i)); m0 = i; }
  const base = med(still);
  const out = { dir, peakFrame: p, trunk };
  if (!Number.isFinite(base)) out.takeoff = { error: 'No se vieron los pies antes del impulso.' };
  else {
    const tol = 0.5 * trunk, on = (i) => Number.isFinite(ank(i)) && Math.abs(ank(i) - base) < tol;
    const off = (i) => Number.isFinite(ank(i)) && (ank(i) - base) * dir > tol;
    let first = -1;
    for (let i = m0; i < n; i++) if (off(i)) { first = i; break; }
    let last = -1;
    for (let i = first < 0 ? n - 1 : first - 1; i >= Math.max(0, m0 - 2 * Math.round(fps)); i--) if (on(i)) { last = i; break; }
    if (first < 0 || last < 0) out.takeoff = { error: 'No se vio a los pies dejar la pared o el banco.' };
    else {
      // los pies dejan de apoyar entre el último cuadro en que se los vio apoyados y el primero en que se los vio lejos
      const frame = first - last <= 2 ? last : Math.round((last + first) / 2);
      out.takeoff = { frame, from: last, to: first, exact: first - last <= 2, why: first - last <= 2 ? `Último cuadro con los pies todavía en su lugar (en el cuadro ${first + 1} ya se separaron).` : `El modelo no vio los pies entre el cuadro ${last + 2} y el ${first}: el despegue está en ese tramo. Mirá cuadro a cuadro y marcá el exacto.` };
    }
  }
  // entrada de las manos: último cuadro con la muñeca adelantada a la vista antes de perderla 3 cuadros seguidos
  const start = out.takeoff?.frame ?? p;
  const wr = (i) => { const xs = [15, 16].filter(j => ok(j, i)).map(j => T[j].x[i]); return xs.length ? (dir > 0 ? Math.max(...xs) : Math.min(...xs)) : NaN; };
  let entry = -1;
  for (let i = start + 1; i < n - 3; i++) {
    if (!Number.isFinite(wr(i))) continue;
    if (![1, 2, 3].some(k => Number.isFinite(wr(i + k)))) { entry = i; break; }
  }
  out.entry = entry < 0 ? { error: 'No se encontró en qué cuadro las manos se dejan de ver después del despegue.' }
    : { frame: entry, why: `Último cuadro en que se ve la mano adelantada; después deja de verse (entró al agua o la tapó la espuma).` };
  return out;
}
