import { auth, db, doc, getDoc, onAuthStateChanged } from './firebase-init.js';
import { loadAdminSidebar } from './admin-ui.js'; // Importamos el cargador

onAuthStateChanged(auth, async (user) => {
    if (!user) {
        window.location.href = "/auth/login.html";
        return;
    }

    const docRef = doc(db, "users", user.uid);
    const docSnap = await getDoc(docRef);

    if (docSnap.exists() && docSnap.data().role === 'admin') {
        // 1. Cargamos el Sidebar dinámicamente
        loadAdminSidebar();
        
        // 2. Mostramos el contenido
        document.body.classList.remove('hidden');
        console.log("Acceso Admin verificado.");
    } else {
        alert("Acceso denegado.");
        window.location.href = "/";
    }
});