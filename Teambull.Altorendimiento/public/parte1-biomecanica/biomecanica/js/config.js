// Conexión con la nube (Supabase). Vacío = la app funciona sin cuentas, guardando en el dispositivo.
// Se completa con los datos del proyecto: Supabase > Project Settings > API (URL y clave "anon public").
// La clave anon es pública por diseño; la seguridad la dan las políticas de la base (supabase/schema.sql).
export const CLOUD = {
  url: '',
  anonKey: '',
  maxVideoMB: 50, // límite de subida por archivo del plan gratuito de Supabase
};
