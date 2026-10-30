import { db, collection, getDocs, query, orderBy, onSnapshot, doc, setDoc } from './firebase-init.js';
import { loadAdminSidebar } from './admin-ui.js';
import { AdminStore } from './admin-store.js';

loadAdminSidebar(sessionStorage.getItem('pixeltech_user_role') || 'admin');

// ============================================================================
// DOM ELEMENTS
// ============================================================================

// Period Filter & Cutoff Badge
const filterMonthInput = document.getElementById('filter-month');
const btnClearDate = document.getElementById('btn-clear-date');
const currentPeriodTitle = document.getElementById('current-period-title');
const badgeStartDate = document.getElementById('badge-start-date');
const badgeStartDateText = document.getElementById('badge-start-date-text');

// Top KPIs
const kpiTotalSales = document.getElementById('kpi-total-sales');
const kpiOrdersCount = document.getElementById('kpi-orders-count');
const kpiUnitsCount = document.getElementById('kpi-units-count');
const kpiTotalCogs = document.getElementById('kpi-total-cogs');
const kpiCogsPercent = document.getElementById('kpi-cogs-percent');
const kpiTotalExpenses = document.getElementById('kpi-total-expenses');
const kpiExpensesCount = document.getElementById('kpi-expenses-count');
const kpiNetProfit = document.getElementById('kpi-net-profit');
const kpiNetMarginBadge = document.getElementById('kpi-net-margin-badge');
const kpiGrossProfitSub = document.getElementById('kpi-gross-profit-sub');
const kpiNetProfitIcon = document.getElementById('kpi-net-profit-icon');
const cardNetProfit = document.getElementById('card-net-profit');

// Channel Cards & Tables
const channelCardsGrid = document.getElementById('channel-cards-grid');
const channelsCountLbl = document.getElementById('channels-count-lbl');
const comparativeTableBody = document.getElementById('comparative-table-body');
const trendsTableBody = document.getElementById('trends-table-body');
const trendChannelSelect = document.getElementById('trend-channel-select');
const syncIcon = document.getElementById('sync-icon');

// Daily Modal Elements
const dailyModal = document.getElementById('daily-modal');
const modalChannelSelect = document.getElementById('modal-channel-select');
const modalProductSearch = document.getElementById('modal-product-search');
const dailyDateFrom = document.getElementById('daily-date-from');
const dailyDateTo = document.getElementById('daily-date-to');
const dailySubSales = document.getElementById('daily-sub-sales');
const dailySubCogs = document.getElementById('daily-sub-cogs');
const dailySubProfit = document.getElementById('daily-sub-profit');
const dailySubMargin = document.getElementById('daily-sub-margin');
const dailyAccordionList = document.getElementById('daily-accordion-list');

// Settings Modal Elements
const settingsModal = document.getElementById('settings-modal');
const inputStartDate = document.getElementById('input-start-date');
const settingsStatusText = document.getElementById('settings-status-text');
const settingsStatusBox = document.getElementById('settings-status-box');

// ============================================================================
// STATE & CACHE EN RAM
// ============================================================================

let productsReady = false;
let purchasesReady = false;
let expensesReady = false;
let ordersReady = false;

let allProducts = [];
let allPurchases = [];
let allExpenses = [];
let allOrders = [];

// Resultados Contables Calculados
let processedSalesRecords = []; // Cada item vendido con su costo FIFO, venta neta y fecha
let processedExpenses = [];     // Gastos operacionales filtrados

// Filtros Principales
let currentMonthFilter = null; // null = Global (Todos los tiempos)
let trendChannelFilter = 'ALL';
let branchesStartDate = localStorage.getItem('pixeltech_branches_profitability_start_date') || null;

// Filtros del Modal Diario
let modalChannelFilter = 'ALL';
let modalProductTerm = '';
let modalFromFilter = '';
let modalToFilter = '';
const expandedDays = new Set();

// Nombres Personalizados de Tiendas MercadoLibre
let mlStoreNames = { 1: 'MercadoLibre 1', 2: 'MercadoLibre 2', 3: 'MercadoLibre 3' };
window.mlStoreNames = mlStoreNames;

// ============================================================================
// HELPERS FORMATO & ZONA HORARIA COLOMBIA (UTC-5)
// ============================================================================

const cleanNumber = (val) => {
    if (typeof val === 'number') return isNaN(val) ? 0 : val;
    if (!val) return 0;
    return parseFloat(val.toString().replace(/[^\d.-]/g, '')) || 0;
};

const normalizeText = (str) => {
    return str ? str.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim() : "";
};

const formatCOP = (val) => {
    const num = Math.round(cleanNumber(val));
    const prefix = num < 0 ? '-$' : '$';
    return prefix + Math.abs(num).toLocaleString('es-CO');
};

function getBogotaDateInfo(d) {
    if (!d) return null;
    let dt = null;
    if (d.toDate && typeof d.toDate === 'function') dt = d.toDate();
    else if (d.seconds) dt = new Date(d.seconds * 1000);
    else if (d instanceof Date) dt = d;
    else dt = new Date(d);

    if (isNaN(dt.getTime())) return null;

    const dtf = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Bogota',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    });
    const [year, month, day] = dtf.format(dt).split('-');

    return {
        dateObj: dt,
        dateStr: `${year}-${month}-${day}`, // YYYY-MM-DD
        monthStr: `${year}-${month}`,       // YYYY-MM
        year: parseInt(year, 10),
        month: parseInt(month, 10),
        day: parseInt(day, 10)
    };
}

function formatBogotaDatePretty(dateStr) {
    if (!dateStr) return '--';
    const [y, m, d] = dateStr.split('-').map(Number);
    const date = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
    const formatted = new Intl.DateTimeFormat('es-CO', {
        timeZone: 'America/Bogota',
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric'
    }).format(date);
    return formatted.charAt(0).toUpperCase() + formatted.slice(1);
}

function getMonthNamePretty(monthStr) {
    if (!monthStr) return '--';
    const [y, m] = monthStr.split('-').map(Number);
    const date = new Date(Date.UTC(y, m - 1, 1, 12, 0, 0));
    const formatted = new Intl.DateTimeFormat('es-CO', {
        timeZone: 'America/Bogota',
        month: 'long',
        year: 'numeric'
    }).format(date);
    return formatted.charAt(0).toUpperCase() + formatted.slice(1);
}

// ============================================================================
// CONFIGURACIÓN DE FECHA DE INICIO CONTABLE (CORTE INICIAL)
// ============================================================================

function updateAccountingBadge() {
    if (branchesStartDate) {
        if (badgeStartDate) badgeStartDate.classList.remove('hidden');
        if (badgeStartDateText) badgeStartDateText.textContent = `Desde: ${branchesStartDate}`;
        if (inputStartDate) inputStartDate.value = branchesStartDate;
        if (settingsStatusText) settingsStatusText.textContent = `Corte activo desde ${branchesStartDate}`;
        if (settingsStatusBox) {
            settingsStatusBox.className = "p-3 rounded-xl bg-amber-50 border border-amber-200 text-xs flex items-center justify-between text-amber-900";
        }
    } else {
        if (badgeStartDate) badgeStartDate.classList.add('hidden');
        if (inputStartDate) inputStartDate.value = '';
        if (settingsStatusText) settingsStatusText.textContent = "Todo el historial activo";
        if (settingsStatusBox) {
            settingsStatusBox.className = "p-3 rounded-xl bg-slate-50 border border-slate-100 text-xs flex items-center justify-between text-slate-800";
        }
    }
}

window.openSettingsModal = () => {
    updateAccountingBadge();
    if (settingsModal) settingsModal.classList.remove('hidden');
};

window.closeSettingsModal = () => {
    if (settingsModal) settingsModal.classList.add('hidden');
};

window.saveAccountingStartDate = async () => {
    const val = inputStartDate ? inputStartDate.value : null;
    if (!val) {
        alert("Por favor selecciona una fecha válida para el corte inicial.");
        return;
    }

    const btn = document.getElementById('btn-save-start-date');
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin text-xs"></i> <span>Guardando...</span>';
    }

    try {
        branchesStartDate = val;
        localStorage.setItem('pixeltech_branches_profitability_start_date', val);

        // Persistir en Firestore config/system exclusivamente para canales
        await setDoc(doc(db, "config", "system"), { branchesStartDate: val }, { merge: true });

        updateAccountingBadge();
        calculateFIFOEngine();
        renderMainDashboard();
        window.closeSettingsModal();
    } catch (e) {
        console.error("Error al guardar fecha de inicio de canales:", e);
        alert("Error al guardar la configuración: " + (e.message || e));
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = '<i class="fa-solid fa-check text-xs"></i> <span>Guardar Fecha de Inicio</span>';
        }
    }
};

window.clearAccountingStartDate = async () => {
    if (!confirm("Confirmar Restablecimiento\n\nDeseas eliminar la fecha de corte y analizar todo el historial de canales completo?")) return;

    const btn = document.getElementById('btn-clear-start-date');
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin text-xs"></i> <span>Restableciendo...</span>';
    }

    try {
        branchesStartDate = null;
        localStorage.removeItem('pixeltech_branches_profitability_start_date');

        await setDoc(doc(db, "config", "system"), { branchesStartDate: null }, { merge: true });

        updateAccountingBadge();
        calculateFIFOEngine();
        renderMainDashboard();
        window.closeSettingsModal();
    } catch (e) {
        console.error("Error al restablecer fecha de canales:", e);
        alert("Error al restablecer la configuración: " + (e.message || e));
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = '<i class="fa-solid fa-rotate-left text-xs"></i> <span>Restablecer (Analizar Todo)</span>';
        }
    }
};

// ============================================================================
// IDENTIFICACIÓN INTELIGENTE DE CANALES Y VENTAS NETAS
// ============================================================================

export function getOrderChannel(order) {
    if (!order) return { id: 'manual', name: 'Bodega Principal - Manual (POS)', type: 'manual', icon: 'fa-cash-register' };

    // 1. Sedes físicas adicionales explícitas
    if (order.branchId && order.branchId !== 'principal' && order.branchId !== 'matriz') {
        const branchName = order.branchName || `Sede ${order.branchId}`;
        return { id: `branch_${order.branchId}`, name: branchName, type: 'branch', icon: 'fa-building' };
    }

    // 2. MercadoLibre (Tiendas 1, 2 y 3)
    const isML = (order.source && order.source.startsWith('MERCADOLIBRE')) ||
                 order.channel === 'MERCADOLIBRE' ||
                 (order.paymentMethod && order.paymentMethod.startsWith('MERCADOLIBRE')) ||
                 String(order.id || '').startsWith('ML-') ||
                 String(order.id || '').startsWith('ML1-') ||
                 String(order.id || '').startsWith('ML2-') ||
                 String(order.id || '').startsWith('ML3-') ||
                 Boolean(order.mlOrderId);

    if (isML) {
        let storeNum = 1;
        if (order.source === 'MERCADOLIBRE_STORE3' || order.source === 'MERCADOLIBRE_3' || order.mlStore === 3 || String(order.id || '').startsWith('ML3-')) {
            storeNum = 3;
        } else if (order.source === 'MERCADOLIBRE_STORE2' || order.source === 'MERCADOLIBRE_2' || order.mlStore === 2 || String(order.id || '').startsWith('ML2-')) {
            storeNum = 2;
        } else {
            storeNum = 1;
        }
        const storeLabel = mlStoreNames[storeNum] || `MercadoLibre ${storeNum}`;
        return { id: `meli_${storeNum}`, name: storeLabel, type: 'meli', storeNum, icon: 'fa-handshake' };
    }

    // 3. Bodega Principal - Tienda Web
    const isWeb = order.source === 'TIENDA' || 
                  order.source === 'TIENDA_WEB' || 
                  order.source === 'WEB' || 
                  order.channel === 'WEB' || 
                  order.orderOrigin === 'WEB';

    if (isWeb) {
        return { id: 'web', name: 'Bodega Principal - Tienda Web', type: 'web', icon: 'fa-globe' };
    }

    // 4. Bodega Principal - Manual (POS / Mostrador)
    return { id: 'manual', name: 'Bodega Principal - Manual (POS)', type: 'manual', icon: 'fa-cash-register' };
}

export function getOrderNetSales(order) {
    if (!order) return 0;
    const isML = (order.source && order.source.startsWith('MERCADOLIBRE')) ||
                 order.channel === 'MERCADOLIBRE' ||
                 (order.paymentMethod && order.paymentMethod.startsWith('MERCADOLIBRE')) ||
                 String(order.id || '').startsWith('ML-') ||
                 String(order.id || '').startsWith('ML1-') ||
                 String(order.id || '').startsWith('ML2-') ||
                 String(order.id || '').startsWith('ML3-') ||
                 Boolean(order.mlOrderId);

    if (isML) {
        // En MercadoLibre: descontar comisiones, fletes de vendedor e impuestos, y sumar bonificaciones Flex
        if (order.netAmount !== undefined && order.netAmount !== null && Number(order.netAmount) > 0) {
            return Number(order.netAmount);
        }
        const gross = Number(order.grossTotal) || Number(order.total) || 0;
        const fee = Number(order.mlFee) || 0;
        const taxes = Number(order.mlTaxes) || 0;
        const shipping = Number(order.mlShipping) || 0;
        const bonus = Number(order.mlShippingBonus) || 0;
        const calculatedNet = gross - fee - taxes - shipping + bonus;
        return calculatedNet > 0 ? calculatedNet : gross;
    }

    // Venta física / manual / web directa: el valor total cobrado
    return Number(order.total) || 0;
}

// ============================================================================
// CARGA REACTIVA Y CONEXIÓN A DATOS
// ============================================================================

function checkReadyAndCalculate() {
    if (productsReady && purchasesReady && expensesReady && ordersReady) {
        calculateFIFOEngine();
        renderMainDashboard();
    }
}

async function init() {
    try {
        updateAccountingBadge();

        // 1. Escuchar nombres de tiendas ML y fecha de inicio contable en tiempo real
        onSnapshot(doc(db, "config", "system"), (snap) => {
            if (snap.exists()) {
                const data = snap.data();
                mlStoreNames[1] = data.mlStoreName1 || data.mlStoreNames?.[1] || 'MercadoLibre 1';
                mlStoreNames[2] = data.mlStoreName2 || data.mlStoreNames?.[2] || 'MercadoLibre 2';
                mlStoreNames[3] = data.mlStoreName3 || data.mlStoreNames?.[3] || 'MercadoLibre 3';
                window.mlStoreNames = mlStoreNames;
                updateMLSelectLabels();

                if (data.branchesStartDate !== undefined) {
                    branchesStartDate = data.branchesStartDate;
                    if (branchesStartDate) {
                        localStorage.setItem('pixeltech_branches_profitability_start_date', branchesStartDate);
                    } else {
                        localStorage.removeItem('pixeltech_branches_profitability_start_date');
                    }
                } else if (data.accountingStartDate !== undefined) {
                    branchesStartDate = data.accountingStartDate;
                    if (branchesStartDate) {
                        localStorage.setItem('pixeltech_branches_profitability_start_date', branchesStartDate);
                    } else {
                        localStorage.removeItem('pixeltech_branches_profitability_start_date');
                    }
                }
                updateAccountingBadge();

                if (productsReady && purchasesReady && expensesReady && ordersReady) {
                    calculateFIFOEngine();
                    renderMainDashboard();
                }
            }
        }, (err) => console.warn("Aviso: no se cargó config/system:", err));

        // 2. Suscripción a Productos (Caché central)
        AdminStore.subscribeToProducts((products) => {
            allProducts = products || [];
            productsReady = true;
            checkReadyAndCalculate();
        });

        // 3. Suscripción a Compras (Caché central)
        AdminStore.subscribeToPurchases((purchases) => {
            allPurchases = purchases || [];
            purchasesReady = true;
            checkReadyAndCalculate();
        });

        // 4. Suscripción a Gastos (Caché central)
        AdminStore.subscribeToExpenses((expenses) => {
            allExpenses = expenses || [];
            expensesReady = true;
            checkReadyAndCalculate();
        });

        // 5. Carga de Pedidos desde Firebase
        const ordersSnap = await getDocs(query(collection(db, "orders"), orderBy("createdAt", "asc")));
        allOrders = ordersSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        ordersReady = true;
        checkReadyAndCalculate();

    } catch (e) {
        console.error("Error al inicializar rentabilidad por canales:", e);
    }
}

function updateMLSelectLabels() {
    const optML1 = document.getElementById('opt-trend-ml1');
    const optML2 = document.getElementById('opt-trend-ml2');
    const optML3 = document.getElementById('opt-trend-ml3');
    const modalOptML1 = document.getElementById('modal-opt-ml1');
    const modalOptML2 = document.getElementById('modal-opt-ml2');
    const modalOptML3 = document.getElementById('modal-opt-ml3');

    if (optML1) optML1.textContent = mlStoreNames[1];
    if (optML2) optML2.textContent = mlStoreNames[2];
    if (optML3) optML3.textContent = mlStoreNames[3];
    if (modalOptML1) modalOptML1.textContent = mlStoreNames[1];
    if (modalOptML2) modalOptML2.textContent = mlStoreNames[2];
    if (modalOptML3) modalOptML3.textContent = mlStoreNames[3];
}

// ============================================================================
// MOTOR CONTABLE FIFO MULTI-CANAL
// ============================================================================

function calculateFIFOEngine() {
    processedSalesRecords = [];

    // 1. Indexar productos por ID para acceso O(1)
    const productMap = new Map();
    allProducts.forEach(p => productMap.set(p.id, p));

    // 2. Indexar compras por producto en orden cronológico
    const purchasesByProduct = new Map();
    allPurchases.forEach(p => {
        const pDate = p.createdAt?.toDate ? p.createdAt.toDate() : (p.date?.toDate ? p.date.toDate() : new Date(p.createdAt || p.date || 0));
        if (p.items && Array.isArray(p.items)) {
            p.items.forEach(it => {
                const prodId = it.id || it.productId;
                if (!prodId) return;
                if (!purchasesByProduct.has(prodId)) purchasesByProduct.set(prodId, []);
                purchasesByProduct.get(prodId).push({
                    date: pDate,
                    qty: parseInt(it.quantity, 10) || 0,
                    cost: cleanNumber(it.unitCostBase || it.cost || it.price)
                });
            });
        }
    });

    // Ordenar compras por fecha ascendente para cada producto
    purchasesByProduct.forEach(list => list.sort((a, b) => a.date - b.date));

    // 3. Colas FIFO activas por producto
    const fifoQueues = new Map();
    purchasesByProduct.forEach((list, prodId) => {
        fifoQueues.set(prodId, list.map(item => ({ qty: item.qty, cost: item.cost })));
    });

    // 4. Filtrar y ordenar órdenes no canceladas cronológicamente (respetando fecha de corte contable)
    const validOrders = allOrders.filter(o => {
        const isCancelled = ['CANCELADO', 'RECHAZADO', 'DEVUELTO'].includes(o.status) || o.billingStatus === 'CANCELLED';
        if (isCancelled) return false;

        // Si hay fecha de inicio contable de canales, excluir ventas anteriores
        if (branchesStartDate) {
            const bogotaInfo = getBogotaDateInfo(o.createdAt || o.date);
            if (bogotaInfo && bogotaInfo.dateStr < branchesStartDate) return false;
        }

        return true;
    });

    validOrders.sort((a, b) => {
        const timeA = a.createdAt?.seconds ? a.createdAt.seconds * 1000 : new Date(a.createdAt || 0).getTime();
        const timeB = b.createdAt?.seconds ? b.createdAt.seconds * 1000 : new Date(b.createdAt || 0).getTime();
        return timeA - timeB;
    });

    // 5. Asignar COGS FIFO a cada item vendido
    validOrders.forEach(order => {
        const channelInfo = getOrderChannel(order);
        const orderNetSales = getOrderNetSales(order);
        const bogotaInfo = getBogotaDateInfo(order.createdAt || order.date);
        if (!bogotaInfo) return;

        const items = order.items && Array.isArray(order.items) ? order.items : [];
        if (items.length === 0) return;

        // Calcular venta neta proporcional por item
        const grossItemsTotal = items.reduce((sum, it) => sum + (cleanNumber(it.price) * (parseInt(it.quantity, 10) || 1)), 0);
        const netRatio = grossItemsTotal > 0 ? (orderNetSales / grossItemsTotal) : 1;

        items.forEach((item, idx) => {
            const prodId = item.id || item.productId;
            const product = prodId ? productMap.get(prodId) : null;
            const qty = parseInt(item.quantity, 10) || 1;
            const unitGrossPrice = cleanNumber(item.price);
            const unitNetPrice = unitGrossPrice * netRatio;
            const itemNetSales = unitNetPrice * qty;

            const lastKnownCost = cleanNumber(product?.lastPurchaseCost || product?.costPrice || product?.cost || item.cost || 0);

            // Extraer costo de la cola FIFO
            let costForThisItem = 0;
            let qtyRemaining = qty;
            const queue = fifoQueues.get(prodId);

            if (queue && queue.length > 0) {
                while (qtyRemaining > 0 && queue.length > 0) {
                    const batch = queue[0];
                    if (batch.qty <= qtyRemaining) {
                        costForThisItem += batch.qty * batch.cost;
                        qtyRemaining -= batch.qty;
                        queue.shift();
                    } else {
                        costForThisItem += qtyRemaining * batch.cost;
                        batch.qty -= qtyRemaining;
                        qtyRemaining = 0;
                    }
                }
            }

            // Si se vendió más unidades de las registradas en compras (existencias previas)
            if (qtyRemaining > 0) {
                costForThisItem += (qtyRemaining * lastKnownCost);
            }

            const unitCostFIFO = qty > 0 ? (costForThisItem / qty) : 0;
            const grossProfit = itemNetSales - costForThisItem;
            const marginPct = itemNetSales > 0 ? (grossProfit / itemNetSales) * 100 : 0;

            const orderRef = order.internalOrderNumber ? `#${order.internalOrderNumber}` : (order.id ? order.id.slice(0, 10) : '---');

            processedSalesRecords.push({
                orderId: order.id,
                orderRef: orderRef,
                orderDate: bogotaInfo.dateObj,
                dateStr: bogotaInfo.dateStr,
                monthStr: bogotaInfo.monthStr,
                timeStr: bogotaInfo.dateObj.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'America/Bogota' }),
                channelId: channelInfo.id,
                channelName: channelInfo.name,
                channelType: channelInfo.type,
                productId: prodId || `item_${idx}`,
                productName: item.name || item.title || product?.name || 'Producto General',
                sku: item.sku || product?.sku || '',
                color: item.color || null,
                capacity: item.capacity || null,
                quantity: qty,
                unitGrossPrice: unitGrossPrice,
                unitNetPrice: unitNetPrice,
                unitCostFIFO: unitCostFIFO,
                totalRevenue: itemNetSales,
                totalCOGS: costForThisItem,
                grossProfit: grossProfit,
                marginPct: marginPct
            });
        });
    });

    // 6. Procesar Gastos Operacionales Filtrados (Excluyendo Proveedores e Inventario y respetando fecha de corte)
    processedExpenses = [];
    allExpenses.forEach(exp => {
        const cat = exp.category || 'Otros';
        if (cat === 'Pago Proveedores' || cat === 'Inventario') return;

        const bogotaInfo = getBogotaDateInfo(exp.date || exp.createdAt);
        if (!bogotaInfo) return;

        // Si hay fecha de corte, ignorar gastos anteriores a ella
        if (branchesStartDate && bogotaInfo.dateStr < branchesStartDate) return;

        processedExpenses.push({
            id: exp.id,
            description: exp.description || 'Gasto Operativo',
            amount: cleanNumber(exp.amount),
            category: cat,
            paymentMethod: exp.paymentMethod || '',
            dateStr: bogotaInfo.dateStr,
            monthStr: bogotaInfo.monthStr,
            dateObj: bogotaInfo.dateObj,
            channelId: exp.channelId || null
        });
    });
}

// ============================================================================
// RENDERIZADO DEL DASHBOARD PRINCIPAL
// ============================================================================

function renderMainDashboard() {
    // 1. Filtrar registros por mes si está activo
    let filteredSales = processedSalesRecords;
    let filteredExpenses = processedExpenses;

    if (currentMonthFilter) {
        filteredSales = processedSalesRecords.filter(r => r.monthStr === currentMonthFilter);
        filteredExpenses = processedExpenses.filter(e => e.monthStr === currentMonthFilter);
        currentPeriodTitle.textContent = getMonthNamePretty(currentMonthFilter);
    } else {
        currentPeriodTitle.textContent = branchesStartDate 
            ? `Historial desde ${branchesStartDate}` 
            : "Historial Global (Todos los Tiempos)";
    }

    // 2. Calcular Totales Consolidados del Periodo
    const totalSales = filteredSales.reduce((sum, r) => sum + r.totalRevenue, 0);
    const totalCOGS = filteredSales.reduce((sum, r) => sum + r.totalCOGS, 0);
    const totalExpenses = filteredExpenses.reduce((sum, e) => sum + e.amount, 0);
    const grossProfit = totalSales - totalCOGS;
    const netProfit = grossProfit - totalExpenses;
    const netMarginPct = totalSales > 0 ? (netProfit / totalSales) * 100 : 0;

    const uniqueOrders = new Set(filteredSales.map(r => r.orderId)).size;
    const totalUnits = filteredSales.reduce((sum, r) => sum + r.quantity, 0);

    // 3. Actualizar Tarjetas KPI Superiores
    if (kpiTotalSales) kpiTotalSales.textContent = formatCOP(totalSales);
    if (kpiOrdersCount) kpiOrdersCount.textContent = `${uniqueOrders.toLocaleString()} órdenes`;
    if (kpiUnitsCount) kpiUnitsCount.textContent = `${totalUnits.toLocaleString()} unidades`;

    if (kpiTotalCogs) kpiTotalCogs.textContent = formatCOP(totalCOGS);
    const cogsPct = totalSales > 0 ? Math.round((totalCOGS / totalSales) * 100) : 0;
    if (kpiCogsPercent) kpiCogsPercent.textContent = `${cogsPct}% de las ventas`;

    if (kpiTotalExpenses) kpiTotalExpenses.textContent = formatCOP(totalExpenses);
    if (kpiExpensesCount) kpiExpensesCount.textContent = `${filteredExpenses.length} egresos reg.`;

    if (kpiNetProfit) kpiNetProfit.textContent = formatCOP(netProfit);
    if (kpiGrossProfitSub) kpiGrossProfitSub.textContent = `Bruto: ${formatCOP(grossProfit)}`;

    // Coloreado condicional de la ganancia neta (Verde = Ganancia / Rojo = Pérdida)
    if (kpiNetMarginBadge) {
        kpiNetMarginBadge.textContent = `Margen Neto: ${netMarginPct.toFixed(1)}%`;
        if (netProfit >= 0) {
            kpiNetMarginBadge.className = "text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-md border text-emerald-700 bg-emerald-50 border-emerald-200";
            if (kpiNetProfit) kpiNetProfit.className = "text-2xl font-black tracking-tight text-emerald-700";
            if (kpiNetProfitIcon) kpiNetProfitIcon.className = "w-11 h-11 rounded-xl bg-emerald-50 text-emerald-600 border border-emerald-100 flex items-center justify-center text-lg shrink-0";
            if (cardNetProfit) cardNetProfit.className = "bg-white p-5 lg:p-6 rounded-2xl border border-emerald-200/80 shadow-xs relative overflow-hidden bg-gradient-to-br from-white to-emerald-50/20";
        } else {
            kpiNetMarginBadge.className = "text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-md border text-rose-700 bg-rose-50 border-rose-200";
            if (kpiNetProfit) kpiNetProfit.className = "text-2xl font-black tracking-tight text-rose-700";
            if (kpiNetProfitIcon) kpiNetProfitIcon.className = "w-11 h-11 rounded-xl bg-rose-50 text-rose-600 border border-rose-100 flex items-center justify-center text-lg shrink-0";
            if (cardNetProfit) cardNetProfit.className = "bg-white p-5 lg:p-6 rounded-2xl border border-rose-200/80 shadow-xs relative overflow-hidden bg-gradient-to-br from-white to-rose-50/20";
        }
    }

    // 4. Agrupar Métricas por Canal
    const channelsMap = new Map();

    const defaultChannels = [
        { id: 'manual', name: 'Bodega Principal - Manual (POS)', icon: 'fa-cash-register' },
        { id: 'web', name: 'Bodega Principal - Tienda Web', icon: 'fa-globe' },
        { id: 'meli_1', name: mlStoreNames[1] || 'MercadoLibre 1', icon: 'fa-handshake' },
        { id: 'meli_2', name: mlStoreNames[2] || 'MercadoLibre 2', icon: 'fa-handshake' },
        { id: 'meli_3', name: mlStoreNames[3] || 'MercadoLibre 3', icon: 'fa-handshake' }
    ];

    defaultChannels.forEach(c => {
        channelsMap.set(c.id, {
            id: c.id,
            name: c.name,
            icon: c.icon,
            orderIds: new Set(),
            units: 0,
            sales: 0,
            cogs: 0,
            assignedExpenses: 0
        });
    });

    filteredSales.forEach(r => {
        if (!channelsMap.has(r.channelId)) {
            channelsMap.set(r.channelId, {
                id: r.channelId,
                name: r.channelName,
                icon: 'fa-store',
                orderIds: new Set(),
                units: 0,
                sales: 0,
                cogs: 0,
                assignedExpenses: 0
            });
        }
        const ch = channelsMap.get(r.channelId);
        ch.orderIds.add(r.orderId);
        ch.units += r.quantity;
        ch.sales += r.totalRevenue;
        ch.cogs += r.totalCOGS;
    });

    let transversalExpenses = 0;
    filteredExpenses.forEach(e => {
        if (e.channelId && channelsMap.has(e.channelId)) {
            channelsMap.get(e.channelId).assignedExpenses += e.amount;
        } else {
            transversalExpenses += e.amount;
        }
    });

    // 5. Renderizar Tarjetas de Puntos de Venta
    renderChannelCards(Array.from(channelsMap.values()));

    // 6. Renderizar Tabla Comparativa
    renderComparativeTable(Array.from(channelsMap.values()), transversalExpenses, totalSales, totalCOGS, totalExpenses, netProfit, netMarginPct);

    // 7. Renderizar Tabla de Tendencias Históricas
    renderHistoricalTrends();
}

function renderChannelCards(channels) {
    if (!channelCardsGrid) return;
    if (channelsCountLbl) channelsCountLbl.textContent = `${channels.length} canales analizados`;

    const html = channels.map(c => {
        const gross = c.sales - c.cogs;
        const grossMargin = c.sales > 0 ? (gross / c.sales) * 100 : 0;
        const isMeli = c.id.startsWith('meli_');
        const badgeColor = isMeli ? 'bg-[#FFE600] text-black border-yellow-400' : (c.id === 'web' ? 'bg-cyan-50 text-cyan-800 border-cyan-200' : 'bg-slate-100 text-slate-800 border-slate-200');

        return `
            <div class="bg-white p-5 rounded-2xl border border-slate-200/80 shadow-xs hover:shadow-md transition-shadow flex flex-col justify-between">
                <div>
                    <!-- Header Tarjeta -->
                    <div class="flex items-start justify-between gap-3 mb-4">
                        <div class="flex items-center gap-2.5 min-w-0">
                            <div class="w-10 h-10 rounded-xl bg-slate-100 text-slate-700 flex items-center justify-center text-sm shrink-0">
                                <i class="fa-solid ${c.icon}"></i>
                            </div>
                            <div class="min-w-0">
                                <h4 class="font-black text-sm text-slate-900 truncate" title="${c.name}">${c.name}</h4>
                                <span class="inline-flex items-center text-[9px] font-black uppercase px-2 py-0.5 rounded border ${badgeColor} mt-0.5">
                                    ${c.id.toUpperCase()}
                                </span>
                            </div>
                        </div>
                        <span class="text-xs font-bold text-slate-400 shrink-0">
                            ${c.orderIds.size} órdenes
                        </span>
                    </div>

                    <!-- Métricas -->
                    <div class="space-y-2 py-3 border-y border-slate-100 text-xs">
                        <div class="flex justify-between font-medium">
                            <span class="text-slate-500">Ventas Netas:</span>
                            <span class="font-bold text-slate-900">${formatCOP(c.sales)}</span>
                        </div>
                        <div class="flex justify-between font-medium">
                            <span class="text-slate-500">Costo FIFO:</span>
                            <span class="font-semibold text-amber-700">-${formatCOP(c.cogs)}</span>
                        </div>
                        <div class="flex justify-between font-black text-sm pt-1 border-t border-dashed border-slate-100">
                            <span class="text-slate-700">Utilidad Bruta:</span>
                            <span class="${gross >= 0 ? 'text-emerald-700' : 'text-rose-600'}">${formatCOP(gross)}</span>
                        </div>
                    </div>
                </div>

                <!-- Footer Tarjeta con Botón Ver por Día -->
                <div class="mt-4 pt-2 flex items-center justify-between">
                    <span class="text-xs font-bold ${grossMargin >= 20 ? 'text-emerald-700' : (grossMargin > 0 ? 'text-amber-700' : 'text-rose-600')}">
                        Margen: ${grossMargin.toFixed(1)}%
                    </span>
                    <button onclick="window.openDailyModal('${c.id}')" 
                        class="px-3 py-1.5 rounded-lg text-xs font-bold text-slate-700 hover:text-white bg-slate-100 hover:bg-slate-900 transition flex items-center gap-1.5 active:scale-95">
                        <i class="fa-solid fa-calendar-day text-[10px]"></i>
                        <span>Ver por Día</span>
                    </button>
                </div>
            </div>
        `;
    }).join('');

    channelCardsGrid.innerHTML = html;
}

function renderComparativeTable(channels, transversalExpenses, totalSales, totalCOGS, totalExpenses, totalNetProfit, totalNetMargin) {
    if (!comparativeTableBody) return;

    let rowsHtml = channels.map(c => {
        const gross = c.sales - c.cogs;
        const grossMargin = c.sales > 0 ? (gross / c.sales) * 100 : 0;
        const net = gross - c.assignedExpenses;
        const netMargin = c.sales > 0 ? (net / c.sales) * 100 : 0;

        return `
            <tr class="hover:bg-slate-50/70 transition-colors border-b border-slate-100 last:border-0">
                <td class="px-6 py-3.5 font-bold text-xs text-slate-800 flex items-center gap-2">
                    <i class="fa-solid ${c.icon} text-slate-400 text-xs"></i>
                    <span>${c.name}</span>
                </td>
                <td class="px-4 py-3.5 text-center text-slate-600 font-bold">${c.orderIds.size}</td>
                <td class="px-4 py-3.5 text-center text-slate-600 font-medium">${c.units}</td>
                <td class="px-6 py-3.5 text-right font-black text-slate-900">${formatCOP(c.sales)}</td>
                <td class="px-6 py-3.5 text-right font-bold text-amber-700">-${formatCOP(c.cogs)}</td>
                <td class="px-6 py-3.5 text-right font-black ${gross >= 0 ? 'text-emerald-700' : 'text-rose-600'}">${formatCOP(gross)}</td>
                <td class="px-4 py-3.5 text-center font-bold text-xs ${grossMargin >= 20 ? 'text-emerald-700' : 'text-amber-700'}">${grossMargin.toFixed(1)}%</td>
                <td class="px-6 py-3.5 text-right font-semibold text-rose-600">-${formatCOP(c.assignedExpenses)}</td>
                <td class="px-6 py-3.5 text-right font-black ${net >= 0 ? 'text-emerald-700' : 'text-rose-600'}">${formatCOP(net)}</td>
                <td class="px-4 py-3.5 text-center">
                    <span class="inline-flex px-2 py-0.5 rounded text-[10px] font-black ${netMargin >= 15 ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : (netMargin > 0 ? 'bg-amber-50 text-amber-700 border border-amber-200' : 'bg-rose-50 text-rose-700 border border-rose-200')}">
                        ${netMargin.toFixed(1)}%
                    </span>
                </td>
            </tr>
        `;
    }).join('');

    // Fila de Gastos Transversales Generales
    if (transversalExpenses > 0) {
        rowsHtml += `
            <tr class="bg-rose-50/30 border-b border-rose-100 text-rose-900 font-medium">
                <td class="px-6 py-3 text-xs italic" colspan="7">
                    Gastos Operacionales Generales Transversales (Nómina Matriz, Arriendos, Servicios Generales no vinculados a un canal único)
                </td>
                <td class="px-6 py-3 text-right font-black text-rose-700">-${formatCOP(transversalExpenses)}</td>
                <td class="px-6 py-3 text-right font-bold text-rose-700">-${formatCOP(transversalExpenses)}</td>
                <td class="px-4 py-3 text-center text-[10px] uppercase font-bold text-slate-400">Transversal</td>
            </tr>
        `;
    }

    // Fila Consolidada Total
    const grossTotal = totalSales - totalCOGS;
    const grossMarginTotal = totalSales > 0 ? (grossTotal / totalSales) * 100 : 0;
    const allUniqueOrders = new Set(processedSalesRecords.filter(r => currentMonthFilter ? r.monthStr === currentMonthFilter : true).map(r => r.orderId)).size;
    const allUnits = processedSalesRecords.filter(r => currentMonthFilter ? r.monthStr === currentMonthFilter : true).reduce((s, r) => s + r.quantity, 0);

    rowsHtml += `
        <tr class="bg-slate-900 text-white font-black border-t-2 border-slate-900">
            <td class="px-6 py-4 uppercase tracking-wider text-xs">Total Consolidado</td>
            <td class="px-4 py-4 text-center text-cyan-300">${allUniqueOrders}</td>
            <td class="px-4 py-4 text-center text-cyan-300">${allUnits}</td>
            <td class="px-6 py-4 text-right text-white">${formatCOP(totalSales)}</td>
            <td class="px-6 py-4 text-right text-amber-300">-${formatCOP(totalCOGS)}</td>
            <td class="px-6 py-4 text-right text-emerald-300">${formatCOP(grossTotal)}</td>
            <td class="px-4 py-4 text-center text-emerald-300">${grossMarginTotal.toFixed(1)}%</td>
            <td class="px-6 py-4 text-right text-rose-300">-${formatCOP(totalExpenses)}</td>
            <td class="px-6 py-4 text-right ${totalNetProfit >= 0 ? 'text-emerald-400' : 'text-rose-400'}">${formatCOP(totalNetProfit)}</td>
            <td class="px-4 py-4 text-center">
                <span class="inline-flex px-2 py-0.5 rounded text-[10px] font-black ${totalNetProfit >= 0 ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-400/30' : 'bg-rose-500/20 text-rose-300 border border-rose-400/30'}">
                    ${totalNetMargin.toFixed(1)}%
                </span>
            </td>
        </tr>
    `;

    comparativeTableBody.innerHTML = rowsHtml;
}

function renderHistoricalTrends() {
    if (!trendsTableBody) return;

    let targetSales = processedSalesRecords;
    if (trendChannelFilter !== 'ALL') {
        targetSales = targetSales.filter(r => r.channelId === trendChannelFilter);
    }

    // Agrupar por mes
    const monthsMap = new Map();
    targetSales.forEach(r => {
        if (!monthsMap.has(r.monthStr)) {
            monthsMap.set(r.monthStr, {
                monthStr: r.monthStr,
                orderIds: new Set(),
                sales: 0,
                cogs: 0
            });
        }
        const m = monthsMap.get(r.monthStr);
        m.orderIds.add(r.orderId);
        m.sales += r.totalRevenue;
        m.cogs += r.totalCOGS;
    });

    const sortedMonths = Array.from(monthsMap.values()).sort((a, b) => b.monthStr.localeCompare(a.monthStr));

    if (sortedMonths.length === 0) {
        trendsTableBody.innerHTML = `<tr><td colspan="7" class="p-8 text-center text-slate-400 font-bold">No hay registros históricos para este canal.</td></tr>`;
        return;
    }

    const maxSales = Math.max(...sortedMonths.map(m => m.sales), 1);

    const html = sortedMonths.map(m => {
        const gross = m.sales - m.cogs;
        const margin = m.sales > 0 ? (gross / m.sales) * 100 : 0;
        const progressPct = Math.min(100, Math.round((m.sales / maxSales) * 100));

        return `
            <tr class="hover:bg-slate-50/70 transition-colors border-b border-slate-100 last:border-0">
                <td class="px-6 py-3.5 font-bold text-xs text-slate-900">${getMonthNamePretty(m.monthStr)}</td>
                <td class="px-4 py-3.5 text-center font-bold text-slate-600">${m.orderIds.size}</td>
                <td class="px-6 py-3.5 text-right font-black text-slate-900">${formatCOP(m.sales)}</td>
                <td class="px-6 py-3.5 text-right font-bold text-amber-700">-${formatCOP(m.cogs)}</td>
                <td class="px-6 py-3.5 text-right font-black ${gross >= 0 ? 'text-emerald-700' : 'text-rose-600'}">${formatCOP(gross)}</td>
                <td class="px-4 py-3.5 text-center font-bold text-xs ${margin >= 20 ? 'text-emerald-700' : 'text-amber-700'}">${margin.toFixed(1)}%</td>
                <td class="px-6 py-3.5">
                    <div class="w-full bg-slate-100 rounded-full h-2 overflow-hidden">
                        <div class="h-2 rounded-full ${gross >= 0 ? 'bg-cyan-500' : 'bg-rose-500'}" style="width: ${progressPct}%"></div>
                    </div>
                </td>
            </tr>
        `;
    }).join('');

    trendsTableBody.innerHTML = html;
}

// ============================================================================
// AUDITORÍA DIARIA DETALLADA (MODAL VER POR DÍA)
// ============================================================================

window.openDailyModal = (channelId = null) => {
    if (channelId) {
        modalChannelFilter = channelId;
        if (modalChannelSelect) modalChannelSelect.value = channelId;
    } else {
        modalChannelFilter = modalChannelSelect ? modalChannelSelect.value : 'ALL';
    }

    if (currentMonthFilter && (!dailyDateFrom.value || !dailyDateTo.value)) {
        const [y, m] = currentMonthFilter.split('-').map(Number);
        const lastDay = new Date(y, m, 0).getDate();
        dailyDateFrom.value = `${currentMonthFilter}-01`;
        dailyDateTo.value = `${currentMonthFilter}-${String(lastDay).padStart(2, '0')}`;
        modalFromFilter = dailyDateFrom.value;
        modalToFilter = dailyDateTo.value;
    }

    renderDailyAccordion();
    if (dailyModal) dailyModal.classList.remove('hidden');
};

window.closeDailyModal = () => {
    if (dailyModal) dailyModal.classList.add('hidden');
};

window.setDailyQuickRange = (rangeType) => {
    const today = new Date();
    const dtf = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota', year: 'numeric', month: '2-digit', day: '2-digit' });
    const todayStr = dtf.format(today);

    switch (rangeType) {
        case 'today':
            dailyDateFrom.value = todayStr;
            dailyDateTo.value = todayStr;
            break;
        case 'yesterday': {
            const yest = new Date(today.getTime() - 24 * 60 * 60 * 1000);
            const yestStr = dtf.format(yest);
            dailyDateFrom.value = yestStr;
            dailyDateTo.value = yestStr;
            break;
        }
        case 'last7': {
            const last7 = new Date(today.getTime() - 6 * 24 * 60 * 60 * 1000);
            dailyDateFrom.value = dtf.format(last7);
            dailyDateTo.value = todayStr;
            break;
        }
        case 'thisMonth': {
            const [y, m] = todayStr.split('-');
            dailyDateFrom.value = `${y}-${m}-01`;
            dailyDateTo.value = todayStr;
            break;
        }
        case 'all':
        default:
            dailyDateFrom.value = '';
            dailyDateTo.value = '';
            break;
    }

    modalFromFilter = dailyDateFrom.value;
    modalToFilter = dailyDateTo.value;
    renderDailyAccordion();
};

function renderDailyAccordion() {
    if (!dailyAccordionList) return;

    let records = processedSalesRecords;

    if (modalChannelFilter !== 'ALL') {
        records = records.filter(r => r.channelId === modalChannelFilter);
    }

    if (modalFromFilter) {
        records = records.filter(r => r.dateStr >= modalFromFilter);
    }
    if (modalToFilter) {
        records = records.filter(r => r.dateStr <= modalToFilter);
    }

    const term = normalizeText(modalProductTerm);
    if (term.length > 0) {
        records = records.filter(r => {
            const name = normalizeText(r.productName);
            const sku = normalizeText(r.sku);
            return name.includes(term) || sku.includes(term);
        });
    }

    const subSales = records.reduce((s, r) => s + r.totalRevenue, 0);
    const subCOGS = records.reduce((s, r) => s + r.totalCOGS, 0);
    const subProfit = subSales - subCOGS;
    const subMargin = subSales > 0 ? (subProfit / subSales) * 100 : 0;

    if (dailySubSales) dailySubSales.textContent = formatCOP(subSales);
    if (dailySubCogs) dailySubCogs.textContent = formatCOP(subCOGS);
    if (dailySubProfit) dailySubProfit.textContent = formatCOP(subProfit);
    if (dailySubMargin) dailySubMargin.textContent = `${subMargin.toFixed(1)}%`;

    if (records.length === 0) {
        dailyAccordionList.innerHTML = `
            <div class="text-center p-12 text-slate-400 font-bold text-xs bg-slate-50/50 rounded-2xl border border-dashed border-slate-200">
                <i class="fa-solid fa-calendar-xmark text-2xl text-slate-300 mb-2 block"></i>
                No se encontraron ventas para los filtros seleccionados.
            </div>
        `;
        return;
    }

    const daysMap = new Map();
    records.forEach(r => {
        if (!daysMap.has(r.dateStr)) {
            daysMap.set(r.dateStr, {
                dateStr: r.dateStr,
                channels: new Set(),
                orderIds: new Set(),
                items: [],
                sales: 0,
                cogs: 0
            });
        }
        const day = daysMap.get(r.dateStr);
        day.channels.add(r.channelName);
        day.orderIds.add(r.orderId);
        day.items.push(r);
        day.sales += r.totalRevenue;
        day.cogs += r.totalCOGS;
    });

    const sortedDays = Array.from(daysMap.values()).sort((a, b) => b.dateStr.localeCompare(a.dateStr));

    const html = sortedDays.map(day => {
        const profit = day.sales - day.cogs;
        const margin = day.sales > 0 ? (profit / day.sales) * 100 : 0;
        const isExpanded = expandedDays.has(day.dateStr);
        const channelTags = Array.from(day.channels).map(c => `
            <span class="inline-flex px-1.5 py-0.5 rounded text-[9px] font-black uppercase bg-slate-100 text-slate-700 border border-slate-200">
                ${c}
            </span>
        `).join(' ');

        const itemsRows = day.items.map(it => `
            <tr class="hover:bg-slate-50/80 transition-colors border-b border-slate-100 last:border-0 text-[11px]">
                <td class="py-2.5 px-3 whitespace-nowrap text-slate-500 font-mono text-[10px]">
                    <span class="font-bold text-slate-800">${it.timeStr}</span>
                    <span class="text-slate-400 ml-1">(${it.orderRef})</span>
                </td>
                <td class="py-2.5 px-3">
                    <span class="inline-flex px-1.5 py-0.5 rounded text-[9px] font-bold uppercase bg-slate-100 text-slate-600">
                        ${it.channelName}
                    </span>
                </td>
                <td class="py-2.5 px-3">
                    <p class="font-bold text-slate-800 leading-tight">${it.productName}</p>
                    <p class="text-[10px] text-slate-400">${it.sku ? 'SKU: ' + it.sku : ''}${it.color ? ' | ' + it.color : ''}</p>
                </td>
                <td class="py-2.5 px-3 text-center font-bold text-slate-700">${it.quantity}</td>
                <td class="py-2.5 px-3 text-right font-medium text-slate-800">${formatCOP(it.unitNetPrice)}</td>
                <td class="py-2.5 px-3 text-right font-medium text-amber-700">-${formatCOP(it.unitCostFIFO)}</td>
                <td class="py-2.5 px-3 text-right font-black ${it.grossProfit >= 0 ? 'text-emerald-700' : 'text-rose-600'}">
                    ${formatCOP(it.grossProfit)}
                </td>
                <td class="py-2.5 px-3 text-center font-bold text-[10px] ${it.marginPct >= 20 ? 'text-emerald-700' : 'text-amber-700'}">
                    ${it.marginPct.toFixed(1)}%
                </td>
            </tr>
        `).join('');

        return `
            <div class="bg-white rounded-2xl border border-slate-200/80 shadow-xs overflow-hidden">
                <div onclick="window.toggleDayAccordion('${day.dateStr}')" 
                    class="p-4 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 cursor-pointer hover:bg-slate-50/80 transition-colors select-none">
                    
                    <div class="flex items-center gap-3">
                        <div class="w-8 h-8 rounded-lg ${profit >= 0 ? 'bg-emerald-50 text-emerald-600' : 'bg-rose-50 text-rose-600'} flex items-center justify-center text-xs shrink-0">
                            <i class="fa-solid fa-calendar-day"></i>
                        </div>
                        <div>
                            <div class="flex items-center gap-2 flex-wrap">
                                <h4 class="font-black text-xs text-slate-900">${formatBogotaDatePretty(day.dateStr)}</h4>
                                ${channelTags}
                            </div>
                            <p class="text-[10px] font-bold text-slate-400 mt-0.5">${day.orderIds.size} órdenes | ${day.items.reduce((s, i) => s + i.quantity, 0)} unidades vendidas</p>
                        </div>
                    </div>

                    <div class="flex items-center gap-4 text-xs font-medium w-full sm:w-auto justify-between sm:justify-end border-t sm:border-t-0 pt-2 sm:pt-0 border-slate-100">
                        <div>
                            <span class="text-[9px] uppercase text-slate-400 font-black block">Ventas</span>
                            <span class="font-black text-slate-900">${formatCOP(day.sales)}</span>
                        </div>
                        <div>
                            <span class="text-[9px] uppercase text-slate-400 font-black block">Costo FIFO</span>
                            <span class="font-bold text-amber-700">-${formatCOP(day.cogs)}</span>
                        </div>
                        <div>
                            <span class="text-[9px] uppercase text-slate-400 font-black block">Utilidad</span>
                            <span class="font-black ${profit >= 0 ? 'text-emerald-700' : 'text-rose-600'}">${formatCOP(profit)}</span>
                        </div>
                        <div class="text-center min-w-[50px]">
                            <span class="text-[9px] uppercase text-slate-400 font-black block">Margen</span>
                            <span class="inline-flex px-1.5 py-0.5 rounded text-[10px] font-black ${margin >= 20 ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-amber-50 text-amber-700 border border-amber-200'}">
                                ${margin.toFixed(1)}%
                            </span>
                        </div>
                        <div class="w-6 h-6 rounded-full bg-slate-100 text-slate-500 flex items-center justify-center text-[10px] transition-transform ${isExpanded ? 'rotate-180 bg-slate-900 text-white' : ''}">
                            <i class="fa-solid fa-chevron-down"></i>
                        </div>
                    </div>
                </div>

                <div class="${isExpanded ? '' : 'hidden'} border-t border-slate-100 bg-slate-50/30 overflow-x-auto">
                    <table class="w-full text-left border-collapse">
                        <thead class="text-[9px] uppercase font-black text-slate-400 tracking-wider bg-slate-50/80 border-b border-slate-100">
                            <tr>
                                <th class="py-2.5 px-3">Hora / Pedido</th>
                                <th class="py-2.5 px-3">Canal</th>
                                <th class="py-2.5 px-3">Producto / Variante</th>
                                <th class="py-2.5 px-3 text-center">Cant.</th>
                                <th class="py-2.5 px-3 text-right">Venta Neta Unit.</th>
                                <th class="py-2.5 px-3 text-right">Costo FIFO Unit.</th>
                                <th class="py-2.5 px-3 text-right">Ganancia</th>
                                <th class="py-2.5 px-3 text-center">Margen</th>
                            </tr>
                        </thead>
                        <tbody class="divide-y divide-slate-100 font-medium">
                            ${itemsRows}
                        </tbody>
                    </table>
                </div>
            </div>
        `;
    }).join('');

    dailyAccordionList.innerHTML = html;
}

window.toggleDayAccordion = (dateStr) => {
    if (expandedDays.has(dateStr)) {
        expandedDays.delete(dateStr);
    } else {
        expandedDays.add(dateStr);
    }
    renderDailyAccordion();
};

// ============================================================================
// EVENT LISTENERS
// ============================================================================

if (filterMonthInput) {
    filterMonthInput.addEventListener('change', (e) => {
        currentMonthFilter = e.target.value || null;
        renderMainDashboard();
    });
}

if (btnClearDate) {
    btnClearDate.addEventListener('click', () => {
        if (filterMonthInput) filterMonthInput.value = "";
        currentMonthFilter = null;
        renderMainDashboard();
    });
}

if (trendChannelSelect) {
    trendChannelSelect.addEventListener('change', (e) => {
        trendChannelFilter = e.target.value;
        renderHistoricalTrends();
    });
}

if (modalChannelSelect) {
    modalChannelSelect.addEventListener('change', (e) => {
        modalChannelFilter = e.target.value;
        renderDailyAccordion();
    });
}

if (modalProductSearch) {
    modalProductSearch.addEventListener('input', (e) => {
        modalProductTerm = e.target.value;
        renderDailyAccordion();
    });
}

if (dailyDateFrom) {
    dailyDateFrom.addEventListener('change', (e) => {
        modalFromFilter = e.target.value;
        renderDailyAccordion();
    });
}

if (dailyDateTo) {
    dailyDateTo.addEventListener('change', (e) => {
        modalToFilter = e.target.value;
        renderDailyAccordion();
    });
}

window.refreshProfitabilityData = async () => {
    if (syncIcon) syncIcon.classList.add('fa-spin');
    try {
        await Promise.all([
            AdminStore.forceSyncExpenses(),
            (async () => {
                const ordersSnap = await getDocs(query(collection(db, "orders"), orderBy("createdAt", "asc")));
                allOrders = ordersSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            })()
        ]);
        calculateFIFOEngine();
        renderMainDashboard();
    } catch (e) {
        console.error("Error al refrescar rentabilidad:", e);
    } finally {
        setTimeout(() => {
            if (syncIcon) syncIcon.classList.remove('fa-spin');
        }, 600);
    }
};

// Arrancar inicialización
init();
