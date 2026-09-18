// functions/mercadolibre3.js
const { createWebhookHandler, createRenewTokenTask } = require('./mercadolibre');

// Webhook oficial para MercadoLibre Tienda 3
// Soporta vinculación OAuth (?code=...), webhooks de órdenes en tiempo real,
// cálculo de comisiones, impuestos, envíos Flex y sincronización de stock
exports.webhook = createWebhookHandler({
    storeDocName: 'mercadolibre_store3',
    storeNumber: 3,
    orderPrefix: 'ML3-',
    source: 'MERCADOLIBRE_STORE3',
    paymentMethod: 'MERCADOLIBRE_3',
    storeTitle: 'MercadoLibre Tienda 3'
});

// Tarea programada para auto-renovar tokens de Tienda 3 cada 5 horas
exports.renewTokenTask = createRenewTokenTask({
    storeDocName: 'mercadolibre_store3',
    storeNumber: 3,
    storeTitle: 'MercadoLibre Tienda 3'
});