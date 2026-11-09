# Control de existencias · Distribuciones Antonio Viña

App web para celular (GitHub Pages + Firebase) que cruza los dos PDF diarios del ADZ:

- **Ventas por productos** → qué recoger en cada proveedor.
- **Diario de ventas** → qué lleva cada cliente.

**La app oficial está en https://yulissalopezc.github.io/control-existencias-prueba/** (repo `control-existencias-prueba`).
Este enlace antiguo solo redirige allí. Este repo se sigue usando para la carga automática por correo y la tarea «Crear usuarios», porque aquí están los secretos.

## Flujo del día

| Paso | Quién | Qué hace |
|---|---|---|
| Cargar (automático) | Nadie | Se envían los 2 PDF a existenciascontrolbd@gmail.com. Cada 10 minutos GitHub Actions revisa el correo, cruza los PDF, publica el día y responde por correo (ver `automatico/`). |
| Cargar (manual, respaldo) | Administradora (con sesión) | Sube los 2 PDF. La app los cruza y muestra la comprobación (productos, pedidos, líneas, EK y si cuadra). Publica el día. |
| Entrar | Todos | Cada persona elige su nombre y pone su PIN de 6 números. Chóferes: Juan Lara, Juan Luna, David García, Alexis y Extra (reserva). Oficina: Don Antonio y Yulissa. |
| Almacenes del día | Oficina | Asigna a cada chófer sus almacenes (CA, CEN, TGT…). |
| 1 Recogida | Chófer | Solo sus almacenes: Tengo / Faltan algunas / No hay, con nota. |
| 2 Clientes | Chófer / Oficina | Cada chófer toma sus clientes («Lo llevo yo»); oficina puede asignar o pasar clientes. «🚨 Urgente» es un buzón donde un chófer deja un cliente que no puede entregar para que otro lo tome. |
| 3 Reparto | Chófer | Separa por cliente, marca «Separado», pesos EK y faltantes. |
| 4 Traspasos | Chófer | Qué pasarse entre chóferes en el punto de encuentro, con PDF imprimible. |
| Resumen | Todos | Avance por chófer, faltantes, pesos EK y mensaje para WhatsApp. Oficina ve también el control de tiempos. |

Todos ven lo mismo en tiempo real.

Cada día es una lista nueva: la app abre siempre en el día de hoy (hora de Canarias). Si los PDF de hoy aún no se han subido, muestra «La lista de hoy aún no está cargada» y aparece sola en cuanto se publica. Los días anteriores (hasta 10) se consultan en el selector de día.

## Archivos

- `index.html`, `styles.css` — interfaz.
- `app.js` — lógica y conexión con Firebase.
- `parser.js` — lectura de los PDF y cruce.
- `firebase-config.js` — configuración pública del proyecto Firebase.
- `fb.js` — conexión con Firebase (modo real, modo prueba con datos `prueba_` y modo local en `localhost`).
- `demo/` — usuarios y base falsa para el modo prueba/local. `demo/usuarios.js` es también la lista de personas y PIN que usa la tarea «Crear usuarios».
- `firestore.rules` — reglas de seguridad (pegar en la consola de Firebase).
- `automatico/crear-usuarios.mjs` y `.github/workflows/crear-usuarios.yml` — crean o actualizan las cuentas reales (Actions → «Crear usuarios» → Run workflow). Para cambiar un PIN o añadir una persona, se edita `demo/usuarios.js` y se vuelve a lanzar.
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
