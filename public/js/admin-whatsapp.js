import { db, collection, query, orderBy, onSnapshot, doc, updateDoc, functions, httpsCallable,limitToLast, storage, ref, uploadBytes, getDownloadURL, where, getDocs, limit, startAt, endAt, startAfter, getDoc, addDoc, Timestamp } from "./firebase-init.js";
import { viewOrderDetail } from "./order-actions.js";
import { initManualSale, openManualSaleModal } from "./manual-sale.js";

// --- REFERENCIAS DOM ---
const els = {
    // Listas y Paneles Principales
    chatList: document.getElementById('chat-list'),
    conversationPanel: document.getElementById('chat-conversation-panel'),
    chatHeader: document.getElementById('chat-header'),
    
    // Info del Chat Activo
    activeName: document.getElementById('active-chat-name'),
    activePhone: document.getElementById('active-chat-phone'),
    waLink: document.getElementById('wa-link-direct'),
    
    // Área de Mensajes e Input
    msgArea: document.getElementById('chat-messages-area'),
    emptyState: document.getElementById('chat-empty-state'),
    inputArea: document.getElementById('chat-input-area'),
    timerBadge: document.getElementById('session-timer-badge'),
    timerText: document.getElementById('session-timer-text'),
    txtInput: document.getElementById('message-input'),
    btnSend: document.getElementById('send-btn'),
    btnAttach: document.getElementById('btn-attach'),
    fileInput: document.getElementById('image-upload-input'),
    backBtn: document.getElementById('back-to-list-btn'),

    // Filtros y Buscador de Chats
    tabOpen: document.getElementById('tab-open'),
    tabResolved: document.getElementById('tab-resolved'),
    chatSearchInput: document.getElementById('chat-search-input'),
    btnResolve: document.getElementById('btn-resolve-chat'),

    // Nuevas Herramientas (Productos y Respuestas)
    btnProducts: document.getElementById('btn-products'),
    prodPicker: document.getElementById('product-picker-popover'),
    prodSearch: document.getElementById('prod-picker-search'),
    prodList: document.getElementById('prod-picker-list'),
    closeProdBtn: document.getElementById('close-prod-picker'),
    quickReplyMenu: document.getElementById('quick-reply-menu'),
    quickReplyList: document.getElementById('quick-reply-list'),

    // Acciones Dropdown
    btnActions: document.getElementById('btn-actions-trigger'),
    dropdownActions: document.getElementById('actions-dropdown'),
    btnActOrders: document.getElementById('btn-action-orders'),
    btnActClient: document.getElementById('btn-action-new-client'),
    btnActSale: document.getElementById('btn-action-new-sale'),

    // Panel Derecho (Historial Pedidos)
    infoPanel: document.getElementById('customer-info-panel'),
    closeInfoBtn: document.getElementById('close-info-panel'),
    infoName: document.getElementById('info-name'),
    infoPhone: document.getElementById('info-phone'),
    infoBadge: document.getElementById('info-status-badge'),
    ordersContainer: document.getElementById('orders-list-container'),
    btnLoadMore: document.getElementById('load-more-orders-btn'),
    inputSearchOrder: document.getElementById('order-search-input'),
    btnSearchOrder: document.getElementById('order-search-btn'),

    // Modal Crear Cliente
    clientModal: document.getElementById('client-modal'),
    inpClientName: document.getElementById('new-client-name'),
    inpClientPhone: document.getElementById('new-client-phone'),
    inpClientDoc: document.getElementById('new-client-doc'),
    inpClientEmail: document.getElementById('new-client-email'),
    inpClientAddr: document.getElementById('new-client-address'),
    inpClientDept: document.getElementById('new-client-dept'),
    inpClientCity: document.getElementById('new-client-city'),
    btnSaveClient: document.getElementById('save-client'),

    // Sonido
    notifySound: document.getElementById('notify-sound')
};

// --- CONFIGURACIÓN GLOBAL ---
let activeChatId = null;
let activeChatData = null;
let unsubscribeMessages = null;
let unsubscribeChats = null;
let timerInterval = null;
let currentTab = 'open'; // 'open' | 'resolved'

// Variable para el debounce
let chatSearchTimeout = null;

let oldestMessageDoc = null; // Para saber desde dónde cargar hacia atrás
let isChatLoading = false;   // Para evitar doble clic

// Configuración de Pedidos (Paginación)
let ordersLoadedForCurrentChat = false; 
let lastOrderSnapshot = null;
let currentPhoneNumbers = [];
const ORDERS_PER_PAGE = 3;

// Mapas de traducción y Config
const TIME_UNITS = { 'months': 'Meses', 'years': 'Años', 'days': 'Días' };
const QUICK_REPLIES = [
    { title: "👋 Saludo", text: "¡Hola! Gracias por escribir a PixelTech. ¿En qué podemos ayudarte hoy?" },
    { title: "🚚 Info Envío", text: "Tus guías se generan en la noche y te llegarán por correo. El tiempo de entrega es de 1 a 3 días hábiles." },
    { title: "💰 Cuenta Bancaria", text: "Nuestra cuenta Bancolombia Ahorros es: 000-000-0000 a nombre de PixelTech SAS. NIT: 900..." },
    { title: "📍 Ubicación", text: "Estamos ubicados en Bogotá, Centro Comercial Tecnológico, Local 101. Horario: Lunes a Sábado 9am - 6pm." },
    { title: "✅ Despedida", text: "¡Gracias por tu compra! Quedamos atentos a cualquier otra duda. ¡Feliz día!" },
    { title: "🛡️ Garantía", text: "Todos nuestros equipos tienen 1 año de garantía directa por defectos de fábrica. Debes conservar la caja y factura." }
];

// Inicializar módulo de Venta Manual
initManualSale(() => {
    // Si se completa una venta y el panel está abierto, recargar pedidos
    if (els.infoPanel.classList.contains('w-96')) resetOrdersPagination(activeChatId);
});

// ==========================================================================
// 1. GESTIÓN DE CHATS (BANDEJA DE ENTRADA)
// ==========================================================================

function initChatList() {
    if (unsubscribeChats) unsubscribeChats();

    const ref = collection(db, "chats");
    // Límite estricto de 50 para la vista inicial
    let q = query(ref, where("status", "==", currentTab), orderBy("lastMessageAt", "desc"), limit(50));
    
    unsubscribeChats = onSnapshot(q, (snapshot) => {

if (!els.chatSearchInput.value) {
            els.chatList.innerHTML = "";
            if(snapshot.empty) {
            els.chatList.innerHTML = `<div class="p-10 text-center text-xs text-gray-400">No hay chats en esta bandeja.</div>`;
            return;
        }

        // Detectar nuevos mensajes para el sonido
        snapshot.docChanges().forEach(change => {
            if (change.type === "modified" || change.type === "added") {
                const data = change.doc.data();
                // Solo sonar si es reciente (< 5 seg), no leído y no es el chat que tengo abierto
                if (data.unread && data.lastMessageAt && (Date.now() - data.lastMessageAt.toDate() < 5000)) {
                    if (document.hidden || activeChatId !== change.doc.id) {
                        playSound();
                        document.title = "(1) Nuevo Mensaje | Admin";
                        setTimeout(() => document.title = "WhatsApp CRM | PixelTech Admin", 3000);
                    }
                }
            }
        });

        snapshot.forEach(docSnap => {
            const chat = docSnap.data();
            const chatId = docSnap.id;
            
            // Filtro local del buscador de chats
            const searchTerm = (els.chatSearchInput.value || "").toLowerCase();
            if (searchTerm && !chat.clientName.toLowerCase().includes(searchTerm) && !chatId.includes(searchTerm)) return;

            // Si el chat que estoy viendo cambia (ej: cliente escribe), actualizo el timer
            if (chatId === activeChatId) {
                startSessionTimer(chat.lastCustomerInteraction);
            }
            renderChatItem(docSnap.id, docSnap.data());
            });
        }
    });
}

function renderChatItem(id, data) {
    const isActive = id === activeChatId;
    const isUnread = data.unread === true;
    
    let preview = data.lastMessage || '...';
    if (preview.includes('Imagen')) preview = '📷 Foto'; 
    if (preview.includes('Audio')) preview = '🎤 Audio';
    
    let timeStr = "";
    if (data.lastMessageAt) {
        const date = data.lastMessageAt.toDate();
        const now = new Date();
        timeStr = (date.toDateString() === now.toDateString()) 
            ? date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) 
            : date.toLocaleDateString();
    }

    const div = document.createElement('div');
    div.className = `flex items-center gap-3 p-3 rounded-xl cursor-pointer transition relative group ${isActive ? 'bg-gray-100' : 'hover:bg-gray-50 bg-white'}`;
    div.onclick = () => openChat(id, data);

    div.innerHTML = `
        <div class="w-12 h-12 rounded-full bg-slate-200 flex items-center justify-center text-gray-500 relative shrink-0">
            <i class="fa-solid fa-user"></i>
            ${isUnread ? '<span class="absolute top-0 right-0 w-3 h-3 bg-brand-cyan rounded-full border-2 border-white shadow-sm"></span>' : ''}
        </div>
        <div class="flex-grow min-w-0">
            <div class="flex justify-between items-baseline mb-1">
                <h4 class="text-sm font-bold text-gray-800 truncate ${isUnread ? 'font-black' : ''}">${data.clientName || id}</h4>
                <span class="text-[10px] ${isUnread ? 'text-brand-cyan font-bold' : 'text-gray-400'}">${timeStr}</span>
            </div>
            <p class="text-xs text-gray-500 truncate ${isUnread ? 'font-bold text-gray-700' : ''}">${preview}</p>
        </div>
    `;
    els.chatList.appendChild(div);
}

// Control de Pestañas (Filtros)
els.tabOpen.onclick = () => {
    currentTab = 'open';
    els.tabOpen.classList.add('bg-white', 'shadow-sm', 'text-brand-black'); els.tabOpen.classList.remove('text-gray-500');
    els.tabResolved.classList.remove('bg-white', 'shadow-sm', 'text-brand-black'); els.tabResolved.classList.add('text-gray-500');
    initChatList();
};
els.tabResolved.onclick = () => {
    currentTab = 'resolved';
    els.tabResolved.classList.add('bg-white', 'shadow-sm', 'text-brand-black'); els.tabResolved.classList.remove('text-gray-500');
    els.tabOpen.classList.remove('bg-white', 'shadow-sm', 'text-brand-black'); els.tabOpen.classList.add('text-gray-500');
    initChatList();
};


els.chatSearchInput.oninput = (e) => {
    const term = e.target.value.toLowerCase().trim();
    
    // 1. Si borra el texto, recargamos la lista por defecto (los 50 top)
    if (!term) {
        initChatList(); 
        return;
    }

    if (chatSearchTimeout) clearTimeout(chatSearchTimeout);

    chatSearchTimeout = setTimeout(async () => {
        els.chatList.innerHTML = `<div class="p-10 text-center"><i class="fa-solid fa-circle-notch fa-spin text-brand-cyan"></i></div>`;
        
        try {
            // Buscamos en Firebase (Aceptamos el costo de lectura porque el usuario lo pidió explícitamente)
            const ref = collection(db, "chats");
            
            // Truco: Buscamos por clientName (sensible a mayúsculas simulado) o phoneNumber
            // Firestore no permite 'OR' queries complejas fácilmente, priorizamos nombre
            // Nota: Para búsqueda perfecta necesitas Algolia o Elastic, pero esto sirve para MVP
            
            // Opción A: Buscar por teléfono exacto (muy eficiente)
            if (!isNaN(term) && term.length > 5) {
               const docSnap = await getDoc(doc(db, "chats", term)); // Intento directo ID sin 57
               const docSnap57 = await getDoc(doc(db, "chats", "57"+term)); // Intento con 57
               
               els.chatList.innerHTML = "";
               if (docSnap.exists()) renderChatItem(docSnap.id, docSnap.data());
               if (docSnap57.exists()) renderChatItem(docSnap57.id, docSnap57.data());
               
               if(!docSnap.exists() && !docSnap57.exists()) els.chatList.innerHTML = `<div class="p-4 text-center text-xs text-gray-400">No encontrado.</div>`;
               return;
            }

            // Opción B: Buscar por nombre (Prefix search)
            // Capitalizamos primera letra para intentar coincidir
            const termCap = term.charAt(0).toUpperCase() + term.slice(1);
            
            const q = query(
                ref, 
                orderBy('clientName'), 
                startAt(termCap), 
                endAt(termCap + '\uf8ff'),
                limit(10)
            );
            
            const snap = await getDocs(q);
            
            els.chatList.innerHTML = "";
            if (snap.empty) {
                els.chatList.innerHTML = `<div class="p-4 text-center text-xs text-gray-400">Sin resultados.</div>`;
            } else {
                snap.forEach(d => renderChatItem(d.id, d.data()));
            }

        } catch (e) {
            console.error(e);
            initChatList(); // Fallback a la lista normal
        }
    }, 600); // Esperar 600ms a que termine de escribir
};

// ==========================================================================
// 2. CONVERSACIÓN (ABRIR Y GESTIONAR)
// ==========================================================================

async function openChat(chatId, data) {
    if (activeChatId === chatId) return;
    activeChatId = chatId;
    activeChatData = data;

    // UI Reset
    els.conversationPanel.classList.remove('translate-x-full');
    els.emptyState.classList.add('hidden');
    els.chatHeader.classList.remove('hidden'); els.chatHeader.classList.add('flex');
    els.msgArea.classList.remove('hidden');
    els.inputArea.classList.remove('hidden');
    els.dropdownActions.classList.add('hidden');
    els.prodPicker.classList.add('hidden');
    els.quickReplyMenu.classList.add('hidden');

    // Manejo Panel Pedidos (Si ya está abierto, recargar. Si no, limpiar)
    if(els.infoPanel.classList.contains('w-96')) {
        ordersLoadedForCurrentChat = false;
        resetOrdersPagination(activeChatId);
    } else {
        ordersLoadedForCurrentChat = false;
        els.ordersContainer.innerHTML = "";
    }

    // Header Info
    els.activeName.textContent = data.clientName || "Usuario";
    els.activePhone.textContent = `+${chatId}`;
    
    // SEGURIDAD: Verificar si el elemento link existe antes de asignar
    if (els.waLink) {
        els.waLink.href = `https://wa.me/${chatId}`;
    }

    // Info Panel Lateral
    els.infoName.textContent = data.clientName || "Usuario";
    els.infoPhone.textContent = `+${chatId}`;
    els.infoBadge.textContent = "Sin verificar";
    els.infoBadge.className = "ml-auto px-2 py-0.5 bg-gray-100 text-gray-500 rounded text-[9px] font-bold uppercase";

    // Configurar Botón Resolver
    updateResolveButton(data.status);

    // Marcar como leído
    if(data.unread) updateDoc(doc(db, "chats", chatId), { unread: false }).catch(console.error);

    // Iniciar Timer y Cargar Mensajes
    startSessionTimer(data.lastCustomerInteraction);
    if (unsubscribeMessages) unsubscribeMessages();
    loadMessages(chatId);

    checkInputState(); // Validar estado botón enviar
    
    els.txtInput.focus();
}

function updateResolveButton(status) {
    if (status === 'resolved') {
        els.btnResolve.innerHTML = '<i class="fa-solid fa-box-open"></i> <span class="hidden lg:inline">Reabrir</span>';
        els.btnResolve.classList.replace('hover:text-green-600', 'hover:text-blue-600');
        els.btnResolve.classList.replace('hover:bg-green-50', 'hover:bg-blue-50');
    } else {
        els.btnResolve.innerHTML = '<i class="fa-solid fa-check"></i> <span class="hidden lg:inline">Resolver</span>';
        els.btnResolve.classList.replace('hover:text-blue-600', 'hover:text-green-600');
        els.btnResolve.classList.replace('hover:bg-blue-50', 'hover:bg-green-50');
    }
}

// Acción del Botón Resolver
els.btnResolve.onclick = async () => {
    if(!activeChatId) return;
    const isResolved = els.btnResolve.innerText.includes('Reabrir'); // Estado actual visual
    const newStatus = isResolved ? 'open' : 'resolved';
    
    els.btnResolve.disabled = true;
    try {
        await updateDoc(doc(db, "chats", activeChatId), { status: newStatus });
        
        // Si estamos viendo la lista 'open' y lo resolvemos, cerrar el panel (UX)
        if (currentTab === 'open' && newStatus === 'resolved') {
            activeChatId = null;
            els.conversationPanel.classList.add('translate-x-full');
        } else {
            updateResolveButton(newStatus);
        }
    } catch(e) { console.error(e); } 
    finally { els.btnResolve.disabled = false; }
};

// ==========================================================================
// 3. MENSAJERÍA (CARGA, ENVIO, PRODUCTOS, RESPUESTAS RÁPIDAS)
// ==========================================================================

function loadMessages(id) {
    els.msgArea.innerHTML = `<div class="flex justify-center p-4"><i class="fa-solid fa-circle-notch fa-spin text-gray-400"></i></div>`;
    oldestMessageDoc = null; // Reset cursor

    // QUERY: Orden ascendente (cronológico) pero limitado a los ÚLTIMOS 20
    const q = query(
        collection(db, "chats", id, "messages"), 
        orderBy("timestamp", "asc"), 
        limitToLast(20)
    );
    
    unsubscribeMessages = onSnapshot(q, (snapshot) => {
        // Limpiamos el área solo si es la primera carga
        // Si es una actualización (ej: mensaje nuevo), no borramos todo para evitar parpadeo
        if (els.msgArea.querySelector('.fa-spin')) {
            els.msgArea.innerHTML = "";
            // Agregar botón de carga (inicialmente oculto o visible según lógica)
            createLoadMoreButton();
        }

        // Guardamos referencia al mensaje más viejo para la paginación
        if (!snapshot.empty) {
            oldestMessageDoc = snapshot.docs[0];
        }

        const isAtBottom = els.msgArea.scrollHeight - els.msgArea.scrollTop === els.msgArea.clientHeight;

        // Renderizamos los mensajes
        // Nota: onSnapshot devuelve todo el set de 20. 
        // Para eficiencia en DOM, limpiamos y repintamos estos 20 (es rápido).
        // Los mensajes "viejos" cargados manualmente se mantendrán arriba del contenedor.
        
        // Limpiar solo la parte de mensajes "vivos", manteniendo el botón de carga arriba
        // Estrategia simplificada: Repintar todo el contenedor de mensajes vivos
        
        // 1. Obtener mensajes existentes (históricos cargados manualmente)
        const historyContainer = document.getElementById('history-messages-container');
        if (!historyContainer) {
            // Si no existe contenedor de historial, creamos estructura
            els.msgArea.innerHTML = "";
            createLoadMoreButton();
            
            const historyDiv = document.createElement('div');
            historyDiv.id = 'history-messages-container';
            els.msgArea.appendChild(historyDiv);

            const liveDiv = document.createElement('div');
            liveDiv.id = 'live-messages-container';
            els.msgArea.appendChild(liveDiv);
        }

        const liveContainer = document.getElementById('live-messages-container');
        liveContainer.innerHTML = ""; // Limpiar solo los recientes para actualizar estados

        snapshot.forEach(doc => {
            const msgNode = createMessageNode(doc.data());
            liveContainer.appendChild(msgNode);
        });

        // Scroll al fondo solo si estaba abajo o es carga inicial
        if (isAtBottom || snapshot.docChanges().some(c => c.type === 'added')) {
            setTimeout(() => els.msgArea.scrollTop = els.msgArea.scrollHeight, 100);
        }
    });
}

// Crear Botón "Cargar Anteriores"
function createLoadMoreButton() {
    const btnContainer = document.createElement('div');
    btnContainer.className = "flex justify-center py-4";
    btnContainer.id = "btn-load-more-wrapper";
    
    const btn = document.createElement('button');
    btn.className = "text-xs font-bold text-brand-cyan hover:underline bg-cyan-50 px-3 py-1 rounded-full border border-cyan-100 transition";
    btn.innerHTML = '<i class="fa-solid fa-clock-rotate-left"></i> Cargar mensajes anteriores';
    btn.onclick = loadOlderMessages;
    
    btnContainer.appendChild(btn);
    els.msgArea.prepend(btnContainer);
}

// Cargar Mensajes Viejos (Paginación)
async function loadOlderMessages() {
    if (!activeChatId || !oldestMessageDoc || isChatLoading) return;
    
    const btnWrapper = document.getElementById('btn-load-more-wrapper');
    const btn = btnWrapper.querySelector('button');
    const historyContainer = document.getElementById('history-messages-container');
    
    isChatLoading = true;
    btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Cargando...';

    try {
        // Guardar altura actual para restaurar scroll
        const previousHeight = els.msgArea.scrollHeight;
        const previousScroll = els.msgArea.scrollTop;

        // QUERY: Buscar hacia atrás desde el mensaje más viejo que tenemos
        const q = query(
            collection(db, "chats", activeChatId, "messages"),
            orderBy("timestamp", "desc"), // Buscamos hacia atrás
            startAfter(oldestMessageDoc),
            limit(20)
        );

        const snap = await getDocs(q);

        if (snap.empty) {
            btnWrapper.innerHTML = `<span class="text-[10px] text-gray-400">Inicio de la conversación</span>`;
            isChatLoading = false;
            return;
        }

        // Actualizar cursor al nuevo más viejo
        oldestMessageDoc = snap.docs[snap.docs.length - 1];

        // Los docs vienen en orden DESC (Nuevo -> Viejo), los invertimos para mostrar
        const docsReversed = snap.docs.reverse();

        // Crear fragmento para insertar
        const fragment = document.createDocumentFragment();
        docsReversed.forEach(doc => {
            const node = createMessageNode(doc.data());
            fragment.appendChild(node);
        });

        // Insertar AL PRINCIPIO del contenedor de historial
        historyContainer.prepend(fragment);

        // Restaurar Scroll (Mágia para que no salte)
        // La nueva posición es: (Nueva Altura Total) - (Altura Anterior) + (Scroll Anterior)
        // Pero como estamos arriba, simplemente queremos mantenernos en el mismo mensaje visual
        const newHeight = els.msgArea.scrollHeight;
        els.msgArea.scrollTop = newHeight - previousHeight + previousScroll;

        btn.innerHTML = '<i class="fa-solid fa-clock-rotate-left"></i> Cargar más antiguos';

    } catch (e) {
        console.error("Error historial:", e);
        btn.innerHTML = "Error al cargar";
    } finally {
        isChatLoading = false;
    }
}

// Helper para crear el HTML del mensaje (Refactorizado para reusar)
function createMessageNode(m) {
    const inc = m.type === 'incoming';
    let contentHtml = "";
    
    if (m.messageType === 'text' || m.type === 'text') {
        contentHtml = `<p class="text-sm text-gray-800 whitespace-pre-wrap leading-relaxed">${m.content}</p>`;
    } else if ((m.messageType === 'image' || m.type === 'image') && m.mediaUrl) {
        contentHtml = `<a href="${m.mediaUrl}" target="_blank"><img src="${m.mediaUrl}" class="rounded-lg max-w-xs max-h-64 object-cover mb-1 border border-black/5 hover:opacity-90 transition"></a>${m.content ? `<p class="text-sm mt-1">${m.content}</p>` : ''}`;
    } else if ((m.messageType === 'audio' || m.type === 'audio') && m.mediaUrl) {
        contentHtml = `<audio controls class="max-w-[240px] mt-1 mb-1"><source src="${m.mediaUrl}"></audio>`;
    } else {
        contentHtml = `<p class="text-sm text-gray-800 italic">[Archivo no soportado]</p>`;
    }

    const div = document.createElement('div');
    div.className = `flex w-full ${inc ? 'justify-start' : 'justify-end'}`;
    const time = m.timestamp ? m.timestamp.toDate().toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'}) : '';
    
    div.innerHTML = `
        <div class="max-w-[75%] p-3 ${inc ? 'chat-bubble-in' : 'chat-bubble-out'} relative group shadow-sm mb-2">
            ${contentHtml}
            <div class="flex justify-end gap-1 mt-1 opacity-60">
                <span class="text-[9px] font-bold">${time}</span>
                ${!inc ? '<i class="fa-solid fa-check-double text-[10px] text-blue-500"></i>' : ''}
            </div>
        </div>
    `;
    return div;
}


// Enviar Texto
async function sendMessage() {
    const text = els.txtInput.value.trim();
    if (!text || !activeChatId) return;
    
    // UI Loading
    els.txtInput.value = ""; // Limpiamos primero
    checkInputState(); // Actualizamos botón inmediatamente a "deshabilitado"
    els.txtInput.focus();
    
    try {
        const sendFn = httpsCallable(functions, 'sendWhatsappMessage');
        // Enviamos en segundo plano, no bloqueamos la UI totalmente para sensación de velocidad
        await sendFn({ phoneNumber: activeChatId, message: text, type: 'text' });
    } catch (e) {
        console.error(e);
        alert("Error al enviar: " + e.message);
        els.txtInput.value = text; // Restaurar texto si falló
        checkInputState();
    }
}
// Respuestas Rápidas (Comando /)
els.txtInput.addEventListener('input', (e) => {
    const val = e.target.value;
    if (val.startsWith('/')) {
        const filter = val.substring(1).toLowerCase();
        renderQuickReplies(filter);
        els.quickReplyMenu.classList.remove('hidden');
    } else {
        els.quickReplyMenu.classList.add('hidden');
    }
});

function renderQuickReplies(filter) {
    els.quickReplyList.innerHTML = "";
    const filtered = QUICK_REPLIES.filter(r => r.title.toLowerCase().includes(filter) || r.text.toLowerCase().includes(filter));
    
    if (filtered.length === 0) {
        els.quickReplyList.innerHTML = `<div class="p-3 text-xs text-gray-400">Sin resultados</div>`;
        return;
    }

    filtered.forEach(r => {
        const div = document.createElement('div');
        div.className = "p-3 hover:bg-slate-50 cursor-pointer border-b border-gray-50 last:border-0";
        div.innerHTML = `<p class="text-[10px] font-black uppercase text-brand-cyan mb-1">${r.title}</p><p class="text-xs text-gray-600 line-clamp-2">${r.text}</p>`;
        div.onclick = () => {
            els.txtInput.value = r.text;
            els.quickReplyMenu.classList.add('hidden');
            els.txtInput.focus();
        };
        els.quickReplyList.appendChild(div);
    });
}

// ==========================================================================
// 5. CATALOGO RÁPIDO (MEJORADO)
// ==========================================================================

// Utilidad para ignorar tildes y mayúsculas
function normalizeText(text) {
    return text ? text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase() : "";
}

// Abrir/Cerrar Picker
els.btnProducts.onclick = () => {
    els.prodPicker.classList.toggle('hidden');
    if (!els.prodPicker.classList.contains('hidden')) {
        els.prodSearch.value = ""; 
        els.prodSearch.focus();
        loadRecentProducts(); 
    }
};
els.closeProdBtn.onclick = () => els.prodPicker.classList.add('hidden');

// A. Cargar Productos (Bajo Demanda)
async function loadRecentProducts() {
    els.prodList.innerHTML = `<div class="p-4 text-center"><i class="fa-solid fa-circle-notch fa-spin text-gray-400"></i></div>`;
    
    // 1. INTENTO LEER DE CACHÉ
    const cached = sessionStorage.getItem('recent_products_cache');
    if (cached) {
        renderProductList(JSON.parse(cached));
        return; // ¡Ahorramos la lectura!
    }

    try {
        const ref = collection(db, "products");
        const q = query(ref, orderBy("createdAt", "desc"), limit(15)); 
        const snap = await getDocs(q);
        
        const products = [];
        snap.forEach(d => products.push(d.data()));
        
        // 2. GUARDAR EN CACHÉ
        sessionStorage.setItem('recent_products_cache', JSON.stringify(products));
        
        renderProductList(products);
    } catch(e) {
        console.error(e);
        els.prodList.innerHTML = `<div class="p-2 text-xs text-red-400">Error cargando lista.</div>`;
    }
}

// B. Buscador (Con Debounce)
let searchTimeout = null;
els.prodSearch.oninput = (e) => {
    const rawTerm = e.target.value;
    
    if (searchTimeout) clearTimeout(searchTimeout);
    
    searchTimeout = setTimeout(async () => {
        if (rawTerm.trim().length === 0) {
            loadRecentProducts();
            return;
        }
        
        els.prodList.innerHTML = `<div class="p-4 text-center"><i class="fa-solid fa-circle-notch fa-spin text-gray-400"></i></div>`;
        
        try {
            const term = rawTerm.charAt(0).toUpperCase() + rawTerm.slice(1);
            const ref = collection(db, "products");
            const q = query(ref, orderBy('name'), startAt(term), endAt(term + '\uf8ff'), limit(10));
            const snap = await getDocs(q);
            const products = [];
            snap.forEach(d => products.push(d.data()));
            
            if (products.length === 0) {
                els.prodList.innerHTML = `<div class="p-4 text-center text-xs text-gray-400"><p>No encontrado. Intenta con la mayúscula inicial (Ej: Iphone).</p></div>`;
            } else {
                renderProductList(products);
            }
        } catch(e) {
            console.error(e);
            els.prodList.innerHTML = `<div class="p-2 text-xs text-red-400">Error búsqueda.</div>`;
        }
    }, 600); 
};

// C. Renderizado de Tarjetas
function renderProductList(products) {
    els.prodList.innerHTML = "";
    if (products.length === 0) {
        els.prodList.innerHTML = `<div class="p-2 text-xs text-gray-400">No hay productos.</div>`;
        return;
    }
    
    products.forEach(p => {
        // Precio "Desde"
        const isVariable = !p.isSimple || (p.combinations && p.combinations.length > 0);
        const priceLabel = isVariable ? `<span class="text-[9px] text-gray-400 font-normal mr-1">Desde</span>` : "";
        const price = (p.price || 0).toLocaleString('es-CO');
        const img = p.mainImage || p.image || 'https://via.placeholder.com/50?text=No+Img';
        
        // Garantía
        let warrantyBadge = "";
        if (p.warranty && p.warranty.time > 0) {
            const unit = TIME_UNITS[p.warranty.unit] || p.warranty.unit;
            warrantyBadge = `<span class="ml-2 px-1.5 py-0.5 bg-blue-50 text-blue-600 rounded text-[8px] font-bold border border-blue-100 uppercase"><i class="fa-solid fa-shield-halved"></i> ${p.warranty.time} ${unit}</span>`;
        }

        // Promo
        const isPromo = p.name.toLowerCase().includes('promo') || p.name.toLowerCase().includes('oferta');
        const priceColor = isPromo ? 'text-red-500' : 'text-emerald-600';

        const div = document.createElement('div');
        div.className = "flex items-start gap-3 p-2 hover:bg-slate-50 rounded-lg cursor-pointer transition border-b border-gray-50 last:border-0 group";
        
        div.innerHTML = `
            <div class="relative w-12 h-12 shrink-0">
                <img src="${img}" class="w-full h-full rounded-md object-cover border border-gray-100 bg-white">
                ${isPromo ? '<div class="absolute -top-1 -right-1 w-3 h-3 bg-red-500 rounded-full border border-white"></div>' : ''}
            </div>
            <div class="min-w-0 flex-1">
                <div class="flex justify-between items-start">
                    <p class="text-[10px] font-black uppercase text-brand-black line-clamp-1 group-hover:text-brand-cyan transition">${p.name}</p>
                </div>
                <div class="flex items-center mt-0.5">
                    ${priceLabel}
                    <span class="text-xs font-black ${priceColor}">$${price}</span>
                    ${warrantyBadge}
                </div>
                <div class="flex gap-2 mt-1">
                    ${p.definedColors?.length > 0 ? `<span class="text-[8px] text-gray-400 bg-gray-100 px-1 rounded">🎨 ${p.definedColors.length} Colores</span>` : ''}
                    <span class="text-[8px] text-gray-400 ml-auto">Stock: ${p.stock || 0}</span>
                </div>
            </div>
        `;
        div.onclick = () => sendProduct(p);
        els.prodList.appendChild(div);
    });
}

// D. Enviar Producto
async function sendProduct(p) {
    if (!confirm(`¿Enviar tarjeta de ${p.name}?`)) return;
    
    els.prodPicker.classList.add('hidden');
    els.btnSend.disabled = true; 
    els.btnSend.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
    
    // Construcción del Mensaje
    const price = (p.price || 0).toLocaleString('es-CO');
    const isVariable = !p.isSimple;
    const priceText = isVariable ? `Desde $${price}` : `$${price}`;
    
    let featuresText = "";
    if (p.definedColors && p.definedColors.length > 0) {
        featuresText += `\n🎨 *Colores:* ${p.definedColors.join(', ')}`;
    }
    if (p.definedCapacities && p.definedCapacities.length > 0) {
        featuresText += `\n💾 *Capacidad:* ${p.definedCapacities.join(', ')}`;
    }

    let warrantyText = "";
    if (p.warranty && p.warranty.time > 0) {
        const unit = TIME_UNITS[p.warranty.unit] || p.warranty.unit;
        warrantyText = `\n🛡️ *Garantía:* ${p.warranty.time} ${unit} (Directa)`;
    }

    const caption = `*${p.name}*\n💲 *Precio:* ${priceText}${featuresText}${warrantyText}`.trim();
    const imgUrl = p.mainImage || p.image;

    try {
        const sendFn = httpsCallable(functions, 'sendWhatsappMessage');
        await sendFn({ 
            phoneNumber: activeChatId, 
            message: caption, 
            type: 'image',
            mediaUrl: imgUrl
        });
    } catch(e) { 
        alert("Error enviando producto: " + e.message); 
    } finally { 
        els.btnSend.disabled = false; 
        els.btnSend.innerHTML = '<i class="fa-solid fa-paper-plane"></i>'; 
        els.txtInput.focus();
    }
}

// Adjuntar Imagen (Clip)
els.btnAttach.onclick = () => els.fileInput.click();
els.fileInput.onchange = async (e) => {
    const f = e.target.files[0]; if (!f || !activeChatId) return; 
    if (!confirm(`Enviar ${f.name}?`)) { els.fileInput.value = ""; return; }
    
    els.txtInput.disabled = true; els.btnSend.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
    try {
        const r = ref(storage, `chats/${activeChatId}/uploads/${Date.now()}_${f.name}`); 
        await uploadBytes(r, f); 
        const u = await getDownloadURL(r); 
        await (httpsCallable(functions, 'sendWhatsappMessage'))({ phoneNumber: activeChatId, message: "", type: 'image', mediaUrl: u });
    } catch (e) { alert("Error al subir imagen"); } 
    finally { els.fileInput.value = ""; els.txtInput.disabled = false; els.btnSend.innerHTML = '<i class="fa-solid fa-paper-plane"></i>'; els.txtInput.focus(); }
};

// Sonido
function playSound() {
    try {
        els.notifySound.currentTime = 0;
        els.notifySound.play().catch(() => {});
    } catch(e){}
}

// Timer 24h
function startSessionTimer(ts) {
    if (timerInterval) clearInterval(timerInterval);
    const check = () => {
        if (!ts) { updateTimer(0, false, "Esperando..."); return; }
        const ms = (24*60*60*1000) - (new Date() - ts.toDate());
        if (ms <= 0) { updateTimer(0, false, "Expirado"); clearInterval(timerInterval); } else updateTimer(ms, true);
    }; check(); timerInterval = setInterval(check, 1000);
}
function updateTimer(ms, open, txt) {
    // Clases visuales del Badge
    els.timerBadge.className = open 
        ? 'flex items-center gap-2 px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest bg-emerald-100 text-emerald-700' 
        : 'flex items-center gap-2 px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest bg-red-100 text-red-700';
    
    els.timerBadge.classList.remove('hidden');
    els.timerText.textContent = open 
        ? `${Math.floor(ms/3600000)}h ${Math.floor((ms%3600000)/60000)}m` 
        : txt;
    
    // Lógica de Inputs
    if(!els.txtInput.dataset.uploading) { 
        els.txtInput.disabled = !open; 
        els.btnAttach.disabled = !open; 
        els.btnProducts.disabled = !open;
        
        // El botón de enviar depende de si hay texto escrito, pero si la sesión cerró, se bloquea todo
        if (!open) {
            els.btnSend.disabled = true;
            els.btnSend.classList.add('opacity-50', 'cursor-not-allowed');
        } else {
            // Si está abierto, verificamos si hay texto para habilitar o deshabilitar visualmente
            checkInputState(); 
        }
    }
}

// Validar estado del botón según el texto
function checkInputState() {
    const text = els.txtInput.value.trim();
    const isSessionOpen = !els.txtInput.disabled;
    
    if (isSessionOpen && text.length > 0) {
        els.btnSend.disabled = false;
        els.btnSend.classList.remove('opacity-50', 'cursor-not-allowed');
        els.btnSend.classList.add('bg-brand-black', 'text-white', 'hover:bg-brand-cyan', 'hover:text-brand-black'); // Estilos activos
        els.btnSend.classList.remove('bg-gray-200', 'text-gray-400'); // Quitar estilos inactivos
    } else {
        els.btnSend.disabled = true;
        els.btnSend.classList.add('opacity-50', 'cursor-not-allowed', 'bg-gray-200', 'text-gray-400');
        els.btnSend.classList.remove('bg-brand-black', 'text-white', 'hover:bg-brand-cyan', 'hover:text-brand-black');
    }
}

// Agregar Listener al input para detectar escritura en tiempo real
els.txtInput.addEventListener('input', () => {
    checkInputState();
    
    // Lógica existente de respuestas rápidas
    const val = els.txtInput.value;
    if (val.startsWith('/')) {
        const filter = val.substring(1).toLowerCase();
        renderQuickReplies(filter);
        els.quickReplyMenu.classList.remove('hidden');
    } else {
        els.quickReplyMenu.classList.add('hidden');
    }
});
// ==========================================================================
// 4. PANEL DERECHO: PEDIDOS (HISTORIAL)
// ==========================================================================

// Dropdown y Acciones
els.btnActions.onclick = (e) => {
    e.stopPropagation();
    els.dropdownActions.classList.toggle('hidden');
};
// Cierra el menú si haces clic fuera
document.addEventListener('click', (e) => {
    if (!els.btnActions.contains(e.target) && !els.dropdownActions.contains(e.target)) {
        els.dropdownActions.classList.add('hidden');
    }
});

els.closeInfoBtn.onclick = () => { els.infoPanel.classList.remove('w-96'); els.infoPanel.classList.add('w-0'); };

// A. Ver Pedidos
els.btnActOrders.onclick = () => {
    els.dropdownActions.classList.add('hidden');
    const isClosed = els.infoPanel.classList.contains('w-0');
    if (isClosed) {
        els.infoPanel.classList.remove('w-0'); els.infoPanel.classList.add('w-96');
        if (!ordersLoadedForCurrentChat && activeChatId) {
            resetOrdersPagination(activeChatId);
            ordersLoadedForCurrentChat = true;
        }
    }
};

// B. Nueva Venta
els.btnActSale.onclick = async () => {
    els.dropdownActions.classList.add('hidden');
    if(!activeChatId) return;
    const cleanPhone = activeChatId.replace(/^57/, '');
    
    const q = query(collection(db, "users"), where("phone", "==", cleanPhone), limit(1));
    const snap = await getDocs(q);
    
    await openManualSaleModal();
    if (!snap.empty) {
        const u = snap.docs[0].data();
        document.getElementById('m-cust-search').value = u.name;
        document.getElementById('m-cust-phone').value = u.phone;
    } else {
        document.getElementById('m-cust-phone').value = cleanPhone;
    }
};

// C. Nuevo Cliente
els.btnActClient.onclick = () => {
    els.dropdownActions.classList.add('hidden');
    if(!activeChatId) return;
    els.inpClientName.value = "";
    els.inpClientPhone.value = activeChatId.replace(/^57/, '');
    els.inpClientDoc.value = ""; els.inpClientEmail.value = ""; els.inpClientAddr.value = "";
    
    els.inpClientDept.innerHTML = '<option>Cargando...</option>'; els.inpClientCity.innerHTML = '...';
    fetch('https://api-colombia.com/api/v1/Department').then(r => r.json()).then(d => {
        d.sort((a,b)=>a.name.localeCompare(b.name));
        els.inpClientDept.innerHTML = '<option value="">Seleccione...</option>';
        d.forEach(x => { const o = document.createElement('option'); o.value=x.id; o.textContent=x.name; o.dataset.name=x.name; els.inpClientDept.appendChild(o); });
    });
    els.clientModal.classList.remove('hidden');
};

els.inpClientDept.onchange = async (e) => {
    if(!e.target.value) return;
    els.inpClientCity.innerHTML = '<option>Cargando...</option>'; els.inpClientCity.disabled=true;
    const res = await fetch(`https://api-colombia.com/api/v1/Department/${e.target.value}/cities`); const c = await res.json();
    c.sort((a,b)=>a.name.localeCompare(b.name));
    els.inpClientCity.innerHTML = '<option value="">Ciudad...</option>';
    c.forEach(x => els.inpClientCity.innerHTML += `<option value="${x.name}">${x.name}</option>`); els.inpClientCity.disabled=false;
};

els.btnSaveClient.onclick = async () => {
    const name = els.inpClientName.value.trim(); const phone = els.inpClientPhone.value.trim();
    if(!name || !phone) return alert("Nombre y Teléfono requeridos");
    els.btnSaveClient.disabled = true; els.btnSaveClient.innerText = "Guardando...";
    try {
        const deptName = els.inpClientDept.options[els.inpClientDept.selectedIndex]?.dataset.name || "";
        const city = els.inpClientCity.value; const address = els.inpClientAddr.value;
        await addDoc(collection(db, "users"), { name, phone, email: els.inpClientEmail.value.trim(), document: els.inpClientDoc.value.trim(), source: 'MANUAL', role: 'client', createdAt: Timestamp.now(), address, dept: deptName, city, addresses: address ? [{ alias: "Principal", address, dept: deptName, city, isDefault: true }] : [] });
        alert("✅ Cliente guardado"); els.clientModal.classList.add('hidden'); els.activeName.textContent = name; els.infoName.textContent = name;
    } catch(e) { alert(e.message); } finally { els.btnSaveClient.disabled = false; els.btnSaveClient.innerText = "Guardar Cliente"; }
};

// Logica Pedidos
function resetOrdersPagination(phoneNumber) {
    els.ordersContainer.innerHTML = ""; els.btnLoadMore.classList.add('hidden'); lastOrderSnapshot = null;
    let n = phoneNumber; if (n.startsWith('57')) n = n.substring(2); if (n.startsWith('+57')) n = n.substring(3);
    currentPhoneNumbers = [phoneNumber, n, `+57 ${n}`, `+57${n}`, parseInt(n)]; loadOrders(true);
}

async function loadOrders(isInitial = false) {
    if (isInitial) els.ordersContainer.innerHTML = `<div class="text-center py-10"><i class="fa-solid fa-circle-notch fa-spin text-brand-cyan"></i></div>`;
    else els.btnLoadMore.disabled = true;

    try {
        const ref = collection(db, "orders");
        let q = query(ref, where("buyerInfo.phone", "in", currentPhoneNumbers), orderBy("createdAt", "desc"), limit(ORDERS_PER_PAGE));
        if (!isInitial && lastOrderSnapshot) q = query(ref, where("buyerInfo.phone", "in", currentPhoneNumbers), orderBy("createdAt", "desc"), startAfter(lastOrderSnapshot), limit(ORDERS_PER_PAGE));
        
        const snap = await getDocs(q);
        if (isInitial) els.ordersContainer.innerHTML = "";

        if (snap.empty) {
            if (isInitial) {
                const q2 = query(ref, where("shippingData.phone", "in", currentPhoneNumbers), limit(3));
                const snap2 = await getDocs(q2);
                if (snap2.empty) { els.ordersContainer.innerHTML = `<div class="text-center py-6 border border-dashed border-gray-200 rounded-xl"><p class="text-xs text-gray-400">Sin pedidos.</p></div>`; els.infoBadge.textContent = "Visitante"; return; }
                renderOrders(snap2.docs);
            } else els.btnLoadMore.classList.add('hidden');
        } else {
            els.infoBadge.className = "ml-auto px-2 py-0.5 bg-emerald-100 text-emerald-700 rounded text-[9px] font-bold uppercase"; els.infoBadge.textContent = "Verificado";
            lastOrderSnapshot = snap.docs[snap.docs.length - 1]; renderOrders(snap.docs);
            if (snap.docs.length < ORDERS_PER_PAGE) els.btnLoadMore.classList.add('hidden'); else els.btnLoadMore.classList.remove('hidden');
        }
    } catch (e) { els.ordersContainer.innerHTML = `<p class="text-xs text-red-400 text-center">Error al cargar.</p>`; } 
    finally { els.btnLoadMore.disabled = false; }
}

function renderOrders(docs) {
    docs.forEach(d => {
        const o = d.data(); const date = o.createdAt?.toDate().toLocaleDateString() || 'N/A'; const total = (o.total || 0).toLocaleString('es-CO');
        let c = "bg-gray-100 text-gray-600"; if(o.status==='PAGADO') c="bg-blue-50 text-blue-600"; if(o.status==='ENTREGADO') c="bg-emerald-50 text-emerald-600";
        const div = document.createElement('div'); div.className = "bg-white border border-gray-100 rounded-xl p-3 shadow-sm hover:shadow-md cursor-pointer group";
        div.onclick = () => viewOrderDetail(d.id);
        div.innerHTML = `<div class="flex justify-between items-start mb-2"><div><span class="text-[10px] font-black uppercase text-gray-400">#${d.id.slice(0,8).toUpperCase()}</span><p class="text-xs font-bold text-brand-black mt-0.5">${date}</p></div><span class="px-2 py-1 rounded text-[9px] font-black uppercase ${c}">${o.status}</span></div><div class="flex justify-between items-center border-t border-gray-50 pt-2"><span class="text-sm font-black">$${total}</span><span class="text-[10px] font-bold text-brand-cyan group-hover:underline">Ver <i class="fa-solid fa-arrow-right"></i></span></div>`;
        els.ordersContainer.appendChild(div);
    });
}

// Buscador Inteligente
els.btnSearchOrder.onclick = async () => {
    let term = els.inputSearchOrder.value.trim();
    if (term.startsWith('#')) term = term.substring(1);
    if (!term) return;

    els.ordersContainer.innerHTML = `<div class="text-center py-4"><i class="fa-solid fa-circle-notch fa-spin text-brand-cyan"></i></div>`; 
    els.btnLoadMore.classList.add('hidden');
    
    try { 
        const s = await getDoc(doc(db, "orders", term)); 
        if(s.exists()) { els.ordersContainer.innerHTML = ""; renderOrders([s]); return; }
    } catch(e) {}

    try {
        const ref = collection(db, "orders");
        // Buscamos los ultimos 20 del usuario para filtrar localmente por ID corto
        const q = query(ref, where("buyerInfo.phone", "in", currentPhoneNumbers), orderBy("createdAt", "desc"), limit(20));
        const snap = await getDocs(q);
        
        const matches = snap.docs.filter(d => d.id.toUpperCase().startsWith(term.toUpperCase()));

        if (matches.length > 0) {
            els.ordersContainer.innerHTML = `<div class="bg-blue-50 text-blue-700 text-[10px] p-2 rounded mb-2 font-bold text-center">Encontrado en historial</div>`;
            renderOrders(matches);
        } else {
            els.ordersContainer.innerHTML = `<div class="text-center py-4"><p class="text-xs text-red-400 font-bold">No encontrada</p><button onclick="window.resetOrdersPagination('${activeChatId}')" class="text-[10px] underline mt-3 text-brand-black font-bold">Volver</button></div>`;
        }
    } catch(e) { console.error(e); alert("Error"); }
};

// LISTENERS GLOBALES
if(els.btnSend) els.btnSend.onclick = sendMessage;
if(els.txtInput) els.txtInput.onkeypress = (e) => { if(e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }};
if(els.backBtn) els.backBtn.onclick = () => { els.conversationPanel.classList.add('translate-x-full'); activeChatId = null; };
if(els.btnLoadMore) els.btnLoadMore.onclick = () => loadOrders(false);
if(els.inputSearchOrder) els.inputSearchOrder.onkeypress = (e) => { if(e.key === 'Enter') { e.preventDefault(); els.btnSearchOrder.click(); }};

// Exponer funcion para el boton "Volver" del buscador
window.resetOrdersPagination = resetOrdersPagination;

initChatList();