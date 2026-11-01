/**
 * Vigilante del correo — Control de existencias (Distribuciones Antonio Viña)
 *
 * Se instala en script.google.com con la cuenta existenciascontrolbd@gmail.com.
 * Cada minuto mira si llegó un correo nuevo con PDF y, si es así, le pide a GitHub
 * que ejecute YA la carga automática (en vez de esperar la revisión de cada 10 minutos).
 * No lee ni procesa los PDF: eso lo sigue haciendo el proceso de GitHub.
 *
 * Configuración: Configuración del proyecto → Propiedades de la secuencia de comandos →
 *   GITHUB_TOKEN = la clave de GitHub (fine-grained, solo este repositorio, Actions: lectura y escritura)
 *
 * Funciones:
 *   probarAviso()        → lanza la carga una vez, para comprobar que la clave funciona.
 *   instalarActivador()  → deja vigilar() funcionando cada minuto (ejecutar una sola vez).
 *   vigilar()            → lo que se ejecuta cada minuto.
 */

const REPO = 'YulissaLopezC/control-existencias';
const WORKFLOW = 'carga-correo.yml';
const BUSQUEDA = 'has:attachment filename:pdf newer_than:2d -label:ce-procesado';

function vigilar() {
  const props = PropertiesService.getScriptProperties();
  const vistos = JSON.parse(props.getProperty('VISTOS') || '[]');
  const nuevos = [];

  GmailApp.search(BUSQUEDA, 0, 20).forEach(hilo => {
    hilo.getMessages().forEach(m => {
      const id = m.getId();
      if (vistos.indexOf(id) !== -1) return;
      const tienePdf = m.getAttachments().some(a => /\.pdf$/i.test(a.getName()) || /pdf/i.test(a.getContentType()));
      if (tienePdf) nuevos.push(id);
    });
  });

  if (!nuevos.length) return;
  if (lanzar(`${nuevos.length} correo(s) nuevo(s) con PDF`)) {
    // Recordamos los correos ya avisados para no volver a lanzar por ellos (guardamos los últimos 300).
    props.setProperty('VISTOS', JSON.stringify(vistos.concat(nuevos).slice(-300)));
  }
  // Si falla, no se guardan: se volverá a intentar en el siguiente minuto.
}

function lanzar(motivo) {
  const token = PropertiesService.getScriptProperties().getProperty('GITHUB_TOKEN');
  if (!token) throw new Error('Falta la propiedad GITHUB_TOKEN en la configuración del proyecto.');
  const r = UrlFetchApp.fetch(`https://api.github.com/repos/${REPO}/actions/workflows/${WORKFLOW}/dispatches`, {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + token.trim(), Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
    payload: JSON.stringify({ ref: 'main' }),
    muteHttpExceptions: true,
  });
  const ok = r.getResponseCode() === 204;
  console.log(ok ? `Carga lanzada en GitHub (${motivo}).` : `GitHub respondió ${r.getResponseCode()}: ${r.getContentText()}`);
  return ok;
}

function probarAviso() {
  if (lanzar('prueba manual')) console.log('✅ Funciona. Revisa la pestaña Actions de GitHub: debe aparecer una ejecución nueva.');
  else console.log('❌ No funcionó. Revisa que la clave GITHUB_TOKEN esté bien copiada y tenga permiso de Actions (lectura y escritura).');
}

function instalarActivador() {
  ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === 'vigilar').forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('vigilar').timeBased().everyMinutes(1).create();
  console.log('✅ Vigilante activado: revisará el correo cada minuto.');
}
