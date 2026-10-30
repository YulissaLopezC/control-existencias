# Control de existencias · Distribuciones Antonio Viña

App web para celular (GitHub Pages + Firebase) que cruza los dos PDF diarios del ADZ:

- **Ventas por productos** → qué recoger en cada proveedor.
- **Diario de ventas** → qué lleva cada cliente.

Enlace: https://yulissalopezc.github.io/control-existencias/

## Flujo del día

| Paso | Quién | Qué hace |
|---|---|---|
| Cargar | Administradora (con sesión) | Sube los 2 PDF. La app los cruza y muestra la comprobación (productos, pedidos, líneas, EK y si cuadra). Publica el día. |
| 1 Recogida | Repartidor (sin cuenta) | Por proveedor: Tengo / Faltan algunas (cuántas hay) / No hay, con nota. |
| 2 Reparto | Repartidor (sin cuenta) | Por producto: a qué cliente va y cuánto. Marca «Separado». Si faltó en el proveedor, decide a quién le falta («Lleva»). En EK escribe el peso de cada pieza; la app suma por cliente y por producto. |
| Resumen | Cualquiera | Faltantes en proveedor, clientes con faltas, pesos EK por cliente y mensaje para WhatsApp. |

Todos ven lo mismo en tiempo real.

## Archivos

- `index.html`, `styles.css` — interfaz.
- `app.js` — lógica y conexión con Firebase.
- `parser.js` — lectura de los PDF y cruce.
- `firebase-config.js` — configuración pública del proyecto Firebase.
- `firestore.rules` — reglas de seguridad (pegar en la consola de Firebase).

## Datos en Firestore

- `dias/{AAAA-MM-DD}` — productos (proveedor, código, cantidad, descripción, unidad, clientes asignados) y pedidos.
- `dias/{fecha}/recogida/{producto}` — marca de recogida.
- `dias/{fecha}/reparto/{producto}` — por pedido: separado, cuánto lleva y pesos EK.
