// Carga automática desde el correo. Lo ejecuta GitHub Actions cada 10 minutos.
//
// Variables (secretos del repositorio en GitHub):
//   GMAIL_USER                 existenciascontrolbd@gmail.com
//   GMAIL_APP_PASSWORD         contraseña de aplicación de esa cuenta (16 letras)
//   FIREBASE_SERVICE_ACCOUNT   contenido del JSON de la cuenta de servicio de Firebase
//   AVISO_EMAILS (opcional)    correos extra que reciben los avisos, separados por comas
//   APP_URL (opcional)         enlace de la app que se incluye en los avisos
import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import nodemailer from 'nodemailer';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import pdfjs from 'pdfjs-dist/legacy/build/pdf.js';
import { procesarCorreo, revisarFaltantes } from './nucleo.mjs';

const ETIQUETA = 'ce-procesado';
const env = k => { const v = process.env[k]; if (!v) { console.error(`Falta la variable ${k}`); process.exit(1); } return v; };
const USER = env('GMAIL_USER'), PASS = env('GMAIL_APP_PASSWORD').replace(/\s+/g, '');
const cfg = {
  appUrl: process.env.APP_URL || 'https://yulissalopezc.github.io/control-existencias/',
  avisoExtra: (process.env.AVISO_EMAILS || USER).split(',').map(s => s.trim()).filter(Boolean),
  esperaMin: Number(process.env.ESPERA_MIN || 30),
};

/* ---------- Firebase ---------- */
initializeApp({ credential: cert(JSON.parse(env('FIREBASE_SERVICE_ACCOUNT'))) });
const db = getFirestore();
db.settings({ ignoreUndefinedProperties: true });
const store = {
  getCarga: async h => (await db.doc(`cargas/${h}`).get()).data(),
  setCarga: (h, d) => db.doc(`cargas/${h}`).set(d),
  updCarga: (h, d) => db.doc(`cargas/${h}`).set(d, { merge: true }),
  getBandeja: async f => (await db.doc(`bandeja/${f}`).get()).data(),
  setBandeja: (f, d) => db.doc(`bandeja/${f}`).set(d),
  bandejasEsperando: async () => (await db.collection('bandeja').where('estado', '==', 'esperando').get()).docs.map(x => x.data()),
  getDia: async f => (await db.doc(`dias/${f}`).get()).data(),
  setDia: (f, d) => db.doc(`dias/${f}`).set(d),
  addRegistro: r => db.collection('registro').add({ ...r, creado: FieldValue.serverTimestamp() }),
};

/* ---------- Avisos por correo ---------- */
const smtp = nodemailer.createTransport({ host: 'smtp.gmail.com', port: 465, secure: true, auth: { user: USER, pass: PASS } });
async function avisar({ para, asunto, texto }) {
  try { await smtp.sendMail({ from: `Control de existencias <${USER}>`, to: para.join(', '), subject: asunto, text: texto }); console.log('Aviso enviado a', para.join(', '), '·', asunto); }
  catch (e) { console.error('No se pudo enviar el aviso:', e.message); }
}

/* ---------- Correo entrante ---------- */
async function main() {
  const imap = new ImapFlow({ host: 'imap.gmail.com', port: 993, secure: true, auth: { user: USER, pass: PASS }, logger: false });
  await imap.connect();
  let procesados = 0;
  const lock = await imap.getMailboxLock('INBOX');
  try {
    // Correos de los últimos 7 días con PDF que aún no tienen la etiqueta de procesado
    const uids = await imap.search({ gmraw: `has:attachment filename:pdf newer_than:7d -label:${ETIQUETA}` }, { uid: true }) || [];
    console.log(`Correos nuevos con PDF: ${uids.length}`);
    for (const uid of uids) {
      const msg = await imap.fetchOne(uid, { source: true }, { uid: true });
      const mail = await simpleParser(msg.source);
      const de = mail.from?.value?.[0]?.address || '';
      const correo = {
        id: mail.messageId || String(uid), de, asunto: mail.subject || '',
        adjuntos: (mail.attachments || []).map(a => ({ nombre: a.filename || 'adjunto.pdf', tipo: a.contentType, contenido: a.content })),
      };
      console.log(`→ ${correo.asunto} · de ${de} · ${correo.adjuntos.length} adjunto(s)`);
      try {
        const r = await procesarCorreo({ correo, store, avisar, pdfjs, cfg });
        console.log('   recibidos:', r.recibidos.map(x => `${x.tipo} ${x.fecha}`).join(', ') || '—',
          '| publicados:', r.publicados.map(x => x.fecha).join(', ') || '—',
          '| duplicados:', r.duplicados.length, '| errores:', r.errores.length, '| no cuadra:', r.noCuadra.length);
        await marcar(imap, uid);
        procesados++;
      } catch (e) {
        // Si falla algo inesperado, NO se marca: se reintentará en la próxima ejecución.
        console.error('   Error procesando el correo:', e);
      }
    }
  } finally { lock.release(); }
  await imap.logout();

  const faltan = await revisarFaltantes({ store, avisar, cfg });
  if (faltan.length) console.log('Avisos de PDF faltante:', faltan.join(', '));
  console.log(`Listo. Correos procesados: ${procesados}`);
}
const marcar = (imap, uid) => imap.messageFlagsAdd(uid, [ETIQUETA], { uid: true, useLabels: true });

main().catch(e => { console.error('Error general:', e); process.exit(1); });
