import { db, collection, addDoc, query, orderBy, Timestamp, doc, updateDoc, onSnapshot, where } from "./firebase-init.js";

// --- REFERENCIAS DOM ---
const modal = document.getElementById('client-modal');
const btnOpen = document.getElementById('btn-add-client');
const btnCloseList = document.querySelectorAll('.close-modal');
const btnSave = document.getElementById('save-client');
const searchInput = document.getElementById('search-client');
const filterType = document.getElementById('filter-client-type');
const listContainer = document.getElementById('clients-table-body');
const loadMoreBtn = document.getElementById('load-more-container');

const inpDept = document.getElementById('new-client-dept');
const inpCity = document.getElementById('new-client-city');

// --- ESTADO GLOBAL (PAGINACIÓN EN RAM) ---
const PAGE_SIZE = 50;
let currentPage = 1;
let currentFilter = 'ALL';
let editingClientId = null;

let adminClientsCache = []; // Base de datos maestra en RAM

const normalizeText = (str) => str ? str.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "") : "";

// ==========================================================================
// 🧠 SMART CACHE: MOTOR CENTRAL DE CLIENTES (ANTI-QUOTA)
// ==========================================================================
const SmartAdminClientsSync = {
    STORAGE_KEY: 'pixeltech_admin_master_clients',
    runtimeMap: {},
    lastSyncTime: 0,
    unsubscribeClients: null,

    async init() {
        // 1. CARGA INICIAL DESDE CACHÉ (Instantánea)
        const cachedRaw = localStorage.getItem(this.STORAGE_KEY);
        if (cachedRaw) {
            try {
                const parsed = JSON.parse(cachedRaw);
                if (parsed.map && parsed.lastSync) {
                    this.runtimeMap = parsed.map;
                    this.lastSyncTime = parsed.lastSync;
                    
                    this.updateGlobalArray();
                    if (adminClientsCache.length > 0) {
                        console.log(`⚡ [Clientes] Cargados ${adminClientsCache.length} de caché local.`);
                        renderClientsFromMemory();
                    }
                }
            } catch (e) {
                console.warn("Caché corrupto, limpiando...");
                localStorage.removeItem(this.STORAGE_KEY);
            }
        }

        // 2. CONEXIÓN EN TIEMPO REAL (Solo Deltas)
        this.listenForUpdates();
    },

    updateGlobalArray() {
        adminClientsCache = Object.values(this.runtimeMap).sort((a, b) => {
            const dateA = a.createdAt?.seconds || new Date(a.createdAt).getTime();
            const dateB = b.createdAt?.seconds || new Date(b.createdAt).getTime();
            return dateB - dateA;
        });
        
        // Exportar a window para que manual-sale lo pueda usar si ambos archivos se abren
        window.adminClientsCache = adminClientsCache;
        sessionStorage.setItem('pixeltech_admin_clients_master', JSON.stringify(adminClientsCache));
    },

    saveStateSafe() {
        try {
            // Guardado ligero para no reventar el LocalStorage
            const lightweightMap = {};
            for (const key in this.runtimeMap) {
                const c = this.runtimeMap[key];
                lightweightMap[key] = {
                    id: c.id,
                    name: c.name,
                    userName: c.userName || '',
                    phone: c.phone || '',
                    email: c.email || '',
                    document: c.document || '',
                    source: c.source || 'WEB',
                    role: c.role || 'client',
                    adminNotes: c.adminNotes || '',
                    address: c.address || '',
                    dept: c.dept || '',
                    city: c.city || '',
                    addresses: c.addresses || [],
                    searchStr: c.searchStr || '',
                    createdAt: c.createdAt
                };
            }

            localStorage.setItem(this.STORAGE_KEY, JSON.stringify({
                map: lightweightMap,
                lastSync: Date.now()
            }));
            
        } catch (e) {
            console.warn("⚠️ LocalStorage de clientes lleno. Operando desde RAM.", e);
        }
    },

    listenForUpdates() {
        if (this.unsubscribeClients) this.unsubscribeClients();

        const colRef = collection(db, "users");
        let q;

        // Si es la primera vez que abre el panel en este PC
        if (this.lastSyncTime === 0 || Object.keys(this.runtimeMap).length === 0) {
            console.log("☁️ [Clientes] Descarga inicial de base de datos...");
            q = query(colRef); 
        } else {
            console.log("🔄 [Clientes] Buscando cambios desde:", new Date(this.lastSyncTime).toLocaleString());
            // 🔥 CLAVE: Solo pedimos clientes nuevos o modificados
            q = query(colRef, where("updatedAt", ">", new Date(this.lastSyncTime)));
        }

        if (adminClientsCache.length === 0) {
            listContainer.innerHTML = `<tr><td colspan="5" class="p-10 text-center"><i class="fa-solid fa-circle-notch fa-spin text-2xl text-brand-cyan"></i><p class="mt-2 text-xs font-bold text-gray-400">Sincronizando clientes...</p></td></tr>`;
        }

        this.unsubscribeClients = onSnapshot(q, (snapshot) => {
            if (snapshot.empty) {
                if (this.lastSyncTime !== 0) console.log("✅ [Clientes] Caché al día.");
                else listContainer.innerHTML = `<tr><td colspan="5" class="p-10 text-center text-gray-400 font-bold uppercase text-xs">No hay clientes registrados.</td></tr>`;
                return;
            }

            let hasChanges = false;

            snapshot.docChanges().forEach(change => {
                const data = change.doc.data();
                const id = change.doc.id;
                
                // Si no tiene fecha de creación, la asignamos
                if (!data.createdAt) data.createdAt = new Date();
                
                // Creamos el String de búsqueda
                data.searchStr = normalizeText(`${data.name || data.userName || ''} ${data.phone || ''} ${data.document || ''} ${data.email || ''}`);

                if (change.type === 'added' || change.type === 'modified') {
                    this.runtimeMap[id] = { id, ...data };
                    hasChanges = true;
                } else if (change.type === 'removed') {
                    if (this.runtimeMap[id]) {
                        delete this.runtimeMap[id];
                        hasChanges = true;
                    }
                }
            });

            if (hasChanges) {
                console.log(`🔥 [Clientes] Actualizaciones en vivo: ${snapshot.docChanges().length} registros.`);
                this.updateGlobalArray();
                this.saveStateSafe();
                
                // Forzamos re-render si no estamos buscando nada específico, 
                // o relanzamos la búsqueda si estábamos escribiendo
                if (searchInput.value.trim().length > 0) {
                    searchInput.dispatchEvent(new Event('input'));
                } else {
                    renderClientsFromMemory();
                }
            }
        }, (error) => {
            console.error("Error Live Clients:", error);
            if (adminClientsCache.length === 0) {
                listContainer.innerHTML = `<tr><td colspan="5" class="text-center text-red-500 py-4">Error de conexión.</td></tr>`;
            }
        });
    }
};

// ==========================================================================
// 1. FILTRADO, BÚSQUEDA Y PAGINACIÓN LOCAL
// ==========================================================================

function renderClientsFromMemory() {
    if (!listContainer) return;
    
    let filtered = [];
    const term = normalizeText(searchInput.value.trim());

    // A. APLICAR FILTROS (Búsqueda y Tipo combinados)
    filtered = adminClientsCache.filter(c => {
        let matchesSearch = true;
        if (term.length > 1) {
            matchesSearch = c.searchStr && c.searchStr.includes(term);
        }

        let matchesType = true;
        const rawSource = (c.source || 'WEB').toUpperCase();
        if (currentFilter === 'WEB') matchesType = (rawSource !== 'MANUAL' && rawSource !== 'MAYORISTA' && rawSource !== 'EXCEL_IMPORT');
        else if (currentFilter === 'MANUAL') matchesType = (rawSource === 'MANUAL' || rawSource === 'EXCEL_IMPORT');
        else if (currentFilter === 'MAYORISTA') matchesType = (rawSource === 'MAYORISTA');

        return matchesSearch && matchesType;
    });

    listContainer.innerHTML = "";

    if (filtered.length === 0) {
        listContainer.innerHTML = `<tr><td colspan="5" class="p-10 text-center text-xs font-bold text-gray-400 uppercase">No se encontraron clientes.</td></tr>`;
        loadMoreBtn.classList.add('hidden');
        return;
    }

    // B. PAGINACIÓN (Slice del Array)
    const startIdx = 0; // Siempre mostramos desde 0
    const endIdx = currentPage * PAGE_SIZE; // Cortamos hasta donde diga la página actual
    const pageClients = filtered.slice(startIdx, endIdx);

    pageClients.forEach(c => renderClientRow(c));

    // C. CONTROL BOTÓN "CARGAR MÁS"
    if (endIdx < filtered.length) {
        loadMoreBtn.classList.remove('hidden');
        loadMoreBtn.querySelector('button').innerHTML = `<i class="fa-solid fa-circle-plus"></i> Mostrar más resultados (${endIdx}/${filtered.length})`;
    } else {
        loadMoreBtn.classList.add('hidden');
    }
}

window.loadMoreClients = () => {
    currentPage++;
    renderClientsFromMemory();
};

if (searchInput) {
    searchInput.addEventListener('input', () => {
        currentPage = 1; // Si busco algo nuevo, vuelvo a la pag. 1
        renderClientsFromMemory();
    });
}

if (filterType) {
    filterType.addEventListener('change', (e) => {
        currentFilter = e.target.value;
        currentPage = 1;
        renderClientsFromMemory();
    });
}

function renderClientRow(c) {
    let dateStr = '---';
    if (c.createdAt) {
        const d = c.createdAt.seconds ? new Date(c.createdAt.seconds * 1000) : new Date(c.createdAt);
        dateStr = d.toLocaleDateString('es-CO');
    }
    
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
                <div class="w-10 h-10 rounded-xl bg-gray-100 flex items-center justify-center shrink-0 font-black text-brand-cyan text-xs group-hover:bg-brand-cyan group-hover:text-white transition uppercase">
                    ${(c.name || c.userName || 'U').substring(0,1)}
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
        <td class="px-4 md:px-8 py-4 text-xs text-gray-400 font-bold whitespace-nowrap">${dateStr}</td>
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


// --- 3. API COLOMBIA (CARGA DE CIUDADES) ---
let deptsLoaded = false;
let globalDeptsData = [];

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

if(inpDept) inpDept.addEventListener('change', (e) => loadCitiesForDept(e.target.value));

// --- 4. LÓGICA DEL MODAL (CREAR / EDITAR) ---
if (btnOpen) {
    btnOpen.onclick = () => {
        editingClientId = null; 
        document.getElementById('modal-title').innerHTML = `Registrar <span class="text-brand-cyan">Cliente</span>`;
        
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

window.editClient = async (id) => {
    const c = adminClientsCache.find(x => x.id === id);
    if(!c) return;

    editingClientId = id;
    document.getElementById('modal-title').innerHTML = `Editar <span class="text-emerald-500">Cliente</span>`;
    
    const typeSelect = document.getElementById('new-client-type');
    const webWarning = document.getElementById('web-client-warning');
    const rawSource = (c.source || 'WEB').toUpperCase();
    
    if (rawSource !== 'MANUAL' && rawSource !== 'MAYORISTA' && rawSource !== 'EXCEL_IMPORT') {
        typeSelect.querySelector('option[value="WEB"]').classList.remove('hidden');
        typeSelect.value = "WEB";
        typeSelect.disabled = true; 
        webWarning.classList.remove('hidden');
    } else {
        typeSelect.querySelector('option[value="WEB"]').classList.add('hidden');
        typeSelect.value = rawSource === 'MAYORISTA' ? 'MAYORISTA' : 'MANUAL';
        typeSelect.disabled = false; 
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


// --- 5. GUARDAR O ACTUALIZAR CLIENTE (Con Fecha Modificada) ---
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
                const clientRef = doc(db, "users", editingClientId);
                let updateData = {
                    name, phone, email, document: documentVal,
                    adminNotes: notes, address, dept: deptName, city,
                    updatedAt: Timestamp.now() // 🔥 Nuevo: Fuerza al caché a detectar el cambio
                };
                
                if (!typeSelect.disabled) {
                    updateData.source = typeSelect.value;
                }

                await updateDoc(clientRef, updateData);
                alert("✅ Cliente actualizado con éxito");
            } else {
                const newClientData = {
                    name, phone, email, document: documentVal,
                    adminNotes: notes, 
                    source: typeSelect.value, 
                    role: 'client',
                    createdAt: Timestamp.now(),
                    updatedAt: Timestamp.now(), // 🔥 Nuevo
                    address, dept: deptName, city,
                    addresses: address ? [{ alias: "Principal", address, dept: deptName, city, isDefault: true }] : []
                };
                await addDoc(collection(db, "users"), newClientData);
                alert("✅ Cliente nuevo registrado");
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
        await loadDepartments();

        const ws_data = [
            ['Tipo_Cliente (Solo: MANUAL o MAYORISTA)', 'Nombre_Completo', 'Telefono', 'Cedula_NIT', 'Email', 'Departamento', 'Ciudad', 'Direccion_Entrega', 'Notas'],
            ['MAYORISTA', 'Empresa Tech SAS', '3001234567', '900123456-7', 'ventas@tech.com', 'Bogotá D.C.', 'Bogotá, D.C.', 'Calle Principal 10', 'Cliente frecuente'],
            ['MANUAL', 'Juan Pérez', '3159876543', '1010101010', 'juan@mail.com', 'Antioquia', 'Medellín', '', '']
        ];
        
        const ws1 = XLSX.utils.aoa_to_sheet(ws_data);
        ws1['!cols'] = [ { wch: 38 }, { wch: 25 }, { wch: 15 }, { wch: 15 }, { wch: 25 }, { wch: 15 }, { wch: 15 }, { wch: 30 }, { wch: 30 } ];

        const dict_data = [
            ['Tipos_de_Cliente_Validos', 'Departamentos_Validos'],
            ['MANUAL', '']
        ];
        
        globalDeptsData.forEach((d, idx) => {
            if(idx === 0) dict_data[1][1] = d.name;
            else if (idx === 1) dict_data.push(['MAYORISTA', d.name]);
            else dict_data.push(['', d.name]);
        });

        const ws2 = XLSX.utils.aoa_to_sheet(dict_data);
        ws2['!cols'] = [ { wch: 25 }, { wch: 30 } ];

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

        let added = 0; let skipped = 0; let errors = 0;
        const elAdded = document.getElementById('res-added');
        const elSkipped = document.getElementById('res-skipped');
        const elErrors = document.getElementById('res-errors');

        // Nota: El array ya se actualiza solo en vivo gracias a onSnapshot.
        for (const row of parsedExcelData) {
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

            if (!name) { skipped++; elSkipped.textContent = skipped; continue; }

            if (rawType !== 'MAYORISTA' && rawType !== 'MANUAL') {
                errors++; elErrors.textContent = errors; continue;
            }

            let isDuplicate = false;
            // 🔥 Busqueda en RAM para evitar cientos de peticiones a BD en cada fila
            if (documentVal) {
                const found = adminClientsCache.find(c => c.document === documentVal);
                if(found) isDuplicate = true;
            }

            if (isDuplicate) {
                skipped++; elSkipped.textContent = skipped;
            } else {
                try {
                    const newClientData = {
                        name, phone, email, document: documentVal,
                        adminNotes: notes, source: rawType, role: 'client',
                        createdAt: Timestamp.now(), updatedAt: Timestamp.now(),
                        address, dept, city,
                        addresses: address ? [{ alias: "Principal", address, dept, city, isDefault: true }] : []
                    };
                    await addDoc(collection(db, "users"), newClientData);
                    added++; elAdded.textContent = added;
                } catch (err) {
                    errors++; elErrors.textContent = errors;
                }
            }
        } 

        btnProcessImport.innerHTML = '<i class="fa-solid fa-check-double"></i> Importación Finalizada';
        setTimeout(() => {
            alert(`Resumen:\n✅ ${added} Nuevos creados\n⏭️ ${skipped} Omitidos\n❌ ${errors} Errores`);
            closeModal();
        }, 500);
    };
}

// 🔥 INICIO DE LA MAGIA
SmartAdminClientsSync.init();