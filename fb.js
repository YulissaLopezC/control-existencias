// Capa de datos. Tres modos:
//  - REAL: la app publicada. Usa Firebase y los datos reales.
//  - LOCAL (localhost o ?demo): base de prueba que vive solo en este navegador.
//  - PRUEBA (enlace control-existencias-prueba o ?prueba): Firebase real, pero TODO se guarda
//    en colecciones aparte que empiezan por "prueba_". Nunca lee ni escribe los datos reales.
const params = new URLSearchParams(location.search);
const LOCAL = ['localhost', '127.0.0.1', ''].includes(location.hostname) || params.has('demo');
const PRUEBA = !LOCAL && (location.pathname.startsWith('/control-existencias-prueba') || params.has('prueba'));
export const MODO = LOCAL ? 'local' : PRUEBA ? 'prueba' : 'real';
export const DEMO = MODO !== 'real';
const PRE = 'prueba_';

let m;
if (LOCAL) {
  m = await import('./demo/fake-firebase.js?v=2');
} else {
  const V = 'https://www.gstatic.com/firebasejs/10.12.2/';
  const [A, F, U, C] = await Promise.all([
    import(V + 'firebase-app.js'), import(V + 'firebase-firestore.js'), import(V + 'firebase-auth.js'), import('./firebase-config.js?v=4'),
  ]);
  const app = A.initializeApp(C.firebaseConfig);
  let db;
  try { db = F.initializeFirestore(app, { localCache: F.persistentLocalCache({ tabManager: F.persistentMultipleTabManager() }) }); }
  catch (e) { db = F.getFirestore(app); }
  m = {
    db, auth: U.getAuth(app),
    doc: F.doc, collection: F.collection, setDoc: F.setDoc, deleteDoc: F.deleteDoc, getDoc: F.getDoc,
    onSnapshot: F.onSnapshot, query: F.query, orderBy: F.orderBy, limit: F.limit, runTransaction: F.runTransaction,
    onAuthStateChanged: U.onAuthStateChanged, signInWithEmailAndPassword: U.signInWithEmailAndPassword, signOut: U.signOut,
  };
  if (PRUEBA) {
    const { USUARIOS_DEMO, fichaUsuario, crearSesion } = await import('./demo/usuarios.js?v=1');
    // Toda ruta se desvía a su copia "prueba_": dias → prueba_dias, config → prueba_config, etc.
    const desviar = s => { const r = [...s]; if (!String(r[0]).startsWith(PRE)) r[0] = PRE + r[0]; return r; };
    m.doc = (d, ...s) => F.doc(d, ...desviar(s));
    m.collection = (d, ...s) => F.collection(d, ...desviar(s));
    // Entrada con PIN de prueba (sin cuentas reales).
    Object.assign(m, crearSesion('ce_prueba_sesion'));
    // Crear los usuarios de prueba si aún no están.
    try {
      const snap = await F.getDocs(m.collection(db, 'usuarios'));
      if (snap.size < USUARIOS_DEMO.length) await Promise.all(USUARIOS_DEMO.map(u => F.setDoc(m.doc(db, 'usuarios', u.uid), fichaUsuario(u))));
    } catch (e) { console.error('No se pudieron crear los usuarios de prueba', e); }
    // Borrar SOLO lo de prueba (días, asignaciones, almacenes, historial). Los usuarios se quedan.
    m.borrarDatosDemo = async () => {
      const borrarCol = async ref => { const s = await F.getDocs(ref); await Promise.all(s.docs.map(x => F.deleteDoc(x.ref))); };
      const dias = await F.getDocs(m.collection(db, 'dias'));
      for (const d of dias.docs) {
        for (const sub of ['recogida', 'reparto', 'asignaciones', 'traspasos', 'almacenes']) await borrarCol(F.collection(db, PRE + 'dias', d.id, sub));
        await F.deleteDoc(d.ref);
      }
      await borrarCol(m.collection(db, 'config'));
      await borrarCol(m.collection(db, 'registro'));
    };
  }
}
export const {
  db, auth, doc, collection, setDoc, deleteDoc, getDoc, onSnapshot, query, orderBy, limit, runTransaction,
  onAuthStateChanged, signInWithEmailAndPassword, signOut,
} = m;
export const borrarDatosDemo = m.borrarDatosDemo || null;
