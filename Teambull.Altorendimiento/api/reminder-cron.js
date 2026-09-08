// Se ejecuta SOLO por Vercel Cron, una vez por día, sin que nadie tenga la app abierta.
// Hace dos cosas:
//   1) Recordatorio de entrenamiento: si hoy le toca entrenar a alguien y todavía no hizo el
//      check-in de ánimo, le manda un push.
//   2) Aviso al coach: si a alguien le queda exactamente 1 semana de plan (según la fecha real
//      de inicio que cargó el coach), le avisa para que arme el próximo.
//
// Variables de entorno necesarias en Vercel: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, CRON_SECRET

import webpush from "web-push";

const SUPABASE_URL = "https://phoqazemsipnxibpxboq.supabase.co";
const SUPABASE_KEY = "sb_publishable_04mcDE0s7wlA5Z2JVAkfbA_67H7Sbvk";
const DIAS_SEMANA = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];

async function enviarPush(userId, title, body) {
  const subRes = await fetch(`${SUPABASE_URL}/rest/v1/push_subscriptions?user_id=eq.${encodeURIComponent(userId)}`, {
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
  });
  const subs = await subRes.json();
  if (!Array.isArray(subs)) return 0;
  const payload = JSON.stringify({ title, body, url: "/" });
  let sent = 0;
  for (const row of subs) {
    try {
      await webpush.sendNotification(row.subscription, payload);
      sent++;
    } catch {
      // suscripción vencida u otro error puntual: seguimos con las demás
    }
  }
  return sent;
}

function maxSemanas(plan) {
  let max = 1;
  for (const dia of plan?.dias || []) {
    for (const bloque of dia.bloques || []) {
      for (const ej of bloque.ejercicios || []) {
        if (Array.isArray(ej.semanas) && ej.semanas.length > max) max = ej.semanas.length;
      }
    }
  }
  return max;
}

export default async function handler(req, res) {
  const auth = req.headers.authorization || "";
  if (process.env.CRON_SECRET && auth !== `Bearer ${process.env.CRON_SECRET}`) {
    res.status(401).json({ error: "No autorizado." });
    return;
  }

  const vapidPublic = process.env.VAPID_PUBLIC_KEY;
  const vapidPrivate = process.env.VAPID_PRIVATE_KEY;
  if (!vapidPublic || !vapidPrivate) {
    res.status(500).json({ error: "Faltan VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY." });
    return;
  }
  webpush.setVapidDetails("mailto:notificaciones@teambull.app", vapidPublic, vapidPrivate);

  try {
    const dataRes = await fetch(`${SUPABASE_URL}/rest/v1/team_data?id=eq.main`, {
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
    });
    const rows = await dataRes.json();
    const data = rows?.[0]?.data;
    if (!data?.alumnos) {
      res.status(200).json({ recordatorios: 0, avisosPlan: 0, info: "Sin datos todavía." });
      return;
    }

    // Si el coach activó el "modo pausa / vacaciones", no mandamos nada de esto hoy.
    if (data.modoPausa) {
      res.status(200).json({ recordatorios: 0, avisosPlan: 0, info: "Modo pausa activado — no se mandó nada hoy." });
      return;
    }
    const diasAviso = typeof data.diasAvisoPlan === "number" ? data.diasAvisoPlan : 7;

    const ahora = new Date();
    const ahoraArg = new Date(ahora.getTime() - 3 * 60 * 60 * 1000); // Argentina, UTC-3
    const hoyISO = ahoraArg.toISOString().slice(0, 10);
    const hoyNombre = DIAS_SEMANA[ahoraArg.getUTCDay()];

    let recordatorios = 0;
    let avisosPlan = 0;

    for (const alumno of data.alumnos) {
      // 1) Recordatorio de entrenamiento de hoy
      const tieneEntrenoHoy = (alumno.plan?.dias || []).some((d) => d.diaSemana === hoyNombre);
      if (tieneEntrenoHoy) {
        const yaHizoCheckin = (alumno.wellness?.checkins || []).some((c) => c.fecha === hoyISO);
        if (!yaHizoCheckin) {
          const plantilla = data.mensajeRecordatorio || "{nombre}, hoy tenés entrenamiento — no te olvides de contarle a tu coach cómo venís.";
          const primerNombre = alumno.nombre?.split(" ")[0] || "Hola";
          const mensaje = plantilla.includes("{nombre}") ? plantilla.replace(/{nombre}/g, primerNombre) : `${primerNombre}, ${plantilla}`;
          const enviados = await enviarPush(alumno.id, "💪 Hoy entrenás", mensaje);
          if (enviados > 0) recordatorios++;
        }
      }

      // 2) Aviso al coach: le queda poco de plan (según los días que eligió el coach en Ajustes)
      const fechaInicio = alumno.plan?.meta?.fechaInicio;
      if (fechaInicio) {
        const inicio = new Date(fechaInicio + "T00:00:00Z");
        const semanas = maxSemanas(alumno.plan);
        const fin = new Date(inicio.getTime() + semanas * 7 * 24 * 60 * 60 * 1000);
        const diasRestantes = Math.ceil((fin.getTime() - ahoraArg.getTime()) / (24 * 60 * 60 * 1000));
        if (diasRestantes === diasAviso) {
          const enviados = await enviarPush("coach", `📋 Le quedan ${diasAviso} días`, `A ${alumno.nombre} le quedan ${diasAviso} días de su plan actual — es un buen momento para armarle el próximo.`);
          if (enviados > 0) avisosPlan++;
        }
      }
    }

    res.status(200).json({ recordatorios, avisosPlan, fecha: hoyISO, dia: hoyNombre });
  } catch (e) {
    res.status(500).json({ error: e.message || "Error inesperado." });
  }
}
