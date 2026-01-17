import { db, collection, getDocs, addDoc, query, orderBy, Timestamp } from "./firebase-init.js";

// --- REFERENCIAS DOM ---
const modal = document.getElementById('client-modal');
const btnOpen = document.getElementById('btn-add-client');
const btnCloseList = document.querySelectorAll('.close-modal');
const btnSave = document.getElementById('save-client');
const searchInput = document.getElementById('search-client');

const inpDept = document.getElementById('new-client-dept');
const inpCity = document.getElementById('new-client-city');

// --- 1. API COLOMBIA (Para Modal de Creación) ---
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
            opt.value = d.id; // ID para buscar ciudades
            opt.textContent = d.name;
            opt.dataset.name = d.name; // Nombre para guardar
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

// --- 2. LÓGICA DEL MODAL ---
if (btnOpen) {
    btnOpen.onclick = () => {
        // Limpiar formulario
        document.getElementById('new-client-name').value = '';
        document.getElementById('new-client-phone').value = '';
        document.getElementById('new-client-doc').value = '';
        document.getElementById('new-client-email').value = '';
        document.getElementById('new-client-address').value = '';
        document.getElementById('new-client-notes').value = '';
        if(inpDept) inpDept.value = "";
        if(inpCity) { inpCity.innerHTML = '<option value="">Seleccione Depto...</option>'; inpCity.disabled = true; }
        
        loadDepartments(); // Cargar lista al abrir
        modal.classList.remove('hidden');
    };
}

const closeModal = () => modal.classList.add('hidden');
btnCloseList.forEach(btn => btn.onclick = closeModal);

// --- 3. CARGAR CLIENTES ---
async function fetchClients() {
    const tableBody = document.getElementById('clients-table-body');
    if (!tableBody) return;

    tableBody.innerHTML = `<tr><td colspan="5" class="p-10 text-center"><i class="fa-solid fa-circle-notch fa-spin text-2xl text-brand-cyan"></i></td></tr>`;

    try {
        const q = query(collection(db, "users"), orderBy("createdAt", "desc"));
        const snapshot = await getDocs(q);
        
        tableBody.innerHTML = "";
        
        if (snapshot.empty) {
            tableBody.innerHTML = `<tr><td colspan="5" class="p-10 text-center text-gray-400 font-bold uppercase text-xs">No hay clientes registrados.</td></tr>`;
            return;
        }

        snapshot.forEach(docSnap => {
            const c = docSnap.data();
            const date = c.createdAt?.toDate ? c.createdAt.toDate().toLocaleDateString('es-CO') : '---';
            const sourceTag = c.source === 'MANUAL' ? 
                `<span class="bg-slate-100 text-slate-500 px-3 py-1 rounded-full text-[9px] font-black uppercase border border-slate-200">Manual</span>` : 
                `<span class="bg-brand-cyan/10 text-brand-cyan px-3 py-1 rounded-full text-[9px] font-black uppercase border border-brand-cyan/20">Web</span>`;

            tableBody.innerHTML += `
                <tr class="hover:bg-slate-50/80 transition border-b border-gray-50 group">
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
                        <a href="client-details.html?id=${docSnap.id}" class="inline-flex w-10 h-10 items-center justify-center rounded-xl bg-slate-100 text-slate-400 hover:bg-brand-black hover:text-white transition shadow-sm">
                            <i class="fa-solid fa-eye text-xs"></i>
                        </a>
                    </td>
                </tr>
            `;
        });
    } catch (e) { console.error(e); }
}

// --- 4. GUARDAR CLIENTE MANUAL (COMPLETO) ---
if (btnSave) {
    btnSave.onclick = async () => {
        const btnOriginalText = btnSave.innerHTML;
        btnSave.disabled = true;
        btnSave.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Guardando...';

        // Obtener valores (opcionales)
        const name = document.getElementById('new-client-name').value.trim();
        const phone = document.getElementById('new-client-phone').value.trim();
        const documentVal = document.getElementById('new-client-doc').value.trim();
        const email = document.getElementById('new-client-email').value.trim();
        const address = document.getElementById('new-client-address').value.trim();
        const notes = document.getElementById('new-client-notes').value.trim();
        
        // Obtener nombres de Depto y Ciudad
        const deptSelect = document.getElementById('new-client-dept');
        const deptName = deptSelect.options[deptSelect.selectedIndex]?.dataset.name || "";
        const city = document.getElementById('new-client-city').value;

        if(!name) {
            alert("El nombre es obligatorio para identificar al cliente.");
            btnSave.disabled = false;
            btnSave.innerHTML = btnOriginalText;
            return;
        }

        try {
            // Estructura de datos alineada con client-details.html
            const newClientData = {
                name, 
                phone, 
                email, 
                document: documentVal,
                adminNotes: notes,
                source: 'MANUAL',
                role: 'client',
                createdAt: Timestamp.now(),
                
                // Dirección principal por defecto
                address,
                dept: deptName,
                city,
                
                // Array de direcciones (estándar nuevo)
                addresses: address ? [{
                    alias: "Principal",
                    address,
                    dept: deptName,
                    city,
                    isDefault: true
                }] : []
            };

            await addDoc(collection(db, "users"), newClientData);
            
            alert("✅ Cliente registrado");
            closeModal();
            fetchClients(); 
        } catch (e) { 
            alert("Error: " + e.message); 
        } finally {
            btnSave.disabled = false;
            btnSave.innerHTML = btnOriginalText;
        }
    };
}

// --- 5. BUSCADOR ---
if (searchInput) {
    searchInput.oninput = (e) => {
        const term = e.target.value.toLowerCase();
        const rows = document.querySelectorAll('#clients-table-body tr');
        rows.forEach(row => {
            const text = row.innerText.toLowerCase();
            row.style.display = text.includes(term) ? '' : 'none';
        });
    };
}

fetchClients();