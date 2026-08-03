// public/js/firebase-init.js
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth, onAuthStateChanged, GoogleAuthProvider, signInWithPopup, signOut } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

// 🔥 IMPORTAMOS LAS FUNCIONES NATIVAS DE ESCRITURA CON UN "ALIAS" (native...)
import { 
    getFirestore, collection, getDocs, doc, Timestamp, getDoc, deleteDoc, query, where, orderBy, limit, onSnapshot, limitToLast, endAt, startAt, serverTimestamp, arrayUnion, startAfter, getCountFromServer, getAggregateFromServer, sum, count, endBefore, documentId,
    addDoc as nativeAddDoc,
    setDoc as nativeSetDoc,
    updateDoc as nativeUpdateDoc,
    runTransaction as nativeRunTransaction,
    writeBatch as nativeWriteBatch
} from "https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js";

import { getStorage, ref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-storage.js";
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

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);
export const functions = getFunctions(app);
export const provider = new GoogleAuthProvider();


// ============================================================================
// 🛡️ INTERCEPTORES: Auto-inyección de updatedAt en TODA la app
// ============================================================================

export const addDoc = (reference, data) => {
    if (data && typeof data === 'object') {
        data.updatedAt = serverTimestamp();
        if (!data.createdAt) data.createdAt = serverTimestamp();
    }
    return nativeAddDoc(reference, data);
};

export const setDoc = (reference, data, options) => {
    if (data && typeof data === 'object') {
        data.updatedAt = serverTimestamp();
        if (!options?.merge && !data.createdAt) data.createdAt = serverTimestamp();
    }
    return nativeSetDoc(reference, data, options);
};

export const updateDoc = (reference, data) => {
    if (data && typeof data === 'object') {
        data.updatedAt = serverTimestamp();
    }
    return nativeUpdateDoc(reference, data);
};

export const writeBatch = (dbInstance) => {
    const batch = nativeWriteBatch(dbInstance);
    // Envolvemos el batch para no perder la inyección si usan encadenamiento (chaining)
    const wrappedBatch = {
        set: (ref, data, options) => {
            if (data && typeof data === 'object') {
                data.updatedAt = serverTimestamp();
                if (!options?.merge && !data.createdAt) data.createdAt = serverTimestamp();
            }
            batch.set(ref, data, options);
            return wrappedBatch;
        },
        update: (ref, data) => {
            if (data && typeof data === 'object') {
                data.updatedAt = serverTimestamp();
            }
            batch.update(ref, data);
            return wrappedBatch;
        },
        delete: (ref) => {
            batch.delete(ref);
            return wrappedBatch;
        },
        commit: () => batch.commit()
    };
    return wrappedBatch;
};

export const runTransaction = (dbInstance, updateFunction) => {
    return nativeRunTransaction(dbInstance, async (transaction) => {
        const wrappedTx = {
            get: (ref) => transaction.get(ref),
            set: (ref, data, options) => {
                if (data && typeof data === 'object') {
                    data.updatedAt = serverTimestamp();
                    if (!options?.merge && !data.createdAt) data.createdAt = serverTimestamp();
                }
                transaction.set(ref, data, options);
                return wrappedTx;
            },
            update: (ref, data) => {
                if (data && typeof data === 'object') {
                    data.updatedAt = serverTimestamp();
                }
                transaction.update(ref, data);
                return wrappedTx;
            },
            delete: (ref) => {
                transaction.delete(ref);
                return wrappedTx;
            }
        };
        return updateFunction(wrappedTx);
    });
};

// Exportar las demás utilidades de Firebase sin modificar
export { 
    onAuthStateChanged, signInWithPopup, signOut, collection, getDocs, doc, 
    limitToLast, getDoc, deleteDoc, query, orderBy, limit, startAt, endAt, 
    where, ref, uploadBytes, getDownloadURL, onSnapshot, serverTimestamp, 
    arrayUnion, Timestamp, httpsCallable, startAfter, getCountFromServer, 
    getAggregateFromServer, sum, count, endBefore, documentId
};

// ==========================================
// 💥 LIMPIEZA EFICIENTE DE CACHÉ (PRESERVANDO INDEXEDDB)
// ==========================================
export async function clearAllAppDataAndReload(preserveAuth = true) {
    console.log("🧹 [Caché] Limpiando almacenamiento de localStorage y descargando archivos nuevos del servidor...");

    // 1. Preservar sesión de usuario (Firebase Auth) y versión de caché
    const authKeys = {};
    if (preserveAuth) {
        try {
            for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i);
                if (key && (key.startsWith('firebase:authUser') || key.includes('firebase') || key === 'pixeltech_cache_version')) {
                    authKeys[key] = localStorage.getItem(key);
                }
            }
        } catch (e) {}
    }

    // 2. Destruir localStorage legacy y sessionStorage (Liberando la cuota de 5MB)
    try { localStorage.clear(); } catch (e) {}
    try { sessionStorage.clear(); } catch (e) {}

    // Restaurar credenciales de sesión y versión de caché
    if (preserveAuth) {
        Object.keys(authKeys).forEach(k => {
            try { localStorage.setItem(k, authKeys[k]); } catch (e) {}
        });
    }

    // 3. 🛡️ IMPORTANTE: MANTENER INDEXEDDB (PixelTechAdminDB)
    // Conservar IndexedDB evita borrar los timestamps lastSync, permitiendo a Firebase 
    // hacer Delta Syncs de solo lo cambiado y ahorrando miles de lecturas en Firestore.

    // 4. Borrar Cache Storage de Service Workers (Descarga archivos JS/HTML/CSS frescos)
    try {
        if ('caches' in window) {
            const cacheNames = await caches.keys();
            await Promise.all(cacheNames.map(name => caches.delete(name)));
        }
    } catch (e) {}

    // 5. Desregistrar Service Workers para actualizar la aplicación en vivo
    try {
        if ('serviceWorker' in navigator) {
            const registrations = await navigator.serviceWorker.getRegistrations();
            for (let registration of registrations) {
                await registration.unregister();
            }
        }
    } catch (e) {}

    // 6. Recargar la página limpia con timestamp único
    const newUrl = new URL(window.location.href);
    newUrl.searchParams.set('refresh', Date.now().toString());
    window.location.replace(newUrl.toString());
}

// ==========================================
// 💥 KILL SWITCH: DESTRUCCIÓN TOTAL DE CACHÉ EN TIEMPO REAL
// ==========================================
export function initCacheKillSwitch(db) {
    if (!navigator.onLine) return;

    try {
        const configRef = doc(db, "config", "system");
        
        onSnapshot(configRef, async (snap) => {
            if (snap.exists()) {
                const serverVersion = snap.data().cacheVersion || 1;
                const localVersionString = localStorage.getItem('pixeltech_cache_version');

                if (localVersionString === null) {
                    localStorage.setItem('pixeltech_cache_version', serverVersion.toString());
                    return; 
                }

                const localVersion = parseInt(localVersionString);
                
                if (serverVersion > localVersion) {
                    console.warn(`💥 KILL SWITCH ACTIVADO (v${serverVersion}). Borrando absolutamente todo e iniciando limpio...`);
                    localStorage.setItem('pixeltech_cache_version', serverVersion.toString());
                    await clearAllAppDataAndReload(true);
                }
            }
        }, (error) => {
            console.warn("Kill Switch en pausa (Modo Offline o error de red).");
        });
    } catch (error) {
        console.error("Error iniciando Kill Switch:", error);
    }
}

window.addEventListener('load', () => {
    if ('requestIdleCallback' in window) {
        requestIdleCallback(() => initCacheKillSwitch(db));
    } else {
        setTimeout(() => initCacheKillSwitch(db), 2000); 
    }
});