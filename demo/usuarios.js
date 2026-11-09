// Usuarios de ejemplo para las pruebas (PIN = contraseña). No son cuentas reales.
export const USUARIOS_DEMO = [
  { uid: 'u-jlara', nombre: 'Juan Lara', rol: 'chofer', color: '#1f6fb5', pin: '111111' },
  { uid: 'u-jluna', nombre: 'Juan Luna', rol: 'chofer', color: '#b3407d', pin: '222222' },
  { uid: 'u-dgarcia', nombre: 'David García', rol: 'chofer', color: '#2e8a57', pin: '333333' },
  { uid: 'u-alexis', nombre: 'Alexis', rol: 'chofer', color: '#c2650f', pin: '444444' },
  // Cupo de reserva: lo usa quien reemplace a un chófer que no esté disponible ese día.
  { uid: 'u-extra', nombre: 'Extra (reserva)', rol: 'chofer', color: '#6a7480', pin: '777777' },
  { uid: 'u-antonio', nombre: 'Don Antonio', rol: 'oficina', color: '#5a4fb0', pin: '555555' },
  { uid: 'u-yulissa', nombre: 'Yulissa', rol: 'oficina', color: '#0f8a8a', pin: '666666' },
  // No es una persona: es donde se deja un pedido que un chófer no puede entregar, para que otro lo tome.
  // No tiene PIN ni aparece en «¿Quién eres?» (ver sinLogin).
  { uid: 'u-urgente', nombre: '🚨 Urgente', rol: 'chofer', color: '#c23b3b', sinLogin: true },
].map((u, i) => ({ ...u, email: u.uid.slice(2) + '@demo.local', orden: i }));
export const fichaUsuario = u => ({ nombre: u.nombre, rol: u.rol, color: u.color, email: u.email, orden: u.orden, pinDemo: u.pin, sinLogin: !!u.sinLogin });

// Sesión de prueba por pestaña (cada pestaña puede ser un usuario distinto).
export function crearSesion(SKEY) {
  const subs = new Set();
  const leer = () => { try { return JSON.parse(sessionStorage.getItem(SKEY) || 'null'); } catch (e) { return null; } };
  return {
    onAuthStateChanged(_, cb) { subs.add(cb); setTimeout(() => cb(leer()), 0); return () => subs.delete(cb); },
    async signInWithEmailAndPassword(_, email, pass) {
      const u = USUARIOS_DEMO.find(x => x.email === String(email).toLowerCase());
      if (!u || u.pin !== pass) { const e = new Error('PIN incorrecto'); e.code = 'auth/invalid-credential'; throw e; }
      const s = { uid: u.uid, email: u.email };
      try { sessionStorage.setItem(SKEY, JSON.stringify(s)); } catch (e) { }
      subs.forEach(cb => cb(s));
      return { user: s };
    },
    async signOut() { try { sessionStorage.removeItem(SKEY); } catch (e) { } subs.forEach(cb => cb(null)); },
  };
}
