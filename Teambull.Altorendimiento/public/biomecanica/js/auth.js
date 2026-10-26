// Cuentas de entrenador (Supabase Auth). Si no hay nube configurada, la app funciona en modo local.
import { CLOUD } from './config.js';
import { useBackend, localStore } from './store.js';
import { teambullStore, inTeamBull } from './store-teambull.js';
import { cloudStore } from './store-cloud.js';

const $ = (id) => document.getElementById(id);
export const cloud = { enabled: false, sb: null, session: null, store: null };

function msg(t, isError) { const el = $('auth-msg'); el.textContent = t; el.hidden = !t; el.classList.toggle('error', !!isError); }
function form(name) {
  for (const n of ['login', 'signup', 'reset', 'newpass']) $('auth-' + n).hidden = n !== name;
  document.querySelectorAll('[data-auth]').forEach(b => b.setAttribute('aria-selected', b.dataset.auth === name));
  $('auth-msg').hidden = true;
}
const ERR = {
  'Invalid login credentials': 'Email o contraseña incorrectos.',
  'Email not confirmed': 'Todavía no confirmaste el email. Revisá tu casilla (y la carpeta de spam).',
  'User already registered': 'Ya hay una cuenta con ese email. Probá ingresar o recuperar la contraseña.',
};
const tr = (e) => ERR[e?.message] || e?.message || 'No se pudo completar la operación.';

export function isLocked() { return cloud.enabled && !cloud.session; }

export async function initCloud({ show, onReady }) {
  if (!CLOUD.url || !CLOUD.anonKey || !window.supabase) { useBackend(inTeamBull ? teambullStore : localStore); onReady(); return cloud; }
  cloud.enabled = true;
  cloud.sb = window.supabase.createClient(CLOUD.url, CLOUD.anonKey, { auth: { persistSession: true, detectSessionInUrl: true } });
  cloud.store = cloudStore(cloud.sb, CLOUD);
  useBackend(cloud.store);

  document.querySelectorAll('[data-auth]').forEach(b => b.onclick = () => form(b.dataset.auth));
  $('auth-forgot').onclick = () => form('reset');
  $('auth-back').onclick = () => form('login');
  $('btn-logout').onclick = async () => { await cloud.sb.auth.signOut(); };

  $('auth-login').onsubmit = async (e) => {
    e.preventDefault(); msg('Ingresando…');
    const { error } = await cloud.sb.auth.signInWithPassword({ email: $('l-email').value.trim(), password: $('l-pass').value });
    if (error) msg(tr(error), true);
  };
  $('auth-signup').onsubmit = async (e) => {
    e.preventDefault(); msg('Creando la cuenta…');
    const { data, error } = await cloud.sb.auth.signUp({
      email: $('s-email').value.trim(), password: $('s-pass').value,
      options: { data: { full_name: $('s-name').value.trim() }, emailRedirectTo: location.origin + location.pathname },
    });
    if (error) return msg(tr(error), true);
    if (!data.session) { form('login'); msg('Listo. Te mandamos un email para confirmar la cuenta; después ingresá acá.'); }
  };
  $('auth-reset').onsubmit = async (e) => {
    e.preventDefault();
    const { error } = await cloud.sb.auth.resetPasswordForEmail($('r-email').value.trim(), { redirectTo: location.origin + location.pathname });
    msg(error ? tr(error) : 'Si el email tiene cuenta, te llega un enlace en unos minutos.', !!error);
  };
  $('auth-newpass').onsubmit = async (e) => {
    e.preventDefault();
    const { error } = await cloud.sb.auth.updateUser({ password: $('n-pass').value });
    if (error) return msg(tr(error), true);
    show('upload');
  };

  const apply = (session) => {
    const was = !!cloud.session;
    cloud.session = session;
    $('user-chip').hidden = !session;
    $('user-email').textContent = session?.user?.email || '';
    $('user-initial').textContent = (session?.user?.user_metadata?.full_name || session?.user?.email || '·').trim().charAt(0).toUpperCase();
    $('btn-athletes').hidden = !session;
    if (!session) { show('auth'); form('login'); }
    else if (!was) onReady();
  };
  cloud.sb.auth.onAuthStateChange((event, session) => {
    if (event === 'PASSWORD_RECOVERY') { cloud.session = session; show('auth'); form('newpass'); return; }
    if (event === 'SIGNED_IN' || event === 'SIGNED_OUT' || event === 'INITIAL_SESSION') apply(session);
  });
  return cloud;
}
