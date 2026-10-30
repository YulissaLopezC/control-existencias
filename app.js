import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import {
  initializeFirestore, getFirestore, persistentLocalCache, persistentMultipleTabManager,
  doc, collection, setDoc, deleteDoc, onSnapshot, query, orderBy, limit
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import { firebaseConfig } from './firebase-config.js?v=4';
import { pdfLines, tipoDePdf, parseProveedores, parseDiario, cruzar } from './parser.js?v=4';

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
const lsGet = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch (e) { } };
let toastT;
function toast(t) { const el = $('#toast'); el.textContent = t; el.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => el.hidden = true, 2800); }

/* ================= Firebase ================= */
const app = initializeApp(firebaseConfig);
let db;
try { db = initializeFirestore(app, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) }); }
catch (e) { db = getFirestore(app); }
const auth = getAuth(app);

/* ================= estado ================= */
let dias = [], fecha = null, dia = null, rec = {}, rep = {};
let unsubRec = null, unsubRep = null;
let cliBy = {};
const filtro = { 1: 'todos', 2: 'todos' }, busq = { 1: '', 2: '' };
const nombreEl = $('#nombre');
nombreEl.value = lsGet('av_nombre') || '';
nombreEl.addEventListener('input', () => lsSet('av_nombre', nombreEl.value.trim()));
const nombre = () => nombreEl.value.trim();
function needName() { if (nombre()) return false; location.hash = location.hash || '#recogida'; nombreEl.focus(); nombreEl.scrollIntoView({ block: 'center' }); toast('Escribe tu nombre antes de marcar'); return true; }

/* ================= vistas ================= */
const VISTAS = ['recogida', 'reparto', 'resumen', 'cargar'];
function vista() { const v = (location.hash || '#recogida').slice(1); return VISTAS.includes(v) ? v : 'recogida'; }
function route() {
  const v = vista();
  VISTAS.forEach(n => { $('#v-' + n).hidden = n !== v; const t = $('#t-' + n); if (n === v) t.setAttribute('aria-current', 'page'); else t.removeAttribute('aria-current'); });
  $('#v-nombre').hidden = !(v === 'recogida' || v === 'reparto');
  $('#bar').hidden = !(v === 'recogida' || v === 'reparto');
  if (v === 'resumen') renderResumen();
  renderStats();
  window.scrollTo(0, 0);
}
addEventListener('hashchange', route);

/* ================= cálculo ================= */
const R = pr => rec[pr.k] || {};
const est = pr => R(pr).estado || null;
function disponible(pr) { const r = R(pr); if (!r.estado) return null; if (r.estado === 'si') return pr.q; if (r.estado === 'no') return 0; return r.quedan ?? 0; }
const cliRep = (pr, p) => ((rep[pr.k] || {}).cli || {})[p] || {};
const lleva = (pr, a) => { const v = cliRep(pr, a.p).lleva; return v == null ? a.q : v; };
const sumaLleva = pr => pr.a.reduce((s, a) => s + lleva(pr, a), 0);
const corto = pr => { const d = disponible(pr); return d != null && d < pr.q; };
const porDecidir = pr => { const d = disponible(pr); return d != null && sumaLleva(pr) - d > 0.0001; };
const separado = (pr, p) => !!cliRep(pr, p).ok;
const prodListo = pr => pr.a.every(a => separado(pr, a.p));
const isEK = pr => pr.um === 'EK';
const pesosDe = (pr, p) => (cliRep(pr, p).pesos || []);
const kgCli = (pr, a) => pesosDe(pr, a.p).slice(0, Math.round(lleva(pr, a))).reduce((s, x) => s + (Number(x) || 0), 0);
const kgProd = pr => pr.a.reduce((s, a) => s + kgCli(pr, a), 0);
const piezasPesadas = (pr, a) => pesosDe(pr, a.p).slice(0, Math.round(lleva(pr, a))).filter(x => x != null && x > 0).length;
const isIssue1 = pr => { const r = R(pr); return r.estado === 'no' || r.estado === 'parcial' || !!(r.nota && r.nota.trim()); };

function estadoRecChip(pr) {
  const s = est(pr), d = disponible(pr);
  if (!s) return '<span class="chip-st">Sin recoger</span>';
  if (s === 'si') return '<span class="chip-st ok">Recogido completo</span>';
  if (s === 'no') return '<span class="chip-st bad">No hay en proveedor</span>';
  return `<span class="chip-st warn">Recogidos ${fmtQ(d)} de ${fmtQ(pr.q)}</span>`;
}

/* ================= 1 RECOGIDA ================= */
function grupos() { const gs = [], idx = {}; dia.productos.forEach(pr => { if (!(pr.g in idx)) { idx[pr.g] = gs.length; gs.push({ g: pr.g, items: [] }); } gs[idx[pr.g]].items.push(pr); }); return gs; }
function emptyHTML() {
  const ult = dias[0];
  const verUlt = ult && ult.id !== fechaSel ? `<p><button class="btn ghost" type="button" data-ver="${esc(ult.id)}">Ver el último día cargado (${diaF(ult.id)} ${fmtF(ult.id)})</button></p>` : '';
  if (fechaSel === hoy()) return `<div class="empty"><h2>La lista de hoy aún no está cargada</h2><p>${diaF(fechaSel)} ${fmtF(fechaSel)}. Cuando se suban los PDF del día aparecerá aquí sola, no hace falta recargar.</p>${verUlt}</div>`;
  return `<div class="empty"><h2>No hay datos de este día</h2><p>Cuando se carguen los PDF del día aparecerán aquí.</p>${verUlt}</div>`;
}
document.addEventListener('click', e => { const b = e.target.closest('[data-ver]'); if (b) selectFecha(b.dataset.ver); });

const abiertos1 = new Set(); // proveedores abiertos en Recogida (empiezan cerrados)
function buildRecogida() {
  const root = $('#lista1');
  if (!dia) { root.innerHTML = emptyHTML(); return; }
  root.innerHTML = grupos().map(gr => `
    <section class="sec${abiertos1.has(gr.g) ? '' : ' closed'}" data-g="${esc(gr.g)}">
      <div class="sec-h"><button class="tog" type="button" aria-expanded="${abiertos1.has(gr.g)}"><span class="tt"><span class="name">Proveedor ${esc(gr.g)}</span><span class="cnt"></span></span><span class="car">▾</span></button></div>
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
  document.querySelectorAll('#lista1 .sec').forEach(sec => {
    const its = dia.productos.filter(i => i.g === sec.dataset.g);
    const done = its.filter(est).length;
    const comp = done === its.length;
    sec.querySelector('.cnt').textContent = comp ? `✓ Completo · ${its.length} revisados` : `${done} de ${its.length} revisados`;
    sec.classList.toggle('completo', comp);
    sec.querySelector('.allok').hidden = comp;
    sec.hidden = !its.some(i => !document.getElementById('it-' + i.k).hidden);
  });
}
const pendRec = {};
function saveRec(pr, patch) {
  if (!fecha) return;
  const antes = grupoListo(1, pr.g);
  const next = { ...R(pr), ...patch, codigo: pr.c, nombre: nombre(), ts: new Date().toISOString() };
  const clear = !next.estado && !(next.nota && next.nota.trim());
  if (clear) delete rec[pr.k]; else rec[pr.k] = next;
  refreshAll();
  if (!antes && grupoListo(1, pr.g)) programarSiguiente(1, pr.g);
  const ref = doc(db, 'dias', fecha, 'recogida', pr.k);
  pendRec[pr.k] = (pendRec[pr.k] || Promise.resolve()).then(() => clear ? deleteDoc(ref) : setDoc(ref, next)).catch(errGuardar);
}
function errGuardar(e) { console.error(e); toast(e && e.code === 'permission-denied' ? 'Sin permiso para guardar' : 'No se guardó. Revisa la conexión'); }
const prodByK = k => dia && dia.productos.find(i => i.k === k);

$('#lista1').addEventListener('click', e => {
  const sec = e.target.closest('.sec'); const tog = e.target.closest('.tog');
  if (tog) { setOpen(1, sec.dataset.g, sec.classList.contains('closed')); return; }
  const ok = e.target.closest('[data-allok]');
  if (ok) { if (needName()) return; dia.productos.filter(i => i.g === ok.dataset.allok && !est(i)).forEach(i => saveRec(i, { estado: 'si' })); return; }
  const sg = e.target.closest('[data-sig]');
  if (sg) { siguiente(1, sg.dataset.sig, false); return; }
  const el = e.target.closest('.item'); if (!el) return;
  const pr = prodByK(el.dataset.k); if (!pr) return;
  const a = e.target.closest('[data-a]');
  if (a) {
    if (needName()) return;
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
  if (e.target.matches('.nota input')) { if (needName()) return; saveRec(pr, { nota: e.target.value.trim() }); }
});

/* ================= 2 REPARTO ================= */
const cache2 = {};
const abiertos2 = new Set(); // proveedores abiertos en Reparto (empiezan cerrados)
function buildReparto() {
  const root = $('#lista2');
  if (!dia) { root.innerHTML = emptyHTML(); return; }
  root.innerHTML = grupos().map(gr => `
    <section class="sec${abiertos2.has(gr.g) ? '' : ' closed'}" data-g="${esc(gr.g)}">
      <div class="sec-h"><button class="tog" type="button" aria-expanded="${abiertos2.has(gr.g)}"><span class="tt"><span class="name">Proveedor ${esc(gr.g)}</span><span class="cnt"></span></span><span class="car">▾</span></button></div>
      <div class="items">${gr.items.map(pr => `<article class="prod" id="r-${esc(pr.k)}" data-k="${esc(pr.k)}"></article>`).join('')}</div>
      <div class="sec-f"><span></span><button class="sig" type="button" data-sig="${esc(gr.g)}">Siguiente →</button></div>
    </section>`).join('');
  Object.keys(cache2).forEach(k => delete cache2[k]);
  refreshReparto();
}
function prodHTML(pr) {
  const d = disponible(pr), sum = sumaLleva(pr), ek = isEK(pr);
  let alerta = '';
  if (corto(pr)) {
    const sobra = sum - d;
    alerta = sobra > 0.0001
      ? `<div class="alerta-box">Solo hay ${fmtQ(d)} de ${fmtQ(pr.q)}. Decide a quién le falta: quita ${fmtQ(sobra)} en «Lleva».</div>`
      : `<div class="alerta-box okb">Faltante repartido: ${fmtQ(d)} de ${fmtQ(pr.q)} asignados.</div>`;
  }
  const rows = pr.a.map(a => {
    const cl = cliBy[a.p] || { nombre: 'Pedido ' + a.p, n: '' };
    const lv = lleva(pr, a), ok = separado(pr, a.p);
    let row2 = '';
    if (corto(pr)) row2 += `<span class="small">Lleva</span><span class="step sm"><button type="button" data-lv="-1" aria-label="Menos">−</button><input class="lleva" type="number" inputmode="numeric" min="0" max="${a.q}" step="1" value="${lv}" aria-label="Lleva"><button type="button" data-lv="1" aria-label="Más">+</button></span><span class="small">de ${fmtQ(a.q)}</span>`;
    if (ek && lv > 0) {
      const ps = pesosDe(pr, a.p); const n = Math.round(lv);
      row2 += `<div class="pesos">${Array.from({ length: n }, (_, i) => `<input class="peso" data-i="${i}" type="text" inputmode="decimal" placeholder="kg ${i + 1}" value="${ps[i] != null ? String(ps[i]).replace('.', ',') : ''}" aria-label="Peso pieza ${i + 1}">`).join('')}<span class="kg">= ${fmtKg(kgCli(pr, a))}</span></div>`;
    }
    return `<div class="cli${ok ? ' sep' : ''}" data-p="${esc(a.p)}">
      <div class="cn">${esc(cl.nombre)}<small>Pedido ${esc(a.p)} · ${fmtQ(a.q)} ${ek ? 'pzs' : 'uds'}${lv !== a.q ? ` · lleva ${fmtQ(lv)}` : ''}</small></div>
      <button type="button" class="sepb" aria-pressed="${ok}">${ok ? '✓ Separado' : 'Separar'}</button>
      ${row2 ? `<div class="row2">${row2}</div>` : ''}
    </div>`;
  }).join('');
  return `<div class="row1"><span class="code">${esc(pr.c)}</span><span class="qty"><b>${fmtQ(pr.q)}</b> ${ek ? '<span class="um ek">EK · piezas</span>' : 'uds'}</span></div>
    <p class="desc">${esc(pr.d)}</p>
    <div class="meta">${estadoRecChip(pr)}${ek ? `<span class="chip-st">${fmtKg(kgProd(pr))} en total</span>` : ''}<span class="chip-st">${pr.a.length} cliente${pr.a.length === 1 ? '' : 's'}</span></div>
    ${alerta}<div class="clis">${rows}</div>`;
}
function refreshReparto() {
  if (!dia) return;
  const q = busq[2].toLowerCase(), f = filtro[2];
  dia.productos.forEach(pr => {
    const el = document.getElementById('r-' + pr.k); if (!el) return;
    const html = prodHTML(pr);
    if (cache2[pr.k] !== html) {
      if (el.contains(document.activeElement) && document.activeElement.tagName === 'INPUT') el.dataset.dirty = '1';
      else { el.innerHTML = html; cache2[pr.k] = html; el.dataset.dirty = ''; }
    }
    el.classList.toggle('done', prodListo(pr)); el.classList.toggle('alerta', porDecidir(pr));
    const okQ = !q || pr.c.toLowerCase().includes(q) || pr.d.toLowerCase().includes(q) || pr.a.some(a => ((cliBy[a.p] || {}).nombre || '').toLowerCase().includes(q));
    const okF = f === 'todos' || (f === 'pend' && !prodListo(pr)) || (f === 'falt' && corto(pr)) || (f === 'ek' && isEK(pr));
    el.hidden = !(okQ && okF);
  });
  document.querySelectorAll('#lista2 .sec').forEach(sec => {
    const its = dia.productos.filter(i => i.g === sec.dataset.g);
    const done = its.filter(prodListo).length, comp = done === its.length;
    sec.querySelector('.cnt').textContent = comp ? `✓ Completo · ${its.length} productos separados` : `${done} de ${its.length} productos separados`;
    sec.classList.toggle('completo', comp);
    sec.hidden = !its.some(i => !document.getElementById('r-' + i.k).hidden);
  });
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
  const body = { codigo: pr.c, nombre: nombre(), ts: new Date().toISOString(), cli: { [p]: merged } };
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
    if (needName()) return;
    const ok = !separado(c.pr, c.a.p);
    if (ok && isEK(c.pr) && piezasPesadas(c.pr, c.a) < Math.round(lleva(c.pr, c.a))) toast('Ojo: faltan pesos por escribir');
    saveRep(c.pr, c.a.p, { ok }); return;
  }
  const b = e.target.closest('[data-lv]');
  if (b) { if (needName()) return; let v = lleva(c.pr, c.a) + Number(b.dataset.lv); v = Math.min(Math.max(0, v), c.a.q); saveRep(c.pr, c.a.p, { lleva: v }); }
});
$('#lista2').addEventListener('change', e => {
  const c = ctxRep(e); if (!c) return;
  if (e.target.matches('.lleva')) {
    if (needName()) return;
    let v = Number(e.target.value); if (isNaN(v) || v < 0) v = 0; v = Math.min(v, c.a.q);
    saveRep(c.pr, c.a.p, { lleva: v });
  }
  if (e.target.matches('.peso')) {
    if (needName()) return;
    const vals = [...c.row.querySelectorAll('.peso')].map(i => parseKg(i.value));
    if (vals.some(v => Number.isNaN(v))) { toast('Escribe el peso en kg, por ejemplo 2,350'); return; }
    if (vals.some(v => v != null && v > 50)) toast('Revisa el peso: parece muy alto');
    saveRep(c.pr, c.a.p, { pesos: vals });
  }
});

/* ================= proveedores: abrir, cerrar y pasar al siguiente ================= */
const LISTA = { 1: '#lista1', 2: '#lista2' };
const abiertosDe = n => n === 1 ? abiertos1 : abiertos2;
function grupoListo(n, g) { if (!dia) return false; const its = dia.productos.filter(i => i.g === g); return its.length > 0 && its.every(n === 1 ? est : prodListo); }
function secDe(n, g) { return [...document.querySelectorAll(LISTA[n] + ' .sec')].find(s => s.dataset.g === g); }
function setOpen(n, g, open) {
  const sec = secDe(n, g); if (!sec) return;
  sec.classList.toggle('closed', !open); sec.querySelector('.tog').setAttribute('aria-expanded', String(open));
  if (open) abiertosDe(n).add(g); else abiertosDe(n).delete(g);
}
function irA(n, g) { const sec = secDe(n, g); if (!sec) return; const y = sec.getBoundingClientRect().top + scrollY - $('header').offsetHeight - 10; scrollTo({ top: Math.max(0, y), behavior: 'smooth' }); }
function siguiente(n, g, auto) {
  const gs = grupos().map(x => x.g), i = gs.indexOf(g);
  setOpen(n, g, false);
  let nx = null;
  for (let j = 1; j < gs.length; j++) { const c = gs[(i + j) % gs.length]; if (!grupoListo(n, c)) { nx = c; break; } }
  if (!nx) { irA(n, g); toast(n === 1 ? '✓ Recogida completa. Sigue con 2 Reparto' : '✓ Reparto completo. Revisa el Resumen'); return; }
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
  n === '1' ? refreshRecogida() : refreshReparto();
}));
$('#buscar1').addEventListener('input', e => { busq[1] = e.target.value.trim(); $('#lista1').classList.toggle('buscando', !!busq[1]); refreshRecogida(); });
$('#buscar2').addEventListener('input', e => { busq[2] = e.target.value.trim(); $('#lista2').classList.toggle('buscando', !!busq[2]); refreshReparto(); });

/* ================= cabecera ================= */
function renderStats() {
  const st = $('#stats');
  if (!dia) { st.innerHTML = fechaSel === hoy() ? '<span>Esperando la lista de hoy</span>' : '<span>Sin datos para este día</span>'; $('#pbar').style.width = '0'; return; }
  const P = dia.productos, tot = P.length, rev = P.filter(est).length;
  const lineas = P.reduce((s, p) => s + p.a.length, 0), sep = P.reduce((s, p) => s + p.a.filter(a => separado(p, a.p)).length, 0);
  const falt = P.filter(isIssue1).length, dec = P.filter(porDecidir).length;
  if (vista() === 'reparto') {
    $('#pbar').style.width = (lineas ? sep / lineas * 100 : 0) + '%';
    st.innerHTML = `<span><b>${sep}</b> de ${lineas} separados</span><span class="s-no"><b>${dec}</b> por decidir</span><span><b>${P.filter(isEK).length}</b> EK</span>`;
  } else {
    $('#pbar').style.width = (tot ? rev / tot * 100 : 0) + '%';
    st.innerHTML = `<span><b>${rev}</b> de ${tot} recogidos</span><span class="s-no"><b>${falt}</b> con faltas</span><span><b>${sep}</b>/${lineas} separados</span>`;
  }
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
  return { faltProv, porCli, ek, nombres };
}
const ordenCli = obj => dia.clientes.map(c => c.p).filter(p => obj[p]);
function renderResumen() {
  if (!dia) { ['#res-prov', '#res-cli', '#res-ek'].forEach(s => $(s).innerHTML = ''); $('#sumgrid').innerHTML = ''; $('#msg').textContent = ''; return; }
  const P = dia.productos, D = datosResumen();
  const lineas = P.reduce((s, p) => s + p.a.length, 0), sep = P.reduce((s, p) => s + p.a.filter(a => separado(p, a.p)).length, 0);
  $('#sumgrid').innerHTML = `<div><b>${P.filter(est).length}/${P.length}</b><span>Recogidos</span></div><div class="g-no"><b>${D.faltProv.length}</b><span>Faltas prov.</span></div><div><b>${sep}/${lineas}</b><span>Separados</span></div><div class="g-par"><b>${Object.keys(D.porCli).length}</b><span>Clientes afect.</span></div>`;
  $('#sumwho').textContent = D.nombres.length ? 'Han marcado: ' + D.nombres.join(', ') : 'Todavía nadie ha marcado.';
  // proveedor
  if (!D.faltProv.length) $('#res-prov').innerHTML = '<span class="lbl">Faltantes en proveedor</span><p class="hint" style="margin:0">Sin faltantes.</p>';
  else { let h = '<span class="lbl">Faltantes en proveedor</span>', g = null; D.faltProv.forEach(pr => { const m = R(pr); if (pr.g !== g) { if (g) h += '</ul>'; g = pr.g; h += `<h3>${esc(g)}</h3><ul>`; } const st = m.estado === 'no' ? '<span class="no">No hay</span>' : m.estado === 'parcial' ? `<span class="par">Hay ${fmtQ(m.quedan ?? 0)} · faltan ${fmtQ(pr.q - (m.quedan ?? 0))}</span>` : 'Con nota'; h += `<li><span class="t">${esc(pr.d)}</span><span class="m">${esc(pr.c)} · pedido ${fmtQ(pr.q)} · ${st}</span>${m.nota ? `<span class="m">Nota: ${esc(m.nota)}</span>` : ''}</li>`; }); $('#res-prov').innerHTML = h + '</ul>'; }
  // clientes
  const pc = ordenCli(D.porCli);
  if (!pc.length) $('#res-cli').innerHTML = '<span class="lbl">Clientes con faltas</span><p class="hint" style="margin:0">Ningún cliente afectado.</p>';
  else $('#res-cli').innerHTML = '<span class="lbl">Clientes con faltas</span><ul>' + pc.map(p => `<li><span class="t">${esc(cliBy[p].nombre)} · ${esc(p)}</span>${D.porCli[p].map(x => `<span class="m">${esc(x.pr.d)} · ${x.dec ? '<span class="no">por decidir</span>' : `<span class="par">lleva ${fmtQ(x.lv)} de ${fmtQ(x.a.q)}</span>`}</span>`).join('')}</li>`).join('') + '</ul>';
  // EK
  const pe = ordenCli(D.ek);
  if (!pe.length) $('#res-ek').innerHTML = '<span class="lbl">Pesos EK por cliente</span><p class="hint" style="margin:0">No hay productos EK.</p>';
  else $('#res-ek').innerHTML = '<span class="lbl">Pesos EK por cliente</span><ul>' + pe.map(p => { const xs = D.ek[p], tot = xs.reduce((s, x) => s + x.kg, 0); return `<li><span class="t">${esc(cliBy[p].nombre)} · ${esc(p)} — ${fmtKg(tot)}</span>${xs.map(x => `<span class="m">${esc(x.pr.d)} · ${fmtQ(x.lv)} pzs · ${x.pes < Math.round(x.lv) ? `<span class="par">${x.pes}/${Math.round(x.lv)} pesadas</span> · ` : ''}<b>${fmtKg(x.kg)}</b></span>`).join('')}</li>`; }).join('') + '</ul>';
  const msg = buildMsg(D); $('#msg').textContent = msg; $('#wa').href = 'https://wa.me/?text=' + encodeURIComponent(msg);
}
function buildMsg(D) {
  const P = dia.productos;
  const lineas = P.reduce((s, p) => s + p.a.length, 0), sep = P.reduce((s, p) => s + p.a.filter(a => separado(p, a.p)).length, 0);
  let o = `CONTROL · ANTONIO VIÑA · ${fmtF(fecha)}\nMarcaron: ${D.nombres.join(', ') || nombre() || 'Sin indicar'}\nRecogidos ${P.filter(est).length}/${P.length} · Separados ${sep}/${lineas}\n`;
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

/* ================= refresco general ================= */
function refreshAll() { refreshRecogida(); refreshReparto(); renderStats(); if (vista() === 'resumen') renderResumen(); }

/* ================= días ================= */
// fechaSel: el día elegido (puede no estar cargado todavía). fecha: el día cargado que se muestra.
let fechaSel = null, ultimoHoy = hoy();
$('#fecha').addEventListener('change', e => selectFecha(e.target.value));
function renderFechas() {
  const s = $('#fecha'), h = hoy();
  const opts = dias.map(d => `<option value="${esc(d.id)}">${d.id === h ? 'Hoy · ' : ''}${diaF(d.id)} ${fmtF(d.id)} · ${d.productos.length} productos · ${d.clientes.length} pedidos</option>`);
  if (!dias.some(d => d.id === h)) opts.unshift(`<option value="${h}">Hoy · ${diaF(h)} ${fmtF(h)} · sin cargar</option>`);
  s.innerHTML = opts.join('');
  if (fechaSel) s.value = fechaSel;
}
function setDia(d) {
  dia = d ? { ...d, productos: d.productos.map(p => ({ ...p, q: Number(p.q), a: (p.a || []).map(a => ({ ...a, q: Number(a.q) })) })) } : null;
  cliBy = {}; if (dia) dia.clientes.forEach(c => cliBy[c.p] = c);
}
function selectFecha(id) {
  fechaSel = id || hoy();
  const d = dias.find(x => x.id === fechaSel);
  const nueva = d ? fechaSel : null;
  const changed = fecha !== nueva;
  fecha = nueva; setDia(d);
  renderFechas();
  buildRecogida(); buildReparto();
  if (changed) {
    rec = {}; rep = {};
    if (unsubRec) unsubRec(); if (unsubRep) unsubRep();
    unsubRec = unsubRep = null;
    if (fecha) {
      unsubRec = onSnapshot(collection(db, 'dias', fecha, 'recogida'), snap => { const m = {}; snap.forEach(x => m[x.id] = x.data()); rec = m; refreshAll(); }, errConexion);
      unsubRep = onSnapshot(collection(db, 'dias', fecha, 'reparto'), snap => { const m = {}; snap.forEach(x => m[x.id] = x.data()); rep = m; refreshAll(); }, errConexion);
    }
  }
  refreshAll();
}
function errConexion(e) { console.error(e); toast('No se pudo conectar con la base de datos'); }
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

/* ================= CARGAR (administradora) ================= */
let usuario = null, pdfProv = null, pdfDiario = null, cruce = null;
onAuthStateChanged(auth, u => {
  usuario = u;
  $('#login-card').hidden = !!u; $('#admin').hidden = !u;
  if (u) $('#adm-who').textContent = 'Sesión: ' + u.email;
});
$('#login').addEventListener('submit', async e => {
  e.preventDefault(); const btn = $('#l-btn'), err = $('#l-err'); err.hidden = true; btn.disabled = true; btn.textContent = 'Entrando…';
  try { await signInWithEmailAndPassword(auth, $('#l-email').value.trim(), $('#l-pass').value); $('#l-pass').value = ''; }
  catch (x) { err.hidden = false; err.textContent = /invalid|wrong|user-not-found/.test(x.code || '') ? 'Correo o contraseña incorrectos.' : x.code === 'auth/too-many-requests' ? 'Demasiados intentos. Espera unos minutos.' : 'No se pudo entrar. Revisa la conexión.'; }
  btn.disabled = false; btn.textContent = 'Entrar';
});
$('#salir').addEventListener('click', () => signOut(auth));

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
      fecha: X.fecha, creada: new Date().toISOString(), por: usuario ? usuario.email : '',
      productos: X.productos.map(p => ({ g: p.g, c: p.c, q: p.q, d: p.d, k: p.k, um: p.um, a: p.a })),
      clientes: X.clientes, problemas: X.problemas.length,
    });
    toast('Día ' + fmtF(X.fecha) + ' publicado');
    pdfProv = pdfDiario = cruce = null; $('#verif').hidden = true;
    ['#fb-prov', '#fb-diario'].forEach(s => { $(s).classList.remove('listo'); }); $('#fb-prov .st').textContent = 'Lo que se recoge en cada proveedor'; $('#fb-diario .st').textContent = 'Lo que lleva cada cliente';
    $('#f-prov').value = ''; $('#f-diario').value = '';
    setTimeout(() => selectFecha(X.fecha), 400); location.hash = '#recogida';
  } catch (x) { console.error(x); b.disabled = false; b.textContent = 'Publicar'; toast(x.code === 'permission-denied' ? 'Tu usuario no tiene permiso para publicar' : 'No se pudo publicar. Inténtalo de nuevo'); }
}

/* ================= arranque ================= */
route();
