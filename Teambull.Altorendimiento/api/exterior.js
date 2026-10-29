// Función serverless: tiempos de natación del exterior y calendario de CADDA.
// Desde el navegador no se puede leer SwimRankings ni CADDA directo (no lo permiten), así que la
// app le pregunta a esta función y esta función lee las páginas públicas y devuelve solo los datos.
//   /api/exterior?buscar=Nombre Apellido   nadadores en SwimRankings (resultados de todo el mundo)
//   /api/exterior?atleta=123456            mejores tiempos de ese nadador (de siempre y de cada temporada)
//   /api/exterior?cadda=1                  próximos torneos del calendario de CADDA

const SRK = "https://www.swimrankings.net/index.php";
const CADDA = "https://cadda.org.ar/wp-json/tribe/events/v1/events";
const CABECERAS = {
  "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
  "Accept-Language": "es-AR,es;q=0.9,en;q=0.8",
};

function responder(res, status, cuerpo, cacheSeg = 0) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", cacheSeg ? `s-maxage=${cacheSeg}, stale-while-revalidate=${cacheSeg}` : "no-store");
  res.end(JSON.stringify(cuerpo));
}

async function traerTexto(url) {
  const r = await fetch(url, { headers: CABECERAS });
  if (!r.ok) throw new Error(`respondió ${r.status}`);
  return r.text();
}

// ---------- HTML → texto ----------
const ENTIDADES = { nbsp: " ", amp: "&", quot: '"', apos: "'", lt: "<", gt: ">", ndash: "–", mdash: "—", ntilde: "ñ", Ntilde: "Ñ", aacute: "á", eacute: "é", iacute: "í", oacute: "ó", uacute: "ú", uuml: "ü", ouml: "ö", auml: "ä", ccedil: "ç", atilde: "ã", otilde: "õ" };
function limpiar(html) {
  return String(html || "")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, n) => ENTIDADES[n] ?? m)
    .replace(/\s+/g, " ")
    .trim();
}
// Filas de una tabla cuyo class empieza con `prefijo` (ej. athleteBest0 / athleteBest1).
function filas(html, prefijo) {
  const out = [];
  const re = new RegExp(`<tr[^>]*class="${prefijo}\\d?"[^>]*>([\\s\\S]*?)</tr>`, "gi");
  let m;
  while ((m = re.exec(html))) out.push(m[1]);
  return out;
}
// Celdas de una fila: [{clase, html, texto}]
function celdas(filaHtml) {
  const out = [];
  const re = /<td([^>]*)>([\s\S]*?)<\/td>/gi;
  let m;
  while ((m = re.exec(filaHtml))) {
    const clase = (/class="([^"]*)"/i.exec(m[1]) || [])[1] || "";
    out.push({ clase, html: m[2], texto: limpiar(m[2]) });
  }
  return out;
}
const celda = (cs, ...clases) => cs.find((c) => clases.some((k) => c.clase.split(/\s+/).includes(k)));

// ---------- SwimRankings ----------
const MESES = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12, ene: 1, abr: 4, ago: 8, dic: 12 };
function fechaISO(txt) {
  const t = String(txt || "").toLowerCase();
  let m = t.match(/(\d{1,2})\.?\s*([a-zé]{3})[a-z]*\.?\s*(\d{4})/);
  if (m && MESES[m[2]]) return `${m[3]}-${String(MESES[m[2]]).padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  m = t.match(/(\d{1,2})[./-](\d{1,2})[./-](\d{4})/);
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  return "";
}
function segundos(txt) {
  const t = String(txt || "").replace(/[^\d:.]/g, "");
  const p = t.split(":");
  const n = p.reduce((acc, x) => acc * 60 + parseFloat(x || "0"), 0);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null;
}
function estilo(prueba) {
  const n = prueba.toLowerCase();
  if (/medley|individual|combinad/.test(n)) return "Combinado";
  if (/free|libre|crawl/.test(n)) return "Libre";
  if (/back|espalda/.test(n)) return "Espalda";
  if (/breast|pecho|braza/.test(n)) return "Pecho";
  if (/fly|mariposa/.test(n)) return "Mariposa";
  return null;
}

async function buscarNadadores(texto) {
  const palabras = String(texto || "").trim().split(/\s+/).filter(Boolean);
  if (!palabras.length) return [];
  // SwimRankings busca por apellido (y nombre opcional). Como no sabemos cuál es cuál, probamos
  // el último y el primero como apellido.
  const intentos = palabras.length === 1
    ? [[palabras[0], ""]]
    : [[palabras[palabras.length - 1], palabras.slice(0, -1).join(" ")], [palabras[0], palabras.slice(1).join(" ")], [palabras[palabras.length - 1], ""]];
  const vistos = new Map();
  for (const [apellido, nombre] of intentos) {
    const url = `${SRK}?internalRequest=athleteFind&athlete_clubId=-1&athlete_gender=-1&athlete_lastname=${encodeURIComponent(apellido)}&athlete_firstname=${encodeURIComponent(nombre)}`;
    const html = await traerTexto(url).catch(() => "");
    const re = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
    let m;
    while ((m = re.exec(html))) {
      const idm = /athleteId=(\d+)/.exec(m[1]);
      if (!idm || vistos.has(idm[1])) continue;
      const cs = celdas(m[1]);
      const nom = celda(cs, "name") || cs.find((c) => /athleteId=/.test(c.html));
      const anio = (cs.map((c) => c.texto).find((t) => /^(19|20)\d{2}$/.test(t))) || "";
      vistos.set(idm[1], {
        id: idm[1],
        nombre: nom ? nom.texto : "",
        anio,
        pais: (celda(cs, "nation") || {}).texto || "",
        club: (celda(cs, "club") || {}).texto || "",
      });
    }
    if (vistos.size >= 5 && nombre) break;
  }
  return [...vistos.values()].filter((x) => x.nombre).slice(0, 25);
}

function tiemposDePagina(html) {
  const out = [];
  for (const f of filas(html, "athleteBest")) {
    const cs = celdas(f);
    const ev = celda(cs, "event");
    const t = celda(cs, "time", "swimtimeImportant", "swimtime");
    if (!ev || !t) continue;
    const prueba = ev.texto;
    if (/x\s*\d|relay|relevo|lap/i.test(prueba)) continue;
    const dist = parseInt((prueba.match(/(\d{2,4})\s*m/i) || [])[1], 10);
    const est = estilo(prueba);
    const seg = segundos(t.texto);
    if (!dist || !est || !seg) continue;
    const curso = (celda(cs, "course") || {}).texto || "";
    const ciudad = celda(cs, "city");
    const titulo = ciudad ? (/title="([^"]+)"/i.exec(ciudad.html) || [])[1] : "";
    const idRes = (/[?&;]id=(\d+)/.exec(t.html) || [])[1];
    const fecha = fechaISO((celda(cs, "date") || {}).texto);
    out.push({
      id: idRes ? `srk-${idRes}` : `srk-${dist}${est}${curso}${seg}${fecha}`,
      distancia: dist,
      estilo: est,
      segundos: seg,
      fecha,
      pileta: /25/.test(curso) ? "25" : /50/.test(curso) ? "50" : "",
      torneo: [titulo ? limpiar(titulo) : "", ciudad ? ciudad.texto : ""].filter(Boolean).join(" · "),
    });
  }
  return out;
}

async function tiemposNadador(id) {
  const anio = new Date().getFullYear();
  const temporadas = ["-1", ...Array.from({ length: 5 }, (_, i) => String(anio - i))];
  const paginas = await Promise.all(temporadas.map((t) => traerTexto(`${SRK}?page=athleteDetail&athleteId=${id}&pbest=${t}`).catch(() => "")));
  if (!paginas.some(Boolean)) throw new Error("SwimRankings no respondió");
  const nombre = limpiar((/<div[^>]*id="name"[^>]*>([\s\S]*?)<\/div>/i.exec(paginas.find(Boolean)) || [])[1] || "");
  const porId = new Map();
  for (const p of paginas) for (const t of tiemposDePagina(p)) if (!porId.has(t.id)) porId.set(t.id, t);
  return { nombre, tiempos: [...porId.values()] };
}

// ---------- CADDA ----------
async function calendarioCadda() {
  const hoy = new Date().toISOString().slice(0, 10);
  let url = `${CADDA}?start_date=${hoy}&per_page=50`;
  const eventos = [];
  for (let i = 0; i < 4 && url; i++) {
    const r = await fetch(url, { headers: { ...CABECERAS, Accept: "application/json" } });
    if (!r.ok) break;
    const d = await r.json();
    eventos.push(...(d.events || []));
    url = d.next_rest_url || null;
  }
  return eventos
    .map((e) => {
      const titulo = limpiar(e.title);
      const cats = (e.categories || []).map((c) => c.name).join(" ");
      return { e, titulo, cats };
    })
    .filter(({ titulo, cats }) => /nataci[oó]n|aguas abiertas/i.test(`${titulo} ${cats}`) && !/art[ií]stic|polo|clavados|master/i.test(`${titulo} ${cats}`))
    .map(({ e, titulo }) => {
      const v = e.venue && !Array.isArray(e.venue) ? e.venue : {};
      return {
        id: `cadda-${e.id}`,
        name: titulo.replace(/\s*[–-]\s*Nataci[oó]n\s*$/i, ""),
        start_date: String(e.start_date || "").slice(0, 10),
        end_date: String(e.end_date || "").slice(0, 10),
        location: [v.venue, v.city, v.country].filter(Boolean).join(", "),
        categoria: limpiar(e.excerpt || e.description || "").slice(0, 80),
        abiertas: /aguas abiertas/i.test(titulo),
        url: e.url || "",
      };
    })
    .filter((e) => e.start_date);
}

export default async function handler(req, res) {
  const q = req.query || {};
  try {
    if (q.cadda) return responder(res, 200, { eventos: await calendarioCadda() }, 6 * 3600);
    if (q.buscar) return responder(res, 200, { nadadores: await buscarNadadores(String(q.buscar).slice(0, 80)) }, 3600);
    if (q.atleta && /^\d{1,12}$/.test(String(q.atleta))) return responder(res, 200, await tiemposNadador(String(q.atleta)), 3 * 3600);
    return responder(res, 400, { error: "Falta buscar, atleta o cadda." });
  } catch (e) {
    return responder(res, 502, { error: e.message || "No se pudo conectar." });
  }
}
