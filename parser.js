// Lectura y cruce de los dos PDF diarios del ADZ (Antonio Viña Medina).
//  - "Ventas por productos": qué recoger en cada proveedor.
//  - "Diario de ventas detallado UM": qué lleva cada cliente.

const NUM = '(\\d{1,4}(?:\\.\\d{3})*,\\d{2,3})';
export const num = s => Number(String(s).replace(/\./g, '').replace(',', '.'));
export const keyOf = c => (String(c).replace(/[^A-Za-z0-9_\-.~:@+]/g, '_') || 'x');

// Convierte un PDF en líneas de texto (agrupa por altura y ordena por X).
export async function pdfLines(pdfjsLib, data) {
  const pdf = await pdfjsLib.getDocument({ data }).promise;
  const lines = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const tc = await (await pdf.getPage(p)).getTextContent();
    const rows = {};
    tc.items.forEach(t => {
      if (!t.str || !t.str.trim()) return;
      const y = Math.round(t.transform[5] / 3) * 3;
      (rows[y] = rows[y] || []).push(t);
    });
    Object.keys(rows).map(Number).sort((a, b) => b - a).forEach(y => {
      let s = '', end = null;
      rows[y].sort((a, b) => a.transform[4] - b.transform[4]).forEach(t => {
        const x = t.transform[4];
        if (end !== null && x - end > 1) s += ' ';
        s += t.str; end = x + (t.width || 0);
      });
      lines.push(s.replace(/\s+/g, ' ').trim());
    });
  }
  return lines;
}

export function tipoDePdf(lines) {
  const head = lines.slice(0, 6).join(' ');
  if (/Ventas por productos/i.test(head)) return 'proveedores';
  if (/Diario de ventas/i.test(head)) return 'diario';
  return null;
}

function fechaDe(lines) {
  for (const l of lines.slice(0, 8)) {
    const m = l.match(/Fecha\s*:\s*(\d{2})\/(\d{2})\/(\d{4})/);
    if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  }
  return null;
}

const ES_CABECERA = l => /^(Antonio Viña|Desde |Hasta |Proveedor:|Código producto|Producto Título|Página)/i.test(l);

// "Ventas por productos" → productos agrupados por proveedor.
export function parseProveedores(lines) {
  const productos = []; let g = null, totalDeclarado = null;
  for (const l of lines) {
    if (!l || ES_CABECERA(l)) continue;
    let m = l.match(/^Total productos:\s*(\d+)/i);
    if (m) { totalDeclarado = Number(m[1]); continue; }
    if (/^[A-Z]{2,5}$/.test(l)) { g = l; continue; }
    m = l.match(new RegExp('^(\\S+)\\s+' + NUM + '\\s+(.+)$'));
    if (m && g) productos.push({ g, c: m[1], q: num(m[2]), d: m[3].trim() });
  }
  return { fecha: fechaDe(lines), productos, totalDeclarado };
}

// "Diario de ventas" → pedidos de clientes con sus líneas.
export function parseDiario(lines) {
  const pedidos = []; let cur = null;
  for (const l of lines) {
    if (!l || ES_CABECERA(l) || /^Subtotal:|^TOTAL\b/i.test(l)) continue;
    let m = l.match(new RegExp('^(\\S+)\\s+(?:.*\\s)?' + NUM + '\\s*(UNIDAD|CAJA|EK|KG|UD|UDS)\\b', 'i'));
    if (m && cur) { cur.lineas.push({ c: m[1], q: num(m[2]), um: m[3].toUpperCase() }); continue; }
    m = l.match(/^(\d{4,7})\s+(\d{1,6})\s+(.+)$/);
    if (m) { cur = { p: m[1], n: m[2], nombre: m[3].trim(), lineas: [] }; pedidos.push(cur); }
  }
  return { fecha: fechaDe(lines), pedidos };
}

// Cruce: une ambos listados y comprueba que las cantidades cuadren.
export function cruzar(prov, diario) {
  const umPorCodigo = {}, asign = {};
  diario.pedidos.forEach(pd => pd.lineas.forEach(li => {
    umPorCodigo[li.c] = li.um;
    (asign[li.c] = asign[li.c] || []).push({ p: pd.p, q: li.q });
  }));
  const seen = {};
  const productos = prov.productos.map(pr => {
    let k = keyOf(pr.c); if (seen[k]) { seen[k]++; k += '~' + seen[k]; } else seen[k] = 1;
    return { ...pr, k, um: umPorCodigo[pr.c] || 'UNIDAD', a: asign[pr.c] || [] };
  });
  const problemas = [];
  productos.forEach(pr => {
    const suma = pr.a.reduce((s, x) => s + x.q, 0);
    if (Math.abs(suma - pr.q) > 0.001) problemas.push({ c: pr.c, d: pr.d, proveedor: pr.q, clientes: suma });
  });
  const codProv = new Set(prov.productos.map(p => p.c));
  Object.keys(asign).forEach(c => { if (!codProv.has(c)) problemas.push({ c, d: '(no está en Ventas por productos)', proveedor: 0, clientes: asign[c].reduce((s, x) => s + x.q, 0) }); });
  if (prov.totalDeclarado != null && prov.totalDeclarado !== prov.productos.length)
    problemas.push({ c: '—', d: `El PDF dice ${prov.totalDeclarado} productos y se leyeron ${prov.productos.length}`, proveedor: prov.totalDeclarado, clientes: prov.productos.length });
  const clientes = diario.pedidos.map(pd => ({ p: pd.p, n: pd.n, nombre: pd.nombre }));
  const fechas = [prov.fecha, diario.fecha].filter(Boolean);
  return {
    fecha: fechas[0] || null,
    fechasDistintas: fechas.length === 2 && fechas[0] !== fechas[1],
    productos, clientes, problemas,
  };
}
