import { auth, db, doc, getDoc, onAuthStateChanged } from './firebase-init.js';
import { loadAdminSidebar } from './admin-ui.js';

// Función para denegar acceso
const denyAccess = () => {
    console.warn("Acceso denegado: Usuario no autorizado.");
    window.location.replace("/auth/login.html"); // 'replace' borra el historial para que no puedan volver atrás
};

onAuthStateChanged(auth, async (user) => {
    // 1. Si no hay usuario logueado, expulsar inmediatamente
    if (!user) {
        denyAccess();
        return;
    }

    try {
        // 2. Verificar rol en base de datos
        const docRef = doc(db, "users", user.uid);
        const docSnap = await getDoc(docRef);

        if (docSnap.exists() && docSnap.data().role === 'admin') {
            // 3. ¡Éxito! Cargamos la UI
            console.log("✅ Admin verificado:", user.email);
            
            loadAdminSidebar();
            
            // 4. IMPORTANTE: Mostramos el cuerpo de la página aquí
            // Usamos display 'flex' o 'block' dependiendo de tu layout (usualmente en Tailwind es flex para el body)
            document.body.style.display = 'flex'; 
            
        } else {
            // Usuario logueado pero no es admin
            alert("No tienes permisos de administrador.");
            denyAccess();
        }
    } catch (error) {
        console.error("Error verificando permisos:", error);
        denyAccess();
    }
});