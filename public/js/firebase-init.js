// public/js/firebase-init.js
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth, onAuthStateChanged, GoogleAuthProvider, signInWithPopup, signOut } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

// LIBRERÍA DE FIRESTORE (Base de datos)
import { 
    getFirestore, collection, addDoc, getDocs, doc, Timestamp, getDoc, setDoc, updateDoc, deleteDoc, query, where, orderBy, limit, runTransaction, writeBatch, onSnapshot,limitToLast,  endAt, startAt, serverTimestamp, arrayUnion, startAfter,
    getCountFromServer, 
    getAggregateFromServer, 
    sum, count,endBefore,documentId
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

// LIBRERÍA DE STORAGE (Imágenes)
import { getStorage, ref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-storage.js";

// --- NUEVO: LIBRERÍA DE FUNCTIONS (Para MercadoPago/Addi) ---
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-functions.js";

// Configuración de tu proyecto
const firebaseConfig = {
  apiKey: "AIzaSyALwLCRjRaWUE5yy5-TBjjxKehguNhb0GU",
  authDomain: "pixeltechcol.firebaseapp.com",
  projectId: "pixeltechcol",
  storageBucket: "pixeltechcol.firebasestorage.app",
  messagingSenderId: "296531510388",
  appId: "1:296531510388:web:544a0d45ea835a3facbd21",
  measurementId: "G-0HP0VNV5F5"
};

// Inicialización
const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);
export const functions = getFunctions(app); // <-- ¡NUEVO! Inicializamos Functions
export const provider = new GoogleAuthProvider();

// Exportar funciones para toda la app
export { 
    onAuthStateChanged, 
    signInWithPopup, 
    signOut,
    collection,
    addDoc, 
    getDocs, 
    doc, 
    limitToLast,
    getDoc,
    setDoc,
    updateDoc,
    deleteDoc,
    query,      
    orderBy,    
    limit,   
    startAt,
    writeBatch,
    endAt,  
    where,      
    ref,
    uploadBytes,
    getDownloadURL,
    runTransaction,
    onSnapshot,
    serverTimestamp,
    arrayUnion,
    Timestamp,
    // --- NUEVO: Exportar para usar en checkout.js ---
    httpsCallable ,
    startAfter,
    // NUEVAS EXPORTACIONES:
    getCountFromServer,
    getAggregateFromServer,
    sum,
    count,
    endBefore,
    documentId                                                                                                 
};

// ==========================================
// 🧹 KILL SWITCH: LIMPIEZA DE CACHÉ GLOBAL Y PWA
// ==========================================
export async function checkCacheVersion(db) {
    if (!navigator.onLine) return; // Si no hay internet, abortamos

    try {
        const configRef = doc(db, "config", "system");
        const snap = await getDoc(configRef);
        
        if (snap.exists()) {
            const serverVersion = snap.data().cacheVersion || 1;
            const localVersionString = localStorage.getItem('pixeltech_cache_version');

            // 🔥 CASO 1: ES UN USUARIO NUEVO (No tiene versión guardada)
            if (localVersionString === null) {
                // Simplemente guardamos la versión actual silenciosamente y no recargamos nada
                console.log(`👋 Nuevo visitante. Registrando versión de caché v${serverVersion}.`);
                localStorage.setItem('pixeltech_cache_version', serverVersion.toString());
                return; // Cortamos la ejecución aquí
            }

            // 🔥 CASO 2: ES UN USUARIO RECURRENTE
            const localVersion = parseInt(localVersionString);
            

            // Si el servidor tiene una versión mayor, detonamos la bomba 💣
            if (serverVersion > localVersion) {
                console.warn(`🔄 Nueva versión detectada (v${serverVersion}). Limpiando TODO el caché...`);

                // 1. Borramos Datos Locales (Carrito, Sesiones de usuario, etc.)
                Object.keys(localStorage).forEach(key => {
                    if (key.includes('pixeltech_')) localStorage.removeItem(key);
                });
                
                Object.keys(sessionStorage).forEach(key => {
                    if (key.includes('pixeltech_')) sessionStorage.removeItem(key);
                });

                // 2. DESTRUIR EL CACHÉ DEL SERVICE WORKER
                if ('caches' in window) {
                    const cacheNames = await caches.keys();
                    await Promise.all(cacheNames.map(name => caches.delete(name)));
                    console.log("🧹 Bóveda de archivos eliminada.");
                }

                // 3. DESREGISTRAR EL SERVICE WORKER ACTUAL
                if ('serviceWorker' in navigator) {
                    const registrations = await navigator.serviceWorker.getRegistrations();
                    for (let registration of registrations) await registration.unregister();
                    console.log("🔌 Service Worker antiguo desregistrado.");
                }

                // 4. Guardamos la nueva versión para no crear un bucle infinito
                localStorage.setItem('pixeltech_cache_version', serverVersion.toString());

                // 5. Forzamos la recarga de la página
                window.location.reload(true);
            }
        }
    } catch (error) {
        if (error.code === 'unavailable' || error.message.includes('offline')) return;
        console.error("Error comprobando versión de caché:", error);
    }
}

// Ejecutamos mucho después de cargar para que PageSpeed no lo cuente como bloqueo
window.addEventListener('load', () => {
    setTimeout(() => {
        checkCacheVersion(db); 
    }, 8000); // 8 Segundos
});