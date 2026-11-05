// Base de datos de PRUEBA: imita lo que la app usa de Firebase, pero guarda todo en este navegador.
// Las pestañas abiertas del mismo navegador se sincronizan entre sí (para simular varios chóferes).
// La sesión es por pestaña: en cada pestaña se puede entrar con un usuario distinto.
const KEY = 'ce_demo_db', SKEY = 'ce_demo_sesion';
const clone = o => (o == null ? o : JSON.parse(JSON.stringify(o)));
const leer = () => { try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (e) { return {}; } };
let store = leer();

import { USUARIOS_DEMO, fichaUsuario, crearSesion } from './usuarios.js?v=1';
export { USUARIOS_DEMO };
function sembrar() {
  let cambio = false;
  for (const u of USUARIOS_DEMO) {
    const p = 'usuarios/' + u.uid;
    if (!store[p]) { store[p] = fichaUsuario(u); cambio = true; }
  }
  if (cambio) guardar();
}

const bc = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('ce_demo') : null;
function guardar() { try { localStorage.setItem(KEY, JSON.stringify(store)); } catch (e) { console.error(e); } if (bc) bc.postMessage('cambio'); }
if (bc) bc.onmessage = () => { store = leer(); avisar(); };
addEventListener('storage', e => { if (e.key === KEY) { store = leer(); avisar(); } });
sembrar();

export const db = { demo: true }, auth = { demo: true };
export const doc = (_, ...s) => ({ type: 'doc', path: s.join('/'), id: String(s[s.length - 1]) });
export const collection = (_, ...s) => ({ type: 'col', path: s.join('/') });
export const orderBy = (f, d) => ({ orderBy: [f, d] });
export const limit = n => ({ limit: n });
export const query = (c, ...cons) => ({ ...c, cons });

function fusionar(a, b) {
  for (const k in b) {
    const v = b[k];
    if (v && typeof v === 'object' && !Array.isArray(v) && a[k] && typeof a[k] === 'object' && !Array.isArray(a[k])) fusionar(a[k], v);
    else a[k] = clone(v);
  }
  return a;
}
function foto(ref) {
  if (ref.type === 'doc') { const d = store[ref.path]; return { id: ref.id, exists: () => d != null, data: () => clone(d) }; }
  let docs = Object.keys(store).filter(p => p.slice(0, p.lastIndexOf('/')) === ref.path)
    .map(p => ({ id: p.split('/').pop(), exists: () => true, data: () => clone(store[p]) }));
  for (const c of ref.cons || []) {
    if (c.orderBy) { const [f, dir] = c.orderBy; docs.sort((x, y) => (x.data()[f] > y.data()[f] ? 1 : -1) * (dir === 'desc' ? -1 : 1)); }
    if (c.limit) docs = docs.slice(0, c.limit);
  }
  return { docs, size: docs.length, empty: !docs.length, forEach: fn => docs.forEach(fn) };
}
const subs = new Set();
function avisar() { subs.forEach(s => setTimeout(() => { if (subs.has(s)) { try { s.next(foto(s.ref)); } catch (e) { console.error(e); } } }, 0)); }
const escribir = (ref, data, opts) => { store[ref.path] = opts && opts.merge && store[ref.path] ? fusionar(clone(store[ref.path]), data) : clone(data); };

export async function setDoc(ref, data, opts) { escribir(ref, data, opts); guardar(); avisar(); }
export async function deleteDoc(ref) { delete store[ref.path]; guardar(); avisar(); }
export async function getDoc(ref) { return foto(ref); }
export function onSnapshot(ref, next) { const s = { ref, next }; subs.add(s); setTimeout(() => { if (subs.has(s)) next(foto(ref)); }, 0); return () => subs.delete(s); }
export async function runTransaction(_, fn) {
  store = leer();
  const tx = {
    get: async r => foto(r),
    set: (r, d, o) => { escribir(r, d, o); return tx; },
    update: (r, d) => { store[r.path] = fusionar(clone(store[r.path] || {}), d); return tx; },
    delete: r => { delete store[r.path]; return tx; },
  };
  const res = await fn(tx);
  guardar(); avisar();
  return res;
}

// --- Sesión de prueba (por pestaña) ---
export const { onAuthStateChanged, signInWithEmailAndPassword, signOut } = crearSesion(SKEY);

export function borrarDatosDemo() { store = {}; sembrar(); guardar(); avisar(); }
