# Control de existencias · Distribuciones Antonio Viña

Lista de chequeo diaria para revisar existencias desde el celular. Versión de ensayo (sin base de datos).

- `index.html` — la página.
- `app.js` — la lógica.
- `lista.json` — la lista del día. **Es el único archivo que cambia a diario.**

## Cómo funciona

- Quien revisa escribe su nombre y marca cada artículo: **Tengo**, **Faltan algunas** (indica cuántas quedan) o **No hay**, con nota opcional.
- Las marcas se guardan en el navegador de ese teléfono, por fecha. Si recarga la página no se pierden.
- En **Resumen** se ven los faltantes por proveedor y se envían por WhatsApp (o se copia el texto).

## Cargar lista (demostración)

La pestaña **Cargar lista** lee un PDF, el HTML anterior o texto pegado, muestra la vista previa y permite usar esa lista. En esta versión de ensayo la lista cargada solo se usa en ese teléfono (botón «Volver a la lista oficial» para deshacer). En la versión final publicará la lista para todos. El lector de PDF es genérico: hay que ajustarlo con un PDF real del día.

## Actualizar la lista oficial del día

Reemplazar `lista.json` con este formato y hacer commit:

```json
{"fecha":"2026-10-28","items":[
 {"g":"CEN","c":"CEN266401","q":14,"d":"PL - VODKA SMIRNOFF 1L. (1)"}
]}
```

`g` = proveedor, `c` = código, `q` = cantidad, `d` = descripción. Al cambiar la fecha, cada teléfono empieza la lista nueva en blanco.

## Pendiente para la versión definitiva

- Guardar las marcas en Firebase para verlas en vivo y tener historial.
- Cargar la lista directamente desde el PDF del día.
