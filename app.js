import {
  DEMO, MODO, db, auth, doc, collection, setDoc, deleteDoc, onSnapshot, query, orderBy, limit, runTransaction,
  onAuthStateChanged, signInWithEmailAndPassword, signOut, borrarDatosDemo,
} from './fb.js?v=21';
import { pdfLines, tipoDePdf, parseProveedores, parseDiario, cruzar } from './parser.js?v=11';

/* ================= utilidades ================= */
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtQ = n => Number.isInteger(n) ? String(n) : String(+n.toFixed(3)).replace('.', ',');
const fmtKg = n => n.toFixed(3).replace('.', ',') + ' kg';
const parseKg = s => { if (s == null || String(s).trim() === '') return null; const v = Number(String(s).replace(',', '.')); return isNaN(v) || v < 0 ? NaN : v; };
const fmtF = id => { if (!id) return ''; const [y, m, d] = id.split('-'); return d + '/' + m + '/' + y; };
const DIAS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
const diaF = id => { const [y, m, d] = id.split('-').map(Number); return DIAS[new Date(y, m - 1, d).getDay()]; };
// El día cambia según la hora de Canarias, donde trabajan los repartidores.
const hoy = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Atlantic/Canary' });
const ahora = () => new Date().toISOString();
let toastT;
function toast(t) { const el = $('#toast'); el.textContent = t; el.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => el.hidden = true, 2800); }

/* ================= estado ================= */
let dias = [], fecha = null, dia = null;
let rec = {}, rep = {}, asig = {}, almDia = {}, tras = {};
let usuarios = {}, habitual = {}, yo = null;
let subsDia = [];
let cliBy = {}, nDe = {}; // pedido → cliente;  pedido → número de cliente
const filtro = { 1: 'todos', 2: 'todos', 3: 'sin' }, busq = { 1: '', 2: '', 3: '' };
const ambito = { 1: 'mios', 2: 'mios' };
const esOficina = () => !!yo && yo.rol === 'oficina';
const esChofer = () => !!yo && yo.rol === 'chofer';
const choferes = () => Object.entries(usuarios).filter(([, u]) => u.rol === 'chofer').sort((a, b) => (a[1].orden ?? 9) - (b[1].orden ?? 9)).map(([uid, u]) => ({ uid, ...u }));
const nombreDe = uid => (usuarios[uid] || {}).nombre || 'otro chófer';
const colorDe = uid => (usuarios[uid] || {}).color || 'var(--muted)';
const chipChof = (uid, txt) => uid ? `<span class="chof" style="--c:${esc(colorDe(uid))}"><i></i>${esc(txt || nombreDe(uid))}</span>` : `<span class="chof sin"><i></i>${esc(txt || 'Sin asignar')}</span>`;
const firma = () => ({ nombre: yo ? yo.nombre : '', uid: yo ? yo.uid : null, ts: ahora() });
function errGuardar(e) { console.error(e); toast(e && e.code === 'permission-denied' ? 'Sin permiso para guardar' : 'No se guardó. Revisa la conexión'); }
function errConexion(e) { console.error(e); toast('No se pudo conectar con la base de datos'); }

/* ================= vistas ================= */
const VISTAS = ['login', 'recogida', 'clientes', 'reparto', 'traspasos', 'resumen', 'oficina'];
function vista() {
  if (!yo) return 'login';
  let v = (location.hash || '#recogida').slice(1);
  if (v === 'cargar') v = 'oficina';
  if (v === 'oficina' && !esOficina()) v = 'recogida';
  return VISTAS.includes(v) && v !== 'login' ? v : 'recogida';
}
function route() {
  const v = vista();
  VISTAS.forEach(n => { $('#v-' + n).hidden = n !== v; const t = $('#t-' + n); if (t) { if (n === v) t.setAttribute('aria-current', 'page'); else t.removeAttribute('aria-current'); } });
  $('#tabs').hidden = !yo; $('#t-oficina').hidden = !esOficina();
  $('#bar').hidden = !(v === 'recogida' || v === 'reparto');
  if (v === 'resumen') renderResumen();
  if (v === 'traspasos') renderTraspasos();
  if (v === 'clientes') renderClientes();
  if (v === 'oficina') renderOficina();
  renderStats();
  window.scrollTo(0, 0);
}
addEventListener('hashchange', route);

/* ================= usuarios y entrada ================= */
if (DEMO) {
  $('#demo-banner').hidden = false;
  if (MODO === 'prueba') $('#demo-texto').textContent = 'Versión de prueba · Usa datos de prueba aparte: no cambia nada de la app real.';
}
$('#demo-borrar').addEventListener('click', async () => {
  if (!borrarDatosDemo || !confirm('¿Borrar todos los datos de prueba? (los datos reales no se tocan)')) return;
  try { await borrarDatosDemo(); toast('Datos de prueba borrados'); } catch (x) { console.error(x); toast('No se pudo borrar. Inténtalo de nuevo'); }
});
let elegido = null, authUser = null;
onSnapshot(collection(db, 'usuarios'), snap => {
  const m = {}; snap.forEach(x => m[x.id] = x.data()); usuarios = m;
  renderQuien(); resolverYo(); refreshAll();
}, errConexion);
function renderQuien() {
  const lista = Object.entries(usuarios).sort((a, b) => (a[1].orden ?? 9) - (b[1].orden ?? 9));
  $('#quien').innerHTML = lista.length
    ? lista.map(([uid, u]) => `<button type="button" class="quien-b" data-uid="${esc(uid)}" style="--c:${esc(u.color || '#5b6876')}"><i></i><span>${esc(u.nombre)}</span><small>${u.rol === 'oficina' ? 'Oficina' : 'Chófer'}${DEMO && u.pinDemo ? ' · PIN ' + esc(u.pinDemo) : ''}</small></button>`).join('')
    : '<p class="small">Todavía no hay usuarios creados.</p>';
}
$('#quien').addEventListener('click', e => {
  const b = e.target.closest('[data-uid]'); if (!b) return;
  elegido = b.dataset.uid; $('#pin-nombre').textContent = nombreDe(elegido);
  $('#pin-form').hidden = false; $('#quien').hidden = true; $('#pin-err').hidden = true; $('#pin').value = ''; $('#pin').focus();
});
$('#pin-otro').addEventListener('click', () => { elegido = null; $('#pin-form').hidden = true; $('#quien').hidden = false; });
$('#pin-form').addEventListener('submit', async e => {
  e.preventDefault(); const u = usuarios[elegido]; if (!u) return;
  const btn = $('#pin-btn'); btn.disabled = true; btn.textContent = 'Entrando…'; $('#pin-err').hidden = true;
  try { await signInWithEmailAndPassword(auth, u.email, $('#pin').value.trim()); }
  catch (x) { $('#pin-err').hidden = false; $('#pin-err').textContent = /invalid|wrong|user-not-found/.test(x.code || '') ? 'PIN incorrecto.' : x.code === 'auth/too-many-requests' ? 'Demasiados intentos. Espera unos minutos.' : 'No se pudo entrar. Revisa la conexión.'; }
  btn.disabled = false; btn.textContent = 'Entrar';
});
$('#login').addEventListener('submit', async e => {
  e.preventDefault(); const btn = $('#l-btn'), err = $('#l-err'); err.hidden = true; btn.disabled = true;
  try { await signInWithEmailAndPassword(auth, $('#l-email').value.trim(), $('#l-pass').value); $('#l-pass').value = ''; }
  catch (x) { err.hidden = false; err.textContent = /invalid|wrong|user-not-found/.test(x.code || '') ? 'Correo o contraseña incorrectos.' : 'No se pudo entrar.'; }
  btn.disabled = false;
});
onAuthStateChanged(auth, u => { authUser = u; resolverYo(); });
let yoUid = null;
function resolverYo() {
  const u = authUser;
  const antes = yoUid;
  if (!u) yo = null;
  else if (usuarios[u.uid]) yo = { uid: u.uid, ...usuarios[u.uid] };
  else yo = { uid: u.uid, nombre: u.email || 'Administración', rol: 'oficina', color: '#5b6876' }; // cuenta de administración
  yoUid = yo ? yo.uid : null;
  $('#yo').hidden = !yo;
  $('#yo').innerHTML = yo ? `${chipChof(yo.uid, yo.nombre)} <button type="button" class="add-nota" id="salir">Salir</button>` : '';
  if (yo && antes !== yoUid) { ambito[1] = esChofer() ? 'mios' : 'todos'; ambito[2] = esChofer() ? 'mios' : 'todos'; filtro[3] = 'sin'; syncSeg(); }
  if (antes !== yoUid) { suscribirRegistro(); if (!yo) { elegido = null; $('#pin-form').hidden = true; $('#quien').hidden = false; } route(); buildRecogida(); buildReparto(); refreshAll(); }
}
document.addEventListener('click', e => { if (e.target.id === 'salir') signOut(auth); });
function syncSeg() {
  document.querySelectorAll('.seg').forEach(g => { const n = g.dataset.ambito; g.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.v === ambito[n]))); });
  document.querySelectorAll('.chips[data-for="3"] .chip').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.f === filtro[3])));
}

/* ================= almacenes (proveedores) y clientes por chófer ================= */
onSnapshot(doc(db, 'config', 'almacenes'), s => { habitual = (s.exists() && s.data().habitual) || {}; refreshAll(); }, errConexion);
// Chófer que va a un almacén hoy: lo elegido para el día; si no, el habitual.
const chofAlm = g => (g in almDia ? almDia[g].chofer : habitual[g]) || null;
const almHabitualSinCambio = g => !(g in almDia);
const misAlmacenes = () => grupos().map(x => x.g).filter(g => chofAlm(g) === (yo && yo.uid));
// Clientes del día: se asignan por número de cliente (todos sus pedidos van con el mismo chófer).
function clientesDia() {
  const m = new Map();
  (dia ? dia.clientes : []).forEach(c => { const n = String(c.n || c.p); if (!m.has(n)) m.set(n, { n, nombre: c.nombre, pedidos: [] }); m.get(n).pedidos.push(c.p); });
  return [...m.values()];
}
const chofCli = n => (asig[n] || {}).chofer || null;
const chofPed = p => chofCli(nDe[p]);
const esMio = p => !!yo && chofPed(p) === yo.uid;

/* ================= cálculo ================= */
const R = pr => rec[pr.k] || {};
const est = pr => R(pr).estado || null;
function disponible(pr) { const r = R(pr); if (!r.estado) return null; if (r.estado === 'si') return pr.q; if (r.estado === 'no') return 0; return r.quedan ?? 0; }
const cliRep = (pr, p) => ((rep[pr.k] || {}).cli || {})[p] || {};
// Cuánto lleva cada cliente. Manda lo que haya puesto una persona; si nadie lo ha decidido:
//  - si en el proveedor «No hay», nadie lleva nada (0);
//  - si el producto es para un solo cliente, lleva lo que se recogió.
const lleva = (pr, a) => {
  const v = cliRep(pr, a.p).lleva; if (v != null) return v;
  const d = disponible(pr);
  if (d === 0) return 0;
  if (d != null && pr.a.length === 1) return Math.min(a.q, d);
  return a.q;
};
const separado = (pr, p) => !!cliRep(pr, p).ok;
// Una línea está lista si se separó o si ese cliente no lleva nada.
const lineaLista = (pr, a) => separado(pr, a.p) || lleva(pr, a) === 0;
const sumaLleva = pr => pr.a.reduce((s, a) => s + lleva(pr, a), 0);
const corto = pr => { const d = disponible(pr); return d != null && d < pr.q; };
const porDecidir = pr => { const d = disponible(pr); return d != null && sumaLleva(pr) - d > 0.0001; };
const isEK = pr => pr.um === 'EK';
const pesosDe = (pr, p) => (cliRep(pr, p).pesos || []);
const kgCli = (pr, a) => pesosDe(pr, a.p).slice(0, Math.round(lleva(pr, a))).reduce((s, x) => s + (Number(x) || 0), 0);
const kgProd = pr => pr.a.reduce((s, a) => s + kgCli(pr, a), 0);
const piezasPesadas = (pr, a) => pesosDe(pr, a.p).slice(0, Math.round(lleva(pr, a))).filter(x => x != null && x > 0).length;
const isIssue1 = pr => { const r = R(pr); return r.estado === 'no' || r.estado === 'parcial' || !!(r.nota && r.nota.trim()); };
// Filas de reparto que ve el usuario (todas o solo sus clientes)
const filasVisibles = pr => ambito[2] === 'mios' && esChofer() ? pr.a.filter(a => esMio(a.p)) : pr.a;
const prodListo = (pr, filas) => (filas || pr.a).every(a => lineaLista(pr, a));

function estadoRecChip(pr) {
  const s = est(pr), d = disponible(pr);
  if (!s) return '<span class="chip-st">Sin recoger</span>';
  if (s === 'si') return '<span class="chip-st ok">Recogido completo</span>';
  if (s === 'no') return '<span class="chip-st bad">No hay en proveedor</span>';
  return `<span class="chip-st warn">Recogidos ${fmtQ(d)} de ${fmtQ(pr.q)}</span>`;
}

/* ================= 1 RECOGIDA ================= */
function grupos() { if (!dia) return []; const gs = [], idx = {}; dia.productos.forEach(pr => { if (!(pr.g in idx)) { idx[pr.g] = gs.length; gs.push({ g: pr.g, items: [] }); } gs[idx[pr.g]].items.push(pr); }); return gs; }
function emptyHTML() {
  const ult = dias[0];
  const verUlt = ult && ult.id !== fechaSel ? `<p><button class="btn ghost" type="button" data-ver="${esc(ult.id)}">Ver el último día cargado (${diaF(ult.id)} ${fmtF(ult.id)})</button></p>` : '';
  if (fechaSel === hoy()) return `<div class="empty"><h2>La lista de hoy aún no está cargada</h2><p>${diaF(fechaSel)} ${fmtF(fechaSel)}. En cuanto lleguen los PDF del día aparecerá aquí sola, no hace falta recargar.</p>${verUlt}</div>`;
  return `<div class="empty"><h2>No hay datos de este día</h2><p>Cuando se carguen los PDF del día aparecerán aquí.</p>${verUlt}</div>`;
}
document.addEventListener('click', e => { const b = e.target.closest('[data-ver]'); if (b) selectFecha(b.dataset.ver); });

const abiertos1 = new Set(); // proveedores abiertos en Recogida (empiezan cerrados)
function buildRecogida() {
  const root = $('#lista1');
  if (!dia) { root.innerHTML = emptyHTML(); return; }
  root.innerHTML = grupos().map(gr => `
    <section class="sec${abiertos1.has(gr.g) ? '' : ' closed'}" data-g="${esc(gr.g)}">
      <div class="sec-h"><button class="tog" type="button" aria-expanded="${abiertos1.has(gr.g)}"><span class="tt"><span class="name">Proveedor ${esc(gr.g)} <span class="alm-chof"></span></span><span class="cnt"></span></span><span class="car">▾</span></button></div>
      <div class="items">${gr.items.map(itemHTML).join('')}</div>
      <div class="sec-f"><button class="allok" type="button" data-allok="${esc(gr.g)}">Marcar todo «Tengo»</button><button class="sig" type="button" data-sig="${esc(gr.g)}">Siguiente →</button></div>
    </section>`).join('');
  refreshRecogida();
}
function itemHTML(pr) {
  return `<article class="item" id="it-${esc(pr.k)}" data-k="${esc(pr.k)}">
    <div class="row1"><span class="code">${esc(pr.c)}</span><span class="qty"><b>${fmtQ(pr.q)}</b> ${isEK(pr) ? '<span class="um ek">EK · piezas</span>' : 'uds'}</span></div>
    <p class="desc">${esc(pr.d)}</p>
    <div class="acts">
      <button type="button" class="b-si" data-a="si" aria-pressed="false">Tengo</button>
      <button type="button" class="b-parcial" data-a="parcial" aria-pressed="false">Faltan algunas</button>
      <button type="button" class="b-no" data-a="no" aria-pressed="false">No hay</button>
    </div>
    <div class="extra">
      <div class="quedan" hidden>Hay
        <span class="step"><button type="button" data-st="-1" aria-label="Menos">−</button><input id="q-${esc(pr.k)}" type="number" inputmode="decimal" min="0" max="${pr.q}" step="1" aria-label="Unidades que hay"><button type="button" data-st="1" aria-label="Más">+</button></span>
        de ${fmtQ(pr.q)}
      </div>
      <div class="nota" hidden><input id="n-${esc(pr.k)}" type="text" placeholder="Anotación / incidencia" aria-label="Anotación"></div>
    </div>
    <button type="button" class="add-nota">+ Añadir nota</button>
    <span class="who" hidden></span>
  </article>`;
}
function refreshItem(pr) {
  const el = document.getElementById('it-' + pr.k); if (!el) return;
  const m = R(pr), s = m.estado || null;
  el.classList.toggle('st-si', s === 'si'); el.classList.toggle('st-parcial', s === 'parcial'); el.classList.toggle('st-no', s === 'no');
  el.querySelectorAll('.acts button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.a === s)));
  const qd = el.querySelector('.quedan'), qi = qd.querySelector('input');
  qd.hidden = s !== 'parcial';
  if (document.activeElement !== qi) qi.value = m.quedan == null ? '' : m.quedan;
  const nd = el.querySelector('.nota'), ni = nd.querySelector('input');
  const show = s === 'no' || s === 'parcial' || !!m.nota || el.dataset.notaOpen === '1';
  nd.hidden = !show; el.querySelector('.add-nota').hidden = show;
  if (document.activeElement !== ni) ni.value = m.nota || '';
  const who = el.querySelector('.who');
  if (s && m.nombre) { who.hidden = false; who.textContent = 'Marcado por ' + m.nombre + (m.ts ? ' · ' + new Date(m.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''); } else who.hidden = true;
  const q = busq[1].toLowerCase();
  const okQ = !q || pr.c.toLowerCase().includes(q) || pr.d.toLowerCase().includes(q);
  const f = filtro[1];
  const okF = f === 'todos' || (f === 'pend' && !s) || (f === 'falt' && isIssue1(pr));
  el.hidden = !(okQ && okF);
}
function refreshRecogida() {
  if (!dia) return;
  dia.productos.forEach(refreshItem);
  const soloMios = ambito[1] === 'mios' && esChofer();
  const mios = misAlmacenes();
  document.querySelectorAll('#lista1 .sec').forEach(sec => {
    const g = sec.dataset.g, its = dia.productos.filter(i => i.g === g);
    const done = its.filter(est).length, comp = done === its.length;
    sec.querySelector('.cnt').textContent = comp ? `✓ Completo · ${its.length} revisados` : `${done} de ${its.length} revisados`;
    sec.querySelector('.alm-chof').innerHTML = chipChof(chofAlm(g));
    sec.classList.toggle('completo', comp);
    sec.querySelector('.allok').hidden = comp;
    sec.hidden = (soloMios && !mios.includes(g)) || !its.some(i => !document.getElementById('it-' + i.k).hidden);
  });
  const av = $('#aviso1');
  av.hidden = !(soloMios && dia);
  if (soloMios) av.innerHTML = mios.length ? `Tus almacenes hoy: <b>${mios.map(esc).join(', ')}</b>.` : 'Hoy todavía no tienes almacenes asignados. Pide a la oficina que te los asigne, o toca <b>Todos</b>.';
}
const pendRec = {};
function saveRec(pr, patch) {
  if (!fecha) return;
  const antes = grupoListo(1, pr.g);
  const next = { ...R(pr), ...patch, codigo: pr.c, ...firma() };
  const clear = !next.estado && !(next.nota && next.nota.trim());
  if (clear) delete rec[pr.k]; else rec[pr.k] = next;
  refreshAll();
  if (!antes && grupoListo(1, pr.g)) programarSiguiente(1, pr.g);
  const ref = doc(db, 'dias', fecha, 'recogida', pr.k);
  pendRec[pr.k] = (pendRec[pr.k] || Promise.resolve()).then(() => clear ? deleteDoc(ref) : setDoc(ref, next)).catch(errGuardar);
}
const prodByK = k => dia && dia.productos.find(i => i.k === k);

$('#lista1').addEventListener('click', e => {
  const sec = e.target.closest('.sec'); const tog = e.target.closest('.tog');
  if (tog) { setOpen(1, sec.dataset.g, sec.classList.contains('closed')); return; }
  const ok = e.target.closest('[data-allok]');
  if (ok) { dia.productos.filter(i => i.g === ok.dataset.allok && !est(i)).forEach(i => saveRec(i, { estado: 'si' })); return; }
  const sg = e.target.closest('[data-sig]');
  if (sg) { siguiente(1, sg.dataset.sig, false); return; }
  const el = e.target.closest('.item'); if (!el) return;
  const pr = prodByK(el.dataset.k); if (!pr) return;
  const a = e.target.closest('[data-a]');
  if (a) {
    const nv = est(pr) === a.dataset.a ? null : a.dataset.a;
    const patch = { estado: nv };
    if (nv !== 'parcial') patch.quedan = null; else if (R(pr).quedan == null) patch.quedan = Math.max(0, Math.floor(pr.q) - 1);
    saveRec(pr, patch);
    if (nv === 'parcial') setTimeout(() => { const i = el.querySelector('.quedan input'); if (i) { i.focus(); i.select(); } }, 50);
    return;
  }
  const st = e.target.closest('[data-st]');
  if (st) { let v = Number(R(pr).quedan ?? 0) + Number(st.dataset.st); v = Math.min(Math.max(0, v), pr.q); if (v >= pr.q) { saveRec(pr, { estado: 'si', quedan: null }); return; } saveRec(pr, { quedan: v }); return; }
  if (e.target.closest('.add-nota')) { el.dataset.notaOpen = '1'; refreshItem(pr); el.querySelector('.nota input').focus(); }
});
$('#lista1').addEventListener('change', e => {
  const el = e.target.closest('.item'); if (!el) return; const pr = prodByK(el.dataset.k); if (!pr) return;
  if (e.target.matches('.quedan input')) {
    const v = e.target.value === '' ? null : Number(e.target.value);
    if (v != null && (isNaN(v) || v < 0)) { toast('Escribe un número de 0 a ' + fmtQ(pr.q)); refreshItem(pr); return; }
    if (v != null && v >= pr.q) { saveRec(pr, { estado: 'si', quedan: null }); return; }
    saveRec(pr, { quedan: v });
  }
  if (e.target.matches('.nota input')) saveRec(pr, { nota: e.target.value.trim() });
});

/* ================= 2 CLIENTES ================= */
function renderClientes() {
  const root = $('#lista3'), cont = $('#cuenta-chof');
  if (!dia) { root.innerHTML = emptyHTML(); cont.hidden = true; return; }
  const cls = clientesDia();
  const lineasDe = c => dia.productos.reduce((s, pr) => s + pr.a.filter(a => c.pedidos.includes(a.p)).length, 0);
  const almsDe = c => [...new Set(dia.productos.filter(pr => pr.a.some(a => c.pedidos.includes(a.p))).map(pr => pr.g))];
  // contador por chófer
  const cuenta = {}; let sin = 0;
  cls.forEach(c => { const ch = chofCli(c.n); if (ch) cuenta[ch] = (cuenta[ch] || 0) + 1; else sin++; });
  cont.hidden = false;
  cont.innerHTML = `<span class="lbl">Clientes del día · ${cls.length}</span><div class="cuenta">${choferes().map(ch => `<span>${chipChof(ch.uid)} <b>${cuenta[ch.uid] || 0}</b></span>`).join('')}<span>${chipChof(null)} <b class="${sin ? 'no' : ''}">${sin}</b></span></div>`;
  const q = busq[3].toLowerCase(), f = filtro[3];
  const vis = cls.filter(c => {
    const ch = chofCli(c.n);
    const okF = f === 'todos' || (f === 'sin' && !ch) || (f === 'mios' && yo && ch === yo.uid);
    const okQ = !q || c.nombre.toLowerCase().includes(q) || c.n.includes(q) || c.pedidos.some(p => p.includes(q));
    return okF && okQ;
  });
  if (!vis.length) { root.innerHTML = `<div class="empty"><p>${f === 'sin' ? '✓ Todos los clientes tienen chófer.' : f === 'mios' ? 'Todavía no has tomado clientes. Ve a «Sin asignar» y toca «Lo llevo yo».' : 'No hay clientes que coincidan.'}</p></div>`; return; }
  const opts = (sel, txt) => `<option value="">${txt}</option>` + choferes().filter(ch => ch.uid !== sel).map(ch => `<option value="${esc(ch.uid)}">${esc(ch.nombre)}</option>`).join('');
  root.innerHTML = vis.map(c => {
    const ch = chofCli(c.n), mio = yo && ch === yo.uid, alms = almsDe(c);
    let acc = '';
    if (!ch) acc = (esChofer() ? `<button type="button" class="btn sm" data-tomar="${esc(c.n)}">Lo llevo yo</button>` : '') + (esOficina() ? `<select class="pasar" data-n="${esc(c.n)}" aria-label="Asignar a">${opts(null, 'Asignar a…')}</select>` : '');
    else if (mio || esOficina()) acc = `<button type="button" class="btn ghost sm" data-soltar="${esc(c.n)}">Soltar</button><select class="pasar" data-n="${esc(c.n)}" aria-label="Pasar a">${opts(ch, 'Pasar a…')}</select>`;
    return `<article class="clie${ch ? ' asignado' : ''}" style="--c:${esc(ch ? colorDe(ch) : 'var(--line)')}">
      <div class="row1"><span class="code">Cliente ${esc(c.n)} · Pedido${c.pedidos.length > 1 ? 's' : ''} ${c.pedidos.map(esc).join(', ')}</span><span class="qty">${lineasDe(c)} productos</span></div>
      <p class="desc">${esc(c.nombre)}</p>
      <div class="meta">${alms.map(g => `<span class="chip-st" title="Almacén ${esc(g)}">${esc(g)}${chofAlm(g) ? ' · ' + esc(nombreDe(chofAlm(g)).split(' ')[0]) : ''}</span>`).join('')}</div>
      <div class="clie-f">${chipChof(ch)}<span class="acc">${acc}</span></div>
    </article>`;
  }).join('');
}
async function asignarCliente(n, para, { soloSiLibre = false } = {}) {
  const ref = doc(db, 'dias', fecha, 'asignaciones', String(n));
  try {
    await runTransaction(db, async tx => {
      const s = await tx.get(ref); const cur = s.exists() ? s.data() : null;
      const dueño = cur && cur.chofer;
      if (dueño && soloSiLibre && dueño !== yo.uid) { const e = new Error('ocupado'); e.code = 'ocupado'; e.quien = dueño; throw e; }
      if (dueño && !soloSiLibre && dueño !== yo.uid && !esOficina()) { const e = new Error('ocupado'); e.code = 'ocupado'; e.quien = dueño; throw e; }
      if (para) tx.set(ref, { chofer: para, ...firma() }); else tx.delete(ref);
    });
    return true;
  } catch (e) { if (e.code === 'ocupado') toast('Ya lo tiene ' + nombreDe(e.quien)); else errGuardar(e); return false; }
}
$('#lista3').addEventListener('click', async e => {
  const t = e.target.closest('[data-tomar]');
  if (t) { t.disabled = true; if (await asignarCliente(t.dataset.tomar, yo.uid, { soloSiLibre: true })) toast('✓ Cliente asignado a ti'); t.disabled = false; return; }
  const s = e.target.closest('[data-soltar]');
  if (s) { if (await asignarCliente(s.dataset.soltar, null)) toast('Cliente liberado'); }
});
$('#lista3').addEventListener('change', async e => {
  const s = e.target.closest('.pasar'); if (!s || !s.value) return;
  const para = s.value; s.disabled = true;
  if (await asignarCliente(s.dataset.n, para)) toast('✓ Asignado a ' + nombreDe(para));
  s.disabled = false;
});

/* ================= 3 REPARTO ================= */
const cache2 = {};
const abiertos2 = new Set(); // proveedores abiertos en Reparto (empiezan cerrados)
function buildReparto() {
  const root = $('#lista2');
  if (!dia) { root.innerHTML = emptyHTML(); return; }
  root.innerHTML = grupos().map(gr => `
    <section class="sec${abiertos2.has(gr.g) ? '' : ' closed'}" data-g="${esc(gr.g)}">
      <div class="sec-h"><button class="tog" type="button" aria-expanded="${abiertos2.has(gr.g)}"><span class="tt"><span class="name">Proveedor ${esc(gr.g)} <span class="alm-chof"></span></span><span class="cnt"></span></span><span class="car">▾</span></button></div>
      <div class="items">${gr.items.map(pr => `<article class="prod" id="r-${esc(pr.k)}" data-k="${esc(pr.k)}"></article>`).join('')}</div>
      <div class="sec-f"><span></span><button class="sig" type="button" data-sig="${esc(gr.g)}">Siguiente →</button></div>
    </section>`).join('');
  Object.keys(cache2).forEach(k => delete cache2[k]);
  refreshReparto();
}
function prodHTML(pr, filas) {
  const d = disponible(pr), sum = sumaLleva(pr), ek = isEK(pr), todos = filas.length === pr.a.length;
  let alerta = '';
  if (corto(pr)) {
    const sobra = sum - d;
    alerta = sobra > 0.0001
      ? `<div class="alerta-box">Solo hay ${fmtQ(d)} de ${fmtQ(pr.q)}. Decide a quién le falta: quita ${fmtQ(sobra)} en «Lleva».</div>`
      : `<div class="alerta-box okb">Faltante repartido: ${fmtQ(d)} de ${fmtQ(pr.q)} asignados.</div>`;
  }
  const rows = filas.map(a => {
    const cl = cliBy[a.p] || { nombre: 'Pedido ' + a.p, n: '' };
    const lv = lleva(pr, a), ok = separado(pr, a.p), ch = chofPed(a.p);
    let row2 = '';
    if (corto(pr)) row2 += `<span class="small">Lleva</span><span class="step sm"><button type="button" data-lv="-1" aria-label="Menos">−</button><input class="lleva" type="number" inputmode="numeric" min="0" max="${a.q}" step="1" value="${lv}" aria-label="Lleva"><button type="button" data-lv="1" aria-label="Más">+</button></span><span class="small">de ${fmtQ(a.q)}</span>`;
    if (ek && lv > 0) {
      const ps = pesosDe(pr, a.p); const n = Math.round(lv);
      row2 += `<div class="pesos">${Array.from({ length: n }, (_, i) => `<input class="peso" data-i="${i}" type="text" inputmode="decimal" placeholder="kg ${i + 1}" value="${ps[i] != null ? String(ps[i]).replace('.', ',') : ''}" aria-label="Peso pieza ${i + 1}">`).join('')}<span class="kg">= ${fmtKg(kgCli(pr, a))}</span></div>`;
    }
    return `<div class="cli${ok ? ' sep' : ''}" data-p="${esc(a.p)}">
      <div class="cn">${esc(cl.nombre)}<small>Pedido ${esc(a.p)} · ${fmtQ(a.q)} ${ek ? 'pzs' : 'uds'}${lv !== a.q ? ` · lleva ${fmtQ(lv)}` : ''}</small>${ambito[2] === 'todos' || !esChofer() ? chipChof(ch) : ''}</div>
      ${lv === 0 && !ok ? '<span class="chip-st bad">No lleva</span>' : `<button type="button" class="sepb" aria-pressed="${ok}">${ok ? '✓ Separado' : 'Separar'}</button>`}
      ${row2 ? `<div class="row2">${row2}</div>` : ''}
    </div>`;
  }).join('');
  return `<div class="row1"><span class="code">${esc(pr.c)}</span><span class="qty"><b>${fmtQ(pr.q)}</b> ${ek ? '<span class="um ek">EK · piezas</span>' : 'uds'}</span></div>
    <p class="desc">${esc(pr.d)}</p>
    <div class="meta">${estadoRecChip(pr)}${ek ? `<span class="chip-st">${fmtKg(kgProd(pr))} en total</span>` : ''}<span class="chip-st">${todos ? pr.a.length + ' cliente' + (pr.a.length === 1 ? '' : 's') : filas.length + ' de ' + pr.a.length + ' clientes son tuyos'}</span></div>
    ${alerta}<div class="clis">${rows}</div>`;
}
function refreshReparto() {
  if (!dia) return;
  const q = busq[2].toLowerCase(), f = filtro[2];
  dia.productos.forEach(pr => {
    const el = document.getElementById('r-' + pr.k); if (!el) return;
    const filas = filasVisibles(pr);
    if (!filas.length) { el.hidden = true; return; }
    const html = prodHTML(pr, filas);
    if (cache2[pr.k] !== html) {
      if (el.contains(document.activeElement) && document.activeElement.tagName === 'INPUT') el.dataset.dirty = '1';
      else { el.innerHTML = html; cache2[pr.k] = html; el.dataset.dirty = ''; }
    }
    el.classList.toggle('done', prodListo(pr, filas)); el.classList.toggle('alerta', porDecidir(pr));
    const okQ = !q || pr.c.toLowerCase().includes(q) || pr.d.toLowerCase().includes(q) || filas.some(a => ((cliBy[a.p] || {}).nombre || '').toLowerCase().includes(q));
    const okF = f === 'todos' || (f === 'pend' && !prodListo(pr, filas)) || (f === 'falt' && corto(pr)) || (f === 'ek' && isEK(pr));
    el.hidden = !(okQ && okF);
  });
  document.querySelectorAll('#lista2 .sec').forEach(sec => {
    const g = sec.dataset.g, its = dia.productos.filter(i => i.g === g && filasVisibles(i).length);
    const done = its.filter(i => prodListo(i, filasVisibles(i))).length, comp = its.length > 0 && done === its.length;
    sec.querySelector('.cnt').textContent = comp ? `✓ Completo · ${its.length} productos separados` : `${done} de ${its.length} productos separados`;
    sec.querySelector('.alm-chof').innerHTML = chipChof(chofAlm(g));
    sec.classList.toggle('completo', comp);
    sec.hidden = !its.some(i => !document.getElementById('r-' + i.k).hidden);
  });
  const soloMios = ambito[2] === 'mios' && esChofer();
  const av = $('#aviso2'); av.hidden = !(soloMios && dia);
  if (soloMios) { const n = clientesDia().filter(c => chofCli(c.n) === yo.uid).length; av.innerHTML = n ? `Ves solo tus <b>${n} cliente${n === 1 ? '' : 's'}</b>. Para ver todos, toca <b>Todos</b>.` : 'Todavía no tienes clientes. Tómalos en la pestaña <b>2 Clientes</b>.'; }
}
$('#lista2').addEventListener('focusout', e => {
  const el = e.target.closest('.prod');
  setTimeout(() => { if (el && el.dataset.dirty === '1' && !el.contains(document.activeElement)) refreshReparto(); }, 0);
});
const pendRep = {};
function saveRep(pr, p, patch) {
  if (!fecha) return;
  const antes = grupoListo(2, pr.g);
  const cur = rep[pr.k] || { cli: {} };
  const merged = { ...((cur.cli || {})[p] || {}), ...patch };
  rep[pr.k] = { ...cur, cli: { ...(cur.cli || {}), [p]: merged } };
  refreshAll();
  if (!antes && grupoListo(2, pr.g)) programarSiguiente(2, pr.g);
  const ref = doc(db, 'dias', fecha, 'reparto', pr.k);
  const body = { codigo: pr.c, ...firma(), cli: { [p]: merged } };
  pendRep[pr.k] = (pendRep[pr.k] || Promise.resolve()).then(() => setDoc(ref, body, { merge: true })).catch(errGuardar);
}
function ctxRep(e) { const el = e.target.closest('.prod'); const row = e.target.closest('.cli'); if (!el || !row) return null; const pr = prodByK(el.dataset.k); const a = pr && pr.a.find(x => x.p === row.dataset.p); return pr && a ? { pr, a, row } : null; }
$('#lista2').addEventListener('click', e => {
  const tog = e.target.closest('.tog');
  if (tog) { const sec = tog.closest('.sec'); setOpen(2, sec.dataset.g, sec.classList.contains('closed')); return; }
  const sg = e.target.closest('[data-sig]');
  if (sg) { siguiente(2, sg.dataset.sig, false); return; }
  const c = ctxRep(e); if (!c) return;
  if (e.target.closest('.sepb')) {
    const ok = !separado(c.pr, c.a.p);
    if (ok && isEK(c.pr) && piezasPesadas(c.pr, c.a) < Math.round(lleva(c.pr, c.a))) toast('Ojo: faltan pesos por escribir');
    saveRep(c.pr, c.a.p, { ok }); return;
  }
  const b = e.target.closest('[data-lv]');
  if (b) { let v = lleva(c.pr, c.a) + Number(b.dataset.lv); v = Math.min(Math.max(0, v), c.a.q); saveRep(c.pr, c.a.p, { lleva: v }); }
});
$('#lista2').addEventListener('change', e => {
  const c = ctxRep(e); if (!c) return;
  if (e.target.matches('.lleva')) { let v = Number(e.target.value); if (isNaN(v) || v < 0) v = 0; v = Math.min(v, c.a.q); saveRep(c.pr, c.a.p, { lleva: v }); }
  if (e.target.matches('.peso')) {
    const vals = [...c.row.querySelectorAll('.peso')].map(i => parseKg(i.value));
    if (vals.some(v => Number.isNaN(v))) { toast('Escribe el peso en kg, por ejemplo 2,350'); return; }
    if (vals.some(v => v != null && v > 50)) toast('Revisa el peso: parece muy alto');
    saveRep(c.pr, c.a.p, { pesos: vals });
  }
});

/* ================= 4 TRASPASOS ================= */
// Un traspaso: algo que recoge un chófer en su almacén y es para un cliente de otro chófer.
function traspasos() {
  if (!dia) return { lista: [], sinAlm: 0, sinCli: 0 };
  const lista = []; let sinAlm = 0, sinCli = 0;
  dia.productos.forEach(pr => {
    const A = chofAlm(pr.g);
    pr.a.forEach(a => {
      const lv = lleva(pr, a); if (lv <= 0) return;
      const B = chofPed(a.p);
      if (!A) { sinAlm++; return; }
      if (!B) { sinCli++; return; }
      if (A !== B) lista.push({ pr, a, lv, de: A, para: B, id: pr.k + '__' + a.p });
    });
  });
  return { lista, sinAlm, sinCli };
}
const trasOk = id => !!(tras[id] && tras[id].ok);
function grupoTrasHTML(titulo, uid, items, puedeMarcar) {
  const hechos = items.filter(t => trasOk(t.id)).length, comp = hechos === items.length;
  return `<section class="sec tras${comp ? ' completo' : ''}">
    <div class="sec-h"><div class="tt" style="padding:12px 14px"><span class="name">${titulo} ${chipChof(uid)}</span><span class="cnt">${comp ? '✓ Todo entregado · ' : ''}${hechos} de ${items.length} entregados</span></div></div>
    <div class="items">${items.map(t => `<div class="tr-it${trasOk(t.id) ? ' ok' : ''}">
        <div class="cn"><b>${esc(t.pr.d)}</b><small>${esc(t.pr.g)} · ${esc(t.pr.c)} · para ${esc((cliBy[t.a.p] || {}).nombre || t.a.p)} (pedido ${esc(t.a.p)})</small></div>
        <span class="qty"><b>${fmtQ(t.lv)}</b> ${isEK(t.pr) ? 'pzs' : 'uds'}</span>
        ${puedeMarcar ? `<button type="button" class="sepb" data-tras="${esc(t.id)}" aria-pressed="${trasOk(t.id)}">${trasOk(t.id) ? '✓ Entregado' : 'Entregar'}</button>` : `<span class="chip-st ${trasOk(t.id) ? 'ok' : ''}">${trasOk(t.id) ? '✓ Recibido' : 'Pendiente'}</span>`}
      </div>`).join('')}</div>
    ${puedeMarcar && !comp ? `<div class="sec-f" style="display:flex"><span></span><button class="allok" type="button" data-tras-todo="${esc(items.map(t => t.id).join(','))}">Marcar todo entregado</button></div>` : ''}
  </section>`;
}
function renderTraspasos() {
  const root = $('#lista4');
  if (!dia) { root.innerHTML = emptyHTML(); return; }
  const T = traspasos();
  let h = '';
  if (T.sinAlm || T.sinCli) h += `<div class="warnbox">Faltan asignaciones: ${T.sinAlm ? `<b>${T.sinAlm}</b> productos de almacenes sin chófer` : ''}${T.sinAlm && T.sinCli ? ' y ' : ''}${T.sinCli ? `<b>${T.sinCli}</b> productos de clientes sin chófer` : ''}. Hasta completarlas, los traspasos no estarán completos.</div>`;
  const agrupar = (arr, key) => { const m = new Map(); arr.forEach(t => { if (!m.has(t[key])) m.set(t[key], []); m.get(t[key]).push(t); }); return [...m.entries()]; };
  if (esChofer()) {
    const dar = T.lista.filter(t => t.de === yo.uid), recibir = T.lista.filter(t => t.para === yo.uid);
    h += `<h2 class="tit">Entregar a compañeros</h2>` + (dar.length ? agrupar(dar, 'para').map(([uid, it]) => grupoTrasHTML('Para', uid, it, true)).join('') : '<p class="small">No tienes nada que entregar a otros chóferes.</p>');
    h += `<h2 class="tit">Recibir de compañeros</h2>` + (recibir.length ? agrupar(recibir, 'de').map(([uid, it]) => grupoTrasHTML('De', uid, it, false)).join('') : '<p class="small">Nadie tiene que traerte nada.</p>');
  } else {
    h += `<h2 class="tit">Todos los traspasos</h2>` + (T.lista.length ? agrupar(T.lista, 'de').map(([de, it]) => agrupar(it, 'para').map(([para, it2]) => grupoTrasHTML(esc(nombreDe(de)) + ' →', para, it2, true)).join('')).join('') : '<p class="small">No hay traspasos entre chóferes.</p>');
  }
  root.innerHTML = h;
}
function marcarTras(ids, ok) {
  ids.forEach(id => {
    tras[id] = { ok, ...firma() };
    const ref = doc(db, 'dias', fecha, 'traspasos', id);
    (ok ? setDoc(ref, tras[id]) : deleteDoc(ref)).catch(errGuardar);
  });
  renderTraspasos(); renderStats();
}
$('#lista4').addEventListener('click', e => {
  const b = e.target.closest('[data-tras]'); if (b) { marcarTras([b.dataset.tras], !trasOk(b.dataset.tras)); return; }
  const t = e.target.closest('[data-tras-todo]'); if (t) marcarTras(t.dataset.trasTodo.split(','), true);
});

/* ================= proveedores: abrir, cerrar y pasar al siguiente ================= */
const LISTA = { 1: '#lista1', 2: '#lista2' };
const abiertosDe = n => n === 1 ? abiertos1 : abiertos2;
function grupoListo(n, g) { if (!dia) return false; const its = dia.productos.filter(i => i.g === g && (n === 1 || filasVisibles(i).length)); return its.length > 0 && its.every(i => n === 1 ? est(i) : prodListo(i, filasVisibles(i))); }
function secDe(n, g) { return [...document.querySelectorAll(LISTA[n] + ' .sec')].find(s => s.dataset.g === g); }
function setOpen(n, g, open) {
  const sec = secDe(n, g); if (!sec) return;
  sec.classList.toggle('closed', !open); sec.querySelector('.tog').setAttribute('aria-expanded', String(open));
  if (open) abiertosDe(n).add(g); else abiertosDe(n).delete(g);
}
function irA(n, g) { const sec = secDe(n, g); if (!sec) return; const y = sec.getBoundingClientRect().top + scrollY - $('header').offsetHeight - 10; scrollTo({ top: Math.max(0, y), behavior: 'smooth' }); }
function siguiente(n, g, auto) {
  const gs = [...document.querySelectorAll(LISTA[n] + ' .sec')].filter(s => !s.hidden).map(s => s.dataset.g), i = gs.indexOf(g);
  setOpen(n, g, false);
  let nx = null;
  for (let j = 1; j < gs.length; j++) { const c = gs[(i + j) % gs.length]; if (!grupoListo(n, c)) { nx = c; break; } }
  if (!nx) { irA(n, g); toast(n === 1 ? '✓ Recogida completa. Sigue con tus clientes' : '✓ Reparto completo. Revisa los traspasos'); return; }
  setOpen(n, nx, true); irA(n, nx);
  if (auto) toast(`✓ Proveedor ${g} completo · sigue ${nx}`);
}
const timers = {};
function programarSiguiente(n, g) {
  if (busq[n]) return; // con búsqueda activa no movemos la pantalla
  clearTimeout(timers[n + g]);
  timers[n + g] = setTimeout(() => { if (grupoListo(n, g) && abiertosDe(n).has(g)) siguiente(n, g, true); }, 700);
}

/* ================= filtros y búsqueda ================= */
document.querySelectorAll('.chips').forEach(g => g.addEventListener('click', e => {
  const b = e.target.closest('.chip'); if (!b) return; const n = g.dataset.for;
  filtro[n] = b.dataset.f; g.querySelectorAll('.chip').forEach(x => x.setAttribute('aria-pressed', String(x === b)));
  n === '1' ? refreshRecogida() : n === '2' ? refreshReparto() : renderClientes();
}));
document.querySelectorAll('.seg').forEach(g => g.addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return; const n = g.dataset.ambito;
  ambito[n] = b.dataset.v; syncSeg();
  if (n === '1') refreshRecogida(); else { Object.keys(cache2).forEach(k => delete cache2[k]); refreshReparto(); }
}));
$('#buscar1').addEventListener('input', e => { busq[1] = e.target.value.trim(); $('#lista1').classList.toggle('buscando', !!busq[1]); refreshRecogida(); });
$('#buscar2').addEventListener('input', e => { busq[2] = e.target.value.trim(); $('#lista2').classList.toggle('buscando', !!busq[2]); refreshReparto(); });
$('#buscar3').addEventListener('input', e => { busq[3] = e.target.value.trim(); renderClientes(); });

/* ================= cabecera ================= */
function renderStats() {
  const st = $('#stats');
  if (!yo) { st.innerHTML = '<span>Entra con tu usuario para empezar</span>'; $('#pbar').style.width = '0'; return; }
  if (!dia) { st.innerHTML = fechaSel === hoy() ? '<span>Esperando la lista de hoy</span>' : '<span>Sin datos para este día</span>'; $('#pbar').style.width = '0'; return; }
  const P = dia.productos, v = vista();
  if (v === 'clientes') {
    const cls = clientesDia(), asig_ = cls.filter(c => chofCli(c.n)).length;
    $('#pbar').style.width = (cls.length ? asig_ / cls.length * 100 : 0) + '%';
    st.innerHTML = `<span><b>${asig_}</b> de ${cls.length} clientes asignados</span>${yo && esChofer() ? `<span><b>${cls.filter(c => chofCli(c.n) === yo.uid).length}</b> tuyos</span>` : ''}<span class="s-no"><b>${cls.length - asig_}</b> sin asignar</span>`;
  } else if (v === 'reparto') {
    const filas = P.flatMap(pr => filasVisibles(pr).map(a => [pr, a])), sep = filas.filter(([pr, a]) => lineaLista(pr, a)).length;
    $('#pbar').style.width = (filas.length ? sep / filas.length * 100 : 0) + '%';
    st.innerHTML = `<span><b>${sep}</b> de ${filas.length} separados</span><span class="s-no"><b>${P.filter(porDecidir).length}</b> por decidir</span><span><b>${P.filter(isEK).length}</b> EK</span>`;
  } else if (v === 'traspasos') {
    const T = traspasos().lista.filter(t => !esChofer() || t.de === yo.uid || t.para === yo.uid), ok = T.filter(t => trasOk(t.id)).length;
    $('#pbar').style.width = (T.length ? ok / T.length * 100 : 0) + '%';
    st.innerHTML = `<span><b>${ok}</b> de ${T.length} traspasos entregados</span>`;
  } else {
    const ps = ambito[1] === 'mios' && esChofer() ? P.filter(pr => misAlmacenes().includes(pr.g)) : P;
    const rev = ps.filter(est).length;
    $('#pbar').style.width = (ps.length ? rev / ps.length * 100 : 0) + '%';
    st.innerHTML = `<span><b>${rev}</b> de ${ps.length} recogidos</span><span class="s-no"><b>${ps.filter(isIssue1).length}</b> con faltas</span>`;
  }
  const falt = P.filter(isIssue1).length;
  $('#bar-btn').textContent = falt ? `Resumen y envío · ${falt} con faltas` : 'Resumen y envío';
}

/* ================= RESUMEN ================= */
function datosResumen() {
  const P = dia.productos;
  const faltProv = P.filter(isIssue1);
  const porCli = {};
  P.forEach(pr => pr.a.forEach(a => {
    const lv = lleva(pr, a);
    if (corto(pr) && (lv < a.q || porDecidir(pr))) (porCli[a.p] = porCli[a.p] || []).push({ pr, a, lv, dec: porDecidir(pr) });
  }));
  const ek = {};
  P.filter(isEK).forEach(pr => pr.a.forEach(a => { const lv = lleva(pr, a); if (lv > 0) (ek[a.p] = ek[a.p] || []).push({ pr, a, lv, kg: kgCli(pr, a), pes: piezasPesadas(pr, a) }); }));
  const nombres = [...new Set([...Object.values(rec), ...Object.values(rep)].map(m => m.nombre).filter(Boolean))];
  // avance por chófer
  const T = traspasos().lista;
  const porChof = choferes().map(ch => {
    const cls = clientesDia().filter(c => chofCli(c.n) === ch.uid);
    const peds = new Set(cls.flatMap(c => c.pedidos));
    const filas = P.flatMap(pr => pr.a.filter(a => peds.has(a.p)).map(a => [pr, a]));
    const alms = grupos().map(x => x.g).filter(g => chofAlm(g) === ch.uid);
    const prodsAlm = P.filter(pr => alms.includes(pr.g));
    return { ch, clientes: cls.length, lineas: filas.length, sep: filas.filter(([pr, a]) => lineaLista(pr, a)).length, alms, rec: prodsAlm.filter(est).length, prods: prodsAlm.length, dar: T.filter(t => t.de === ch.uid && !trasOk(t.id)).length, recibir: T.filter(t => t.para === ch.uid && !trasOk(t.id)).length };
  });
  const sinCli = clientesDia().filter(c => !chofCli(c.n)).length, sinAlm = grupos().map(x => x.g).filter(g => !chofAlm(g));
  return { faltProv, porCli, ek, nombres, porChof, sinCli, sinAlm };
}
const ordenCli = obj => dia.clientes.map(c => c.p).filter(p => obj[p]);
function renderResumen() {
  if (!dia) { ['#res-chof', '#res-prov', '#res-cli', '#res-ek'].forEach(s => $(s).innerHTML = ''); $('#sumgrid').innerHTML = ''; $('#msg').textContent = ''; return; }
  const P = dia.productos, D = datosResumen();
  const lineas = P.reduce((s, p) => s + p.a.length, 0), sep = P.reduce((s, p) => s + p.a.filter(a => lineaLista(p, a)).length, 0);
  $('#sumgrid').innerHTML = `<div><b>${P.filter(est).length}/${P.length}</b><span>Recogidos</span></div><div class="g-no"><b>${D.faltProv.length}</b><span>Faltas prov.</span></div><div><b>${sep}/${lineas}</b><span>Separados</span></div><div class="g-par"><b>${Object.keys(D.porCli).length}</b><span>Clientes afect.</span></div>`;
  $('#sumwho').textContent = D.nombres.length ? 'Han marcado: ' + D.nombres.join(', ') : 'Todavía nadie ha marcado.';
  // chóferes
  $('#res-chof').innerHTML = '<span class="lbl">Avance por chófer</span>' +
    (D.sinCli || D.sinAlm.length ? `<div class="warnbox" style="margin-bottom:8px">${D.sinCli ? `<b>${D.sinCli}</b> clientes sin chófer. ` : ''}${D.sinAlm.length ? `Almacenes sin chófer: <b>${D.sinAlm.map(esc).join(', ')}</b>.` : ''}</div>` : '') +
    '<ul>' + D.porChof.map(x => `<li><span class="t">${chipChof(x.ch.uid)}</span><span class="m">Almacenes: ${x.alms.length ? x.alms.map(esc).join(', ') + ` · recogidos ${x.rec}/${x.prods}` : '—'}</span><span class="m">Clientes: ${x.clientes} · separados ${x.sep}/${x.lineas}</span><span class="m">Traspasos pendientes: entregar ${x.dar} · recibir ${x.recibir}</span></li>`).join('') + '</ul>';
  // proveedor
  if (!D.faltProv.length) $('#res-prov').innerHTML = '<span class="lbl">Faltantes en proveedor</span><p class="hint" style="margin:0">Sin faltantes.</p>';
  else { let h = '<span class="lbl">Faltantes en proveedor</span>', g = null; D.faltProv.forEach(pr => { const m = R(pr); if (pr.g !== g) { if (g) h += '</ul>'; g = pr.g; h += `<h3>${esc(g)}</h3><ul>`; } const st = m.estado === 'no' ? '<span class="no">No hay</span>' : m.estado === 'parcial' ? `<span class="par">Hay ${fmtQ(m.quedan ?? 0)} · faltan ${fmtQ(pr.q - (m.quedan ?? 0))}</span>` : 'Con nota'; h += `<li><span class="t">${esc(pr.d)}</span><span class="m">${esc(pr.c)} · pedido ${fmtQ(pr.q)} · ${st}</span>${m.nota ? `<span class="m">Nota: ${esc(m.nota)}</span>` : ''}</li>`; }); $('#res-prov').innerHTML = h + '</ul>'; }
  // clientes
  const pc = ordenCli(D.porCli);
  if (!pc.length) $('#res-cli').innerHTML = '<span class="lbl">Clientes con faltas</span><p class="hint" style="margin:0">Ningún cliente afectado.</p>';
  else $('#res-cli').innerHTML = '<span class="lbl">Clientes con faltas</span><ul>' + pc.map(p => `<li><span class="t">${esc(cliBy[p].nombre)} · ${esc(p)} ${chipChof(chofPed(p))}</span>${D.porCli[p].map(x => `<span class="m">${esc(x.pr.d)} · ${x.dec ? '<span class="no">por decidir</span>' : `<span class="par">lleva ${fmtQ(x.lv)} de ${fmtQ(x.a.q)}</span>`}</span>`).join('')}</li>`).join('') + '</ul>';
  // EK
  const pe = ordenCli(D.ek);
  if (!pe.length) $('#res-ek').innerHTML = '<span class="lbl">Pesos EK por cliente</span><p class="hint" style="margin:0">No hay productos EK.</p>';
  else $('#res-ek').innerHTML = '<span class="lbl">Pesos EK por cliente</span><ul>' + pe.map(p => { const xs = D.ek[p], tot = xs.reduce((s, x) => s + x.kg, 0); return `<li><span class="t">${esc(cliBy[p].nombre)} · ${esc(p)} — ${fmtKg(tot)}</span>${xs.map(x => `<span class="m">${esc(x.pr.d)} · ${fmtQ(x.lv)} pzs · ${x.pes < Math.round(x.lv) ? `<span class="par">${x.pes}/${Math.round(x.lv)} pesadas</span> · ` : ''}<b>${fmtKg(x.kg)}</b></span>`).join('')}</li>`; }).join('') + '</ul>';
  const msg = buildMsg(D); $('#msg').textContent = msg; $('#wa').href = 'https://wa.me/?text=' + encodeURIComponent(msg);
}
function buildMsg(D) {
  const P = dia.productos;
  const lineas = P.reduce((s, p) => s + p.a.length, 0), sep = P.reduce((s, p) => s + p.a.filter(a => lineaLista(p, a)).length, 0);
  let o = `CONTROL · ANTONIO VIÑA · ${fmtF(fecha)}\nMarcaron: ${D.nombres.join(', ') || 'nadie todavía'}\nRecogidos ${P.filter(est).length}/${P.length} · Separados ${sep}/${lineas}\n`;
  o += '\nCHÓFERES'; D.porChof.forEach(x => { o += `\n• ${x.ch.nombre}: ${x.clientes} clientes · separados ${x.sep}/${x.lineas}` + (x.alms.length ? ` · almacenes ${x.alms.join(', ')}` : ''); });
  if (D.sinCli) o += `\n• Sin chófer: ${D.sinCli} clientes`;
  o += '\n';
  if (D.faltProv.length) { o += '\nFALTANTES EN PROVEEDOR'; let g = null; D.faltProv.forEach(pr => { const m = R(pr); if (pr.g !== g) { g = pr.g; o += `\n${g}`; } o += `\n• ${pr.c} ${pr.d} — pedido ${fmtQ(pr.q)}` + (m.estado === 'no' ? ' · NO HAY' : m.estado === 'parcial' ? ` · hay ${fmtQ(m.quedan ?? 0)} · faltan ${fmtQ(pr.q - (m.quedan ?? 0))}` : '') + (m.nota ? `\n   Nota: ${m.nota}` : ''); }); o += '\n'; }
  else o += '\nSin faltantes en proveedor.\n';
  const pc = ordenCli(D.porCli);
  if (pc.length) { o += '\nCLIENTES CON FALTAS'; pc.forEach(p => { o += `\n• ${p} ${cliBy[p].nombre}`; D.porCli[p].forEach(x => { o += `\n   ${x.pr.d}: ` + (x.dec ? 'POR DECIDIR' : `lleva ${fmtQ(x.lv)} de ${fmtQ(x.a.q)}`); }); }); o += '\n'; }
  const pe = ordenCli(D.ek);
  const conPeso = pe.filter(p => D.ek[p].some(x => x.pes > 0));
  if (conPeso.length) { o += '\nPESOS EK'; conPeso.forEach(p => { const xs = D.ek[p].filter(x => x.pes > 0); o += `\n• ${p} ${cliBy[p].nombre} — ${fmtKg(xs.reduce((s, x) => s + x.kg, 0))}`; xs.forEach(x => { o += `\n   ${x.pr.d}: ${fmtQ(x.lv)} pzs = ${fmtKg(x.kg)}` + (x.pes < Math.round(x.lv) ? ` (${x.pes}/${Math.round(x.lv)} pesadas)` : ''); }); }); o += '\n'; }
  let sinPesar = 0, cliSin = 0;
  pe.forEach(p => { const n = D.ek[p].reduce((s, x) => s + Math.max(0, Math.round(x.lv) - x.pes), 0); sinPesar += n; if (n) cliSin++; });
  if (sinPesar) o += `\nEK sin pesar: ${sinPesar} piezas en ${cliSin} cliente${cliSin === 1 ? '' : 's'}.`;
  return o.trim();
}
$('#copiar').addEventListener('click', () => {
  const t = $('#msg').textContent;
  const sel = () => { const r = document.createRange(); r.selectNodeContents($('#msg')); const s = getSelection(); s.removeAllRanges(); s.addRange(r); toast('Texto seleccionado: cópialo'); };
  try { navigator.clipboard.writeText(t).then(() => toast('Texto copiado'), sel); } catch (e) { sel(); }
});

/* ================= OFICINA ================= */
function renderOficina() {
  // Almacenes del día
  const box = $('#almacenes');
  if (!dia) box.innerHTML = '<p class="small">Cuando se cargue el día aparecerán sus almacenes.</p>';
  else {
    const opts = sel => `<option value="">— Sin chófer —</option>` + choferes().map(ch => `<option value="${esc(ch.uid)}"${ch.uid === sel ? ' selected' : ''}>${esc(ch.nombre)}</option>`).join('');
    box.innerHTML = '<div class="alms">' + grupos().map(gr => {
      const ch = chofAlm(gr.g), hab = habitual[gr.g] || null, propio = !almHabitualSinCambio(gr.g);
      return `<div class="alm" data-g="${esc(gr.g)}"><div><b>${esc(gr.g)}</b><small>${gr.items.length} productos · habitual: ${hab ? esc(nombreDe(hab)) : '—'}${propio && ch !== hab ? ' · <span class="par">cambiado hoy</span>' : ''}</small></div>
        <select class="alm-sel" aria-label="Chófer para ${esc(gr.g)}">${opts(ch)}</select>
        ${ch !== hab ? `<button type="button" class="add-nota" data-habitual="${esc(gr.g)}">Hacer habitual</button>` : '<span class="small">✓ habitual</span>'}</div>`;
    }).join('') + '</div>';
  }
  // Usuarios
  $('#usuarios').innerHTML = Object.entries(usuarios).sort((a, b) => (a[1].orden ?? 9) - (b[1].orden ?? 9)).map(([uid, u]) => `<li>${chipChof(uid, u.nombre)} <span class="small">${u.rol === 'oficina' ? 'Oficina' : 'Chófer'}${DEMO && u.pinDemo ? ' · PIN de prueba ' + esc(u.pinDemo) : ''}</span></li>`).join('');
}
$('#almacenes').addEventListener('change', e => {
  const s = e.target.closest('.alm-sel'); if (!s || !fecha) return;
  const g = s.closest('.alm').dataset.g, ch = s.value || null;
  almDia[g] = { chofer: ch, ...firma() };
  setDoc(doc(db, 'dias', fecha, 'almacenes', g), almDia[g]).catch(errGuardar);
  // Si aún no tenía chófer habitual, este pasa a ser el habitual.
  if (ch && !habitual[g]) { habitual[g] = ch; setDoc(doc(db, 'config', 'almacenes'), { habitual: { [g]: ch } }, { merge: true }).catch(errGuardar); }
  toast(`${g} → ${ch ? nombreDe(ch) : 'sin chófer'}`); renderOficina(); refreshAll();
});
$('#almacenes').addEventListener('click', e => {
  const b = e.target.closest('[data-habitual]'); if (!b) return;
  const g = b.dataset.habitual, ch = chofAlm(g);
  habitual[g] = ch; setDoc(doc(db, 'config', 'almacenes'), { habitual: { [g]: ch } }, { merge: true }).catch(errGuardar);
  toast(`${g}: ${ch ? nombreDe(ch) : 'sin chófer'} queda como habitual`); renderOficina();
});

/* ================= refresco general ================= */
function refreshAll() {
  refreshRecogida(); refreshReparto(); renderStats();
  const v = vista();
  if (v === 'resumen') renderResumen(); if (v === 'clientes') renderClientes(); if (v === 'traspasos') renderTraspasos(); if (v === 'oficina') renderOficina();
}

/* ================= días ================= */
// fechaSel: el día elegido (puede no estar cargado todavía). fecha: el día cargado que se muestra.
let fechaSel = null, ultimoHoy = hoy();
$('#fecha').addEventListener('change', e => selectFecha(e.target.value));
function renderFechas() {
  const s = $('#fecha'), h = hoy();
  const opts = dias.map(d => `<option value="${esc(d.id)}">${d.id === h ? 'Hoy · ' : ''}${diaF(d.id)} ${fmtF(d.id)} · ${d.productos.length} productos · ${d.clientes.length} pedidos${d.origen === 'correo' ? ' · por correo' : ''}</option>`);
  if (!dias.some(d => d.id === h)) opts.unshift(`<option value="${h}">Hoy · ${diaF(h)} ${fmtF(h)} · sin cargar</option>`);
  s.innerHTML = opts.join('');
  if (fechaSel) s.value = fechaSel;
}
function setDia(d) {
  dia = d ? { ...d, productos: d.productos.map(p => ({ ...p, q: Number(p.q), a: (p.a || []).map(a => ({ ...a, q: Number(a.q) })) })) } : null;
  cliBy = {}; nDe = {}; if (dia) dia.clientes.forEach(c => { cliBy[c.p] = c; nDe[c.p] = String(c.n || c.p); });
}
const coleccion = (nombre, fn) => onSnapshot(collection(db, 'dias', fecha, nombre), snap => { const m = {}; snap.forEach(x => m[x.id] = x.data()); fn(m); refreshAll(); }, errConexion);
function selectFecha(id) {
  fechaSel = id || hoy();
  const d = dias.find(x => x.id === fechaSel);
  const nueva = d ? fechaSel : null;
  const changed = fecha !== nueva;
  fecha = nueva; setDia(d);
  renderFechas();
  buildRecogida(); buildReparto();
  if (changed) {
    rec = {}; rep = {}; asig = {}; almDia = {}; tras = {};
    subsDia.forEach(u => u()); subsDia = [];
    if (fecha) subsDia = [
      coleccion('recogida', m => rec = m), coleccion('reparto', m => rep = m), coleccion('asignaciones', m => asig = m),
      coleccion('almacenes', m => almDia = m), coleccion('traspasos', m => tras = m),
    ];
  }
  refreshAll();
}
onSnapshot(query(collection(db, 'dias'), orderBy('fecha', 'desc'), limit(10)), snap => {
  dias = snap.docs.map(x => ({ id: x.id, ...x.data() }));
  if (fecha && fecha === fechaSel && dias.some(x => x.id === fecha)) { setDia(dias.find(x => x.id === fecha)); renderFechas(); buildRecogida(); buildReparto(); refreshAll(); }
  else selectFecha(fechaSel || hoy()); // al abrir: siempre el día de hoy; si se publica mientras esperan, aparece solo
}, errConexion);
// Si la app queda abierta y cambia el día, pasa sola al nuevo día.
function revisarCambioDeDia() {
  const h = hoy();
  if (h !== ultimoHoy) { const estabaEnHoy = fechaSel === ultimoHoy; ultimoHoy = h; if (estabaEnHoy) { selectFecha(h); toast('Nuevo día: ' + diaF(h) + ' ' + fmtF(h)); } else renderFechas(); }
}
document.addEventListener('visibilitychange', () => { if (!document.hidden) revisarCambioDeDia(); });
setInterval(revisarCambioDeDia, 60000);

/* ================= CARGA DE PDF (oficina) ================= */
let pdfProv = null, pdfDiario = null, cruce = null, unsubReg = null;
function suscribirRegistro() {
  if (unsubReg) { unsubReg(); unsubReg = null; }
  if (esOficina()) unsubReg = onSnapshot(query(collection(db, 'registro'), orderBy('ts', 'desc'), limit(12)), snap => renderRegistro(snap.docs.map(x => x.data())), () => { $('#registro').innerHTML = '<li class="small">No se pudo leer el historial (revisa las reglas de Firebase).</li>'; });
}
const ETQ = { publicado: '✅ Publicado', 'no-cuadra': '❌ No cuadra (no se publicó)', error: '❌ Error en los PDF', falta: '⚠️ Falta un PDF', duplicado: 'ℹ️ Ya estaba cargado' };
function renderRegistro(rows) {
  const ul = $('#registro');
  if (!rows.length) { ul.innerHTML = `<li class="small">${DEMO ? 'En modo prueba no hay carga por correo: usa la carga manual de abajo.' : 'Todavía no ha llegado ningún correo con PDF.'}</li>`; return; }
  ul.innerHTML = rows.map(r => `<li class="${esc(r.estado)}"><span class="t">${ETQ[r.estado] || esc(r.estado)}${r.fecha ? ' · día ' + fmtF(r.fecha) : ''}</span><span class="m">${esc(r.mensaje || '')}</span><span class="m">${r.ts ? new Date(r.ts).toLocaleString([], { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : ''}${r.de ? ' · de ' + esc(r.de) : ''}</span></li>`).join('');
}
function loadScript(src) { return new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('No se pudo cargar el lector de PDF')); document.head.appendChild(s); }); }
async function leerPdf(file) {
  if (!window.pdfjsLib) {
    await loadScript('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js');
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  }
  return pdfLines(window.pdfjsLib, new Uint8Array(await file.arrayBuffer()));
}
async function onFile(file, esperado) {
  if (!file) return;
  const box = $(esperado === 'proveedores' ? '#fb-prov' : '#fb-diario');
  box.querySelector('.st').textContent = 'Leyendo ' + file.name + '…';
  try {
    const lines = await leerPdf(file);
    const tipo = tipoDePdf(lines);
    if (!tipo) throw new Error('Este PDF no parece ni «Ventas por productos» ni «Diario de ventas»');
    if (tipo === 'almacen') throw new Error('Este es el «Diario de ventas por Almacén»: no hace falta. Sube el «Diario de ventas detallado UM»');
    if (tipo === 'proveedores') { pdfProv = parseProveedores(lines); marcarBox('#fb-prov', `${file.name} · ${pdfProv.productos.length} productos`); }
    else { pdfDiario = parseDiario(lines); marcarBox('#fb-diario', `${file.name} · ${pdfDiario.pedidos.length} pedidos`); }
    if (tipo !== esperado) toast('Ese PDF era el otro listado; lo puse en su sitio');
    if (box.id === 'fb-prov' && tipo !== 'proveedores' && !pdfProv) box.querySelector('.st').textContent = 'Falta este PDF';
    if (box.id === 'fb-diario' && tipo !== 'diario' && !pdfDiario) box.querySelector('.st').textContent = 'Falta este PDF';
    verificar();
  } catch (x) { console.error(x); box.classList.remove('listo'); box.querySelector('.st').textContent = x.message || 'No se pudo leer el PDF'; }
}
function marcarBox(sel, txt) { const b = $(sel); b.classList.add('listo'); b.querySelector('.st').textContent = '✓ ' + txt; }
$('#f-prov').addEventListener('change', e => onFile(e.target.files[0], 'proveedores'));
$('#f-diario').addEventListener('change', e => onFile(e.target.files[0], 'diario'));
function verificar() {
  const v = $('#verif');
  if (!pdfProv || !pdfDiario) { v.hidden = true; return; }
  cruce = cruzar(pdfProv, pdfDiario);
  const X = cruce, lineas = X.productos.reduce((s, p) => s + p.a.length, 0), nEK = X.productos.filter(p => p.um === 'EK').length;
  const existe = dias.some(d => d.id === X.fecha);
  let h = `<span class="lbl">Comprobación del ${fmtF(X.fecha) || '¿fecha?'}</span>
    <div class="check"><div><b>${X.productos.length}</b><span>Productos</span></div><div><b>${X.clientes.length}</b><span>Pedidos</span></div><div><b>${lineas}</b><span>Líneas</span></div><div><b>${nEK}</b><span>EK</span></div></div>`;
  if (X.problemas.length) h += `<div class="alerta-box" style="margin-top:10px">No cuadran ${X.problemas.length} producto(s):<br>${X.problemas.map(p => `${esc(p.c)} ${esc(p.d)}: proveedor ${fmtQ(p.proveedor)} · clientes ${fmtQ(p.clientes)}`).join('<br>')}</div>`;
  else h += `<div class="okbox" style="margin-top:10px">✓ Cuadra: lo que se recoge en proveedores es igual a lo que se reparte a clientes.</div>`;
  if (X.fechasDistintas) h += `<div class="warnbox" style="margin-top:10px">Los dos PDF tienen fechas distintas (${fmtF(pdfProv.fecha)} y ${fmtF(pdfDiario.fecha)}). Revisa que sean del mismo día.</div>`;
  if (!X.fecha) h += `<div class="warnbox" style="margin-top:10px">No encontré la fecha en los PDF.</div>`;
  if (existe) h += `<div class="warnbox" style="margin-top:10px">Ya hay datos del ${fmtF(X.fecha)}. Si publicas, se reemplaza la lista y se conservan las marcas de los productos que sigan.</div>`;
  h += `<div class="btnrow" style="margin-top:12px"><button class="btn" id="publicar" type="button" ${X.fecha ? '' : 'disabled'}>${existe ? 'Reemplazar' : 'Publicar'} el día ${fmtF(X.fecha)}${X.problemas.length ? ' de todos modos' : ''}</button></div>`;
  v.innerHTML = h; v.hidden = false;
  $('#publicar').addEventListener('click', publicar);
  v.scrollIntoView({ behavior: 'smooth', block: 'start' });
}
async function publicar() {
  const b = $('#publicar'); b.disabled = true; b.textContent = 'Publicando…';
  try {
    const X = cruce;
    await setDoc(doc(db, 'dias', X.fecha), {
      fecha: X.fecha, creada: ahora(), por: yo ? yo.nombre : '',
      productos: X.productos.map(p => ({ g: p.g, c: p.c, q: p.q, d: p.d, k: p.k, um: p.um, a: p.a })),
      clientes: X.clientes, problemas: X.problemas.length,
    });
    toast('Día ' + fmtF(X.fecha) + ' publicado');
    pdfProv = pdfDiario = cruce = null; $('#verif').hidden = true;
    ['#fb-prov', '#fb-diario'].forEach(s => { $(s).classList.remove('listo'); }); $('#fb-prov .st').textContent = 'Lo que se recoge en cada proveedor'; $('#fb-diario .st').textContent = 'Lo que lleva cada cliente';
    $('#f-prov').value = ''; $('#f-diario').value = '';
    setTimeout(() => selectFecha(X.fecha), 400);
  } catch (x) { console.error(x); b.disabled = false; b.textContent = 'Publicar'; toast(x.code === 'permission-denied' ? 'Tu usuario no tiene permiso para publicar' : 'No se pudo publicar. Inténtalo de nuevo'); }
}

/* ================= arranque ================= */
route();
