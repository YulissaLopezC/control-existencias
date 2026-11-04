# Probar la fase 1 en tu computador (modo prueba)

En el computador (`localhost` o `127.0.0.1`) la app entra sola en **MODO PRUEBA**:
no toca la base de datos real y todo queda guardado solo en tu navegador.

## 1. Descargar la rama `fase-1`

- **Con Git:** `git clone -b fase-1 https://github.com/YulissaLopezC/control-existencias.git`
  (o, si ya la tienes clonada: `git fetch` y `git checkout fase-1`).
- **Sin Git:** en GitHub, cambia la rama a **fase-1** → botón verde **Code** → **Download ZIP** y descomprímelo.

## 2. Abrirla con un servidor local

Elige una (todas sirven):

- **VS Code + Live Server:** abre la carpeta, clic derecho en `index.html` → **Open with Live Server**.
- **Python:** en la carpeta, `python -m http.server 8000` y abre http://localhost:8000
- **Node:** en la carpeta, `npx serve` y abre la dirección que muestra.

> Abrir `index.html` con doble clic no funciona: hace falta el servidor local.

## 3. Usuarios de prueba

| Usuario | Rol | PIN |
|---|---|---|
| Juan Lara | Chófer | 111111 |
| Juan Luna | Chófer | 222222 |
| David García | Chófer | 333333 |
| Alexis | Chófer | 444444 |
| Don Antonio | Oficina | 555555 |
| Yulissa | Oficina | 666666 |

Cada **pestaña** del navegador puede tener un usuario distinto, y se ven entre sí en vivo.

## 4. Recorrido sugerido

1. Pestaña 1 → entra como **Yulissa** → **Oficina** → sube los 2 PDF del día → **Publicar**.
2. En **Oficina → Almacenes del día**, asigna un chófer a cada almacén (CA, CEN, TGT…).
3. Pestaña 2 → entra como **Juan Lara** → elige el día en el selector de arriba si no es hoy →
   **1 Recogida** muestra solo sus almacenes → **2 Clientes** → «Lo llevo yo».
4. Pestaña 3 → **Juan Luna** → intenta tomar un cliente de Juan Lara: no lo deja.
5. **3 Reparto** muestra solo los clientes de cada uno; **4 Traspasos** muestra qué pasarse en el punto de encuentro.
6. **Resumen** (como oficina) muestra el avance por chófer.

Para empezar de cero: botón **Borrar datos de prueba** en la franja amarilla.
