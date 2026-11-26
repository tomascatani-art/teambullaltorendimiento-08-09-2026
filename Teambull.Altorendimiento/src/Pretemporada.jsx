import React, { useState } from "react";
import { createPortal } from "react-dom";

/* =========================================================
   PRETEMPORADA (periodización, como la Planificación de hrtraining)
   El coach arma la pretemporada por fases (mesociclos) y semanas (microciclos), con volumen e
   intensidad de 1 a 10, tipo de semana y capacidades a desarrollar. Se copia a cada alumno/a
   elegido en alumno.pretemporadas (mismo id en todas las copias, igual que la planificación de
   agua), así viaja con el resto de sus datos y no hace falta tocar la sincronización.
   ========================================================= */

const C = { fondo: "#121017", card: "#1C1A24", borde: "#322E3D", input: "#26232F", texto: "#F4F1EA", gris: "#8B8698", gris2: "#C9C5D2", naranja: "#FF6B35", verde: "#7DD6C0" };
const ACENTO = "#FF6B35";

export const FASES_PRE = {
  GENERAL: { label: "Preparatorio general", corto: "General", color: "#7DD6C0", hint: "Volumen alto, intensidad moderada. Base." },
  ESPECIFICO: { label: "Preparatorio específico", corto: "Específico", color: "#4FC3F7", hint: "Pasa al gesto de la prueba, sube la intensidad." },
  PRECOMPETITIVO: { label: "Precompetitivo", corto: "Precomp.", color: "#B39DDB", hint: "Intensidad alta, el volumen baja." },
  PUESTA_A_PUNTO: { label: "Puesta a punto", corto: "Taper", color: "#FFD166", hint: "Baja el volumen y se mantiene la intensidad (taper)." },
  COMPETITIVO: { label: "Competitivo", corto: "Competitivo", color: "#FF6B35", hint: "Mantener el rendimiento y cuidar la fatiga." },
  TRANSICION: { label: "Transición", corto: "Transición", color: "#81C784", hint: "Recuperación activa." },
};
export const TIPOS_SEMANA = {
  CARGA: { label: "Carga", factor: 1, color: null },
  CHOQUE: { label: "Choque", factor: 1.25, color: "#E85D5D" },
  RECUPERACION: { label: "Recuperación", factor: 0.55, color: "#81C784" },
  ACTIVACION: { label: "Activación", factor: 0.7, color: "#FFD166" },
  COMPETENCIA: { label: "Competencia", factor: 0.8, color: "#FF6B35" },
};
export const CAPACIDADES = {
  RES_AEROBICA: "Resistencia aeróbica",
  RES_ANAEROBICA: "Resistencia anaeróbica",
  FUERZA_MAXIMA: "Fuerza máxima",
  FUERZA_RES: "Fuerza-resistencia",
  POTENCIA: "Potencia",
  HIPERTROFIA: "Hipertrofia",
  VELOCIDAD: "Velocidad",
  TECNICA: "Técnica",
  MOVILIDAD: "Movilidad",
  ESTABILIDAD: "Estabilidad / core",
};

let _n = 0;
const nid = () => `pt${Date.now().toString(36)}${(_n++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const hoyISO = () => new Date().toISOString().slice(0, 10);
const sumarDias = (iso, d) => { const t = new Date(iso + "T00:00:00"); t.setDate(t.getDate() + d); return t.toISOString().slice(0, 10); };
const diasEntre = (a, b) => Math.round((new Date(b + "T00:00:00") - new Date(a + "T00:00:00")) / 86400000);
const fechaCorta = (iso) => { try { return new Date(iso + "T00:00:00").toLocaleDateString("es-AR", { day: "numeric", month: "short" }); } catch { return iso; } };
const corto = (n) => { const p = String(n || "").trim().split(/\s+/); return p.length > 1 ? `${p[0]} ${p[p.length - 1][0]}.` : p[0] || "—"; };
const lim = (v) => Math.max(1, Math.min(10, Math.round(v)));

// Estructura sugerida para una pretemporada (proporciones clásicas de periodización por bloques).
const MOLDE = [
  { nombre: "Acumulación — base general", fase: "GENERAL", parte: 0.4, caps: ["RES_AEROBICA", "FUERZA_RES", "HIPERTROFIA", "MOVILIDAD", "TECNICA"], vol: 8, int: 4 },
  { nombre: "Transformación — específico", fase: "ESPECIFICO", parte: 0.3, caps: ["FUERZA_MAXIMA", "RES_AEROBICA", "RES_ANAEROBICA", "TECNICA"], vol: 7, int: 7 },
  { nombre: "Realización — precompetitivo", fase: "PRECOMPETITIVO", parte: 0.2, caps: ["POTENCIA", "VELOCIDAD", "RES_ANAEROBICA"], vol: 5, int: 8 },
  { nombre: "Puesta a punto", fase: "PUESTA_A_PUNTO", parte: 0.1, caps: ["VELOCIDAD", "POTENCIA"], vol: 3, int: 9 },
];
// Semanas de un mesociclo: 3 de carga y 1 de recuperación, choque antes de la última, y la puesta a punto termina en activación.
function semanasDeFase(f) {
  return Array.from({ length: f.semanas }, (_, w) => {
    const n = f.semanas;
    const tipo = f.fase === "TRANSICION" ? "RECUPERACION" : f.fase === "PUESTA_A_PUNTO" ? (w === n - 1 ? "ACTIVACION" : "CARGA") : f.fase === "COMPETITIVO" ? (w % 2 ? "COMPETENCIA" : "CARGA") : (w + 1) % 4 === 0 ? "RECUPERACION" : w === n - 2 && n >= 3 ? "CHOQUE" : "CARGA";
    return { id: nid(), tipo, vol: lim(f.vol * TIPOS_SEMANA[tipo].factor), int: lim(f.int + (tipo === "CHOQUE" ? 1 : tipo === "RECUPERACION" ? -2 : 0)), nota: "" };
  });
}
export function estructuraSugerida(totalSemanas) {
  let quedan = totalSemanas;
  const fases = [];
  MOLDE.forEach((m, i) => {
    const s = i === MOLDE.length - 1 ? quedan : Math.max(1, Math.round(totalSemanas * m.parte));
    const w = Math.min(s, quedan - (MOLDE.length - 1 - i));
    if (w <= 0) return;
    quedan -= w;
    fases.push({ id: nid(), nombre: m.nombre, fase: m.fase, semanas: w, caps: [...m.caps], vol: m.vol, int: m.int, nota: "" });
  });
  return { fases, semanas: fases.flatMap(semanasDeFase) };
}
export function nuevaPretemporada() {
  const inicio = hoyISO();
  const total = 10;
  return { id: nid(), titulo: "Pretemporada", inicio, objetivoFecha: sumarDias(inicio, total * 7), objetivo: "", nota: "", ...estructuraSugerida(total) };
}
const totalSemanas = (p) => (p.fases || []).reduce((t, f) => t + (Number(f.semanas) || 0), 0);
// Cada semana con su fase y fechas.
export function semanasConFase(p) {
  const out = [];
  let i = 0;
  (p.fases || []).forEach((f) => {
    for (let w = 0; w < f.semanas; w++, i++) {
      const s = (p.semanas || [])[i] || { id: `x${i}`, tipo: "CARGA", vol: f.vol || 5, int: f.int || 5, nota: "" };
      out.push({ ...s, n: i + 1, fase: f, desde: sumarDias(p.inicio, i * 7), hasta: sumarDias(p.inicio, i * 7 + 6) });
    }
  });
  return out;
}
export function semanaActual(p) {
  const d = diasEntre(p.inicio, hoyISO());
  const total = totalSemanas(p);
  if (d < 0) return { estado: "antes", faltan: -d };
  const n = Math.floor(d / 7);
  if (n >= total) return { estado: "termino" };
  return { estado: "en curso", semana: semanasConFase(p)[n] };
}
// Todas las pretemporadas que hay entre los alumnos/as, una vez cada una.
export function pretemporadasDelPlantel(alumnos) {
  const mapa = new Map();
  alumnos.forEach((a) => (a.pretemporadas || []).forEach((p) => {
    const e = mapa.get(p.id);
    if (e) e.alumnoIds.push(a.id); else mapa.set(p.id, { plan: p, alumnoIds: [a.id] });
  }));
  return [...mapa.values()].sort((x, y) => (y.plan.inicio || "").localeCompare(x.plan.inicio || ""));
}
// Al cambiar la cantidad de semanas de una fase se rearma la lista de semanas, conservando lo que ya estaba cargado.
function reacomodar(p, fases) {
  const viejas = semanasConFase(p);
  const semanas = [];
  fases.forEach((f) => {
    const deEsta = viejas.filter((s) => s.fase.id === f.id);
    const nuevas = semanasDeFase(f);
    for (let w = 0; w < f.semanas; w++) {
      const v = deEsta[w];
      semanas.push(v ? { id: v.id, tipo: v.tipo, vol: v.vol, int: v.int, nota: v.nota } : nuevas[w]);
    }
  });
  return { ...p, fases, semanas };
}

/* ---------- piezas visuales ---------- */
const colorSemana = (s) => TIPOS_SEMANA[s.tipo]?.color || s.fase.color;

function Chip({ color, children, activo = true, onClick }) {
  return <span onClick={onClick} className="font-body" style={{ display: "inline-block", border: `1px solid ${activo ? color : C.borde}`, background: activo ? `${color}22` : "transparent", color: activo ? C.texto : C.gris, borderRadius: 999, fontSize: 10.5, fontWeight: 600, padding: "3px 8px", cursor: onClick ? "pointer" : "default", whiteSpace: "nowrap" }}>{children}</span>;
}
function Caja({ titulo, extra, children, estilo }) {
  return (
    <div style={{ background: C.card, border: `1px solid ${C.borde}`, borderRadius: 14, padding: 12, marginBottom: 10, ...estilo }}>
      {titulo && <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}><span className="font-display" style={{ color: C.texto, fontSize: 15, fontWeight: 700 }}>{titulo}</span>{extra}</div>}
      {children}
    </div>
  );
}

// Línea de tiempo: fila de fases (mesociclos) y una barra por semana (alto = volumen, color = fase o tipo de semana), con HOY.
export function LineaTiempoPre({ plan, seleccion, onElegir }) {
  const semanas = semanasConFase(plan);
  const total = semanas.length || 1;
  const act = semanaActual(plan);
  const hoyPos = act.estado === "en curso" ? ((diasEntre(plan.inicio, hoyISO()) / 7) / total) * 100 : null;
  const meses = [];
  for (let i = 0; i < semanas.length; i++) { const m = semanas[i].desde.slice(0, 7); if (!meses.length || meses[meses.length - 1].m !== m) meses.push({ m, i }); }
  return (
    <div style={{ position: "relative", paddingTop: 14 }}>
      <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 12 }}>
        {meses.map(({ m, i }) => <span key={m} className="font-body" style={{ position: "absolute", left: `${(i / total) * 100}%`, color: C.gris, fontSize: 9, textTransform: "capitalize" }}>{(() => { const t = new Date(m + "-02T00:00:00").toLocaleDateString("es-AR", { month: "short" }).replace(".", ""); return t.charAt(0).toUpperCase() + t.slice(1); })()}</span>)}
      </div>
      <div style={{ display: "flex", gap: 2, marginBottom: 4 }}>
        {(plan.fases || []).map((f) => (
          <div key={f.id} title={f.nombre} style={{ flex: f.semanas, minWidth: 0, background: FASES_PRE[f.fase]?.color || C.gris, borderRadius: 6, padding: "4px 5px", overflow: "hidden" }}>
            <span className="font-body" style={{ display: "block", color: "#121017", fontSize: 9.5, fontWeight: 800, lineHeight: 1.15, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{FASES_PRE[f.fase]?.corto || f.nombre}</span>
            <span className="font-body" style={{ display: "block", color: "#121017aa", fontSize: 8.5, fontWeight: 700 }}>{f.semanas} sem</span>
          </div>
        ))}
      </div>
      <div style={{ display: "flex", gap: 2, alignItems: "flex-end", height: 64 }}>
        {semanas.map((s, i) => (
          <button key={s.id + i} onClick={onElegir ? () => onElegir(i) : undefined} title={`Semana ${s.n} · ${TIPOS_SEMANA[s.tipo]?.label} · Vol ${s.vol} · Int ${s.int}`}
            style={{ flex: 1, minWidth: 0, height: `${s.vol * 10}%`, background: colorSemana({ ...s, fase: FASES_PRE[s.fase.fase] || {} }), opacity: seleccion === i ? 1 : 0.85, border: seleccion === i ? "2px solid #F4F1EA" : "none", borderRadius: "4px 4px 0 0", padding: 0, cursor: onElegir ? "pointer" : "default" }} />
        ))}
      </div>
      <div style={{ display: "flex", gap: 2, marginTop: 3 }}>
        {semanas.map((s, i) => <span key={i} className="font-body" style={{ flex: 1, minWidth: 0, textAlign: "center", color: seleccion === i ? C.texto : C.gris, fontSize: 8.5, fontWeight: 700 }}>{s.n}</span>)}
      </div>
      {hoyPos !== null && (
        <div style={{ position: "absolute", top: 12, bottom: 12, left: `${hoyPos}%`, width: 2, background: "#F4F1EA", pointerEvents: "none" }}>
          <span className="font-body" style={{ position: "absolute", top: -12, left: -12, background: "#F4F1EA", color: "#121017", fontSize: 8, fontWeight: 800, borderRadius: 3, padding: "0 3px" }}>HOY</span>
        </div>
      )}
    </div>
  );
}

// Dinámica de volumen (barras) e intensidad (línea), escala 1 a 10.
export function DinamicaPre({ plan }) {
  const semanas = semanasConFase(plan);
  const W = 320, H = 130, iz = 18, ab = 16, ar = 6;
  const n = semanas.length || 1;
  const paso = (W - iz) / n;
  const y = (v) => ar + (H - ar - ab) * (1 - v / 10);
  const pts = semanas.map((s, i) => `${iz + paso * i + paso / 2},${y(s.int)}`).join(" ");
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", display: "block", fontFamily: "Inter, sans-serif" }}>
        {[0, 5, 10].map((v) => <g key={v}><line x1={iz} x2={W} y1={y(v)} y2={y(v)} stroke="#26232F" /><text x={iz - 4} y={y(v) + 3} fill="#8B8698" fontSize="8" textAnchor="end">{v}</text></g>)}
        {semanas.map((s, i) => <rect key={i} x={iz + paso * i + paso * 0.15} width={paso * 0.7} y={y(s.vol)} height={y(0) - y(s.vol)} rx="2" fill={FASES_PRE[s.fase.fase]?.color || "#888"} fillOpacity="0.55" />)}
        <polyline points={pts} fill="none" stroke={ACENTO} strokeWidth="2" />
        {semanas.map((s, i) => <circle key={i} cx={iz + paso * i + paso / 2} cy={y(s.int)} r="2.6" fill={ACENTO} />)}
        {semanas.map((s, i) => (i % Math.ceil(n / 12) === 0 ? <text key={`t${i}`} x={iz + paso * i + paso / 2} y={H - 4} fill="#8B8698" fontSize="7.5" textAnchor="middle">S{s.n}</text> : null))}
      </svg>
      <div className="font-body" style={{ display: "flex", gap: 14, justifyContent: "center", color: C.gris, fontSize: 10.5, marginTop: 2 }}>
        <span><span style={{ display: "inline-block", width: 9, height: 9, borderRadius: 2, background: "#7DD6C099", marginRight: 4 }} />Volumen</span>
        <span><span style={{ display: "inline-block", width: 9, height: 2, background: ACENTO, marginRight: 4, verticalAlign: "middle" }} />Intensidad</span>
      </div>
    </div>
  );
}

function Leyenda() {
  return (
    <div className="font-body" style={{ display: "flex", flexWrap: "wrap", gap: 10, color: C.gris, fontSize: 9.5, marginTop: 8 }}>
      <span>Alto de la barra = volumen</span>
      {["CHOQUE", "RECUPERACION", "ACTIVACION"].map((k) => <span key={k}><span style={{ display: "inline-block", width: 8, height: 8, borderRadius: 2, background: TIPOS_SEMANA[k].color, marginRight: 4 }} />{TIPOS_SEMANA[k].label}</span>)}
    </div>
  );
}

// Lo que se ve de una pretemporada (coach y alumno): resumen, línea de tiempo, dinámica, fases y semanas.
export function VistaPretemporada({ plan, pie }) {
  const semanas = semanasConFase(plan);
  const act = semanaActual(plan);
  const [sel, setSel] = useState(act.estado === "en curso" ? act.semana.n - 1 : 0);
  const s = semanas[sel];
  const fin = sumarDias(plan.inicio, semanas.length * 7 - 1);
  return (
    <div>
      <Caja>
        <div className="font-body" style={{ color: ACENTO, fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.3 }}>{fechaCorta(plan.inicio)} → {fechaCorta(fin)} · {semanas.length} semanas</div>
        <div className="font-display" style={{ color: C.texto, fontSize: 20, fontWeight: 700, margin: "2px 0 4px" }}>{plan.titulo || "Pretemporada"}</div>
        {plan.objetivo && <div className="font-body" style={{ color: C.gris2, fontSize: 12, marginBottom: 6 }}>🎯 {plan.objetivo}</div>}
        {act.estado === "en curso" && <EstadoHoy semana={act.semana} total={semanas.length} />}
        {act.estado === "antes" && <div className="font-body" style={{ color: C.gris, fontSize: 12 }}>Empieza en {act.faltan} día{act.faltan === 1 ? "" : "s"}.</div>}
        {act.estado === "termino" && <div className="font-body" style={{ color: C.gris, fontSize: 12 }}>Terminó el {fechaCorta(fin)}.</div>}
      </Caja>
      <Caja titulo="Estructura de la pretemporada">
        <LineaTiempoPre plan={plan} seleccion={sel} onElegir={setSel} />
        <Leyenda />
      </Caja>
      {s && (
        <Caja estilo={{ borderColor: FASES_PRE[s.fase.fase]?.color }}>
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8 }}>
            <span className="font-display" style={{ color: C.texto, fontSize: 16, fontWeight: 700 }}>Semana {s.n} <span className="font-body" style={{ color: C.gris, fontSize: 11, fontWeight: 400 }}>{fechaCorta(s.desde)} – {fechaCorta(s.hasta)}</span></span>
            <Chip color={colorSemana({ ...s, fase: FASES_PRE[s.fase.fase] || {} })}>{TIPOS_SEMANA[s.tipo]?.label}</Chip>
          </div>
          <div className="font-body" style={{ color: FASES_PRE[s.fase.fase]?.color, fontSize: 11.5, fontWeight: 700, margin: "4px 0 8px" }}>{s.fase.nombre}</div>
          <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
            <Medidor label="Volumen" v={s.vol} color={FASES_PRE[s.fase.fase]?.color} />
            <Medidor label="Intensidad" v={s.int} color={ACENTO} />
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>{(s.fase.caps || []).map((k, i) => <Chip key={k} color={i === 0 ? ACENTO : C.verde}>{CAPACIDADES[k] || k}</Chip>)}</div>
          {(s.nota || s.fase.nota) && <div className="font-body" style={{ color: C.gris2, fontSize: 12, marginTop: 8, whiteSpace: "pre-wrap" }}>📝 {s.nota || s.fase.nota}</div>}
        </Caja>
      )}
      <Caja titulo="Volumen e intensidad" extra={<span className="font-body" style={{ color: C.gris, fontSize: 10 }}>escala 1-10</span>}>
        <DinamicaPre plan={plan} />
      </Caja>
      <Caja titulo="Fases">
        {(plan.fases || []).map((f, i) => (
          <div key={f.id} style={{ borderTop: i ? `1px solid ${C.input}` : "none", padding: "8px 0" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ width: 10, height: 10, borderRadius: 3, background: FASES_PRE[f.fase]?.color, flexShrink: 0 }} />
              <span className="font-body" style={{ color: C.texto, fontSize: 13, fontWeight: 700, flex: 1 }}>{f.nombre}</span>
              <span className="font-body" style={{ color: C.gris, fontSize: 11 }}>{f.semanas} sem</span>
            </div>
            <div className="font-body" style={{ color: C.gris, fontSize: 10.5, margin: "2px 0 5px 18px" }}>{FASES_PRE[f.fase]?.hint}</div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginLeft: 18 }}>{(f.caps || []).map((k, j) => <Chip key={k} color={j === 0 ? ACENTO : C.verde}>{CAPACIDADES[k] || k}</Chip>)}</div>
          </div>
        ))}
      </Caja>
      {plan.nota && <Caja><div className="font-body" style={{ color: C.gris2, fontSize: 12, whiteSpace: "pre-wrap" }}>📝 {plan.nota}</div></Caja>}
      {pie}
    </div>
  );
}
function Medidor({ label, v, color }) {
  return (
    <div style={{ flex: 1, background: C.input, borderRadius: 10, padding: "7px 9px" }}>
      <div style={{ display: "flex", justifyContent: "space-between" }}><span className="font-body" style={{ color: C.gris, fontSize: 10.5 }}>{label}</span><span className="font-display" style={{ color: C.texto, fontSize: 15, fontWeight: 700 }}>{v}<span style={{ color: C.gris, fontSize: 10 }}>/10</span></span></div>
      <div style={{ height: 5, background: "#121017", borderRadius: 3, marginTop: 4 }}><div style={{ width: `${v * 10}%`, height: "100%", background: color, borderRadius: 3 }} /></div>
    </div>
  );
}
function EstadoHoy({ semana, total }) {
  const col = FASES_PRE[semana.fase.fase]?.color;
  return (
    <div style={{ marginTop: 4 }}>
      <div className="font-body" style={{ display: "flex", justifyContent: "space-between", color: C.texto, fontSize: 12, fontWeight: 700, marginBottom: 4 }}>
        <span>Semana {semana.n} de {total} · <span style={{ color: col }}>{FASES_PRE[semana.fase.fase]?.corto}</span></span>
        <span style={{ color: C.gris }}>{Math.round((semana.n / total) * 100)}%</span>
      </div>
      <div style={{ height: 6, background: C.input, borderRadius: 3 }}><div style={{ width: `${(semana.n / total) * 100}%`, height: "100%", background: col, borderRadius: 3 }} /></div>
    </div>
  );
}

/* ---------- editor del coach ---------- */
const inp = { background: C.input, border: `1px solid ${C.borde}`, borderRadius: 8, color: C.texto, fontSize: 13, padding: "8px 9px", boxSizing: "border-box", outline: "none", minWidth: 0 };
const btnChico = { background: C.input, border: "none", borderRadius: 8, color: C.texto, fontSize: 14, fontWeight: 700, width: 28, height: 28, cursor: "pointer", padding: 0 };

function EditorPretemporada({ inicial, alumnoIdsIniciales, alumnos, plantelGrupos, onGuardar, onCancelar }) {
  const [p, setP] = useState(inicial);
  const [para, setPara] = useState(alumnoIdsIniciales || []);
  const [semSel, setSemSel] = useState(null);
  const activos = alumnos.filter((a) => a.activo !== false);
  const total = totalSemanas(p);
  const semanas = semanasConFase(p);
  const setFase = (fid, cambios) => setP((x) => reacomodar(x, x.fases.map((f) => (f.id === fid ? { ...f, ...cambios } : f))));
  const setSemana = (i, cambios) => setP((x) => ({ ...x, semanas: x.semanas.map((s, j) => (j === i ? { ...s, ...cambios } : s)) }));
  const rearmar = (n) => setP((x) => ({ ...x, ...estructuraSugerida(n), objetivoFecha: sumarDias(x.inicio, n * 7) }));
  const todosMarcados = activos.length > 0 && activos.every((a) => para.includes(a.id));
  const toggle = (id) => setPara((l) => (l.includes(id) ? l.filter((x) => x !== id) : [...l, id]));
  const s = semSel !== null ? semanas[semSel] : null;
  return (
    <div>
      <Caja>
        <input value={p.titulo} onChange={(e) => setP({ ...p, titulo: e.target.value })} placeholder="Nombre (ej: Pretemporada 2027)" className="font-body" style={{ ...inp, width: "100%", marginBottom: 8, fontSize: 15, fontWeight: 700 }} />
        <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
          <label style={{ flex: 1 }}><span className="font-body" style={{ display: "block", color: C.gris, fontSize: 10.5, marginBottom: 3 }}>Empieza</span>
            <input type="date" value={p.inicio} onChange={(e) => setP({ ...p, inicio: e.target.value, objetivoFecha: sumarDias(e.target.value, total * 7) })} className="font-body" style={{ ...inp, width: "100%" }} /></label>
          <label style={{ flex: 1 }}><span className="font-body" style={{ display: "block", color: C.gris, fontSize: 10.5, marginBottom: 3 }}>Competencia objetivo</span>
            <input type="date" value={p.objetivoFecha} onChange={(e) => { const n = Math.max(3, Math.min(24, Math.round(diasEntre(p.inicio, e.target.value) / 7))); setP((x) => ({ ...x, objetivoFecha: e.target.value })); if (e.target.value && n !== total) rearmar(n); }} className="font-body" style={{ ...inp, width: "100%" }} /></label>
        </div>
        <input value={p.objetivo} onChange={(e) => setP({ ...p, objetivo: e.target.value })} placeholder="Objetivo (ej: llegar en pico al Nacional)" className="font-body" style={{ ...inp, width: "100%", marginBottom: 10 }} />
        <div style={{ display: "flex", alignItems: "center", gap: 8, background: "rgba(255,107,53,0.08)", border: "1px solid rgba(255,107,53,0.35)", borderRadius: 10, padding: "8px 10px" }}>
          <span style={{ fontSize: 16 }}>⚡</span>
          <span className="font-body" style={{ flex: 1, color: C.gris2, fontSize: 11, lineHeight: 1.35 }}>Estructura armada sola: <b style={{ color: C.texto }}>{total} semanas</b> en fases, con 3 de carga y 1 de descarga. Después ajustás lo que quieras.</span>
          <button onClick={() => rearmar(Math.max(3, total - 1))} style={btnChico}>−</button>
          <button onClick={() => rearmar(Math.min(24, total + 1))} style={btnChico}>＋</button>
        </div>
      </Caja>

      <Caja titulo="Así queda" extra={<span className="font-body" style={{ color: C.gris, fontSize: 10 }}>tocá una semana para editarla</span>}>
        <LineaTiempoPre plan={p} seleccion={semSel} onElegir={(i) => setSemSel(semSel === i ? null : i)} />
        <Leyenda />
        {s && (
          <div style={{ borderTop: `1px solid ${C.input}`, marginTop: 10, paddingTop: 10 }}>
            <div className="font-body" style={{ color: C.texto, fontSize: 12.5, fontWeight: 700, marginBottom: 6 }}>Semana {s.n} · <span style={{ color: FASES_PRE[s.fase.fase]?.color }}>{s.fase.nombre}</span></div>
            <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginBottom: 8 }}>
              {Object.entries(TIPOS_SEMANA).map(([k, t]) => <Chip key={k} color={t.color || FASES_PRE[s.fase.fase]?.color} activo={s.tipo === k} onClick={() => setSemana(semSel, { tipo: k })}>{t.label}</Chip>)}
            </div>
            {[["vol", "Volumen"], ["int", "Intensidad"]].map(([campo, label]) => (
              <div key={campo} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
                <span className="font-body" style={{ color: C.gris, fontSize: 11, width: 64 }}>{label}</span>
                <input type="range" min="1" max="10" value={s[campo]} onChange={(e) => setSemana(semSel, { [campo]: Number(e.target.value) })} style={{ flex: 1, accentColor: campo === "int" ? ACENTO : FASES_PRE[s.fase.fase]?.color }} />
                <span className="font-display" style={{ color: C.texto, fontSize: 14, fontWeight: 700, width: 22, textAlign: "right" }}>{s[campo]}</span>
              </div>
            ))}
            <input value={s.nota} onChange={(e) => setSemana(semSel, { nota: e.target.value })} placeholder="Nota de la semana (ej: test de 400 el sábado)" className="font-body" style={{ ...inp, width: "100%" }} />
          </div>
        )}
      </Caja>

      <Caja titulo="Fases">
        {p.fases.map((f, i) => (
          <div key={f.id} style={{ borderTop: i ? `1px solid ${C.input}` : "none", padding: "9px 0" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
              <span style={{ width: 10, height: 10, borderRadius: 3, background: FASES_PRE[f.fase]?.color, flexShrink: 0 }} />
              <input value={f.nombre} onChange={(e) => setP((x) => ({ ...x, fases: x.fases.map((y) => (y.id === f.id ? { ...y, nombre: e.target.value } : y)) }))} className="font-body" style={{ ...inp, flex: 1, padding: "6px 8px", fontWeight: 700 }} />
              <button onClick={() => f.semanas > 1 && setFase(f.id, { semanas: f.semanas - 1 })} style={btnChico}>−</button>
              <span className="font-body" style={{ color: C.texto, fontSize: 12, fontWeight: 700, minWidth: 36, textAlign: "center" }}>{f.semanas} sem</span>
              <button onClick={() => setFase(f.id, { semanas: f.semanas + 1 })} style={btnChico}>＋</button>
            </div>
            <select value={f.fase} onChange={(e) => setP((x) => ({ ...x, fases: x.fases.map((y) => (y.id === f.id ? { ...y, fase: e.target.value } : y)) }))} className="font-body" style={{ ...inp, width: "100%", padding: "6px 8px", marginBottom: 6 }}>
              {Object.entries(FASES_PRE).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
              {Object.entries(CAPACIDADES).map(([k, label]) => {
                const on = (f.caps || []).includes(k);
                return <Chip key={k} color={(f.caps || [])[0] === k ? ACENTO : C.verde} activo={on} onClick={() => setP((x) => ({ ...x, fases: x.fases.map((y) => (y.id === f.id ? { ...y, caps: on ? y.caps.filter((c) => c !== k) : [...(y.caps || []), k] } : y)) }))}>{on ? "✓ " : ""}{label}</Chip>;
              })}
            </div>
          </div>
        ))}
        <div className="font-body" style={{ color: C.gris, fontSize: 10, marginTop: 4 }}>La primera capacidad que marcás (naranja) es la prioritaria.</div>
      </Caja>

      <textarea value={p.nota} onChange={(e) => setP({ ...p, nota: e.target.value })} placeholder="Nota para los alumnos/as (opcional)" rows={2} className="font-body" style={{ ...inp, width: "100%", resize: "vertical", marginBottom: 12 }} />

      <div className="font-body" style={{ color: C.texto, fontSize: 12, fontWeight: 700, marginBottom: 6 }}>¿Quién la ve?</div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 6 }}>
        <Chip color={ACENTO} activo={todosMarcados} onClick={() => setPara(todosMarcados ? [] : activos.map((a) => a.id))}>Todos/as</Chip>
        {(plantelGrupos || []).map((g) => {
          const ids = activos.filter((a) => a.plantelGrupoId === g.id).map((a) => a.id);
          const marcado = ids.length > 0 && ids.every((id) => para.includes(id));
          return <Chip key={g.id} color={ACENTO} activo={marcado} onClick={() => setPara((l) => (marcado ? l.filter((id) => !ids.includes(id)) : [...new Set([...l, ...ids])]))}>{g.nombre}</Chip>;
        })}
      </div>
      <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginBottom: 14 }}>
        {activos.map((a) => <Chip key={a.id} color={ACENTO} activo={para.includes(a.id)} onClick={() => toggle(a.id)}>{para.includes(a.id) ? "✓ " : ""}{corto(a.nombre)}</Chip>)}
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <button onClick={onCancelar} className="font-body" style={{ flex: 1, background: C.card, border: `1px solid ${C.borde}`, borderRadius: 10, color: C.gris, fontWeight: 700, fontSize: 13, padding: "11px 0", cursor: "pointer" }}>Cancelar</button>
        <button disabled={para.length === 0} onClick={() => onGuardar(p, para)} className="font-body" style={{ flex: 2, background: para.length ? ACENTO : C.input, border: "none", borderRadius: 10, color: para.length ? "#121017" : "#6B6678", fontWeight: 700, fontSize: 13, padding: "11px 0", cursor: para.length ? "pointer" : "default" }}>
          Guardar · {total} semanas · {para.length} alumno{para.length === 1 ? "" : "s"}
        </button>
      </div>
    </div>
  );
}

function Pantalla({ titulo, onClose, children }) {
  return createPortal((
    <div style={{ position: "fixed", inset: 0, zIndex: 680, background: C.fondo, overflowY: "auto", paddingTop: "env(safe-area-inset-top, 0px)" }}>
      <div style={{ maxWidth: 520, margin: "0 auto", padding: "16px 18px 40px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
          <span className="font-display" style={{ color: C.texto, fontSize: 22, fontWeight: 700 }}>{titulo}</span>
          <button onClick={onClose} className="font-body" style={{ background: C.input, border: "none", borderRadius: 999, color: C.texto, width: 32, height: 32, fontSize: 14, cursor: "pointer", flexShrink: 0 }}>✕</button>
        </div>
        {children}
      </div>
    </div>
  ), document.body);
}
function resumenCorto(p) {
  const a = semanaActual(p);
  const tot = totalSemanas(p);
  if (a.estado === "en curso") return `Semana ${a.semana.n} de ${tot} · ${FASES_PRE[a.semana.fase.fase]?.corto} · ${TIPOS_SEMANA[a.semana.tipo]?.label}`;
  if (a.estado === "antes") return `Empieza en ${a.faltan} día${a.faltan === 1 ? "" : "s"} · ${tot} semanas`;
  return `Terminada · ${tot} semanas`;
}
const btnPie = { flex: 1, background: C.input, border: "none", borderRadius: 8, color: C.texto, fontSize: 11.5, fontWeight: 700, padding: "9px 0", cursor: "pointer" };

// Coach: acceso chico en el Dashboard + pantalla con la lista, el detalle y el editor.
export function AccesoPretemporadaCoach({ alumnos, plantelGrupos, onGuardar, onBorrar }) {
  const [abierto, setAbierto] = useState(false);
  const [editando, setEditando] = useState(null); // { plan, alumnoIds, nueva }
  const [viendo, setViendo] = useState(null); // id
  const lista = pretemporadasDelPlantel(alumnos);
  const enCurso = lista.find((x) => semanaActual(x.plan).estado === "en curso") || lista[0];
  const nombreDe = (id) => corto(alumnos.find((a) => a.id === id)?.nombre || "");
  const vista = viendo && lista.find((x) => x.plan.id === viendo);
  const cerrar = () => { if (editando) setEditando(null); else if (vista) setViendo(null); else setAbierto(false); };
  return (
    <>
      <div style={{ padding: "0 20px 12px" }}>
        <button onClick={() => setAbierto(true)} className="font-body" style={{ width: "100%", display: "flex", alignItems: "center", gap: 10, background: C.card, border: `1px solid ${C.borde}`, borderRadius: 12, padding: "10px 12px", cursor: "pointer", textAlign: "left" }}>
          <span style={{ fontSize: 20 }}>🔥</span>
          <span style={{ flex: 1, minWidth: 0 }}>
            <span style={{ display: "block", color: C.texto, fontSize: 12.5, fontWeight: 700 }}>Pretemporada</span>
            <span style={{ display: "block", color: C.gris, fontSize: 9.5 }}>{enCurso ? `${enCurso.plan.titulo} · ${resumenCorto(enCurso.plan)}` : "Armá la periodización por fases y semanas"}</span>
          </span>
          <span style={{ color: ACENTO, fontSize: 12, fontWeight: 700 }}>Abrir ›</span>
        </button>
      </div>
      {abierto && (
        <Pantalla titulo={editando ? (editando.nueva ? "🔥 Nueva pretemporada" : "🔥 Editar pretemporada") : vista ? "🔥 Pretemporada" : "🔥 Pretemporadas"} onClose={cerrar}>
          {editando ? (
            <EditorPretemporada inicial={editando.plan} alumnoIdsIniciales={editando.alumnoIds} alumnos={alumnos} plantelGrupos={plantelGrupos}
              onCancelar={() => setEditando(null)} onGuardar={(plan, ids) => { onGuardar(plan, ids); setEditando(null); setViendo(plan.id); }} />
          ) : vista ? (
            <VistaPretemporada plan={vista.plan} pie={(
              <Caja>
                <div className="font-body" style={{ color: C.gris, fontSize: 10.5, marginBottom: 8 }}>👥 {vista.alumnoIds.map(nombreDe).join(", ")}</div>
                <div style={{ display: "flex", gap: 6 }}>
                  <button onClick={() => setEditando({ plan: vista.plan, alumnoIds: vista.alumnoIds })} style={btnPie} className="font-body">✎ Editar</button>
                  <button onClick={() => setEditando({ plan: { ...vista.plan, id: nid(), titulo: `${vista.plan.titulo} (copia)`, inicio: hoyISO() }, alumnoIds: [], nueva: true })} style={btnPie} className="font-body">⧉ Copiar</button>
                  <button onClick={() => { if (window.confirm("¿Borrar esta pretemporada? Los alumnos/as dejan de verla.")) { onBorrar(vista.plan.id); setViendo(null); } }} style={{ ...btnPie, flex: "none", padding: "9px 12px", color: "#E85D5D" }} className="font-body">🗑</button>
                </div>
              </Caja>
            )} />
          ) : (
            <>
              <button onClick={() => setEditando({ plan: nuevaPretemporada(), alumnoIds: [], nueva: true })} className="font-body" style={{ width: "100%", background: ACENTO, border: "none", borderRadius: 12, color: "#121017", fontWeight: 700, fontSize: 14, padding: "12px 0", cursor: "pointer", marginBottom: 14 }}>＋ Nueva pretemporada</button>
              {lista.length === 0 && <div className="font-body" style={{ color: C.gris, fontSize: 12, textAlign: "center", padding: "20px 0" }}>Todavía no armaste ninguna. Ponés la fecha de inicio y la de la competencia y se arma sola por fases y semanas.</div>}
              {lista.map(({ plan, alumnoIds }) => (
                <button key={plan.id} onClick={() => setViendo(plan.id)} className="font-body" style={{ width: "100%", textAlign: "left", background: C.card, border: `1px solid ${semanaActual(plan).estado === "en curso" ? ACENTO : C.borde}`, borderRadius: 14, padding: 12, marginBottom: 10, cursor: "pointer" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
                    <span className="font-display" style={{ color: C.texto, fontSize: 17, fontWeight: 700 }}>{plan.titulo || "Pretemporada"}</span>
                    <span style={{ color: C.gris, fontSize: 10.5, whiteSpace: "nowrap" }}>👥 {alumnoIds.length}</span>
                  </div>
                  <div style={{ color: ACENTO, fontSize: 10.5, fontWeight: 700, margin: "2px 0 8px" }}>{resumenCorto(plan)}</div>
                  <LineaTiempoPre plan={plan} />
                </button>
              ))}
            </>
          )}
        </Pantalla>
      )}
    </>
  );
}

// Alumno/a: acceso chico en Inicio (solo si el coach le cargó una).
export function AccesoPretemporadaAlumno({ alumno }) {
  const [abierto, setAbierto] = useState(false);
  const planes = [...(alumno.pretemporadas || [])].sort((a, b) => (b.inicio || "").localeCompare(a.inicio || ""));
  const actual = planes.find((p) => semanaActual(p).estado === "en curso") || planes.find((p) => semanaActual(p).estado === "antes") || planes[0];
  if (!actual) return null;
  const a = semanaActual(actual);
  const col = a.estado === "en curso" ? FASES_PRE[a.semana.fase.fase]?.color : C.borde;
  return (
    <>
      <button onClick={() => setAbierto(true)} className="font-body" style={{ width: "100%", display: "flex", alignItems: "center", gap: 10, background: C.card, border: `1px solid ${col}`, borderRadius: 12, padding: "10px 12px", cursor: "pointer", textAlign: "left", marginBottom: 10 }}>
        <span style={{ fontSize: 20 }}>🔥</span>
        <span style={{ flex: 1, minWidth: 0 }}>
          <span style={{ display: "block", color: C.texto, fontSize: 12.5, fontWeight: 700 }}>{actual.titulo || "Pretemporada"}</span>
          <span style={{ display: "block", color: C.gris, fontSize: 9.5 }}>{resumenCorto(actual)}</span>
          {a.estado === "en curso" && <span style={{ display: "block", height: 4, background: C.input, borderRadius: 2, marginTop: 5 }}><span style={{ display: "block", width: `${(a.semana.n / totalSemanas(actual)) * 100}%`, height: "100%", background: col, borderRadius: 2 }} /></span>}
        </span>
        <span style={{ color: ACENTO, fontSize: 12, fontWeight: 700 }}>Ver ›</span>
      </button>
      {abierto && (
        <Pantalla titulo="🔥 Pretemporada" onClose={() => setAbierto(false)}>
          <VistaPretemporada plan={actual} />
        </Pantalla>
      )}
    </>
  );
}
