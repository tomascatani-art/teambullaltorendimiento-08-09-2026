// Informe PDF del análisis de competencia (formato de planilla por tramos).
const ACC = [10, 122, 168], INK = [8, 16, 26], GREY = [110, 117, 128], LINE = [220, 223, 228];
const GREEN = [21, 128, 61], RED = [200, 30, 30];
const STYLE = { crol: 'Crol', espalda: 'Espalda', pecho: 'Pecho', mariposa: 'Mariposa', medley: 'Medley' };

import { angleValue, ANGLE_TYPE_LABEL, secPerCycle, strokesPerMin } from './race.js';

export async function buildRaceReport(cfg, res, ref, { frameDur, compare, angles = [], angleFrames = [], speed = null, checks = [] }) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'landscape' });
  const PW = 297, PH = 210, M = 12;
  const f = (v, d = 2) => (Number.isFinite(v) ? v.toFixed(d).replace('.', ',') : '-');
  let y = 0, page = 1;

  const header = (title) => {
    doc.setFillColor(...INK); doc.rect(0, 0, PW, 20, 'F');
    doc.setFillColor(...ACC); doc.rect(0, 20, PW, 0.8, 'F');
    doc.setTextColor(255, 255, 255); doc.setFont('helvetica', 'bold'); doc.setFontSize(13);
    doc.text(`${cfg.swimmer} · ${cfg.distance} m ${STYLE[cfg.style]}`, M, 9.5);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
    doc.text([cfg.event, cfg.date, `pileta de ${cfg.poolLength} m`].filter(Boolean).join(' · '), M, 15.5);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(9);
    doc.text('SwimBull · ' + title.toUpperCase(), PW - M, 9.5, { align: 'right' });
    if (Number.isFinite(res.finalTime)) { doc.setFontSize(14); doc.text(`${f(res.finalTime)} s`, PW - M, 16.5, { align: 'right' }); }
    y = 30;
  };
  const footer = () => {
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(...GREY);
    doc.text('Análisis de competencia SwimBull. Eventos marcados por el analista sobre el video; cálculos automáticos.', M, PH - 6);
    doc.text(String(page), PW - M, PH - 6, { align: 'right' });
  };
  const h2 = (t) => { doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(...INK); doc.text(t, M, y); y += 1.6; doc.setDrawColor(...ACC); doc.setLineWidth(0.6); doc.line(M, y, M + 10, y); y += 5; };

  // tabla genérica: rows = [[label, ...cells]], colorFn(rowIdx, colIdx) → color
  const table = (head, rows, { labelW = 42, colorFn } = {}) => {
    const n = head.length - 1;
    const cw = Math.min(22, (PW - 2 * M - labelW) / Math.max(1, n));
    doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5); doc.setTextColor(...GREY);
    head.forEach((h, i) => doc.text(String(h), i === 0 ? M : M + labelW + (i - 1) * cw + cw - 1.5, y, { align: i === 0 ? 'left' : 'right' }));
    y += 1.8; doc.setDrawColor(...LINE); doc.setLineWidth(0.2); doc.line(M, y, M + labelW + n * cw, y); y += 4;
    rows.forEach((r, ri) => {
      r.forEach((c, i) => {
        doc.setFont('helvetica', i === 0 ? 'bold' : 'normal'); doc.setFontSize(8.5);
        doc.setTextColor(...((colorFn && i > 0 && colorFn(ri, i - 1)) || INK));
        doc.text(String(c), i === 0 ? M : M + labelW + (i - 1) * cw + cw - 1.5, y, { align: i === 0 ? 'left' : 'right' });
      });
      y += 2; doc.setDrawColor(...LINE); doc.line(M, y, M + labelW + n * cw, y); y += 3.6;
    });
    y += 3;
  };

  header('Planilla');
  // salida y sincronización
  const st = res.start;
  h2('Salida');
  table(['', 'Reacción', 'T bloque', 'T vuelo', 'Break out (m)', 'T break out', 'Vel. (m/s)'],
    [['Salida', f(st.reaction), f(st.blockTime), f(st.flightTime), f(st.breakoutDist), f(st.breakoutTime), f(st.underwaterSpeed)]], { labelW: 30 });

  // parciales en bloques de hasta 10 columnas
  h2('Parciales por tramo');
  const secs = res.sections;
  for (let k = 0; k < secs.length; k += 10) {
    const part = secs.slice(k, k + 10);
    if (y > PH - 50) { footer(); doc.addPage(); page++; header('Planilla'); }
    table(['Marca (m)', ...part.map(s => `${s.dist}${s.kind === 'wall' ? ' (pared)' : s.kind === 'finish' ? ' (llegada)' : ''}`)], [
      ['T total (s)', ...part.map(s => f(s.cumulative))],
      ['T parcial (s)', ...part.map(s => f(s.partial))],
      ['Velocidad (m/s)', ...part.map(s => f(s.speed))],
      ['Ciclos', ...part.map(s => s.cycles ?? '-')],
      ['Frecuencia (ciclos/min)', ...part.map(s => f(s.strokeRate, 1))],
      ['Tiempo por ciclo (s)', ...part.map(s => f(secPerCycle(s.strokeRate)))],
      ['Brazadas/min', ...part.map(s => f(strokesPerMin(s.strokeRate, cfg.style), 1))],
      ['Dist. por ciclo (m)', ...part.map(s => f(s.dps))],
    ]);
  }
  if (res.turns.length) {
    if (y > PH - 55) { footer(); doc.addPage(); page++; header('Planilla'); }
    h2('Virajes');
    const tt = res.turns.slice(0, 10);
    table(['Viraje (m)', ...tt.map(t => t.wall)], [
      ['5 m in (s)', ...tt.map(t => f(t.in5))],
      ['15 m out (s)', ...tt.map(t => f(t.out15))],
      ['Giro 5+15 (s)', ...tt.map(t => f(t.turnTime))],
      ['Contacto en pared (s)', ...tt.map(t => f(t.contact))],
      ['Break out (m)', ...tt.map(t => f(t.breakoutDist))],
      ['Vel. subacuática (m/s)', ...tt.map(t => f(t.underwaterSpeed))],
    ]);
  }

  // por largo + gráfico
  footer(); doc.addPage(); page++; header('Por largo');
  h2('Resumen por largo');
  const laps = res.laps;
  table(['Largo', ...laps.map(l => l.lap)], [
    ['Parcial (s)', ...laps.map(l => f(l.split))],
    ['Acumulado (s)', ...laps.map(l => f(l.cumulative))],
    ['Ciclos', ...laps.map(l => l.cycles ?? '-')],
    ['Vel. nado limpio (m/s)', ...laps.map(l => f(l.cleanSpeed))],
    ['Frecuencia (ciclos/min)', ...laps.map(l => f(l.strokeRate, 1))],
    ['Dist. por ciclo (m)', ...laps.map(l => f(l.dps))],
  ]);
  // gráfico de velocidad y frecuencia por tramo
  const pts = secs.filter(s => Number.isFinite(s.speed));
  if (pts.length >= 2) {
    h2('Velocidad y frecuencia por tramo');
    const gx = M + 12, gw = PW - 2 * M - 24, gh = 52, gy = y;
    const vmin = Math.floor(Math.min(...pts.map(s => s.speed)) * 10) / 10, vmax = Math.ceil(Math.max(...pts.map(s => s.speed)) * 10) / 10 || 1;
    const X = (d) => gx + (d / cfg.distance) * gw;
    const Yv = (v) => gy + gh - (v - vmin) / ((vmax - vmin) || 1) * gh;
    doc.setDrawColor(...LINE); doc.setLineWidth(0.2);
    for (let k = 0; k <= 4; k++) {
      const v = vmin + (vmax - vmin) * k / 4;
      doc.line(gx, Yv(v), gx + gw, Yv(v));
      doc.setFontSize(7); doc.setTextColor(...GREY); doc.text(f(v, 2), gx - 2, Yv(v) + 1, { align: 'right' });
    }
    for (let d = 0; d <= cfg.distance; d += cfg.poolLength) { doc.text(`${d} m`, X(d), gy + gh + 4, { align: 'center' }); }
    doc.setDrawColor(...ACC); doc.setLineWidth(0.7);
    const mid = (s) => (s.from + s.dist) / 2;
    for (let i = 1; i < pts.length; i++) doc.line(X(mid(pts[i - 1])), Yv(pts[i - 1].speed), X(mid(pts[i])), Yv(pts[i].speed));
    doc.setFillColor(...ACC);
    pts.forEach(s => doc.circle(X(mid(s)), Yv(s.speed), 0.8, 'F'));
    const srs = secs.filter(s => Number.isFinite(s.strokeRate));
    if (srs.length >= 2) {
      const smin = Math.floor(Math.min(...srs.map(s => s.strokeRate)) / 5) * 5, smax = Math.ceil(Math.max(...srs.map(s => s.strokeRate)) / 5) * 5 || 1;
      const Ys = (v) => gy + gh - (v - smin) / ((smax - smin) || 1) * gh;
      doc.setDrawColor(...INK); doc.setLineWidth(0.4);
      for (let i = 1; i < srs.length; i++) doc.line(X(mid(srs[i - 1])), Ys(srs[i - 1].strokeRate), X(mid(srs[i])), Ys(srs[i].strokeRate));
      doc.setFontSize(7); doc.setTextColor(...GREY);
      doc.text(`${smax}`, gx + gw + 2, Ys(smax) + 1); doc.text(`${smin}`, gx + gw + 2, Ys(smin) + 1);
    }
    y = gy + gh + 9;
    doc.setFontSize(8); doc.setTextColor(...ACC); doc.text('Velocidad (m/s, eje izquierdo)', gx, y);
    doc.setTextColor(...INK); doc.text('Frecuencia (ciclos/min, eje derecho)', gx + 60, y);
    y += 6;
  }

  // velocidad continua (línea seguida + referencias de distancia)
  if (speed) {
    const sp = speed.sp;
    if (y > PH - 95) { footer(); doc.addPage(); page++; header('Velocidad'); }
    h2('Velocidad continua');
    const gx = M + 12, gw = PW - 2 * M - 16, gh = 55, gy = y;
    const d0 = Math.min(...sp.map(s => s.d)), d1 = Math.max(...sp.map(s => s.d)) || d0 + 1;
    const lo = Math.max(0, Math.floor(Math.min(...sp.map(s => s.v - s.sv)) * 2) / 2), hi = Math.ceil(Math.max(...sp.map(s => s.v + s.sv)) * 2) / 2;
    const X = (d) => gx + (d - d0) / ((d1 - d0) || 1) * gw, Yv = (v) => gy + gh - (v - lo) / ((hi - lo) || 1) * gh;
    doc.setDrawColor(...LINE); doc.setLineWidth(0.2); doc.setFontSize(7); doc.setTextColor(...GREY);
    const stepV = (hi - lo) > 3 ? 1 : 0.5;
    for (let v = lo; v <= hi + 1e-9; v += stepV) { doc.line(gx, Yv(v), gx + gw, Yv(v)); doc.text(f(v, 1), gx - 2, Yv(v) + 1, { align: 'right' }); }
    doc.text('m/s', gx - 2, gy - 3, { align: 'right' });
    const stepD = (d1 - d0) > 20 ? 5 : (d1 - d0) > 8 ? 2 : 1;
    for (let d = Math.ceil(d0 / stepD) * stepD; d <= d1; d += stepD) doc.text(`${d} m`, X(d), gy + gh + 4, { align: 'center' });
    // banda del margen
    const band = [...sp.map(s => [X(s.d), Yv(s.v + s.sv)]), ...sp.slice().reverse().map(s => [X(s.d), Yv(Math.max(lo, s.v - s.sv))])];
    doc.setFillColor(205, 228, 238);
    doc.lines(band.slice(1).map((p, i) => [p[0] - band[i][0], p[1] - band[i][1]]), band[0][0], band[0][1], [1, 1], 'F', true);
    doc.setDrawColor(...ACC); doc.setLineWidth(0.6);
    for (let i = 1; i < sp.length; i++) doc.line(X(sp[i - 1].d), Yv(sp[i - 1].v), X(sp[i].d), Yv(sp[i].v));
    y = gy + gh + 9;
    const vmax = sp.reduce((a, s) => (s.v > a.v ? s : a), sp[0]), mErr = sp.reduce((a, s) => a + s.sv, 0) / sp.length;
    const ser = speed.series, mean = (ser[ser.length - 1].d - ser[0].d) / (ser[ser.length - 1].t - ser[0].t);
    doc.setFontSize(8.5); doc.setTextColor(...INK);
    doc.text(`Máxima ${f(vmax.v)} m/s a ${f(vmax.d, 1)} m · media del tramo ${f(mean)} m/s · margen medio ±${f(mErr)} m/s (banda celeste).`, M, y); y += 6;
    if (speed.segs.length) {
      table(['Tramo', ...speed.segs.slice(0, 12).map(g => `${f(g.from, 0)}-${f(g.to, 0)}`)], [
        ['Tiempo (s)', ...speed.segs.slice(0, 12).map(g => f(g.time))],
        ['Velocidad (m/s)', ...speed.segs.slice(0, 12).map(g => f(g.speed))],
      ]);
    }
    doc.setFontSize(8); doc.setTextColor(...GREY);
    doc.text(doc.splitTextToSize('Velocidad del punto seguido (la cabeza) calculada cuadro a cuadro con las referencias de distancia del andarivel. Vale con la cámara fija durante todo el tramo.', PW - 2 * M), M, y); y += 9;
  }

  // verificación de la precisión con distancias conocidas
  if (checks.length) {
    if (y > PH - 50) { footer(); doc.addPage(); page++; header('Precisión'); }
    h2('Verificación de la cámara');
    doc.setFontSize(8.5); doc.setTextColor(...INK);
    for (const c of checks) {
      const t = `Distancia real ${f(c.real, 2)} m, medida ${f(c.measured, 2)} m con la calibración: error ${c.err >= 0 ? '+' : ''}${f(c.err, 2)} m (${c.pct >= 0 ? '+' : ''}${f(c.pct, 1)} %)${c.method ? `, ${c.method}` : ''}.`;
      doc.text(doc.splitTextToSize(t, PW - 2 * M), M, y); y += 5;
    }
    doc.setFontSize(8); doc.setTextColor(...GREY);
    doc.text(doc.splitTextToSize('Dos marcas a distancia conocida, filmadas con la misma cámara y no usadas para calibrar. Las distancias y velocidades de este informe tienen, como mínimo, ese error relativo.', PW - 2 * M), M, y); y += 9;
  }

  // comparación
  if (ref) {
    footer(); doc.addPage(); page++; header('Comparación');
    h2(`Comparación con ${ref.cfg.swimmer}${ref.cfg.event ? ' · ' + ref.cfg.event : ''}${ref.cfg.date ? ' · ' + ref.cfg.date : ''}`);
    const c = compare(res, ref.res);
    const rows = c.rows.slice(0, 12);
    const col = (v, lowerBetter) => (Number.isFinite(v) && Math.abs(v) > 1e-9 ? ((v < 0) === lowerBetter ? GREEN : RED) : null);
    const sgn = (v, d = 2) => (Number.isFinite(v) ? (v > 0 ? '+' : '') + f(v, d) : '-');
    table(['Marca (m)', ...rows.map(r => r.dist)], [
      ['Δ T total (s)', ...rows.map(r => sgn(r.cumulative))],
      ['Δ T parcial (s)', ...rows.map(r => sgn(r.partial))],
      ['Δ Velocidad (m/s)', ...rows.map(r => sgn(r.speed))],
      ['Δ Frecuencia (c/min)', ...rows.map(r => sgn(r.strokeRate, 1))],
      ['Δ Dist. por ciclo (m)', ...rows.map(r => sgn(r.dps))],
    ], {
      colorFn: (ri, ci) => {
        const r = rows[ci];
        return [col(r.cumulative, true), col(r.partial, true), col(r.speed, false), null, col(r.dps, false)][ri];
      },
    });
    doc.setFontSize(8); doc.setTextColor(...GREY);
    doc.text('Diferencia = este análisis menos la referencia. Verde: mejor; rojo: peor. La frecuencia no se colorea.', M, y);
    y += 6;
  }

  // ángulos medidos sobre el cuadro
  if (angles.length) {
    footer(); doc.addPage(); page++; header('Ángulos');
    h2('Ángulos medidos sobre el video');
    const t0 = res.sync?.t0;
    const list = angles.slice().sort((a, b) => a.t - b.t);
    table(['Ángulo', ...list.slice(0, 12).map((_, i) => i + 1)], [
      ['Nombre', ...list.slice(0, 12).map(a => a.label.length > 14 ? a.label.slice(0, 13) + '…' : a.label)],
      ['Tiempo de carrera (s)', ...list.slice(0, 12).map(a => Number.isFinite(t0) ? f(a.t - t0) : '-')],
      ['Valor (°)', ...list.slice(0, 12).map(a => f(angleValue(a), 1))],
      ['Tipo', ...list.slice(0, 12).map(a => ({ '3p': '3 puntos', h: 'horizontal', v: 'vertical' })[a.type])],
    ], { labelW: 40 });
    if (list.length > 12) { doc.setFontSize(8); doc.setTextColor(...GREY); doc.text(`Se muestran 12 de ${list.length} ángulos; el CSV tiene la lista completa.`, M, y); y += 5; }
    // fotogramas con los ángulos dibujados, de a 2 por fila
    const colW = (PW - 2 * M - 8) / 2;
    let col = 0, rowH = 0;
    for (const fr of angleFrames) {
      const c = fr.canvas, h = Math.min(70, colW * c.height / c.width), w = h * c.width / c.height;
      if (col === 0 && y + h + 10 > PH - 12) { footer(); doc.addPage(); page++; header('Ángulos'); }
      const x = M + col * (colW + 8);
      doc.addImage(c.toDataURL('image/jpeg', 0.85), 'JPEG', x, y, w, h);
      doc.setFontSize(7.5); doc.setTextColor(...GREY); doc.setFont('helvetica', 'normal');
      const names = angles.filter(a => Math.abs(a.t - fr.t) < frameDur * 0.5).map(a => `${a.label} ${f(angleValue(a), 1)}°`).join(' · ');
      doc.text(doc.splitTextToSize(`${Number.isFinite(t0) ? f(fr.t - t0) + ' s · ' : ''}${names}`, colW)[0], x, y + h + 3.5);
      rowH = Math.max(rowH, h + 8); col++;
      if (col === 2) { col = 0; y += rowH; rowH = 0; }
    }
    if (col) y += rowH;
    doc.setFontSize(8); doc.setTextColor(...GREY);
    doc.text('Ángulos 2D en el plano de la imagen, marcados por el analista. Dependen de la posición de la cámara respecto del nadador.', M, y + 2); y += 8;
  }

  // notas de método
  if (y > PH - 50) { footer(); doc.addPage(); page++; header('Método'); }
  h2('Método y precisión');
  const syncTxt = res.sync.method === 'oficial' ? `Tiempo cero sincronizado con el tiempo oficial (${f(cfg.officialTime)} s) en el cuadro de llegada.`
    : res.sync.method === 'sonido' ? `Tiempo cero en la señal sonora, corregida ${f(res.sync.delay * 1000, 0)} ms por la distancia de la cámara a los bloques (${f(cfg.cameraDistance, 0)} m).`
      : 'Tiempo cero en la señal marcada.';
  const notes = [
    syncTxt,
    `Cada evento se marcó con una resolución de un cuadro (±${f(frameDur * 1000, 0)} ms).`,
    'Parciales y velocidades se calculan con la cabeza como referencia al cruzar cada marca. La lectura de marcas lejanas depende del ángulo de la cámara (paralaje).',
    'Frecuencia en ciclos por minuto (1 ciclo = una vuelta completa de un brazo en crol y espalda, una brazada simultánea en pecho y mariposa). Distancia por ciclo = velocidad / frecuencia, solo en tramos de nado limpio.',
    'Las distancias de break out las ingresa o mide el analista sobre el cuadro.',
    ...res.warnings,
  ];
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5); doc.setTextColor(...INK);
  for (const n of notes) {
    const lines = doc.splitTextToSize('• ' + n, PW - 2 * M);
    doc.text(lines, M, y); y += lines.length * 4 + 1;
  }
  footer();
  return doc.output('blob');
}
