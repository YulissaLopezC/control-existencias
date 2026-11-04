// Capa de datos: en producción usa Firebase; en el computador (localhost) o con ?demo
// usa una base de prueba que vive solo en este navegador, para probar sin tocar los datos reales.
const params = new URLSearchParams(location.search);
export const DEMO = ['localhost', '127.0.0.1', ''].includes(location.hostname) || params.has('demo');

let m;
if (DEMO) {
  m = await import('./demo/fake-firebase.js?v=1');
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
}
export const {
  db, auth, doc, collection, setDoc, deleteDoc, getDoc, onSnapshot, query, orderBy, limit, runTransaction,
  onAuthStateChanged, signInWithEmailAndPassword, signOut,
} = m;
export const borrarDatosDemo = m.borrarDatosDemo || null;
