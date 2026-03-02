import { db, collection, addDoc, query, orderBy, Timestamp, limit, startAfter, where, doc, getDoc, onSnapshot } from "./firebase-init.js";

// --- REFERENCIAS DOM ---
const modal = document.getElementById('client-modal');
const btnOpen = document.getElementById('btn-add-client');
const btnCloseList = document.querySelectorAll('.close-modal');
const btnSave = document.getElementById('save-client');
const searchInput = document.getElementById('search-client');
const listContainer = document.getElementById('clients-table-body');
const loadMoreBtn = document.getElementById('load-more-container');

const inpDept = document.getElementById('new-client-dept');
const inpCity = document.getElementById('new-client-city');

// --- ESTADO GLOBAL ---
let lastVisible = null;
let isLoading = false;
const DOCS_PER_PAGE = 50;

let unsubscribeClientsList = null;
let adminClientsCache = []; // RAM Cache para búsquedas instantáneas

// ==========================================================================
// 🧠 SMART REAL-TIME CACHE: LISTA DE CLIENTES
// ==========================================================================
function startClientsListener(isNextPage = false) {
    if (isLoading) return;
    isLoading = true;

    // UI Loading
    if (!isNextPage) {
        listContainer.innerHTML = `<tr><td colspan="5" class="p-10 text-center"><i class="fa-solid fa-circle-notch fa-spin text-2xl text-brand-cyan"></i><p class="mt-2 text-xs font-bold text-gray-400">Cargando clientes...</p></td></tr>`;
        loadMoreBtn.classList.add('hidden');
        
        // Si empezamos de cero (página 1), apagamos el listener viejo
        if (unsubscribeClientsList) unsubscribeClientsList();
    } else {
        const btn = loadMoreBtn.querySelector('button');
        btn.innerHTML = `<i class="fa-solid fa-circle-notch fa-spin"></i> Cargando...`;
    }

    try {
        const usersRef = collection(db, "users");
        let constraints = [];

        constraints.push(orderBy("createdAt", "desc"));

        // B. EJECUCIÓN HÍBRIDA (getDocs para paginación, onSnapshot para página 1)
        if (isNextPage && lastVisible) {
            constraints.push(startAfter(lastVisible));
            constraints.push(limit(DOCS_PER_PAGE));
            
            const q = query(usersRef, ...constraints);
            getDocs(q).then(snapshot => handleSnapshotResult(snapshot, true)).catch(e => {
                console.error("Error Paginación Clientes:", e);
                isLoading = false;
            });
            
        } else {
            constraints.push(limit(DOCS_PER_PAGE));
            const q = query(usersRef, ...constraints);
            
            unsubscribeClientsList = onSnapshot(q, (snapshot) => {
                handleSnapshotResult(snapshot, false);
            }, (error) => {
                console.error("Error Live Clientes:", error);
                listContainer.innerHTML = `<tr><td colspan="5" class="text-center text-red-400 font-bold p-10">Error de conexión en vivo.</td></tr>`;
            });
        }

    } catch (e) {
        console.error("Error configurando query de clientes:", e);
        isLoading = false;
    }
}

function handleSnapshotResult(snapshot, isNextPage) {
    if (!isNextPage) {
        listContainer.innerHTML = "";
        // Reiniciamos el caché RAM en la página 1
        adminClientsCache = [];
    }

    if (snapshot.empty) {
        if (!isNextPage) listContainer.innerHTML = `<tr><td colspan="5" class="p-10 text-center text-gray-400 font-bold uppercase text-xs">No hay clientes registrados.</td></tr>`;
        loadMoreBtn.classList.add('hidden');
        isLoading = false;
        return;
    }

    // Actualizamos lastVisible solo si NO es un repintado en vivo de un docChange (para evitar dañar la paginación)
    if (snapshot.docs.length > 0 && !snapshot.metadata.hasPendingWrites) {
         lastVisible = snapshot.docs[snapshot.docs.length - 1];
    }

    // UI del botón "Cargar más"
    if (snapshot.docs.length === DOCS_PER_PAGE) {
        loadMoreBtn.classList.remove('hidden');
        loadMoreBtn.querySelector('button').innerHTML = `<i class="fa-solid fa-circle-plus"></i> Cargar siguientes 50`;
    } else {
        loadMoreBtn.classList.add('hidden');
    }

    // Renderizar y guardar en RAM para el buscador
    snapshot.forEach(docSnap => {
        const clientData = { id: docSnap.id, ...docSnap.data() };
        adminClientsCache.push(clientData);
        renderClientRow(clientData);
    });

    isLoading = false;
}

// Global para el botón HTML
window.loadMoreClients = () => startClientsListener(true);

function renderClientRow(c) {
    const date = c.createdAt?.toDate ? c.createdAt.toDate().toLocaleDateString('es-CO') : '---';
    const sourceTag = c.source === 'MANUAL' ? 
        `<span class="bg-slate-100 text-slate-500 px-3 py-1 rounded-full text-[9px] font-black uppercase border border-slate-200">Manual</span>` : 
        `<span class="bg-brand-cyan/10 text-brand-cyan px-3 py-1 rounded-full text-[9px] font-black uppercase border border-brand-cyan/20">Web</span>`;

    const row = document.createElement('tr');
    row.className = "hover:bg-slate-50/80 transition border-b border-gray-50 group fade-in";
    row.innerHTML = `
        <td class="px-8 py-5">
            <div class="flex items-center gap-3">
                <div class="w-10 h-10 rounded-xl bg-gray-100 flex items-center justify-center font-black text-brand-cyan text-xs group-hover:bg-brand-cyan group-hover:text-white transition">
                    ${(c.name || c.userName || 'U').substring(0,1).toUpperCase()}
                </div>
                <div>
                    <div class="font-black text-brand-black text-sm uppercase">${c.name || c.userName || 'Sin nombre'}</div>
                    ${c.document ? `<span class="text-[9px] text-gray-400 font-bold uppercase">${c.document}</span>` : ''}
                </div>
            </div>
        </td>
        <td class="px-8 py-5">
            <div class="text-xs font-bold text-gray-600">${c.phone || '---'}</div>
            <div class="text-[10px] text-gray-400 font-medium">${c.email || ''}</div>
        </td>
        <td class="px-8 py-5">${sourceTag}</td>
        <td class="px-8 py-5 text-xs text-gray-400 font-bold">${date}</td>
        <td class="px-8 py-5 text-center">
            <a href="client-details.html?id=${c.id}" class="inline-flex w-10 h-10 items-center justify-center rounded-xl bg-slate-100 text-slate-400 hover:bg-brand-black hover:text-white transition shadow-sm" title="Ver Detalle">
                <i class="fa-solid fa-eye text-xs"></i>
            </a>
        </td>
    `;
    listContainer.appendChild(row);
}

// --- 2. BÚSQUEDA HÍBRIDA (RAM + SERVIDOR) ---
if (searchInput) {
    searchInput.addEventListener('keyup', (e) => {
        const term = e.target.value.toLowerCase().trim();

        // Si el usuario borró todo
        if (term.length === 0) {
            if (e.key === 'Backspace' || e.key === 'Delete') {
                // Restaurar desde la RAM en milisegundos (0 lecturas)
                listContainer.innerHTML = "";
                adminClientsCache.forEach(c => renderClientRow(c));
            }
            return;
        }

        // A. BÚSQUEDA EN SERVIDOR (ENTER)
        if (e.key === 'Enter' && term.length > 0) {
            performServerSearch(term);
            return;
        }

        // B. BÚSQUEDA LOCAL EN RAM (Mientras escribe)
        listContainer.innerHTML = "";
        const results = adminClientsCache.filter(c => {
            const nameMatch = (c.name || c.userName || "").toLowerCase().includes(term);
            const phoneMatch = (c.phone || "").toLowerCase().includes(term);
            const docMatch = (c.document || "").toLowerCase().includes(term);
            const emailMatch = (c.email || "").toLowerCase().includes(term);
            return nameMatch || phoneMatch || docMatch || emailMatch;
        });

        if (results.length === 0) {
            listContainer.innerHTML = `<tr><td colspan="5" class="p-10 text-center text-xs font-bold text-gray-400 uppercase">No visible en caché. Pulsa Enter para buscar a fondo.</td></tr>`;
        } else {
            results.forEach(c => renderClientRow(c));
        }
    });
}

async function performServerSearch(term) {
    if(isLoading) return;
    isLoading = true;

    // Apagamos live listener para no interferir con la vista de búsqueda
    if(unsubscribeClientsList) unsubscribeClientsList();

    listContainer.innerHTML = `<tr><td colspan="5" class="p-10 text-center"><i class="fa-solid fa-search fa-bounce text-brand-cyan"></i> Buscando a fondo...</td></tr>`;
    loadMoreBtn.classList.add('hidden');

    try {
        const queries = [];
        const usersRef = collection(db, "users");

        // 1. Por ID de Documento (Firebase ID)
        const docRef = doc(db, "users", term);
        const p1 = getDoc(docRef).then(s => s.exists() ? [{ id: s.id, ...s.data() }] : []);

        // 2. Por Email Exacto
        const qEmail = query(usersRef, where("email", "==", term));
        const p2 = getDocs(qEmail).then(s => s.docs.map(d => ({ id: d.id, ...d.data() })));

        // 3. Por Cédula/NIT Exacto (campo 'document')
        const qDoc = query(usersRef, where("document", "==", term));
        const p3 = getDocs(qDoc).then(s => s.docs.map(d => ({ id: d.id, ...d.data() })));
        
        // 4. Por Teléfono Exacto (Súper común)
        const qPhone = query(usersRef, where("phone", "==", term));
        const p4 = getDocs(qPhone).then(s => s.docs.map(d => ({ id: d.id, ...d.data() })));

        // Ejecutar todo en paralelo
        const [r1, r2, r3, r4] = await Promise.all([p1, p2, p3, p4]);
        
        // Unir resultados eliminando duplicados
        const allResults = [...r1, ...r2, ...r3, ...r4];
        const uniqueIds = new Set();
        const finalDocs = [];

        allResults.forEach(d => {
            if(!uniqueIds.has(d.id)) {
                uniqueIds.add(d.id);
                finalDocs.push(d);
            }
        });

        listContainer.innerHTML = "";
        
        if (finalDocs.length > 0) {
            finalDocs.forEach(d => renderClientRow(d));
        } else {
            listContainer.innerHTML = `<tr><td colspan="5" class="p-10 text-center text-xs font-bold text-gray-400 uppercase">No se encontró cliente con ID, Email, Teléfono o Documento exacto: "${term}"<br><span class="text-[9px] text-brand-cyan cursor-pointer hover:underline mt-2 block" onclick="window.loadMoreClients()">Recargar Lista Original</span></td></tr>`;
        }

    } catch(e) {
        console.error(e);
        startClientsListener(false); // Restaurar lista si falla
    } finally {
        isLoading = false;
    }
}


// --- 3. API COLOMBIA ---
let deptsLoaded = false;

async function loadDepartments() {
    if (deptsLoaded) return; 
    try {
        const res = await fetch('https://api-colombia.com/api/v1/Department');
        const depts = await res.json();
        depts.sort((a, b) => a.name.localeCompare(b.name));

        inpDept.innerHTML = '<option value="">Seleccione...</option>';
        depts.forEach(d => {
            const opt = document.createElement('option');
            opt.value = d.id; 
            opt.textContent = d.name;
            opt.dataset.name = d.name;
            inpDept.appendChild(opt);
        });
        deptsLoaded = true;
    } catch (e) { console.error("Error API Colombia:", e); }
}

if(inpDept) {
    inpDept.addEventListener('change', async (e) => {
        const deptId = e.target.value;
        inpCity.innerHTML = '<option value="">Cargando...</option>';
        inpCity.disabled = true;

        if (!deptId) {
            inpCity.innerHTML = '<option value="">Seleccione Depto...</option>';
            return;
        }

        try {
            const res = await fetch(`https://api-colombia.com/api/v1/Department/${deptId}/cities`);
            const cities = await res.json();
            cities.sort((a, b) => a.name.localeCompare(b.name));

            inpCity.innerHTML = '<option value="">Seleccione Ciudad...</option>';
            cities.forEach(c => {
                const opt = document.createElement('option');
                opt.value = c.name;
                opt.textContent = c.name;
                inpCity.appendChild(opt);
            });
            inpCity.disabled = false;
        } catch (e) { console.error("Error Ciudades:", e); }
    });
}

// --- 4. LÓGICA DEL MODAL ---
if (btnOpen) {
    btnOpen.onclick = () => {
        document.getElementById('new-client-name').value = '';
        document.getElementById('new-client-phone').value = '';
        document.getElementById('new-client-doc').value = '';
        document.getElementById('new-client-email').value = '';
        document.getElementById('new-client-address').value = '';
        document.getElementById('new-client-notes').value = '';
        if(inpDept) inpDept.value = "";
        if(inpCity) { inpCity.innerHTML = '<option value="">Seleccione Depto...</option>'; inpCity.disabled = true; }
        
        loadDepartments();
        modal.classList.remove('hidden');
    };
}

const closeModal = () => modal.classList.add('hidden');
btnCloseList.forEach(btn => btn.onclick = closeModal);

// --- 5. GUARDAR CLIENTE MANUAL ---
if (btnSave) {
    btnSave.onclick = async () => {
        const btnOriginalText = btnSave.innerHTML;
        btnSave.disabled = true;
        btnSave.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Guardando...';

        const name = document.getElementById('new-client-name').value.trim();
        const phone = document.getElementById('new-client-phone').value.trim();
        const documentVal = document.getElementById('new-client-doc').value.trim();
        const email = document.getElementById('new-client-email').value.trim();
        const address = document.getElementById('new-client-address').value.trim();
        const notes = document.getElementById('new-client-notes').value.trim();
        
        const deptSelect = document.getElementById('new-client-dept');
        const deptName = deptSelect.options[deptSelect.selectedIndex]?.dataset.name || "";
        const city = document.getElementById('new-client-city').value;

        if(!name) {
            alert("El nombre es obligatorio.");
            btnSave.disabled = false;
            btnSave.innerHTML = btnOriginalText;
            return;
        }

        try {
            const newClientData = {
                name, phone, email, document: documentVal,
                adminNotes: notes, source: 'MANUAL', role: 'client',
                createdAt: Timestamp.now(),
                address, dept: deptName, city,
                addresses: address ? [{ alias: "Principal", address, dept: deptName, city, isDefault: true }] : []
            };

            await addDoc(collection(db, "users"), newClientData);
            
            alert("✅ Cliente registrado");
            closeModal();
            // ¡La tabla se actualizará sola gracias al onSnapshot!

        } catch (e) { 
            alert("Error: " + e.message); 
        } finally {
            btnSave.disabled = false;
            btnSave.innerHTML = btnOriginalText;
        }
    };
}

// Iniciar carga inteligente
startClientsListener(false);