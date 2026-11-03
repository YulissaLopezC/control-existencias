// Lógica de la carga automática, separada del correo y de Firebase para poder probarla.
//
// Flujo por correo recibido:
//  1. Toma los PDF adjuntos. Si un PDF ya se procesó antes (misma huella), lo ignora.
//  2. Reconoce cada PDF («Ventas por productos» o «Diario de ventas») y su fecha.
//  3. Lo guarda en la «bandeja» de esa fecha.
//  4. Cuando la bandeja tiene los dos, los cruza: si cuadra publica el día y avisa;
//     si no cuadra, NO publica y avisa con las diferencias.
//  5. Si pasa un tiempo y solo llegó uno, avisa de que falta el otro (revisarFaltantes).

import { createHash } from 'node:crypto';
import { pdfLines, tipoDePdf, parseProveedores, parseDiario, cruzar, combinarProveedores } from '../parser.js';

export const NOMBRE = { proveedores: 'Ventas por productos', diario: 'Diario de ventas', almacen: 'Diario de ventas por Almacén' };
const fmtF = id => { const [y, m, d] = id.split('-'); return `${d}/${m}/${y}`; };
export const huella = buf => createHash('sha256').update(buf).digest('hex');
const esPdf = a => /\.pdf$/i.test(a.nombre || '') || /pdf/i.test(a.tipo || '');

/**
 * @param correo  {id, de, asunto, adjuntos:[{nombre, tipo, contenido:Buffer}]}
 * @param store   adaptador de datos (ver memoria en prueba-local.mjs o Firestore en index.mjs)
 * @param avisar  async ({para, asunto, texto}) => void
 * @param pdfjs   librería pdf.js
 * @param cfg     {appUrl, avisoExtra:[correos], ahora:Date}
 */
export async function procesarCorreo({ correo, store, avisar, pdfjs, cfg }) {
  const ahora = (cfg.ahora || new Date()).toISOString();
  const pdfs = (correo.adjuntos || []).filter(esPdf);
  const res = { correo: correo.id, recibidos: [], duplicados: [], errores: [], ignorados: [], fechas: new Set(), publicados: [], noCuadra: [] };
  if (!pdfs.length) return res;

  for (const a of pdfs) {
    const h = huella(a.contenido);
    const previa = await store.getCarga(h);
    // Solo se ignora si ese mismo PDF ya acabó publicado; si quedó sin publicar (no cuadraba, faltaba el otro…) se vuelve a procesar.
    let saltar = false;
    if (previa && previa.tipo === 'almacen') saltar = true;
    else if (previa && previa.estado === 'publicado' && previa.fecha) {
      const dia = await store.getDia(previa.fecha);           // solo si ese PDF está de verdad en la lista publicada
      saltar = !!(dia && (dia.hashes || []).includes(h));
    }
    console.log(`   · ${a.nombre}: ${previa ? 'visto antes (' + previa.estado + ', ' + previa.tipo + ')' : 'nuevo'}${saltar ? ' → se omite' : ''}`);
    if (saltar) { res.duplicados.push({ nombre: a.nombre, fecha: previa.fecha, tipo: previa.tipo }); continue; }
    let lines;
    try { lines = await pdfLines(pdfjs, new Uint8Array(a.contenido)); }
    catch (e) { res.errores.push(`«${a.nombre}»: no se pudo leer el PDF (${e.message}).`); continue; }
    const tipo = tipoDePdf(lines);
    if (!tipo) { res.errores.push(`«${a.nombre}»: no es ni «Ventas por productos» ni «Diario de ventas».`); continue; }
    if (tipo === 'almacen') {
      res.ignorados.push(`«${a.nombre}» (${NOMBRE.almacen}): no hace falta, se ignora.`);
      await store.setCarga(h, { hash: h, tipo, fecha: null, nombre: a.nombre, de: correo.de, asunto: correo.asunto || '', estado: 'ignorado', ts: ahora });
      continue;
    }
    const datos = tipo === 'proveedores' ? parseProveedores(lines) : parseDiario(lines);
    console.log(`     ${NOMBRE[tipo]} · ${datos.fecha} · ${tipo === 'proveedores' ? datos.productos.length + ' productos' + (datos.filtro ? ' (solo proveedor ' + datos.filtro + ')' : '') : datos.pedidos.length + ' pedidos'}`);
    const cuenta = tipo === 'proveedores' ? datos.productos.length : datos.pedidos.length;
    if (!datos.fecha) { res.errores.push(`«${a.nombre}» (${NOMBRE[tipo]}): no encontré la fecha dentro del PDF.`); continue; }
    if (!cuenta) { res.errores.push(`«${a.nombre}» (${NOMBRE[tipo]}): no encontré ${tipo === 'proveedores' ? 'productos' : 'pedidos'} dentro del PDF.`); continue; }

    const b = (await store.getBandeja(datos.fecha)) || { fecha: datos.fecha, primeraLlegada: ahora };
    if (tipo === 'proveedores' && datos.filtro && b.proveedores) {
      // Extracto de un solo proveedor: se combina con el listado que ya había
      const ant = b.proveedores;
      b.proveedores = { datos: combinarProveedores(ant.datos, datos), hash: ant.hash, extras: [...(ant.extras || []), h], nombre: ant.nombre + ' + ' + a.nombre, de: correo.de, recibido: ahora };
    } else {
      b[tipo] = { datos, hash: h, extras: [], nombre: a.nombre, de: correo.de, recibido: ahora };
    }
    b.estado = 'esperando'; b.avisoFalta = false; b.actualizado = ahora;
    await store.setBandeja(datos.fecha, b);
    await store.setCarga(h, { hash: h, tipo, fecha: datos.fecha, nombre: a.nombre, de: correo.de, asunto: correo.asunto || '', estado: 'recibido', ts: ahora });
    res.recibidos.push({ nombre: a.nombre, tipo, fecha: datos.fecha, cuenta });
    res.fechas.add(datos.fecha);
  }

  // Cruzar y publicar las fechas que ya tienen los dos PDF
  for (const fecha of res.fechas) {
    const b = await store.getBandeja(fecha);
    if (!b.proveedores || !b.diario) continue;
    const X = cruzar(b.proveedores.datos, b.diario.datos);
    const lineas = X.productos.reduce((s, p) => s + p.a.length, 0);
    const ek = X.productos.filter(p => p.um === 'EK').length;
    const hashes = [b.proveedores.hash, ...(b.proveedores.extras || []), b.diario.hash, ...(b.diario.extras || [])];
    if (X.problemas.length) {
      b.estado = 'no-cuadra'; b.actualizado = ahora; await store.setBandeja(fecha, b);
      for (const h of hashes) await store.updCarga(h, { estado: 'no-cuadra' });
      res.noCuadra.push({ fecha, problemas: X.problemas });
      await registrar(store, { fecha, estado: 'no-cuadra', ahora, de: correo.de, archivos: [b.proveedores.nombre, b.diario.nombre], mensaje: `No cuadran ${X.problemas.length} producto(s)` });
      continue;
    }
    const previo = await store.getDia(fecha);
    await store.setDia(fecha, {
      fecha, creada: ahora, por: 'correo', origen: 'correo',
      archivos: { proveedores: b.proveedores.nombre, diario: b.diario.nombre }, hashes,
      productos: X.productos.map(p => ({ g: p.g, c: p.c, q: p.q, d: p.d, k: p.k, um: p.um, a: p.a })),
      clientes: X.clientes, problemas: 0,
    });
    b.estado = 'publicado'; b.publicado = ahora; await store.setBandeja(fecha, b);
    for (const h of hashes) await store.updCarga(h, { estado: 'publicado' });
    const info = { fecha, productos: X.productos.length, pedidos: X.clientes.length, lineas, ek, reemplazo: !!previo, antes: previo ? { productos: previo.productos.length, pedidos: previo.clientes.length } : null };
    res.publicados.push(info);
    await registrar(store, { fecha, estado: 'publicado', ahora, de: correo.de, archivos: [b.proveedores.nombre, b.diario.nombre], mensaje: `${info.productos} productos · ${info.pedidos} pedidos · ${lineas} líneas${info.reemplazo ? ' (reemplazó la lista anterior)' : ''}` });
  }

  // Errores sueltos (PDF ilegibles o desconocidos) también quedan en el historial
  if (res.errores.length) await registrar(store, { fecha: null, estado: 'error', ahora, de: correo.de, archivos: pdfs.map(a => a.nombre), mensaje: res.errores.join(' ') });
  if (!res.recibidos.length && res.duplicados.length && !res.errores.length)
    await registrar(store, { fecha: res.duplicados[0].fecha, estado: 'duplicado', ahora, de: correo.de, archivos: res.duplicados.map(d => d.nombre), mensaje: 'Estos PDF ya estaban cargados; no se hizo nada.' });

  // Aviso por correo con el resultado
  const msg = mensajeResultado(res, cfg);
  if (msg) await avisar({ para: destinatarios(correo.de, cfg), asunto: msg.asunto, texto: msg.texto });
  res.fechas = [...res.fechas];
  return res;
}

// Avisa cuando solo llegó uno de los dos PDF y ya pasó el tiempo de espera.
export async function revisarFaltantes({ store, avisar, cfg }) {
  const ahora = cfg.ahora || new Date();
  const espera = (cfg.esperaMin ?? 30) * 60000;
  const avisos = [];
  for (const b of await store.bandejasEsperando()) {
    if (b.avisoFalta || (b.proveedores && b.diario)) continue;
    if (ahora - new Date(b.actualizado || b.primeraLlegada) < espera) continue;
    const tiene = b.proveedores ? 'proveedores' : 'diario', falta = b.proveedores ? 'diario' : 'proveedores';
    const de = b[tiene].de;
    await avisar({
      para: destinatarios(de, cfg),
      asunto: `⚠️ Falta el PDF «${NOMBRE[falta]}» del ${fmtF(b.fecha)}`,
      texto: `Hola:\n\nRecibí «${NOMBRE[tiene]}» del ${fmtF(b.fecha)} (${b[tiene].nombre}), pero todavía no ha llegado «${NOMBRE[falta]}».\n\nLa lista del día se publicará en cuanto llegue. Envíalo a este mismo correo.\n\n${cfg.appUrl || ''}`,
    });
    b.avisoFalta = true; await store.setBandeja(b.fecha, b);
    await registrar(store, { fecha: b.fecha, estado: 'falta', ahora: ahora.toISOString(), de, archivos: [b[tiene].nombre], mensaje: `Falta «${NOMBRE[falta]}»` });
    avisos.push(b.fecha);
  }
  return avisos;
}

function destinatarios(de, cfg) { return [...new Set([de, ...(cfg.avisoExtra || [])].filter(Boolean))]; }

async function registrar(store, { fecha, estado, ahora, de, archivos, mensaje }) {
  await store.addRegistro({ fecha, estado, ts: ahora, de: de || '', archivos: archivos || [], mensaje });
}

export function mensajeResultado(res, cfg) {
  const partes = [], url = cfg.appUrl || '';
  let asunto = null;
  for (const p of res.publicados) {
    asunto = `✅ Lista del ${fmtF(p.fecha)} cargada`;
    partes.push(`✅ La lista del ${fmtF(p.fecha)} ya está en la app para todos los repartidores.\n• ${p.productos} productos · ${p.pedidos} pedidos · ${p.lineas} líneas · ${p.ek} productos EK\n• Todo cuadra: lo que se recoge en proveedores es igual a lo que se reparte a clientes.` + (p.reemplazo ? `\n• Reemplazó la lista que había (antes ${p.antes.productos} productos y ${p.antes.pedidos} pedidos). Las marcas ya hechas se conservan.` : ''));
  }
  for (const n of res.noCuadra) {
    asunto = asunto || `❌ La lista del ${fmtF(n.fecha)} no se publicó: no cuadra`;
    partes.push(`❌ Recibí los dos PDF del ${fmtF(n.fecha)}, pero no cuadran y NO se publicó la lista:\n` + n.problemas.slice(0, 15).map(x => `• ${x.c} ${x.d}: proveedor ${x.proveedor} · clientes ${x.clientes}`).join('\n') + (n.problemas.length > 15 ? `\n• … y ${n.problemas.length - 15} más` : '') + `\n\nRevisa que los dos PDF sean del mismo momento y vuelve a enviarlos, o súbelos a mano en la pestaña «Cargar».`);
  }
  const esperando = res.recibidos.filter(r => !res.publicados.some(p => p.fecha === r.fecha) && !res.noCuadra.some(n => n.fecha === r.fecha));
  for (const r of esperando) {
    asunto = asunto || `📥 Recibido «${NOMBRE[r.tipo]}» del ${fmtF(r.fecha)}`;
    partes.push(`📥 Recibí «${NOMBRE[r.tipo]}» del ${fmtF(r.fecha)} (${r.cuenta} ${r.tipo === 'proveedores' ? 'productos' : 'pedidos'}). Falta el otro PDF; la lista se publicará cuando llegue.`);
  }
  if (res.errores.length) { asunto = asunto || '❌ No se pudieron procesar los PDF'; partes.push('❌ Problemas con los adjuntos:\n' + res.errores.map(e => '• ' + e).join('\n')); }
  if (res.ignorados.length && partes.length) partes.push('ℹ️ ' + res.ignorados.join(' '));
  if (res.duplicados.length && !res.recibidos.length) { asunto = asunto || 'ℹ️ Estos PDF ya estaban cargados'; partes.push('ℹ️ ' + res.duplicados.map(d => `«${d.nombre}»`).join(', ') + ' ya se habían procesado antes. No se cargó nada de nuevo.'); }
  else if (res.duplicados.length) partes.push('ℹ️ Ya estaban cargados y se ignoraron: ' + res.duplicados.map(d => `«${d.nombre}»`).join(', ') + '.');
  if (!partes.length) return null;
  return { asunto, texto: `Hola:\n\n${partes.join('\n\n')}\n\nApp: ${url}\n\n(Mensaje automático de Control de existencias)` };
}
