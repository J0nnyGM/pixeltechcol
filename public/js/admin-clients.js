import { db, collection, addDoc, query, orderBy, Timestamp, limit, startAfter, where, doc, getDoc, updateDoc, onSnapshot } from "./firebase-init.js";

// --- REFERENCIAS DOM ---
const modal = document.getElementById('client-modal');
const btnOpen = document.getElementById('btn-add-client');
const btnCloseList = document.querySelectorAll('.close-modal');
const btnSave = document.getElementById('save-client');
const searchInput = document.getElementById('search-client');
const filterType = document.getElementById('filter-client-type'); // Dropdown filtro
const listContainer = document.getElementById('clients-table-body');
const loadMoreBtn = document.getElementById('load-more-container');

const inpDept = document.getElementById('new-client-dept');
const inpCity = document.getElementById('new-client-city');

// --- ESTADO GLOBAL ---
let lastVisible = null;
let isLoading = false;
const DOCS_PER_PAGE = 50;

let unsubscribeClientsList = null;
let adminClientsCache = []; // RAM Cache 
let editingClientId = null; // Para saber si creamos o editamos

// ==========================================================================
// 🧠 SMART REAL-TIME CACHE: LISTA DE CLIENTES
// ==========================================================================
function startClientsListener(isNextPage = false) {
    if (isLoading) return;
    isLoading = true;

    if (!isNextPage) {
        listContainer.innerHTML = `<tr><td colspan="5" class="p-10 text-center"><i class="fa-solid fa-circle-notch fa-spin text-2xl text-brand-cyan"></i><p class="mt-2 text-xs font-bold text-gray-400">Cargando clientes...</p></td></tr>`;
        loadMoreBtn.classList.add('hidden');
        if (unsubscribeClientsList) unsubscribeClientsList();
    } else {
        const btn = loadMoreBtn.querySelector('button');
        btn.innerHTML = `<i class="fa-solid fa-circle-notch fa-spin"></i> Cargando...`;
    }

    try {
        const usersRef = collection(db, "users");
        let constraints = [];
        constraints.push(orderBy("createdAt", "desc"));

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
        adminClientsCache = [];
    }

    if (snapshot.empty && !isNextPage) {
        listContainer.innerHTML = `<tr><td colspan="5" class="p-10 text-center text-gray-400 font-bold uppercase text-xs">No hay clientes registrados.</td></tr>`;
        loadMoreBtn.classList.add('hidden');
        isLoading = false;
        return;
    }

    if (snapshot.docs.length > 0 && !snapshot.metadata.hasPendingWrites) {
         lastVisible = snapshot.docs[snapshot.docs.length - 1];
    }

    if (snapshot.docs.length === DOCS_PER_PAGE) {
        loadMoreBtn.classList.remove('hidden');
        loadMoreBtn.querySelector('button').innerHTML = `<i class="fa-solid fa-circle-plus"></i> Cargar siguientes 50`;
    } else {
        loadMoreBtn.classList.add('hidden');
    }

    snapshot.forEach(docSnap => {
        // Evitamos duplicados en cache al actualizar en tiempo real
        const clientData = { id: docSnap.id, ...docSnap.data() };
        const index = adminClientsCache.findIndex(c => c.id === docSnap.id);
        if (index > -1) adminClientsCache[index] = clientData;
        else adminClientsCache.push(clientData);
    });

    applyFilters(); // Pintamos usando la función de filtro centralizada
    isLoading = false;
}

window.loadMoreClients = () => startClientsListener(true);

function renderClientRow(c) {
    const date = c.createdAt?.toDate ? c.createdAt.toDate().toLocaleDateString('es-CO') : '---';
    
    // Insignias de origen según el "Tipo" de cliente
    let sourceTag = '';
    const rawSource = (c.source || 'WEB').toUpperCase();

    if (rawSource === 'MAYORISTA') {
        sourceTag = `<span class="bg-purple-100 text-purple-600 px-3 py-1 rounded-full text-[9px] font-black uppercase border border-purple-200">Mayorista</span>`;
    } else if (rawSource === 'MANUAL' || rawSource === 'EXCEL_IMPORT') {
        sourceTag = `<span class="bg-slate-100 text-slate-500 px-3 py-1 rounded-full text-[9px] font-black uppercase border border-slate-200">Manual</span>`;
    } else {
        sourceTag = `<span class="bg-brand-cyan/10 text-brand-cyan px-3 py-1 rounded-full text-[9px] font-black uppercase border border-brand-cyan/20">Web</span>`;
    }

    const row = document.createElement('tr');
    row.className = "hover:bg-slate-50/80 transition border-b border-gray-50 group fade-in";
    row.innerHTML = `
        <td class="px-4 md:px-8 py-4">
            <div class="flex items-center gap-3">
                <div class="w-10 h-10 rounded-xl bg-gray-100 flex items-center justify-center shrink-0 font-black text-brand-cyan text-xs group-hover:bg-brand-cyan group-hover:text-white transition">
                    ${(c.name || c.userName || 'U').substring(0,1).toUpperCase()}
                </div>
                <div class="min-w-0"> <div class="font-black text-brand-black text-sm uppercase truncate max-w-[200px]">${c.name || c.userName || 'Sin nombre'}</div>
                    ${c.document ? `<span class="text-[9px] text-gray-400 font-bold uppercase truncate block">DOC: ${c.document}</span>` : ''}
                </div>
            </div>
        </td>
        <td class="px-4 md:px-8 py-4">
            <div class="text-xs font-bold text-gray-600 truncate max-w-[150px]">${c.phone || '---'}</div>
            <div class="text-[10px] text-gray-400 font-medium truncate max-w-[150px]">${c.email || ''}</div>
        </td>
        <td class="px-4 md:px-8 py-4">${sourceTag}</td>
        <td class="px-4 md:px-8 py-4 text-xs text-gray-400 font-bold whitespace-nowrap">${date}</td>
        <td class="px-4 md:px-8 py-4">
            <div class="flex items-center justify-center gap-2">
                <button onclick="window.editClient('${c.id}')" class="flex items-center justify-center w-8 h-8 rounded-lg bg-emerald-50 text-emerald-500 hover:bg-emerald-500 hover:text-white transition shadow-sm shrink-0" title="Edición Rápida">
                    <i class="fa-solid fa-pen text-[10px]"></i>
                </button>
                <a href="client-details.html?id=${c.id}" class="flex items-center justify-center w-8 h-8 rounded-lg bg-slate-100 text-slate-400 hover:bg-brand-black hover:text-white transition shadow-sm shrink-0" title="Ver Historial Completo">
                    <i class="fa-solid fa-eye text-[10px]"></i>
                </a>
            </div>
        </td>
    `;
    listContainer.appendChild(row);
}

// --- 2. BÚSQUEDA Y FILTRADO HÍBRIDO ---
function applyFilters() {
    listContainer.innerHTML = "";
    const term = searchInput ? searchInput.value.toLowerCase().trim() : '';
    const type = filterType ? filterType.value : 'ALL';

    const results = adminClientsCache.filter(c => {
        // 1. Filtro Búsqueda
        const nameMatch = (c.name || c.userName || "").toLowerCase().includes(term);
        const phoneMatch = (c.phone || "").toLowerCase().includes(term);
        const docMatch = (c.document || "").toLowerCase().includes(term);
        const emailMatch = (c.email || "").toLowerCase().includes(term);
        const matchesSearch = term === "" || nameMatch || phoneMatch || docMatch || emailMatch;

        // 2. Filtro Tipo
        let matchesType = true;
        const rawSource = (c.source || 'WEB').toUpperCase();
        
        if (type === 'WEB') matchesType = (rawSource !== 'MANUAL' && rawSource !== 'MAYORISTA' && rawSource !== 'EXCEL_IMPORT');
        else if (type === 'MANUAL') matchesType = (rawSource === 'MANUAL' || rawSource === 'EXCEL_IMPORT');
        else if (type === 'MAYORISTA') matchesType = (rawSource === 'MAYORISTA');

        return matchesSearch && matchesType;
    });

    if (results.length === 0) {
        listContainer.innerHTML = `<tr><td colspan="5" class="p-10 text-center text-xs font-bold text-gray-400 uppercase">No se encontraron resultados en esta vista.</td></tr>`;
    } else {
        results.forEach(c => renderClientRow(c));
    }
}

if (searchInput) {
    searchInput.addEventListener('keyup', (e) => {
        if (e.key === 'Enter' && searchInput.value.trim().length > 0) {
            performServerSearch(searchInput.value.trim());
            return;
        }
        applyFilters();
    });
}
if (filterType) {
    filterType.addEventListener('change', applyFilters);
}

async function performServerSearch(term) {
    if(isLoading) return;
    isLoading = true;

    if(unsubscribeClientsList) unsubscribeClientsList();

    listContainer.innerHTML = `<tr><td colspan="5" class="p-10 text-center"><i class="fa-solid fa-search fa-bounce text-brand-cyan"></i> Buscando a fondo...</td></tr>`;
    loadMoreBtn.classList.add('hidden');

    try {
        const usersRef = collection(db, "users");

        const docRef = doc(db, "users", term);
        const p1 = getDoc(docRef).then(s => s.exists() ? [{ id: s.id, ...s.data() }] : []);
        const qEmail = query(usersRef, where("email", "==", term));
        const p2 = getDocs(qEmail).then(s => s.docs.map(d => ({ id: d.id, ...d.data() })));
        const qDoc = query(usersRef, where("document", "==", term));
        const p3 = getDocs(qDoc).then(s => s.docs.map(d => ({ id: d.id, ...d.data() })));
        const qPhone = query(usersRef, where("phone", "==", term));
        const p4 = getDocs(qPhone).then(s => s.docs.map(d => ({ id: d.id, ...d.data() })));

        const [r1, r2, r3, r4] = await Promise.all([p1, p2, p3, p4]);
        
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
            // Reemplazamos la cache temporalmente para que el filtro también funcione con la búsqueda
            adminClientsCache = finalDocs;
            applyFilters();
        } else {
            listContainer.innerHTML = `<tr><td colspan="5" class="p-10 text-center text-xs font-bold text-gray-400 uppercase">No se encontró cliente con ID, Email, Teléfono o Documento exacto: "${term}"<br><span class="text-[9px] text-brand-cyan cursor-pointer hover:underline mt-2 block" onclick="window.location.reload()">Recargar Lista Original</span></td></tr>`;
        }
    } catch(e) {
        console.error(e);
        startClientsListener(false); 
    } finally {
        isLoading = false;
    }
}

// --- 3. API COLOMBIA (CARGA DE CIUDADES INDEPENDIENTE) ---
let deptsLoaded = false;
let globalDeptsData = []; // Guardamos los departamentos para el Excel

async function loadDepartments() {
    if (deptsLoaded) return; 
    try {
        const res = await fetch('https://api-colombia.com/api/v1/Department');
        globalDeptsData = await res.json();
        globalDeptsData.sort((a, b) => a.name.localeCompare(b.name));

        inpDept.innerHTML = '<option value="">Seleccione...</option>';
        globalDeptsData.forEach(d => {
            const opt = document.createElement('option');
            opt.value = d.id; 
            opt.textContent = d.name;
            opt.dataset.name = d.name;
            inpDept.appendChild(opt);
        });
        deptsLoaded = true;
    } catch (e) { console.error("Error API Colombia:", e); }
}

async function loadCitiesForDept(deptId) {
    if (!inpCity) return;
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
}

if(inpDept) {
    inpDept.addEventListener('change', (e) => loadCitiesForDept(e.target.value));
}

// --- 4. LÓGICA DEL MODAL (CREAR / EDITAR) ---
if (btnOpen) {
    btnOpen.onclick = () => {
        editingClientId = null; // Limpiamos ID
        document.getElementById('modal-title').innerHTML = `Registrar <span class="text-brand-cyan">Cliente</span>`;
        
        // Reset Tipo
        const typeSelect = document.getElementById('new-client-type');
        typeSelect.disabled = false;
        typeSelect.value = 'MANUAL';
        document.getElementById('web-client-warning').classList.add('hidden');

        document.getElementById('new-client-name').value = '';
        document.getElementById('new-client-phone').value = '';
        document.getElementById('new-client-doc').value = '';
        document.getElementById('new-client-email').value = '';
        document.getElementById('new-client-address').value = '';
        document.getElementById('new-client-notes').value = '';
        if(inpDept) inpDept.value = "";
        if(inpCity) { inpCity.innerHTML = '<option value="">Seleccione Depto...</option>'; inpCity.disabled = true; }
        
        btnSave.innerHTML = "Guardar Cliente";
        loadDepartments();
        modal.classList.remove('hidden');
    };
}

const closeModal = () => {
    modal.classList.add('hidden');
    document.getElementById('import-modal').classList.add('hidden');
};
btnCloseList.forEach(btn => btn.onclick = closeModal);

// FUNCIÓN DE EDICIÓN RÁPIDA
window.editClient = async (id) => {
    const c = adminClientsCache.find(x => x.id === id);
    if(!c) return;

    editingClientId = id;
    document.getElementById('modal-title').innerHTML = `Editar <span class="text-emerald-500">Cliente</span>`;
    
    // Proteger si es cliente Web
    const typeSelect = document.getElementById('new-client-type');
    const webWarning = document.getElementById('web-client-warning');
    const rawSource = (c.source || 'WEB').toUpperCase();
    
    if (rawSource !== 'MANUAL' && rawSource !== 'MAYORISTA' && rawSource !== 'EXCEL_IMPORT') {
        // Es cliente Web puro
        typeSelect.querySelector('option[value="WEB"]').classList.remove('hidden'); // Mostrar opcion Web
        typeSelect.value = "WEB";
        typeSelect.disabled = true; // Bloqueado
        webWarning.classList.remove('hidden');
    } else {
        typeSelect.querySelector('option[value="WEB"]').classList.add('hidden');
        typeSelect.value = rawSource === 'MAYORISTA' ? 'MAYORISTA' : 'MANUAL';
        typeSelect.disabled = false; // Permitir cambiar entre Normal y Mayorista
        webWarning.classList.add('hidden');
    }
    
    document.getElementById('new-client-name').value = c.name || c.userName || '';
    document.getElementById('new-client-phone').value = c.phone || '';
    document.getElementById('new-client-doc').value = c.document || '';
    document.getElementById('new-client-email').value = c.email || '';
    document.getElementById('new-client-address').value = c.address || '';
    document.getElementById('new-client-notes').value = c.adminNotes || '';

    btnSave.innerHTML = "Actualizar Cliente";
    
    await loadDepartments();
    
    if (c.dept) {
        // Buscamos el ID del departamento por su nombre
        const option = [...inpDept.options].find(o => o.dataset.name === c.dept);
        if (option) {
            inpDept.value = option.value;
            await loadCitiesForDept(option.value);
            inpCity.value = c.city || "";
        }
    } else {
        inpDept.value = "";
        inpCity.innerHTML = '<option value="">Seleccione Depto...</option>';
        inpCity.disabled = true;
    }

    modal.classList.remove('hidden');
}


// --- 5. GUARDAR O ACTUALIZAR CLIENTE ---
if (btnSave) {
    btnSave.onclick = async () => {
        const btnOriginalText = btnSave.innerHTML;
        btnSave.disabled = true;
        btnSave.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Procesando...';

        const typeSelect = document.getElementById('new-client-type');
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
            alert("El nombre de la persona/empresa es obligatorio.");
            btnSave.disabled = false;
            btnSave.innerHTML = btnOriginalText;
            return;
        }

        try {
            if (editingClientId) {
                // ACTUALIZAR EXISTENTE
                const clientRef = doc(db, "users", editingClientId);
                let updateData = {
                    name, phone, email, document: documentVal,
                    adminNotes: notes, address, dept: deptName, city
                };
                
                // Si NO estaba bloqueado (no era Web), actualizamos su tipo
                if (!typeSelect.disabled) {
                    updateData.source = typeSelect.value;
                }

                await updateDoc(clientRef, updateData);
                window.showToast("Cliente actualizado con éxito", "success");
            } else {
                // CREAR NUEVO
                const newClientData = {
                    name, phone, email, document: documentVal,
                    adminNotes: notes, 
                    source: typeSelect.value, 
                    role: 'client',
                    createdAt: Timestamp.now(),
                    address, dept: deptName, city,
                    addresses: address ? [{ alias: "Principal", address, dept: deptName, city, isDefault: true }] : []
                };
                await addDoc(collection(db, "users"), newClientData);
                window.showToast("Cliente nuevo registrado", "success");
            }

            closeModal();

        } catch (e) { 
            alert("Error: " + e.message); 
        } finally {
            btnSave.disabled = false;
            btnSave.innerHTML = btnOriginalText;
        }
    };
}


// ==========================================================================
// 📥 IMPORTACIÓN MASIVA DESDE EXCEL
// ==========================================================================

const modalImport = document.getElementById('import-modal');
const btnOpenImport = document.getElementById('btn-import-clients');
const btnDownloadTemplate = document.getElementById('btn-download-template');
const fileInput = document.getElementById('excel-file-input');
const fileNameDisplay = document.getElementById('file-name-display');
const btnProcessImport = document.getElementById('btn-process-import');
const importStatus = document.getElementById('import-status');

if (btnOpenImport) {
    btnOpenImport.onclick = () => {
        fileInput.value = "";
        fileNameDisplay.textContent = "Ningún archivo seleccionado";
        btnProcessImport.disabled = true;
        importStatus.classList.add('hidden');
        modalImport.classList.remove('hidden');
    };
}

if (btnDownloadTemplate) {
    btnDownloadTemplate.onclick = async () => {
        btnDownloadTemplate.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Generando...';
        
        // 1. Descargamos los departamentos para crear la hoja de ayuda
        await loadDepartments();

        // 2. Hoja 1: Datos a llenar. Cambiamos la cabecera para ser súper explícitos
        const ws_data = [
            ['Tipo_Cliente (Solo: MANUAL o MAYORISTA)', 'Nombre_Completo', 'Telefono', 'Cedula_NIT', 'Email', 'Departamento', 'Ciudad', 'Direccion_Entrega', 'Notas'],
            ['MAYORISTA', 'Empresa Tech SAS', '3001234567', '900123456-7', 'ventas@tech.com', 'Bogotá D.C.', 'Bogotá, D.C.', 'Calle Principal 10', 'Cliente frecuente'],
            ['MANUAL', 'Juan Pérez', '3159876543', '1010101010', 'juan@mail.com', 'Antioquia', 'Medellín', '', '']
        ];
        
        const ws1 = XLSX.utils.aoa_to_sheet(ws_data);
        ws1['!cols'] = [ { wch: 38 }, { wch: 25 }, { wch: 15 }, { wch: 15 }, { wch: 25 }, { wch: 15 }, { wch: 15 }, { wch: 30 }, { wch: 30 } ];

        // 3. Hoja 2: Valores Permitidos (El "Diccionario" para el usuario)
        const dict_data = [
            ['Tipos_de_Cliente_Validos', 'Departamentos_Validos'],
            ['MANUAL', '']
        ];
        
        // Llenamos los departamentos reales desde la API
        globalDeptsData.forEach((d, idx) => {
            if(idx === 0) {
                dict_data[1][1] = d.name; // Al lado de MANUAL
            } else if (idx === 1) {
                dict_data.push(['MAYORISTA', d.name]);
            } else {
                dict_data.push(['', d.name]);
            }
        });

        const ws2 = XLSX.utils.aoa_to_sheet(dict_data);
        ws2['!cols'] = [ { wch: 25 }, { wch: 30 } ];

        // Construir archivo
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws1, "Registros");
        XLSX.utils.book_append_sheet(wb, ws2, "Valores_Permitidos");
        
        XLSX.writeFile(wb, "Plantilla_Importar_Clientes.xlsx");
        
        btnDownloadTemplate.innerHTML = '<i class="fa-solid fa-download mr-2"></i> Descargar Plantilla .XLSX';
    };
}

let parsedExcelData = [];

if (fileInput) {
    fileInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;

        fileNameDisplay.textContent = file.name;
        btnProcessImport.disabled = true;
        btnProcessImport.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Leyendo...';

        const reader = new FileReader();
        reader.onload = (evt) => {
            try {
                const data = new Uint8Array(evt.target.result);
                const workbook = XLSX.read(data, { type: 'array' });
                // Leemos siempre la hoja 0 que es "Registros"
                const firstSheetName = workbook.SheetNames[0];
                const worksheet = workbook.Sheets[firstSheetName];
                
                parsedExcelData = XLSX.utils.sheet_to_json(worksheet, { defval: "" });
                
                if (parsedExcelData.length > 0) {
                    btnProcessImport.disabled = false;
                    btnProcessImport.innerHTML = `Procesar ${parsedExcelData.length} Clientes`;
                } else {
                    alert("El archivo Excel está vacío en su primera hoja.");
                    btnProcessImport.innerHTML = 'Procesar Clientes';
                }
            } catch (err) {
                alert("Error al leer el archivo Excel.");
                btnProcessImport.innerHTML = 'Procesar Clientes';
            }
        };
        reader.readAsArrayBuffer(file);
    });
}

if (btnProcessImport) {
    btnProcessImport.onclick = async () => {
        if (parsedExcelData.length === 0) return;

        btnProcessImport.disabled = true;
        btnProcessImport.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Subiendo a BD...';
        importStatus.classList.remove('hidden');

        let added = 0;
        let skipped = 0;
        let errors = 0;

        const elAdded = document.getElementById('res-added');
        const elSkipped = document.getElementById('res-skipped');
        const elErrors = document.getElementById('res-errors');

        for (const row of parsedExcelData) {
            // Buscamos la columna por su nombre exacto.
            const rawTypeKey = Object.keys(row).find(key => key.includes('Tipo_Cliente'));
            const rawType = String(row[rawTypeKey] || '').trim().toUpperCase();
            
            const name = String(row['Nombre_Completo'] || '').trim();
            const phone = String(row['Telefono'] || '').trim();
            const documentVal = String(row['Cedula_NIT'] || '').trim();
            const email = String(row['Email'] || '').trim();
            const dept = String(row['Departamento'] || '').trim();
            const city = String(row['Ciudad'] || '').trim();
            const address = String(row['Direccion_Entrega'] || '').trim();
            const notes = String(row['Notas'] || '').trim();

            // Validaciones estrictas
            if (!name) {
                skipped++;
                elSkipped.textContent = skipped;
                continue;
            }

            // Si el Excel trae un tipo inválido o vacío, se marca como Error
            if (rawType !== 'MAYORISTA' && rawType !== 'MANUAL') {
                errors++;
                elErrors.textContent = errors;
                console.warn(`Error en Fila: El tipo de cliente debe ser MANUAL o MAYORISTA. Recibido: ${rawType}`);
                continue;
            }

            let isDuplicate = false;

            if (documentVal) {
                try {
                    const q = query(collection(db, "users"), where("document", "==", documentVal));
                    const snap = await getDocs(q);
                    if (!snap.empty) isDuplicate = true; 
                } catch (e) { console.error(e); }
            }

            if (isDuplicate) {
                skipped++;
                elSkipped.textContent = skipped;
            } else {
                try {
                    const newClientData = {
                        name, phone, email, document: documentVal,
                        adminNotes: notes, 
                        source: rawType, // Será MAYORISTA o MANUAL
                        role: 'client',
                        createdAt: Timestamp.now(),
                        address, dept, city,
                        addresses: address ? [{ alias: "Principal", address, dept, city, isDefault: true }] : []
                    };
                    await addDoc(collection(db, "users"), newClientData);
                    added++;
                    elAdded.textContent = added;
                } catch (err) {
                    errors++;
                    elErrors.textContent = errors;
                }
            }
        } 

        btnProcessImport.innerHTML = '<i class="fa-solid fa-check-double"></i> Importación Finalizada';
        setTimeout(() => {
            alert(`Resumen:\n✅ ${added} Nuevos creados\n⏭️ ${skipped} Omitidos (Duplicados o sin nombre)\n❌ ${errors} Errores (Tipo de Cliente inválido o error BD)`);
            closeModal();
            // Recargamos los clientes en la tabla
            startClientsListener(false);
        }, 500);
    };
}

startClientsListener(false);