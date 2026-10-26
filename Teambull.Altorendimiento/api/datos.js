// Función serverless: la única puerta a los datos de Team Bull cuando el "modo seguro" está activo.
// La app ya no lee ni escribe la tabla team_data directo con la clave pública: entra acá con
// usuario y contraseña, recibe un pase firmado y con ese pase trae y guarda los datos.
//   - El coach recibe y guarda todo, como siempre.
//   - Cada alumno/a recibe solo lo suyo (de sus compañeros/as, solo nombre y tiempos de reacción
//     para el ranking) y solo puede guardar su propia ficha.
// Además guarda una copia de seguridad por día en team_data_backups (las últimas 60) y el coach
// puede ver la lista y volver a una.
//
// Variables de entorno necesarias en Vercel:
//   SUPABASE_SERVICE_ROLE_KEY  la clave secreta de Supabase (Settings → API Keys → secret)
//   TB_SECRET                  cualquier texto largo y secreto, para firmar los pases
// Si falta alguna, responde { seguro: false } y la app sigue funcionando como antes.

import crypto from "crypto";
import zlib from "zlib";

const SUPABASE_URL = "https://phoqazemsipnxibpxboq.supabase.co";
const TABLA = `${SUPABASE_URL}/rest/v1/team_data?id=eq.main`;
const BACKUPS = `${SUPABASE_URL}/rest/v1/team_data_backups`;
const DURACION_PASE = 30 * 24 * 60 * 60 * 1000; // 30 días
const COPIAS_A_GUARDAR = 60;

const clave = () => process.env.SUPABASE_SERVICE_ROLE_KEY;
const secreto = () => process.env.TB_SECRET;
const cabeceras = (extra) => ({ apikey: clave(), Authorization: `Bearer ${clave()}`, ...extra });

// ---------- pases firmados ----------
const b64 = (s) => Buffer.from(s).toString("base64url");
const firmar = (txt) => crypto.createHmac("sha256", secreto()).update(txt).digest("base64url");
function crearPase(rol, id) {
  const cuerpo = b64(JSON.stringify({ r: rol, i: id, e: Date.now() + DURACION_PASE }));
  return `${cuerpo}.${firmar(cuerpo)}`;
}
function leerPase(req) {
  const m = /^Bearer (.+)$/.exec(req.headers.authorization || "");
  if (!m) return null;
  const [cuerpo, firma] = m[1].split(".");
  if (!cuerpo || !firma) return null;
  const esperada = firmar(cuerpo);
  if (firma.length !== esperada.length || !crypto.timingSafeEqual(Buffer.from(firma), Buffer.from(esperada))) return null;
  try {
    const p = JSON.parse(Buffer.from(cuerpo, "base64url").toString());
    return p.e > Date.now() ? p : null;
  } catch { return null; }
}

// ---------- entrada y salida (comprimidas: los datos pueden pesar varios MB) ----------
async function leerCuerpo(req) {
  const partes = [];
  for await (const c of req) partes.push(c);
  let buf = Buffer.concat(partes);
  if (!buf.length) return {};
  if (req.headers["x-tb-gzip"] === "1") buf = zlib.gunzipSync(buf);
  return JSON.parse(buf.toString("utf8"));
}
function responder(req, res, status, obj) {
  const json = Buffer.from(JSON.stringify(obj));
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  if (json.length > 1024 && /\bgzip\b/.test(req.headers["accept-encoding"] || "")) {
    res.setHeader("Content-Encoding", "gzip");
    res.end(zlib.gzipSync(json));
  } else res.end(json);
}

// ---------- Supabase (con la clave secreta, que nunca sale del servidor) ----------
// Lo último que se leyó o se guardó: su versión (updated_at) viaja a la app para que, antes de bajar
// todo, pueda preguntar solo si cambió algo.
let versionLeida = null;
async function leerDatos() {
  const r = await fetch(`${TABLA}&select=data,updated_at`, { headers: cabeceras() });
  if (!r.ok) throw new Error(`Supabase respondió ${r.status}: ${(await r.text()).slice(0, 150)}`);
  const filas = await r.json();
  versionLeida = filas?.[0]?.updated_at ?? null;
  return filas?.[0]?.data || null;
}
async function leerVersion() {
  const r = await fetch(`${TABLA}&select=updated_at`, { headers: cabeceras() });
  if (!r.ok) throw new Error(`Supabase respondió ${r.status}: ${(await r.text()).slice(0, 150)}`);
  return (await r.json())?.[0]?.updated_at ?? null;
}
async function escribirDatos(data) {
  const r = await fetch(`${TABLA}&select=updated_at`, {
    method: "PATCH",
    headers: cabeceras({ "Content-Type": "application/json", Prefer: "return=representation" }),
    body: JSON.stringify({ data, updated_at: new Date().toISOString() }),
  });
  if (!r.ok) throw new Error(`Supabase respondió ${r.status}: ${(await r.text()).slice(0, 150)}`);
  try { return (await r.json())?.[0]?.updated_at ?? null; } catch { return null; }
}
// Una copia por día como máximo (si la tabla de copias todavía no existe, sigue sin copia).
async function copiaDelDia(data, forzar) {
  if (!data) return;
  try {
    if (!forzar) {
      const r = await fetch(`${BACKUPS}?select=created_at&order=created_at.desc&limit=1`, { headers: cabeceras() });
      if (!r.ok) return;
      const ultima = (await r.json())?.[0]?.created_at;
      if (ultima && Date.now() - new Date(ultima).getTime() < 20 * 60 * 60 * 1000) return;
    }
    const ins = await fetch(BACKUPS, { method: "POST", headers: cabeceras({ "Content-Type": "application/json", Prefer: "return=minimal" }), body: JSON.stringify({ data }) });
    if (!ins.ok) return;
    const viejas = await fetch(`${BACKUPS}?select=id&order=created_at.desc&offset=${COPIAS_A_GUARDAR}`, { headers: cabeceras() });
    const ids = viejas.ok ? (await viejas.json()).map((x) => x.id) : [];
    if (ids.length) await fetch(`${BACKUPS}?id=in.(${ids.join(",")})`, { method: "DELETE", headers: cabeceras() });
  } catch {
    // la copia es un extra: si falla, el guardado sigue igual
  }
}

// ---------- lo que ve cada uno ----------
const sinClaves = ({ password, recoveryPin, ...resto }) => resto;
function vistaAlumno(data, id) {
  return {
    ...data,
    coaches: (data.coaches || []).map(sinClaves),
    alumnos: (data.alumnos || []).map((a) => (a.id === id ? a : { id: a.id, nombre: a.nombre, activo: a.activo, plantelGrupoId: a.plantelGrupoId, reacciones: a.reacciones || [] })),
    logActividad: [],
  };
}
const vista = (data, pase) => (!data ? null : pase.r === "coach" ? data : vistaAlumno(data, pase.i));

export default async function handler(req, res) {
  if (!clave() || !secreto()) return responder(req, res, 200, { seguro: false });
  try {
    if (req.method === "GET") {
      const pase = leerPase(req);
      if (!pase) return responder(req, res, 401, { seguro: true, error: "Tenés que ingresar de nuevo." });
      if (req.query?.version) return responder(req, res, 200, { updated_at: await leerVersion() });
      if (req.query?.copias && pase.r === "coach") {
        const r = await fetch(`${BACKUPS}?select=id,created_at&order=created_at.desc&limit=${COPIAS_A_GUARDAR}`, { headers: cabeceras() });
        return responder(req, res, 200, { copias: r.ok ? await r.json() : [], tabla: r.ok });
      }
      const data = await leerDatos();
      return responder(req, res, 200, { seguro: true, data: vista(data, pase), updated_at: versionLeida });
    }
    if (req.method !== "POST") return responder(req, res, 405, { error: "Método no permitido" });

    const cuerpo = await leerCuerpo(req);
    if (cuerpo.accion === "estado") return responder(req, res, 200, { seguro: true });

    if (cuerpo.accion === "login") {
      const data = await leerDatos();
      const u = String(cuerpo.usuario || "").trim(), p = String(cuerpo.password || "").trim();
      const c = (data?.coaches || []).find((x) => x.usuario === u && x.password === p);
      const a = !c && (data?.alumnos || []).find((x) => x.usuario === u && x.password === p);
      if (!c && !a) return responder(req, res, 401, { seguro: true, error: "Usuario o contraseña incorrectos." });
      const pase = c ? { r: "coach", i: c.id } : { r: "athlete", i: a.id };
      return responder(req, res, 200, { seguro: true, token: crearPase(pase.r, pase.i), rol: pase.r, id: pase.i, data: vista(data, pase), updated_at: versionLeida });
    }

    if (cuerpo.accion === "recuperar") {
      const data = await leerDatos();
      const c = (data?.coaches || []).find((x) => x.usuario === String(cuerpo.usuario || "").trim());
      if (!c) return responder(req, res, 200, { ok: false, texto: "No existe ese usuario." });
      if (!c.recoveryPin) return responder(req, res, 200, { ok: false, texto: "Ese usuario todavía no configuró un PIN de recuperación.", sinPin: true, telefono: c.telefono || "" });
      if (c.recoveryPin !== String(cuerpo.pin || "").trim()) return responder(req, res, 200, { ok: false, texto: "El PIN no coincide." });
      return responder(req, res, 200, { ok: true, texto: `Tu contraseña es: ${c.password}` });
    }

    const pase = leerPase(req);
    if (!pase) return responder(req, res, 401, { seguro: true, error: "Tenés que ingresar de nuevo." });

    if (cuerpo.accion === "guardar") {
      const nuevo = cuerpo.data;
      if (!nuevo || !Array.isArray(nuevo.alumnos)) return responder(req, res, 400, { error: "Datos inválidos." });
      const actual = await leerDatos();
      if (pase.r === "coach") {
        await copiaDelDia(actual, false);
        return responder(req, res, 200, { ok: true, updated_at: await escribirDatos(nuevo) });
      }
      // alumno/a: solo su propia ficha; usuario, contraseña y coaches los maneja el coach
      const mio = nuevo.alumnos.find((x) => x.id === pase.i);
      const enNube = (actual?.alumnos || []).find((x) => x.id === pase.i);
      if (!mio || !enNube) return responder(req, res, 403, { error: "No encontramos tu ficha." });
      const ficha = { ...mio, usuario: enNube.usuario, password: enNube.password, coachIds: enNube.coachIds === undefined ? null : enNube.coachIds };
      const uidMax = Math.max(Number(actual._uidMax) || 0, Number(nuevo._uidMax) || 0);
      const version = await escribirDatos({ ...actual, _uidMax: uidMax, alumnos: actual.alumnos.map((x) => (x.id === pase.i ? ficha : x)) });
      return responder(req, res, 200, { ok: true, updated_at: version });
    }

    if (cuerpo.accion === "restaurar" && pase.r === "coach") {
      const r = await fetch(`${BACKUPS}?id=eq.${encodeURIComponent(cuerpo.copiaId)}&select=data`, { headers: cabeceras() });
      const copia = r.ok ? (await r.json())?.[0]?.data : null;
      if (!copia) return responder(req, res, 404, { error: "No encontramos esa copia." });
      await copiaDelDia(await leerDatos(), true); // lo de ahora también queda guardado, por si acaso
      await escribirDatos(copia);
      return responder(req, res, 200, { ok: true, data: copia });
    }

    return responder(req, res, 400, { error: "Acción desconocida." });
  } catch (e) {
    return responder(req, res, 500, { error: e.message || "Error inesperado en el servidor." });
  }
}
