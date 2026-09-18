// functions/mercadolibre2.js
const { createWebhookHandler, createRenewTokenTask } = require('./mercadolibre');

// Webhook oficial para MercadoLibre Tienda 2
// Soporta vinculación OAuth (?code=...), webhooks de órdenes en tiempo real,
// cálculo de comisiones, impuestos, envíos Flex y sincronización de stock
exports.webhook = createWebhookHandler({
    storeDocName: 'mercadolibre_store2',
    storeNumber: 2,
    orderPrefix: 'ML2-',
    source: 'MERCADOLIBRE_STORE2',
    paymentMethod: 'MERCADOLIBRE_2',
    storeTitle: 'MercadoLibre Tienda 2'
});

// Tarea programada para auto-renovar tokens de Tienda 2 cada 5 horas
exports.renewTokenTask = createRenewTokenTask({
    storeDocName: 'mercadolibre_store2',
    storeNumber: 2,
    storeTitle: 'MercadoLibre Tienda 2'
});