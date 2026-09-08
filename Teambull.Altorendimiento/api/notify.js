// Función serverless: envía una notificación push a un usuario (coach o alumno/a).
// Se llama automáticamente desde la app cada vez que se manda un mensaje de chat.

import webpush from "web-push";

const SUPABASE_URL = "https://phoqazemsipnxibpxboq.supabase.co";
const SUPABASE_KEY = "sb_publishable_04mcDE0s7wlA5Z2JVAkfbA_67H7Sbvk";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Método no permitido" });
    return;
  }

  const vapidPublic = process.env.VAPID_PUBLIC_KEY;
  const vapidPrivate = process.env.VAPID_PRIVATE_KEY;
  if (!vapidPublic || !vapidPrivate) {
    res.status(500).json({ error: "Faltan VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY en las variables de entorno de Vercel." });
    return;
  }
  webpush.setVapidDetails("mailto:notificaciones@teambull.app", vapidPublic, vapidPrivate);

  try {
    const { userId, title, body, url } = req.body || {};
    if (!userId) {
      res.status(400).json({ error: "Falta userId (a quién avisarle)." });
      return;
    }

    const subRes = await fetch(`${SUPABASE_URL}/rest/v1/push_subscriptions?user_id=eq.${encodeURIComponent(userId)}`, {
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
    });
    const subs = await subRes.json();

    if (!Array.isArray(subs) || subs.length === 0) {
      res.status(200).json({ sent: 0, info: "Ese usuario no tiene notificaciones activadas en ningún dispositivo." });
      return;
    }

    const payload = JSON.stringify({ title: title || "Team Bull", body: body || "", url: url || "/" });
    let sent = 0;
    const vencidas = [];

    for (const row of subs) {
      try {
        await webpush.sendNotification(row.subscription, payload);
        sent++;
      } catch (err) {
        if (err.statusCode === 410 || err.statusCode === 404) vencidas.push(row.id);
      }
    }

    for (const id of vencidas) {
      await fetch(`${SUPABASE_URL}/rest/v1/push_subscriptions?id=eq.${id}`, {
        method: "DELETE",
        headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
      });
    }

    res.status(200).json({ sent, vencidas: vencidas.length });
  } catch (e) {
    res.status(500).json({ error: e.message || "Error inesperado en el servidor." });
  }
}
