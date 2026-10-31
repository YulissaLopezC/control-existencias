# Control de existencias · Distribuciones Antonio Viña

App web para celular (GitHub Pages + Firebase) que cruza los dos PDF diarios del ADZ:

- **Ventas por productos** → qué recoger en cada proveedor.
- **Diario de ventas** → qué lleva cada cliente.

Enlace: https://yulissalopezc.github.io/control-existencias/

## Flujo del día

| Paso | Quién | Qué hace |
|---|---|---|
| Cargar (automático) | Nadie | Se envían los 2 PDF a existenciascontrolbd@gmail.com. Cada 10 minutos GitHub Actions revisa el correo, cruza los PDF, publica el día y responde por correo (ver `automatico/`). |
| Cargar (manual, respaldo) | Administradora (con sesión) | Sube los 2 PDF. La app los cruza y muestra la comprobación (productos, pedidos, líneas, EK y si cuadra). Publica el día. |
| 1 Recogida | Repartidor (sin cuenta) | Por proveedor: Tengo / Faltan algunas (cuántas hay) / No hay, con nota. |
| 2 Reparto | Repartidor (sin cuenta) | Por producto: a qué cliente va y cuánto. Marca «Separado». Si faltó en el proveedor, decide a quién le falta («Lleva»). En EK escribe el peso de cada pieza; la app suma por cliente y por producto. |
| Resumen | Cualquiera | Faltantes en proveedor, clientes con faltas, pesos EK por cliente y mensaje para WhatsApp. |

Todos ven lo mismo en tiempo real.

Cada día es una lista nueva: la app abre siempre en el día de hoy (hora de Canarias). Si los PDF de hoy aún no se han subido, muestra «La lista de hoy aún no está cargada» y aparece sola en cuanto se publica. Los días anteriores (hasta 10) se consultan en el selector de día.

## Archivos

- `index.html`, `styles.css` — interfaz.
- `app.js` — lógica y conexión con Firebase.
- `parser.js` — lectura de los PDF y cruce.
- `firebase-config.js` — configuración pública del proyecto Firebase.
- `firestore.rules` — reglas de seguridad (pegar en la consola de Firebase).
- `automatico/` — carga automática desde el correo (Node). `nucleo.mjs` tiene la lógica, `index.mjs` conecta Gmail (IMAP) y Firebase, `prueba-local.mjs` la prueba con PDF locales.
- `.github/workflows/carga-correo.yml` — ejecuta la carga automática cada 10 minutos.

## Carga automática: cómo funciona

1. Busca en el Gmail correos de los últimos 7 días con PDF que no tengan la etiqueta `ce-procesado`.
2. Reconoce cada PDF (Ventas por productos / Diario de ventas) y su fecha, y lo guarda en la bandeja de ese día.
3. Cuando el día tiene los dos, los cruza. Si cuadra, publica el día; si no cuadra, no publica y avisa con las diferencias.
4. Cada PDF se identifica por su huella: si se reenvía el mismo, no se carga dos veces.
5. Si solo llega uno, a los 30 minutos avisa de que falta el otro.
6. Responde por correo al remitente (y a `AVISO_EMAILS`) con el resultado. El historial se ve en la pestaña «Cargar».

Secretos necesarios en GitHub (Settings → Secrets and variables → Actions): `GMAIL_USER`, `GMAIL_APP_PASSWORD`, `FIREBASE_SERVICE_ACCOUNT` y, opcional, `AVISO_EMAILS`.

Nota: GitHub pausa las tareas programadas de un repositorio público si pasan 60 días sin cambios en él; si ocurre, se reactiva en la pestaña Actions.

## Datos en Firestore

- `dias/{AAAA-MM-DD}` — productos (proveedor, código, cantidad, descripción, unidad, clientes asignados) y pedidos.
- `dias/{fecha}/recogida/{producto}` — marca de recogida.
- `dias/{fecha}/reparto/{producto}` — por pedido: separado, cuánto lleva y pesos EK.
