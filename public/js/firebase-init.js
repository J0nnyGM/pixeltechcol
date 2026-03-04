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
// 🧹 KILL SWITCH: LIMPIEZA DE CACHÉ GLOBAL
// ==========================================
export async function checkCacheVersion(db) {
    try {
        // Leemos la versión actual desde Firebase (1 sola lectura muy barata)
        const configRef = doc(db, "config", "system");
        const snap = await getDoc(configRef);
        
        if (snap.exists()) {
            const serverVersion = snap.data().cacheVersion || 1;
            const localVersion = parseInt(localStorage.getItem('pixeltech_cache_version') || '0');

            // Si el servidor tiene una versión mayor, detonamos la bomba 💣
            if (serverVersion > localVersion) {
                console.warn(`🔄 Nueva versión detectada (v${serverVersion}). Limpiando caché...`);

                // 1. Borramos SOLO las llaves de nuestro caché para no borrar sesiones de Firebase Auth
                Object.keys(localStorage).forEach(key => {
                    if (key.includes('pixeltech_')) {
                        localStorage.removeItem(key);
                    }
                });
                
                Object.keys(sessionStorage).forEach(key => {
                    if (key.includes('pixeltech_')) {
                        sessionStorage.removeItem(key);
                    }
                });

                // 2. Guardamos la nueva versión para no crear un bucle infinito
                localStorage.setItem('pixeltech_cache_version', serverVersion.toString());

                // 3. Forzamos la recarga de la página (Hard Reload)
                window.location.reload(true);
            }
        }
    } catch (error) {
        console.error("Error comprobando versión de caché:", error);
    }
}

  // Ejecutar automáticamente a los 2 segundos de abrir la página (para no frenar la carga principal)
  setTimeout(() => {
    // Asume que 'db' es tu variable global exportada de Firestore
    checkCacheVersion(db); 
}, 2000);