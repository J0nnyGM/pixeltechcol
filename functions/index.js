require('dotenv').config();

const functions = require("firebase-functions");
const { onSchedule } = require("firebase-functions/v2/scheduler");
const admin = require("firebase-admin");

// --- 1. INICIALIZACIÓN GLOBAL (CRÍTICO) ---
// Esto debe ejecutarse primero para que todos los módulos compartan la instancia
if (!admin.apps.length) {
    admin.initializeApp();
}

// --- 2. IMPORTAR MÓDULOS ---
const mpModule = require('./mercadopago');
const schedulerModule = require('./scheduler');
const codModule = require('./cod');
const addiModule = require('./addi');
const emailModule = require('./emails'); 
const whatsappModule = require('./whatsapp');
const syncModule = require('./sync');
const merchantModule = require('./google-merchant'); // <--- 1. NUEVO: Importar módulo
const sitemapModule = require('./sitemap');

// --- 3. EXPORTAR FUNCIONES ---

// MercadoPago
exports.createMercadoPagoPreference = functions.https.onCall(mpModule.createPreference);
exports.mercadoPagoWebhook = functions.https.onRequest(mpModule.webhook);

// Contra Entrega (COD)
exports.createCODOrder = functions.https.onCall(codModule.createCODOrder);

// ADDI
exports.createAddiCheckout = functions.https.onCall(addiModule.createAddiCheckout);
exports.addiWebhook = functions.https.onRequest(addiModule.webhook);

// Notificaciones por Correo
exports.sendOrderConfirmation = emailModule.sendOrderConfirmation;
exports.sendDispatchNotification = emailModule.sendDispatchNotification;

// Mantenimiento (Scheduler)
exports.cleanupOldOrders = onSchedule("every 24 hours", schedulerModule.cleanupOldOrders);
exports.processScheduledTransfers = schedulerModule.processScheduledTransfers;
exports.cancelAbandonedPayments = schedulerModule.cancelAbandonedPayments;
exports.checkExpiredPromotions = schedulerModule.checkExpiredPromotions;

// WhatsApp
exports.whatsappWebhook = whatsappModule.webhook;
exports.sendWhatsappMessage = whatsappModule.sendMessage;

// Sync
exports.touchProductTimestamp = syncModule.touchProductTimestamp;

// Google Merchant Center (Feed XML)
exports.generateProductFeed = merchantModule.generateProductFeed; // <--- 2. NUEVO: Exportar función

exports.sitemap = sitemapModule.generateSitemap;