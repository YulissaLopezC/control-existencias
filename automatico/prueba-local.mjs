// Prueba del proceso automático sin correo ni Firebase.
// Uso: node prueba-local.mjs <ventas_por_productos.pdf> <diario_de_ventas.pdf> [otro.pdf]
import fs from 'node:fs';
import pdfjs from 'pdfjs-dist/legacy/build/pdf.js';
import { procesarCorreo, revisarFaltantes } from './nucleo.mjs';

export function storeMemoria() {
  const m = { cargas: {}, bandeja: {}, dias: {}, registro: [] };
  const c = o => o == null ? o : JSON.parse(JSON.stringify(o));
  return {
    m,
    getCarga: async h => c(m.cargas[h]), setCarga: async (h, d) => { m.cargas[h] = c(d); }, updCarga: async (h, d) => { m.cargas[h] = { ...m.cargas[h], ...c(d) }; },
    getBandeja: async f => c(m.bandeja[f]), setBandeja: async (f, d) => { m.bandeja[f] = c(d); },
    bandejasEsperando: async () => Object.values(m.bandeja).filter(b => b.estado === 'esperando').map(c),
    getDia: async f => c(m.dias[f]), setDia: async (f, d) => { m.dias[f] = c(d); },
    addRegistro: async r => { m.registro.push(c(r)); },
  };
}

const [prov, diario, otro] = process.argv.slice(2);
if (!prov || !diario) { console.log('Uso: node prueba-local.mjs <ventas_por_productos.pdf> <diario_de_ventas.pdf> [otro.pdf]'); process.exit(1); }
const adj = (f, n) => ({ nombre: n || f.split('/').pop(), tipo: 'application/pdf', contenido: fs.readFileSync(f) });
const enviados = [];
const avisar = async a => { enviados.push(a); };
const cfg = { appUrl: 'https://yulissalopezc.github.io/control-existencias/', avisoExtra: ['existenciascontrolbd@gmail.com'] };
const ultimo = () => enviados[enviados.length - 1];
const titulo = t => console.log('\n=== ' + t + ' ===');

let s = storeMemoria();
titulo('1. Los dos PDF en el mismo correo');
let r = await procesarCorreo({ correo: { id: 'a', de: 'antonio@ejemplo.com', asunto: 'PDF del día', adjuntos: [adj(prov), adj(diario)] }, store: s, avisar, pdfjs, cfg });
console.log('publicados:', r.publicados, '| día guardado:', Object.keys(s.m.dias), '| para:', ultimo().para);
console.log(ultimo().asunto + '\n' + ultimo().texto);

titulo('2. Se reenvían los mismos PDF (no debe cargar dos veces)');
const diasAntes = JSON.stringify(s.m.dias);
r = await procesarCorreo({ correo: { id: 'b', de: 'antonio@ejemplo.com', adjuntos: [adj(prov), adj(diario)] }, store: s, avisar, pdfjs, cfg });
console.log('duplicados:', r.duplicados.length, '| día sin cambios:', diasAntes === JSON.stringify(s.m.dias), '| aviso:', ultimo().asunto);

titulo('3. Los PDF llegan en correos separados');
s = storeMemoria();
r = await procesarCorreo({ correo: { id: 'c', de: 'antonio@ejemplo.com', adjuntos: [adj(diario)] }, store: s, avisar, pdfjs, cfg });
console.log('tras el 1º → publicados:', r.publicados.length, '| aviso:', ultimo().asunto);
r = await procesarCorreo({ correo: { id: 'd', de: 'antonio@ejemplo.com', adjuntos: [adj(prov)] }, store: s, avisar, pdfjs, cfg });
console.log('tras el 2º → publicados:', r.publicados.length, '| aviso:', ultimo().asunto);

titulo('4. Solo llega uno y pasa el tiempo de espera');
s = storeMemoria();
await procesarCorreo({ correo: { id: 'e', de: 'antonio@ejemplo.com', adjuntos: [adj(prov)] }, store: s, avisar, pdfjs, cfg });
let av = await revisarFaltantes({ store: s, avisar, cfg: { ...cfg, ahora: new Date() } });
console.log('aviso inmediato (no debe):', av);
av = await revisarFaltantes({ store: s, avisar, cfg: { ...cfg, ahora: new Date(Date.now() + 31 * 60000) } });
console.log('a los 31 min:', av, '|', ultimo().asunto);
av = await revisarFaltantes({ store: s, avisar, cfg: { ...cfg, ahora: new Date(Date.now() + 90 * 60000) } });
console.log('no repite el aviso:', av);

if (otro) {
  titulo('5. Llega un PDF que no es ninguno de los dos');
  s = storeMemoria();
  r = await procesarCorreo({ correo: { id: 'f', de: 'antonio@ejemplo.com', adjuntos: [adj(otro)] }, store: s, avisar, pdfjs, cfg });
  console.log('errores:', r.errores, '|', ultimo().asunto);
}

titulo('6. Correo sin PDF (se ignora)');
const n = enviados.length;
r = await procesarCorreo({ correo: { id: 'g', de: 'x@y.com', adjuntos: [{ nombre: 'foto.jpg', tipo: 'image/jpeg', contenido: Buffer.from('x') }] }, store: s, avisar, pdfjs, cfg });
console.log('avisos enviados:', enviados.length - n);
console.log('\nRegistro del último escenario:', s.m.registro.map(x => x.estado + ': ' + x.mensaje));
