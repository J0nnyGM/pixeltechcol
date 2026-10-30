import { db, collection, getDocs, query, orderBy, onSnapshot, doc, setDoc } from './firebase-init.js';
import { loadAdminSidebar } from './admin-ui.js';
import { AdminStore } from './admin-store.js';

loadAdminSidebar();

// ============================================================================
// DOM ELEMENTS
// ============================================================================

// Period Filter & Cutoff Badge
const filterMonthInput = document.getElementById('filter-month');
const btnClearDate = document.getElementById('btn-clear-date');
const currentPeriodTitle = document.getElementById('current-period-title');
const badgeStartDate = document.getElementById('badge-start-date');
const badgeStartDateText = document.getElementById('badge-start-date-text');

// Header Actions
const btnBackGeneral = document.getElementById('btn-back-general');
const syncIcon = document.getElementById('sync-icon');

// Top KPIs
const kpiStockValue = document.getElementById('kpi-stock-value');
const kpiStockUnits = document.getElementById('kpi-stock-units');
const kpiTotalRevenue = document.getElementById('kpi-total-revenue');
const kpiUnitsSold = document.getElementById('kpi-units-sold');
const kpiTotalCogs = document.getElementById('kpi-total-cogs');
const kpiCogsPct = document.getElementById('kpi-cogs-pct');
const kpiTotalProfit = document.getElementById('kpi-total-profit');
const kpiProfitMarginBadge = document.getElementById('kpi-profit-margin-badge');
const kpiCatalogCount = document.getElementById('kpi-catalog-count');
const kpiProfitIcon = document.getElementById('kpi-profit-icon');

// Top 5 Lists
const topSalesList = document.getElementById('top-sales-list');
const topProfitList = document.getElementById('top-profit-list');

// Catalog Table Controls
const catalogSearch = document.getElementById('catalog-search');
const catalogFilterCategory = document.getElementById('catalog-filter-category');
const catalogSortSelect = document.getElementById('catalog-sort-select');
const catalogTableBody = document.getElementById('catalog-table-body');
const catalogPageInfo = document.getElementById('catalog-page-info');
const catalogPageSizeSelect = document.getElementById('catalog-page-size');
const catalogBtnPrev = document.getElementById('catalog-btn-prev');
const catalogPageCurrent = document.getElementById('catalog-page-current');
const catalogBtnNext = document.getElementById('catalog-btn-next');

// Specific Product Dashboard
const generalDashboard = document.getElementById('general-dashboard');
const specificDashboard = document.getElementById('specific-dashboard');
const dashImg = document.getElementById('dash-img');
const dashName = document.getElementById('dash-name');
const dashSku = document.getElementById('dash-sku');
const dashCategoryBadge = document.getElementById('dash-category-badge');

const dashStockCurrent = document.getElementById('dash-stock-current');
const dashAvgCost = document.getElementById('dash-avg-cost');
const dashStockValue = document.getElementById('dash-stock-value');
const dashLastCost = document.getElementById('dash-last-cost');

const dashQtySold = document.getElementById('dash-qty-sold');
const dashRevenue = document.getElementById('dash-revenue');
const dashCogs = document.getElementById('dash-cogs');
const dashProfit = document.getElementById('dash-profit');
const dashMargin = document.getElementById('dash-margin');

// Product Timeline
const timelineFilterType = document.getElementById('timeline-filter-type');
const timelinePageSizeSelect = document.getElementById('timeline-page-size');
const timelineTableBody = document.getElementById('timeline-table-body');
const timelineViewRange = document.getElementById('timeline-view-range');
const timelineTotalCount = document.getElementById('timeline-total-count');
const timelinePageNum = document.getElementById('timeline-page-num');
const timelineTotalPages = document.getElementById('timeline-total-pages');
const btnTimelinePrev = document.getElementById('btn-timeline-prev');
const btnTimelineNext = document.getElementById('btn-timeline-next');

// Settings Modal Elements
const settingsModal = document.getElementById('settings-modal');
const inputStartDate = document.getElementById('input-start-date');
const settingsStatusText = document.getElementById('settings-status-text');
const settingsStatusBox = document.getElementById('settings-status-box');

// ============================================================================
// STATE EN RAM
// ============================================================================

let productsReady = false;
let purchasesReady = false;
let ordersReady = false;

let allProducts = [];
let allPurchases = [];
let allOrders = [];
let productMetrics = [];

// Filtros Globales
let currentMonthFilter = null; // null = Historial Global
let productsStartDate = localStorage.getItem('pixeltech_products_profitability_start_date') || null;

// Paginación y Filtros del Catálogo
let catalogSearchTerm = '';
let catalogSelectedCategory = '';
let catalogSort = 'profit-desc';
let catalogCurrentPage = 1;
let catalogPageSize = 15;

// Estado del Producto Seleccionado
let currentTimelineProduct = null;
let currentTimelineType = 'ALL';
let timelineCurrentPage = 1;
let timelinePageSize = 10;

// ============================================================================
// HELPERS FORMATO & ZONA HORARIA COLOMBIA
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
// CONFIGURACIÓN DE FECHA DE CORTE CONTABLE
// ============================================================================

function updateAccountingBadge() {
    if (productsStartDate) {
        if (badgeStartDate) badgeStartDate.classList.remove('hidden');
        if (badgeStartDateText) badgeStartDateText.textContent = `Desde: ${productsStartDate}`;
        if (inputStartDate) inputStartDate.value = productsStartDate;
        if (settingsStatusText) settingsStatusText.textContent = `Corte activo desde ${productsStartDate}`;
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
        productsStartDate = val;
        localStorage.setItem('pixeltech_products_profitability_start_date', val);

        await setDoc(doc(db, "config", "system"), { productsStartDate: val }, { merge: true });

        updateAccountingBadge();
        calculateFIFOEngine();
        renderGeneralDashboard();
        window.closeSettingsModal();
    } catch (e) {
        console.error("Error al guardar fecha de inicio de catálogo:", e);
        alert("Error al guardar la configuración: " + (e.message || e));
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = '<i class="fa-solid fa-check text-xs"></i> <span>Guardar Fecha de Inicio</span>';
        }
    }
};

window.clearAccountingStartDate = async () => {
    if (!confirm("Confirmar Restablecimiento\n\nDeseas eliminar la fecha de corte y analizar todo el historial de productos completo?")) return;

    const btn = document.getElementById('btn-clear-start-date');
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin text-xs"></i> <span>Restableciendo...</span>';
    }

    try {
        productsStartDate = null;
        localStorage.removeItem('pixeltech_products_profitability_start_date');

        await setDoc(doc(db, "config", "system"), { productsStartDate: null }, { merge: true });

        updateAccountingBadge();
        calculateFIFOEngine();
        renderGeneralDashboard();
        window.closeSettingsModal();
    } catch (e) {
        console.error("Error al restablecer fecha de catálogo:", e);
        alert("Error al restablecer la configuración: " + (e.message || e));
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = '<i class="fa-solid fa-rotate-left text-xs"></i> <span>Restablecer (Analizar Todo)</span>';
        }
    }
};

// ============================================================================
// CARGA Y CONEXIÓN REACTIVA
// ============================================================================

function checkReadyAndCalculate() {
    if (productsReady && purchasesReady && ordersReady) {
        populateCategoryFilter();
        calculateFIFOEngine();
        renderGeneralDashboard();
    }
}

async function init() {
    try {
        updateAccountingBadge();

        if (catalogPageSizeSelect) {
            catalogPageSize = parseInt(catalogPageSizeSelect.value, 10) || 15;
        }

        // 1. Escuchar fecha de inicio contable en tiempo real desde config/system
        onSnapshot(doc(db, "config", "system"), (snap) => {
            if (snap.exists()) {
                const data = snap.data();
                if (data.productsStartDate !== undefined) {
                    productsStartDate = data.productsStartDate;
                    if (productsStartDate) {
                        localStorage.setItem('pixeltech_products_profitability_start_date', productsStartDate);
                    } else {
                        localStorage.removeItem('pixeltech_products_profitability_start_date');
                    }
                } else if (data.accountingStartDate !== undefined) {
                    productsStartDate = data.accountingStartDate;
                    if (productsStartDate) {
                        localStorage.setItem('pixeltech_products_profitability_start_date', productsStartDate);
                    } else {
                        localStorage.removeItem('pixeltech_products_profitability_start_date');
                    }
                }
                updateAccountingBadge();
                if (productsReady && purchasesReady && ordersReady) {
                    calculateFIFOEngine();
                    renderGeneralDashboard();
                }
            }
        }, (err) => console.warn("Aviso al leer config/system:", err));

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

        // 4. Carga de Pedidos desde Firebase
        const ordersSnap = await getDocs(query(collection(db, "orders"), orderBy("createdAt", "asc")));
        allOrders = ordersSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        ordersReady = true;
        checkReadyAndCalculate();

    } catch (e) {
        console.error("Error al inicializar análisis FIFO:", e);
    }
}

function populateCategoryFilter() {
    if (!catalogFilterCategory) return;
    const previous = catalogFilterCategory.value;
    const categories = new Set();
    allProducts.forEach(p => {
        if (p.category) categories.add(p.category);
    });

    catalogFilterCategory.innerHTML = '<option value="">Todas las Categorías</option>';
    Array.from(categories).sort().forEach(cat => {
        catalogFilterCategory.innerHTML += `<option value="${cat}">${cat}</option>`;
    });

    if (previous) catalogFilterCategory.value = previous;
}

// ============================================================================
// MOTOR CONTABLE FIFO & COSTO PROMEDIO PONDERADO
// ============================================================================

function calculateFIFOEngine() {
    productMetrics = [];

    // 1. Indexar Compras por producto
    const purchasesByProduct = new Map();
    allPurchases.forEach(p => {
        const bInfo = getBogotaDateInfo(p.createdAt || p.date);
        const dateObj = bInfo ? bInfo.dateObj : new Date(0);
        if (p.items && Array.isArray(p.items)) {
            p.items.forEach(it => {
                const prodId = it.id || it.productId;
                if (!prodId) return;
                if (!purchasesByProduct.has(prodId)) purchasesByProduct.set(prodId, []);
                purchasesByProduct.get(prodId).push({
                    type: 'IN',
                    date: dateObj,
                    dateStr: bInfo ? bInfo.dateStr : '',
                    monthStr: bInfo ? bInfo.monthStr : '',
                    qty: parseInt(it.quantity, 10) || 0,
                    cost: cleanNumber(it.unitCostBase || it.cost || it.price),
                    refId: p.id ? p.id.slice(0, 8) : 'Compra'
                });
            });
        }
    });

    // 2. Indexar Órdenes válidas y asignar ventas netas
    const salesByProduct = new Map();
    const validOrders = allOrders.filter(o => {
        const isCancelled = ['CANCELADO', 'RECHAZADO', 'DEVUELTO'].includes(o.status) || o.billingStatus === 'CANCELLED';
        if (isCancelled) return false;

        // Respetar fecha de corte contable de catálogo de productos
        if (productsStartDate) {
            const bInfo = getBogotaDateInfo(o.createdAt || o.date);
            if (bInfo && bInfo.dateStr < productsStartDate) return false;
        }

        return true;
    });

    validOrders.forEach(o => {
        const bInfo = getBogotaDateInfo(o.createdAt || o.date);
        if (!bInfo) return;

        const isML = (o.source && o.source.startsWith('MERCADOLIBRE')) ||
                     o.channel === 'MERCADOLIBRE' ||
                     (o.paymentMethod && o.paymentMethod.startsWith('MERCADOLIBRE')) ||
                     String(o.id || '').startsWith('ML-') ||
                     String(o.id || '').startsWith('ML1-') ||
                     String(o.id || '').startsWith('ML2-') ||
                     String(o.id || '').startsWith('ML3-') ||
                     Boolean(o.mlOrderId);

        // Calcular ingreso neto real para la orden
        let orderNet = Number(o.total) || 0;
        if (isML) {
            if (o.netAmount !== undefined && o.netAmount !== null && Number(o.netAmount) > 0) {
                orderNet = Number(o.netAmount);
            } else {
                const gross = Number(o.grossTotal) || Number(o.total) || 0;
                const fee = Number(o.mlFee) || 0;
                const taxes = Number(o.mlTaxes) || 0;
                const shipping = Number(o.mlShipping) || 0;
                const bonus = Number(o.mlShippingBonus) || 0;
                const calc = gross - fee - taxes - shipping + bonus;
                orderNet = calc > 0 ? calc : gross;
            }
        }

        const items = o.items && Array.isArray(o.items) ? o.items : [];
        const grossItemsTotal = items.reduce((sum, it) => sum + (cleanNumber(it.price) * (parseInt(it.quantity, 10) || 1)), 0);
        const netRatio = grossItemsTotal > 0 ? (orderNet / grossItemsTotal) : 1;

        items.forEach(it => {
            const prodId = it.id || it.productId;
            if (!prodId) return;

            const qty = parseInt(it.quantity, 10) || 1;
            const grossPrice = cleanNumber(it.price);
            const netPrice = grossPrice * netRatio;

            if (!salesByProduct.has(prodId)) salesByProduct.set(prodId, []);
            salesByProduct.get(prodId).push({
                type: 'OUT',
                date: bInfo.dateObj,
                dateStr: bInfo.dateStr,
                monthStr: bInfo.monthStr,
                qty: qty,
                price: netPrice,
                refId: o.internalOrderNumber ? `#${o.internalOrderNumber}` : (o.id ? o.id.slice(0, 8) : 'Ord'),
                orderId: o.id
            });
        });
    });

    // 3. Procesar FIFO y Costo Promedio por Producto
    allProducts.forEach(product => {
        const prodId = product.id;
        const purchases = purchasesByProduct.get(prodId) || [];
        const sales = salesByProduct.get(prodId) || [];

        // Combinar movimientos en una línea de tiempo cronológica
        const timeline = [...purchases, ...sales];
        timeline.sort((a, b) => a.date - b.date);

        const inventoryQueue = [];
        let lastKnownCost = cleanNumber(product.lastPurchaseCost || product.costPrice || product.cost || 0);

        let totalQtySold = 0;
        let totalRevenue = 0;
        let totalCOGS = 0;

        timeline.forEach(event => {
            if (event.type === 'IN') {
                inventoryQueue.push({ qty: event.qty, cost: event.cost });
                if (event.cost > 0) lastKnownCost = event.cost;
                event.totalIn = event.qty * event.cost;
            } else if (event.type === 'OUT') {
                let qtyToFulfill = event.qty;
                let costForThisSale = 0;
                let isGhostInventory = false;

                while (qtyToFulfill > 0 && inventoryQueue.length > 0) {
                    const batch = inventoryQueue[0];
                    if (batch.qty <= qtyToFulfill) {
                        costForThisSale += batch.qty * batch.cost;
                        qtyToFulfill -= batch.qty;
                        inventoryQueue.shift();
                    } else {
                        costForThisSale += qtyToFulfill * batch.cost;
                        batch.qty -= qtyToFulfill;
                        qtyToFulfill = 0;
                    }
                }

                if (qtyToFulfill > 0) {
                    isGhostInventory = true;
                    costForThisSale += (qtyToFulfill * lastKnownCost);
                }

                event.costForThisSale = costForThisSale;
                event.revenueForThisSale = event.qty * event.price;
                event.profitForThisSale = event.revenueForThisSale - costForThisSale;
                event.isGhostInventory = isGhostInventory;

                // Si hay filtro de mes activo, solo sumar a los totales del periodo si coincide
                const matchMonth = !currentMonthFilter || event.monthStr === currentMonthFilter;
                if (matchMonth) {
                    totalQtySold += event.qty;
                    totalRevenue += event.revenueForThisSale;
                    totalCOGS += costForThisSale;
                }
            }
        });

        const profit = totalRevenue - totalCOGS;
        const margin = totalRevenue > 0 ? (profit / totalRevenue) * 100 : 0;

        // -----------------------------------------------------------------
        // Valuación de Existencias por Costo Promedio Ponderado
        // -----------------------------------------------------------------
        let currentStock = 0;
        if (product.combinations && Array.isArray(product.combinations) && product.combinations.length > 0) {
            currentStock = product.combinations.reduce((sum, c) => sum + (parseInt(c.stock, 10) || 0), 0);
        } else if (product.variants && Array.isArray(product.variants) && product.variants.length > 0) {
            currentStock = product.variants.reduce((sum, v) => sum + (parseInt(v.stock, 10) || 0), 0);
        } else {
            currentStock = parseInt(product.stock, 10) || 0;
        }

        const queueQty = inventoryQueue.reduce((sum, b) => sum + b.qty, 0);
        const queueVal = inventoryQueue.reduce((sum, b) => sum + (b.qty * b.cost), 0);

        let avgCost = 0;
        let totalStockValue = 0;

        if (currentStock <= 0) {
            avgCost = lastKnownCost;
            totalStockValue = 0;
        } else {
            if (currentStock <= queueQty) {
                avgCost = queueQty > 0 ? (queueVal / queueQty) : lastKnownCost;
                totalStockValue = currentStock * avgCost;
            } else {
                const missingUnits = currentStock - queueQty;
                const missingVal = missingUnits * lastKnownCost;
                totalStockValue = queueVal + missingVal;
                avgCost = totalStockValue / currentStock;
            }
        }

        if (avgCost <= 0 && lastKnownCost > 0) {
            avgCost = lastKnownCost;
            totalStockValue = currentStock * avgCost;
        }

        const sortedTimeline = [...timeline].sort((a, b) => b.date - a.date);

        productMetrics.push({
            product,
            currentStock,
            avgCost,
            totalStockValue,
            lastKnownCost,
            totalQtySold,
            totalRevenue,
            totalCOGS,
            profit,
            margin,
            timeline: sortedTimeline
        });
    });
}

// ============================================================================
// RENDERIZADO DEL DASHBOARD GENERAL
// ============================================================================

function renderGeneralDashboard() {
    // 1. Period Title
    if (currentPeriodTitle) {
        if (currentMonthFilter) {
            currentPeriodTitle.textContent = getMonthNamePretty(currentMonthFilter);
        } else {
            currentPeriodTitle.textContent = productsStartDate 
                ? `Historial desde ${productsStartDate}` 
                : "Historial Global (Todos los Tiempos)";
        }
    }

    // 2. KPIs Maestros
    const totalStockValue = productMetrics.reduce((s, p) => s + p.totalStockValue, 0);
    const totalStockUnits = productMetrics.reduce((s, p) => s + p.currentStock, 0);
    const totalRevenue = productMetrics.reduce((s, p) => s + p.totalRevenue, 0);
    const totalUnitsSold = productMetrics.reduce((s, p) => s + p.totalQtySold, 0);
    const totalCOGS = productMetrics.reduce((s, p) => s + p.totalCOGS, 0);
    const totalProfit = totalRevenue - totalCOGS;
    const marginPct = totalRevenue > 0 ? (totalProfit / totalRevenue) * 100 : 0;

    if (kpiStockValue) kpiStockValue.textContent = formatCOP(totalStockValue);
    if (kpiStockUnits) kpiStockUnits.textContent = `${totalStockUnits.toLocaleString()} unidades en stock`;

    if (kpiTotalRevenue) kpiTotalRevenue.textContent = formatCOP(totalRevenue);
    if (kpiUnitsSold) kpiUnitsSold.textContent = `${totalUnitsSold.toLocaleString()} unidades vendidas`;

    if (kpiTotalCogs) kpiTotalCogs.textContent = formatCOP(totalCOGS);
    const cogsPct = totalRevenue > 0 ? Math.round((totalCOGS / totalRevenue) * 100) : 0;
    if (kpiCogsPct) kpiCogsPct.textContent = `${cogsPct}% de las ventas`;

    if (kpiTotalProfit) kpiTotalProfit.textContent = formatCOP(totalProfit);
    if (kpiCatalogCount) kpiCatalogCount.textContent = `${productMetrics.length} productos analizados`;

    if (kpiProfitMarginBadge) {
        kpiProfitMarginBadge.textContent = `Margen: ${marginPct.toFixed(1)}%`;
        if (totalProfit >= 0) {
            kpiProfitMarginBadge.className = "text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-md border text-emerald-700 bg-emerald-50 border-emerald-200";
            if (kpiTotalProfit) kpiTotalProfit.className = "text-2xl font-black tracking-tight text-emerald-700";
            if (kpiProfitIcon) kpiProfitIcon.className = "w-11 h-11 rounded-xl bg-emerald-50 text-emerald-600 border border-emerald-100 flex items-center justify-center text-lg shrink-0";
        } else {
            kpiProfitMarginBadge.className = "text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-md border text-rose-700 bg-rose-50 border-rose-200";
            if (kpiTotalProfit) kpiTotalProfit.className = "text-2xl font-black tracking-tight text-rose-700";
            if (kpiProfitIcon) kpiProfitIcon.className = "w-11 h-11 rounded-xl bg-rose-50 text-rose-600 border border-rose-100 flex items-center justify-center text-lg shrink-0";
        }
    }

    // 3. Render Top 5 Lists
    renderTopLists();

    // 4. Render Catalog Table
    renderCatalogTable();
}

function renderTopLists() {
    const byRevenue = [...productMetrics].sort((a, b) => b.totalRevenue - a.totalRevenue).slice(0, 5);
    const byProfit = [...productMetrics].sort((a, b) => b.profit - a.profit).slice(0, 5);

    const generateHtml = (arr, type) => {
        const filtered = arr.filter(i => i.totalQtySold > 0);
        if (filtered.length === 0) {
            return `<div class="p-6 text-center text-slate-400 font-bold text-xs uppercase">No hay ventas registradas en este periodo</div>`;
        }

        return filtered.map((item, idx) => {
            const p = item.product;
            const imgUrl = p.mainImage || p.image || (p.images ? p.images[0] : '') || 'https://placehold.co/60';
            const valDisplay = type === 'sales'
                ? `<div class="text-right">
                       <span class="text-sm font-black text-slate-900 block">${formatCOP(item.totalRevenue)}</span>
                       <span class="text-[10px] font-bold text-slate-400 uppercase">${item.totalQtySold} unidades</span>
                   </div>`
                : `<div class="text-right">
                       <span class="text-sm font-black text-emerald-700 block">${formatCOP(item.profit)}</span>
                       <span class="inline-flex px-1.5 py-0.2 rounded text-[9px] font-black ${item.margin >= 20 ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'bg-amber-50 text-amber-700 border border-amber-200'}">
                           ${item.margin.toFixed(1)}% margen
                       </span>
                   </div>`;

            return `
                <div onclick="window.showSpecificProduct('${p.id}')"
                    class="p-3 rounded-xl border border-slate-100 hover:border-slate-300 hover:bg-slate-50/70 transition-all cursor-pointer flex items-center justify-between gap-3 group">
                    <div class="flex items-center gap-3 min-w-0">
                        <span class="w-6 h-6 rounded-full bg-slate-100 text-slate-500 font-black text-[10px] flex items-center justify-center shrink-0 group-hover:bg-slate-900 group-hover:text-white transition-colors">
                            ${idx + 1}
                        </span>
                        <img src="${imgUrl}" class="w-10 h-10 rounded-lg object-contain bg-white border border-slate-200 p-0.5 shrink-0">
                        <div class="min-w-0">
                            <p class="font-bold text-xs text-slate-900 truncate group-hover:text-cyan-600 transition-colors uppercase" title="${p.name}">
                                ${p.name}
                            </p>
                            <p class="text-[10px] text-slate-400 font-medium truncate">SKU: ${p.sku || 'N/A'}${p.category ? ' • ' + p.category : ''}</p>
                        </div>
                    </div>
                    <div class="shrink-0">
                        ${valDisplay}
                    </div>
                </div>
            `;
        }).join('');
    };

    if (topSalesList) topSalesList.innerHTML = generateHtml(byRevenue, 'sales');
    if (topProfitList) topProfitList.innerHTML = generateHtml(byProfit, 'profit');
}

function renderCatalogTable() {
    if (!catalogTableBody) return;

    let items = [...productMetrics];

    // 1. Filtro por búsqueda
    const term = normalizeText(catalogSearchTerm);
    if (term.length > 0) {
        items = items.filter(m => {
            const name = normalizeText(m.product.name);
            const sku = normalizeText(m.product.sku);
            const brand = normalizeText(m.product.brand);
            return name.includes(term) || sku.includes(term) || brand.includes(term);
        });
    }

    // 2. Filtro por categoría
    if (catalogSelectedCategory) {
        items = items.filter(m => (m.product.category || '') === catalogSelectedCategory);
    }

    // 3. Ordenamiento
    items.sort((a, b) => {
        switch (catalogSort) {
            case 'revenue-desc':
                return b.totalRevenue - a.totalRevenue;
            case 'margin-desc':
                return b.margin - a.margin;
            case 'qty-desc':
                return b.totalQtySold - a.totalQtySold;
            case 'stock-desc':
                return b.currentStock - a.currentStock;
            case 'name-asc':
                return (a.product.name || '').localeCompare(b.product.name || '');
            case 'profit-desc':
            default:
                return b.profit - a.profit;
        }
    });

    // 4. Paginación
    const totalItems = items.length;
    const totalPages = Math.ceil(totalItems / catalogPageSize) || 1;
    if (catalogCurrentPage < 1) catalogCurrentPage = 1;
    if (catalogCurrentPage > totalPages) catalogCurrentPage = totalPages;

    const startIdx = (catalogCurrentPage - 1) * catalogPageSize;
    const endIdx = Math.min(startIdx + catalogPageSize, totalItems);
    const pageItems = items.slice(startIdx, endIdx);

    if (catalogPageInfo) {
        catalogPageInfo.textContent = totalItems > 0 
            ? `Mostrando ${startIdx + 1} - ${endIdx} de ${totalItems} productos`
            : `Mostrando 0 de 0 productos`;
    }
    if (catalogPageCurrent) catalogPageCurrent.textContent = `Pág ${catalogCurrentPage} / ${totalPages}`;
    if (catalogBtnPrev) catalogBtnPrev.disabled = catalogCurrentPage <= 1;
    if (catalogBtnNext) catalogBtnNext.disabled = catalogCurrentPage >= totalPages;

    if (totalItems === 0) {
        catalogTableBody.innerHTML = `
            <tr>
                <td colspan="10" class="p-12 text-center text-slate-400 font-bold text-xs">
                    <i class="fa-solid fa-box-open text-2xl text-slate-300 mb-2 block"></i>
                    No se encontraron productos que coincidan con la búsqueda.
                </td>
            </tr>
        `;
        return;
    }

    const rows = pageItems.map(m => {
        const p = m.product;
        const imgUrl = p.mainImage || p.image || (p.images ? p.images[0] : '') || 'https://placehold.co/40';

        return `
            <tr class="hover:bg-slate-50/70 transition-colors border-b border-slate-100 last:border-0">
                <td class="px-6 py-3.5">
                    <div class="flex items-center gap-3">
                        <img src="${imgUrl}" class="w-9 h-9 rounded-lg object-contain bg-white border border-slate-200 p-0.5 shrink-0">
                        <div class="min-w-0">
                            <p class="font-bold text-xs text-slate-900 uppercase truncate max-w-[220px]" title="${p.name}">
                                ${p.name}
                            </p>
                            <p class="text-[10px] text-slate-400 font-medium">SKU: ${p.sku || 'N/A'}${p.category ? ' | ' + p.category : ''}</p>
                        </div>
                    </div>
                </td>
                <td class="px-4 py-3.5 text-center font-bold text-xs ${m.currentStock > 0 ? 'text-slate-800' : 'text-rose-500'}">
                    ${m.currentStock}
                </td>
                <td class="px-4 py-3.5 text-right font-medium text-slate-700">${formatCOP(m.avgCost)}</td>
                <td class="px-4 py-3.5 text-right font-bold text-slate-900">${formatCOP(m.totalStockValue)}</td>
                <td class="px-4 py-3.5 text-center font-bold text-slate-800">${m.totalQtySold}</td>
                <td class="px-4 py-3.5 text-right font-bold text-slate-900">${formatCOP(m.totalRevenue)}</td>
                <td class="px-4 py-3.5 text-right font-bold text-amber-700">-${formatCOP(m.totalCOGS)}</td>
                <td class="px-6 py-3.5 text-right font-black ${m.profit >= 0 ? 'text-emerald-700' : 'text-rose-600'}">
                    ${formatCOP(m.profit)}
                </td>
                <td class="px-4 py-3.5 text-center">
                    <span class="inline-flex px-1.5 py-0.5 rounded text-[10px] font-black ${m.margin >= 20 ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : (m.margin > 0 ? 'bg-amber-50 text-amber-700 border border-amber-200' : 'bg-rose-50 text-rose-700 border border-rose-200')}">
                        ${m.margin.toFixed(1)}%
                    </span>
                </td>
                <td class="px-4 py-3.5 text-center">
                    <button onclick="window.showSpecificProduct('${p.id}')"
                        class="px-2.5 py-1 rounded-lg text-[10px] font-bold text-slate-700 hover:text-white bg-slate-100 hover:bg-slate-900 transition active:scale-95">
                        Ver Detalle
                    </button>
                </td>
            </tr>
        `;
    }).join('');

    catalogTableBody.innerHTML = rows;
}

window.changeCatalogPage = (delta) => {
    catalogCurrentPage += delta;
    renderCatalogTable();
};

// ============================================================================
// VISTA ESPECÍFICA DEL PRODUCTO
// ============================================================================

window.showSpecificProduct = (productId) => {
    const data = productMetrics.find(m => m.product.id === productId);
    if (!data) return;

    currentTimelineProduct = data;
    timelineCurrentPage = 1;
    currentTimelineType = 'ALL';
    if (timelineFilterType) timelineFilterType.value = 'ALL';

    if (generalDashboard) generalDashboard.classList.add('hidden');
    if (specificDashboard) specificDashboard.classList.remove('hidden');
    if (btnBackGeneral) {
        btnBackGeneral.classList.remove('hidden');
        btnBackGeneral.classList.add('flex');
    }

    const p = data.product;
    if (dashName) dashName.textContent = p.name;
    if (dashSku) dashSku.textContent = `SKU: ${p.sku || 'N/A'}${p.brand ? ' | Marca: ' + p.brand : ''}`;
    if (dashCategoryBadge) dashCategoryBadge.textContent = p.category || 'General';
    if (dashImg) dashImg.src = p.mainImage || p.image || (p.images ? p.images[0] : '') || 'https://placehold.co/60';

    // Bloque 1: Existencias Físicas
    if (dashStockCurrent) dashStockCurrent.textContent = `${data.currentStock} unid.`;
    if (dashAvgCost) dashAvgCost.textContent = formatCOP(data.avgCost);
    if (dashStockValue) dashStockValue.textContent = formatCOP(data.totalStockValue);
    if (dashLastCost) dashLastCost.textContent = formatCOP(data.lastKnownCost);

    // Bloque 2: Rendimiento FIFO
    if (dashQtySold) dashQtySold.textContent = `${data.totalQtySold} unid.`;
    if (dashRevenue) dashRevenue.textContent = formatCOP(data.totalRevenue);
    if (dashCogs) dashCogs.textContent = `-${formatCOP(data.totalCOGS)}`;
    if (dashProfit) dashProfit.textContent = formatCOP(data.profit);
    if (dashMargin) dashMargin.textContent = `Margen: ${data.margin.toFixed(1)}%`;

    renderTimelinePage();
    window.scrollTo({ top: 0, behavior: 'smooth' });
};

window.showGeneralDashboard = () => {
    currentTimelineProduct = null;
    if (specificDashboard) specificDashboard.classList.add('hidden');
    if (btnBackGeneral) btnBackGeneral.classList.add('hidden');
    if (generalDashboard) generalDashboard.classList.remove('hidden');
};

window.filterTimelineByType = (type) => {
    currentTimelineType = type;
    timelineCurrentPage = 1;
    renderTimelinePage();
};

window.setTimelinePageSize = (size) => {
    timelinePageSize = parseInt(size, 10) || 10;
    timelineCurrentPage = 1;
    renderTimelinePage();
};

window.changeTimelinePage = (delta) => {
    timelineCurrentPage += delta;
    renderTimelinePage();
};

function renderTimelinePage() {
    if (!currentTimelineProduct || !timelineTableBody) return;

    let items = currentTimelineProduct.timeline || [];

    if (currentTimelineType !== 'ALL') {
        items = items.filter(ev => ev.type === currentTimelineType);
    }

    const totalItems = items.length;
    const totalPages = Math.ceil(totalItems / timelinePageSize) || 1;
    if (timelineCurrentPage < 1) timelineCurrentPage = 1;
    if (timelineCurrentPage > totalPages) timelineCurrentPage = totalPages;

    const startIdx = (timelineCurrentPage - 1) * timelinePageSize;
    const endIdx = Math.min(startIdx + timelinePageSize, totalItems);
    const pageItems = items.slice(startIdx, endIdx);

    if (timelineViewRange) timelineViewRange.textContent = totalItems === 0 ? '0-0' : `${startIdx + 1}-${endIdx}`;
    if (timelineTotalCount) timelineTotalCount.textContent = totalItems;
    if (timelinePageNum) timelinePageNum.textContent = timelineCurrentPage;
    if (timelineTotalPages) timelineTotalPages.textContent = totalPages;
    if (btnTimelinePrev) btnTimelinePrev.disabled = timelineCurrentPage <= 1;
    if (btnTimelineNext) btnTimelineNext.disabled = timelineCurrentPage >= totalPages;

    if (pageItems.length === 0) {
        timelineTableBody.innerHTML = `
            <tr>
                <td colspan="6" class="p-10 text-center text-xs font-bold text-slate-400">
                    No hay movimientos registrados para este criterio.
                </td>
            </tr>
        `;
        return;
    }

    const rows = pageItems.map(event => {
        const dateStr = event.date.toLocaleDateString('es-CO', {
            year: 'numeric',
            month: 'short',
            day: '2-digit',
            timeZone: 'America/Bogota'
        });

        if (event.type === 'IN') {
            return `
                <tr class="bg-blue-50/20 border-b border-slate-100 last:border-0 hover:bg-blue-50/40 transition-colors">
                    <td class="px-6 py-4 font-mono text-xs font-bold text-slate-500">${dateStr}</td>
                    <td class="px-6 py-4">
                        <span class="inline-flex items-center gap-1 bg-blue-100 text-blue-700 px-2 py-0.5 rounded text-[10px] font-black uppercase">
                            <i class="fa-solid fa-arrow-down text-[9px]"></i> Compra
                        </span>
                        <span class="text-[10px] text-slate-400 font-bold ml-1.5">Ref: ${event.refId}</span>
                    </td>
                    <td class="px-4 py-4 text-center font-black text-slate-900 text-sm">+${event.qty}</td>
                    <td class="px-6 py-4 text-right font-medium text-slate-700">${formatCOP(event.cost)}</td>
                    <td class="px-6 py-4 text-right font-black text-slate-900">${formatCOP(event.totalIn)}</td>
                    <td class="px-6 py-4 text-right text-slate-300 font-bold">---</td>
                </tr>
            `;
        } else {
            const isEstimated = event.isGhostInventory;
            const ghostBadge = isEstimated 
                ? `<span class="inline-block mt-0.5 text-[8px] bg-amber-50 text-amber-700 border border-amber-200 px-1.5 py-0.2 rounded uppercase font-bold" title="Costo estimado según último costo conocido">Lote previo</span>` 
                : '';

            return `
                <tr class="border-b border-slate-100 last:border-0 hover:bg-slate-50/80 transition-colors">
                    <td class="px-6 py-4 font-mono text-xs font-bold text-slate-500">${dateStr}</td>
                    <td class="px-6 py-4">
                        <span class="inline-flex items-center gap-1 bg-emerald-50 text-emerald-700 border border-emerald-200 px-2 py-0.5 rounded text-[10px] font-black uppercase">
                            <i class="fa-solid fa-arrow-up text-[9px]"></i> Venta
                        </span>
                        <span class="text-[10px] text-slate-400 font-bold ml-1.5">Ord: ${event.refId}</span>
                    </td>
                    <td class="px-4 py-4 text-center font-black text-slate-900 text-sm">-${event.qty}</td>
                    <td class="px-6 py-4 text-right font-medium text-slate-700">${formatCOP(event.price)}</td>
                    <td class="px-6 py-4 text-right font-black text-slate-900">${formatCOP(event.revenueForThisSale)}</td>
                    <td class="px-6 py-4 text-right">
                        <span class="font-black text-sm ${event.profitForThisSale >= 0 ? 'text-emerald-700' : 'text-rose-600'}">
                            ${event.profitForThisSale >= 0 ? '+' : ''}${formatCOP(event.profitForThisSale)}
                        </span>
                        <span class="text-[10px] text-slate-400 font-bold block mt-0.5">FIFO: -${formatCOP(event.costForThisSale)}</span>
                        ${ghostBadge}
                    </td>
                </tr>
            `;
        }
    }).join('');

    timelineTableBody.innerHTML = rows;
}

// ============================================================================
// EVENT LISTENERS
// ============================================================================

if (filterMonthInput) {
    filterMonthInput.addEventListener('change', (e) => {
        currentMonthFilter = e.target.value || null;
        calculateFIFOEngine();
        renderGeneralDashboard();
    });
}

if (btnClearDate) {
    btnClearDate.addEventListener('click', () => {
        if (filterMonthInput) filterMonthInput.value = "";
        currentMonthFilter = null;
        calculateFIFOEngine();
        renderGeneralDashboard();
    });
}

if (catalogSearch) {
    catalogSearch.addEventListener('input', (e) => {
        catalogSearchTerm = e.target.value;
        catalogCurrentPage = 1;
        renderCatalogTable();
    });
}

if (catalogFilterCategory) {
    catalogFilterCategory.addEventListener('change', (e) => {
        catalogSelectedCategory = e.target.value;
        catalogCurrentPage = 1;
        renderCatalogTable();
    });
}

if (catalogSortSelect) {
    catalogSortSelect.addEventListener('change', (e) => {
        catalogSort = e.target.value;
        catalogCurrentPage = 1;
        renderCatalogTable();
    });
}

if (catalogPageSizeSelect) {
    catalogPageSizeSelect.addEventListener('change', (e) => {
        catalogPageSize = parseInt(e.target.value, 10) || 15;
        catalogCurrentPage = 1;
        renderCatalogTable();
    });
}

window.refreshFIFOData = async () => {
    if (syncIcon) syncIcon.classList.add('fa-spin');
    try {
        await Promise.all([
            AdminStore.forceSyncAll ? null : null,
            (async () => {
                const ordersSnap = await getDocs(query(collection(db, "orders"), orderBy("createdAt", "asc")));
                allOrders = ordersSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            })()
        ]);
        calculateFIFOEngine();
        renderGeneralDashboard();
    } catch (e) {
        console.error("Error al refrescar finanzas FIFO:", e);
    } finally {
        setTimeout(() => {
            if (syncIcon) syncIcon.classList.remove('fa-spin');
        }, 600);
    }
};

// Arrancar inicialización
init();