import { db, collection, getDocs, query, orderBy } from './firebase-init.js';
import { loadAdminSidebar } from './admin-ui.js';
import { AdminStore } from './admin-store.js';

loadAdminSidebar();

// --- DOM ---
const searchInput = document.getElementById('product-search');
const resultsContainer = document.getElementById('product-results');
const generalDashboard = document.getElementById('general-dashboard');
const specificDashboard = document.getElementById('specific-dashboard');
const btnBack = document.getElementById('btn-back-general');
const timelineBody = document.getElementById('timeline-table-body');
const topSalesList = document.getElementById('top-sales-list');
const topProfitList = document.getElementById('top-profit-list');

// --- DATOS GLOBALES EN RAM ---
let productIndex = [];
let allPurchases = [];
let allOrders = [];
let globalMetrics = []; 

let productsReady = false;
let purchasesReady = false;
let ordersReady = false;

const normalizeText = (str) => str ? str.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "") : "";
const formatMoney = (val) => `$${Math.round(val || 0).toLocaleString('es-CO')}`;

const parseDate = (d) => {
    if (!d) return new Date(0);
    if (d.toDate && typeof d.toDate === 'function') return d.toDate();
    const dt = new Date(d);
    return isNaN(dt.getTime()) ? new Date(0) : dt;
};

// ============================================================================
// 1. INICIALIZACIÓN REACTIVA CON ADMINSTORE
// ============================================================================
function checkReadyAndCalculate() {
    if (productsReady && purchasesReady && ordersReady) {
        calculateGlobalFIFO();
    }
}

async function initAnalysis() {
    try {
        // Suscripción reactiva y con 0 costo de lectura a productos cacheados
        AdminStore.subscribeToProducts((products) => {
            productIndex = products || [];
            productsReady = true;
            checkReadyAndCalculate();
        });

        // Suscripción reactiva a compras cacheadas en IndexedDB
        AdminStore.subscribeToPurchases((purchases) => {
            allPurchases = purchases || [];
            purchasesReady = true;
            checkReadyAndCalculate();
        });

        // Carga de pedidos
        const ordersSnap = await getDocs(query(collection(db, "orders"), orderBy("createdAt", "asc")));
        allOrders = ordersSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        ordersReady = true;
        checkReadyAndCalculate();

    } catch (e) {
        console.error("Error en inicialización de rentabilidad:", e);
        topSalesList.innerHTML = `<div class="p-4 text-red-500 font-bold text-xs text-center">Error al conectar con la base de datos.</div>`;
        topProfitList.innerHTML = `<div class="p-4 text-red-500 font-bold text-xs text-center">Error al conectar con la base de datos.</div>`;
    }
}

// ============================================================================
// 2. ALGORITMO CONTABLE FIFO Y COSTO PROMEDIO
// ============================================================================
function calculateGlobalFIFO() {
    globalMetrics = [];

    productIndex.forEach(product => {
        let timeline = [];

        allPurchases.forEach(p => {
            if (p.items && Array.isArray(p.items)) {
                p.items.forEach(item => {
                    if (item.id === product.id || item.productId === product.id) {
                        timeline.push({ 
                            type: 'IN', 
                            date: parseDate(p.createdAt || p.date), 
                            qty: parseInt(item.quantity) || 0, 
                            unitCost: parseFloat(item.unitCostBase || item.cost || item.price) || 0, 
                            refId: p.id 
                        });
                    }
                });
            }
        });

        allOrders.forEach(o => {
            if (['CANCELADO', 'RECHAZADO', 'DEVUELTO'].includes(o.status)) return;
            if (o.items && Array.isArray(o.items)) {
                o.items.forEach(item => {
                    if (item.id === product.id || item.productId === product.id) {
                        timeline.push({ 
                            type: 'OUT', 
                            date: parseDate(o.createdAt || o.date), 
                            qty: parseInt(item.quantity) || 0, 
                            unitPrice: parseFloat(item.price) || 0, 
                            refId: o.internalOrderNumber ? o.internalOrderNumber.toString() : o.id, 
                            status: o.status 
                        });
                    }
                });
            }
        });

        timeline.sort((a, b) => a.date - b.date);

        let inventoryQueue = []; 
        let totalQtySold = 0, totalRevenue = 0, totalCOGS = 0;
        let lastKnownCost = parseFloat(product.lastPurchaseCost || product.costPrice || product.cost || 0);

        timeline.forEach(event => {
            if (event.type === 'IN') {
                inventoryQueue.push({ qty: event.qty, cost: event.unitCost });
                if (event.unitCost > 0) lastKnownCost = event.unitCost;
                event.totalIn = event.qty * event.unitCost;
            } 
            else if (event.type === 'OUT') {
                let qtyToFulfill = event.qty;
                let costForThisSale = 0;
                let isGhostInventory = false;

                while (qtyToFulfill > 0 && inventoryQueue.length > 0) {
                    let batch = inventoryQueue[0];
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
                event.revenueForThisSale = event.qty * event.unitPrice;
                event.profitForThisSale = event.revenueForThisSale - costForThisSale;
                event.isGhostInventory = isGhostInventory;

                totalQtySold += event.qty;
                totalRevenue += event.revenueForThisSale;
                totalCOGS += costForThisSale;
            }
        });

        const profit = totalRevenue - totalCOGS;
        const margin = totalRevenue > 0 ? (profit / totalRevenue) * 100 : 0;

        // ---------------------------------------------------------------------
        // VALUACIÓN DE EXISTENCIAS POR MÉTODO DE COSTO PROMEDIO PONDERADO
        // ---------------------------------------------------------------------
        let currentStock = 0;
        if (product.combinations && Array.isArray(product.combinations) && product.combinations.length > 0) {
            currentStock = product.combinations.reduce((sum, c) => sum + (parseInt(c.stock) || 0), 0);
        } else if (product.variants && Array.isArray(product.variants) && product.variants.length > 0) {
            currentStock = product.variants.reduce((sum, v) => sum + (parseInt(v.stock) || 0), 0);
        } else {
            currentStock = parseInt(product.stock) || 0;
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
                // Hay suficientes unidades remanentes en cola formal
                avgCost = queueQty > 0 ? (queueVal / queueQty) : lastKnownCost;
                totalStockValue = currentStock * avgCost;
            } else {
                // El stock actual supera las compras registradas: faltantes al último costo conocido
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

        // Ordenar movimientos visuales del más nuevo al más viejo
        const sortedTimeline = [...timeline].sort((a, b) => b.date - a.date);

        globalMetrics.push({
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

    renderTop10Lists();

    // Refrescar en tiempo real si el usuario está viendo el detalle de un producto
    if (currentTimelineProduct) {
        const updated = globalMetrics.find(m => m.product.id === currentTimelineProduct.product.id);
        if (updated) {
            currentTimelineProduct = updated;
            renderTimelinePage();
            const elStock = document.getElementById('dash-stock-current');
            const elAvgCost = document.getElementById('dash-avg-cost');
            const elStockVal = document.getElementById('dash-stock-value');
            const elLastCost = document.getElementById('dash-last-cost');
            const elQtySold = document.getElementById('dash-qty-sold');
            const elRevenue = document.getElementById('dash-revenue');
            const elCogs = document.getElementById('dash-cogs');
            const elProfit = document.getElementById('dash-profit');
            const elMargin = document.getElementById('dash-margin');

            if (elStock) elStock.textContent = updated.currentStock;
            if (elAvgCost) elAvgCost.textContent = formatMoney(updated.avgCost);
            if (elStockVal) elStockVal.textContent = formatMoney(updated.totalStockValue);
            if (elLastCost) elLastCost.textContent = formatMoney(updated.lastKnownCost);
            if (elQtySold) elQtySold.textContent = updated.totalQtySold;
            if (elRevenue) elRevenue.textContent = formatMoney(updated.totalRevenue);
            if (elCogs) elCogs.textContent = `-${formatMoney(updated.totalCOGS)}`;
            if (elProfit) elProfit.textContent = formatMoney(updated.profit);
            if (elMargin) elMargin.textContent = `Margen: ${updated.margin.toFixed(1)}%`;
        }
    }
}

// ============================================================================
// 3. RENDERIZADO DE LOS TOP 10 (AHORA CON NÚMEROS GIGANTES)
// ============================================================================
function renderTop10Lists() {
    const byRevenue = [...globalMetrics].sort((a, b) => b.totalRevenue - a.totalRevenue).slice(0, 10);
    const byProfit = [...globalMetrics].sort((a, b) => b.profit - a.profit).slice(0, 10);

    const generateHtml = (arr, type) => {
        if (arr.length === 0 || arr[0].totalQtySold === 0) return `<div class="text-center p-4 text-gray-400 text-xs font-bold">Sin datos suficientes</div>`;
        
        return arr.filter(i => i.totalQtySold > 0).map((item, index) => {
            const p = item.product;
            
            const valueDisplay = type === 'sales'
                ? `<span class="text-brand-cyan font-black text-xl lg:text-2xl tracking-tight">${formatMoney(item.totalRevenue)}</span>`
                : `<span class="text-emerald-500 font-black text-xl lg:text-2xl tracking-tight">${formatMoney(item.profit)}</span><br><span class="text-[10px] text-gray-400 font-bold tracking-widest uppercase bg-gray-50 px-2 py-1 rounded">Margen: ${item.margin.toFixed(1)}%</span>`;

            return `
            <div class="flex items-center gap-4 p-4 hover:bg-slate-50 rounded-2xl transition-all duration-300 cursor-pointer border border-transparent hover:border-gray-100 hover:shadow-sm hover:-translate-y-0.5 group" onclick="window.showSpecificProduct('${p.id}')">
                <div class="w-8 h-8 rounded-full bg-slate-100 text-gray-400 flex items-center justify-center text-[11px] font-black shrink-0 group-hover:bg-brand-black group-hover:text-white transition-colors">${index + 1}</div>
                <img src="${p.mainImage || p.image || 'https://placehold.co/50'}" class="w-14 h-14 rounded-lg object-contain bg-white border border-gray-100 shrink-0 p-1 shadow-sm">
                <div class="flex-grow min-w-0">
                    <p class="text-xs font-black text-brand-black uppercase truncate group-hover:text-brand-cyan transition-colors">${p.name}</p>
                    <p class="text-[10px] font-bold text-gray-400 truncate mt-1">SKU: ${p.sku || 'N/A'} <span class="mx-1">•</span> <i class="fa-solid fa-tags text-gray-300"></i> ${item.totalQtySold} unid.</p>
                </div>
                <div class="text-right shrink-0 leading-tight">
                    ${valueDisplay}
                </div>
            </div>`;
        }).join('');
    };

    topSalesList.innerHTML = generateHtml(byRevenue, 'sales');
    topProfitList.innerHTML = generateHtml(byProfit, 'profit');
}

// ============================================================================
// 4. INTERACCIÓN UI (BUSCADOR Y VISTA ESPECÍFICA CON PAGINACIÓN)
// ============================================================================
let currentTimelineProduct = null;
let timelineCurrentPage = 1;
let timelinePageSize = 10;

window.setTimelinePageSize = (size) => {
    timelinePageSize = parseInt(size) || 10;
    timelineCurrentPage = 1;
    renderTimelinePage();
};

window.changeTimelinePage = (dir) => {
    timelineCurrentPage += dir;
    renderTimelinePage();
};

function renderTimelinePage() {
    if (!currentTimelineProduct) return;
    const timeline = currentTimelineProduct.timeline || [];
    const totalItems = timeline.length;
    const totalPages = Math.ceil(totalItems / timelinePageSize) || 1;

    if (timelineCurrentPage < 1) timelineCurrentPage = 1;
    if (timelineCurrentPage > totalPages) timelineCurrentPage = totalPages;

    const startIdx = (timelineCurrentPage - 1) * timelinePageSize;
    const endIdx = Math.min(startIdx + timelinePageSize, totalItems);
    const pageItems = timeline.slice(startIdx, endIdx);

    const viewRangeEl = document.getElementById('timeline-view-range');
    const totalCountEl = document.getElementById('timeline-total-count');
    const pageNumEl = document.getElementById('timeline-page-num');
    const totalPagesEl = document.getElementById('timeline-total-pages');
    const btnPrev = document.getElementById('btn-timeline-prev');
    const btnNext = document.getElementById('btn-timeline-next');

    if (viewRangeEl) viewRangeEl.textContent = totalItems === 0 ? '0-0' : `${startIdx + 1}-${endIdx}`;
    if (totalCountEl) totalCountEl.textContent = totalItems;
    if (pageNumEl) pageNumEl.textContent = timelineCurrentPage;
    if (totalPagesEl) totalPagesEl.textContent = totalPages;
    if (btnPrev) btnPrev.disabled = timelineCurrentPage <= 1;
    if (btnNext) btnNext.disabled = timelineCurrentPage >= totalPages;

    timelineBody.innerHTML = "";
    if (pageItems.length === 0) {
        timelineBody.innerHTML = `<tr><td colspan="6" class="p-10 text-center text-sm font-bold text-gray-400">No hay movimientos registrados.</td></tr>`;
        return;
    }

    pageItems.forEach(event => {
        const dateStr = event.date.toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' });

        if (event.type === 'IN') {
            timelineBody.innerHTML += `
                <tr class="bg-blue-50/30 border-b border-gray-50">
                    <td class="px-6 py-5 text-sm font-bold text-gray-500">${dateStr}</td>
                    <td class="px-6 py-5">
                        <span class="bg-blue-100 text-blue-600 px-2.5 py-1 rounded-lg text-[10px] font-black uppercase inline-flex items-center gap-1 shadow-2xs">
                            <i class="fa-solid fa-arrow-down text-[9px]"></i> Compra
                        </span>
                        <br><span class="text-[9px] text-gray-400 font-bold mt-1 block tracking-wider">Ref: ${event.refId ? event.refId.slice(0,6) : 'N/A'}</span>
                    </td>
                    <td class="px-6 py-5 text-center font-black text-brand-black text-base">+${event.qty}</td>
                    <td class="px-6 py-5 text-right text-sm font-bold text-gray-600">${formatMoney(event.unitCost)}</td>
                    <td class="px-6 py-5 text-right font-black text-brand-black text-base">${formatMoney(event.totalIn)}</td>
                    <td class="px-6 py-5 text-right text-gray-300 font-bold">---</td>
                </tr>
            `;
        } else if (event.type === 'OUT') {
            const ghostBadge = event.isGhostInventory 
                ? `<span class="inline-block mt-1 text-[8px] bg-amber-50 text-amber-700 border border-amber-200 px-2 py-0.5 rounded uppercase font-bold" title="Costo estimado según último valor obtenido">Costo Estimado</span>` 
                : '';

            timelineBody.innerHTML += `
                <tr class="hover:bg-slate-50 border-b border-gray-50 transition-colors">
                    <td class="px-6 py-5 text-sm font-bold text-gray-500">${dateStr}</td>
                    <td class="px-6 py-5">
                        <span class="bg-emerald-50 text-emerald-600 px-2.5 py-1 rounded-lg text-[10px] font-black uppercase inline-flex items-center gap-1 shadow-2xs">
                            <i class="fa-solid fa-arrow-up text-[9px]"></i> Venta
                        </span>
                        <br><span class="text-[9px] text-gray-400 font-bold mt-1 block tracking-wider">Ord: #${event.refId ? event.refId.slice(0,6) : 'N/A'}</span>
                    </td>
                    <td class="px-6 py-5 text-center font-black text-brand-black text-base">-${event.qty}</td>
                    <td class="px-6 py-5 text-right text-sm font-bold text-gray-600">${formatMoney(event.unitPrice)}</td>
                    <td class="px-6 py-5 text-right font-black text-brand-black text-base">${formatMoney(event.revenueForThisSale)}</td>
                    <td class="px-6 py-5 text-right">
                        <span class="font-black text-base ${event.profitForThisSale >= 0 ? 'text-brand-cyan' : 'text-red-500'}">
                            ${event.profitForThisSale >= 0 ? '+' : ''}${formatMoney(event.profitForThisSale)}
                        </span>
                        <br><span class="text-[10px] text-gray-400 font-bold tracking-wider block mt-0.5">Costo FIFO: -${formatMoney(event.costForThisSale)}</span>
                        ${ghostBadge}
                    </td>
                </tr>
            `;
        }
    });
}

searchInput.addEventListener('input', (e) => {
    const term = normalizeText(e.target.value.trim());
    if (term.length < 2) {
        resultsContainer.classList.add('hidden');
        return;
    }

    const words = term.split(" ");
    const results = productIndex.filter(p => {
        const searchStr = normalizeText(`${p.name} ${p.sku || ''} ${p.brand || ''}`);
        return words.every(w => searchStr.includes(w));
    });

    resultsContainer.innerHTML = "";
    if (results.length === 0) {
        resultsContainer.innerHTML = `<div class="p-4 text-xs font-bold text-gray-400 text-center">No encontrado</div>`;
    } else {
        results.slice(0, 10).forEach(p => {
            const div = document.createElement('div');
            div.className = "p-3 hover:bg-brand-cyan/10 cursor-pointer border-b border-gray-50 last:border-0 rounded-lg flex items-center gap-3 transition-colors";
            div.innerHTML = `
                <img src="${p.mainImage || p.image || ''}" class="w-8 h-8 rounded object-contain bg-gray-50 border border-gray-100">
                <div>
                    <p class="text-[11px] font-black uppercase text-brand-black">${p.name}</p>
                    <p class="text-[9px] font-bold text-gray-400">SKU: ${p.sku || 'N/A'}</p>
                </div>`;
            div.onclick = () => {
                searchInput.value = ""; 
                resultsContainer.classList.add('hidden');
                window.showSpecificProduct(p.id);
            };
            resultsContainer.appendChild(div);
        });
    }
    resultsContainer.classList.remove('hidden');
});

window.showGeneralDashboard = () => {
    specificDashboard.classList.add('hidden');
    btnBack.classList.add('hidden');
    generalDashboard.classList.remove('hidden');
    currentTimelineProduct = null;
};

window.showSpecificProduct = (productId) => {
    const data = globalMetrics.find(m => m.product.id === productId);
    if (!data) return;

    currentTimelineProduct = data;
    timelineCurrentPage = 1;

    generalDashboard.classList.add('hidden');
    specificDashboard.classList.remove('hidden');
    btnBack.classList.remove('hidden');
    btnBack.classList.add('flex');

    document.getElementById('dash-name').textContent = data.product.name;
    document.getElementById('dash-sku').textContent = `SKU: ${data.product.sku || 'N/A'}`;
    document.getElementById('dash-img').src = data.product.mainImage || data.product.image || '';

    // Bloque 1: Existencias Actuales & Método Costo Promedio
    document.getElementById('dash-stock-current').textContent = data.currentStock;
    document.getElementById('dash-avg-cost').textContent = formatMoney(data.avgCost);
    document.getElementById('dash-stock-value').textContent = formatMoney(data.totalStockValue);
    document.getElementById('dash-last-cost').textContent = formatMoney(data.lastKnownCost);

    // Bloque 2: Rendimiento Comercial & Método FIFO
    document.getElementById('dash-qty-sold').textContent = data.totalQtySold;
    document.getElementById('dash-revenue').textContent = formatMoney(data.totalRevenue);
    document.getElementById('dash-cogs').textContent = `-${formatMoney(data.totalCOGS)}`;
    document.getElementById('dash-profit').textContent = formatMoney(data.profit);
    document.getElementById('dash-margin').textContent = `Margen: ${data.margin.toFixed(1)}%`;

    renderTimelinePage();
};

initAnalysis();