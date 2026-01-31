const { onRequest, onCall, HttpsError } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");
const axios = require("axios");
const db = admin.firestore();
const storage = admin.storage();

// --- CONFIGURACIÓN ---
const VERIFY_TOKEN = process.env.WHATSAPP_VERIFY_TOKEN;
const API_TOKEN = process.env.WHATSAPP_API_TOKEN;
const PHONE_ID = process.env.WHATSAPP_PHONE_ID;

// --- HELPERS ---

// 1. Enviar mensaje a Meta (Reutilizable)
async function sendToMeta(phoneNumber, message, type = 'text', mediaUrl = null) {
    const url = `https://graph.facebook.com/v17.0/${PHONE_ID}/messages`;
    let body = { 
        messaging_product: 'whatsapp', 
        to: phoneNumber, 
        type: type 
    };

    if (type === 'image') {
        body.image = { link: mediaUrl, caption: message || "" };
    } else {
        body.text = { body: message };
    }

    try {
        const response = await axios.post(url, body, {
            headers: { 'Authorization': `Bearer ${API_TOKEN}`, 'Content-Type': 'application/json' }
        });
        return response.data.messages[0].id;
    } catch (error) {
        console.error("Error Meta API:", error.response?.data || error.message);
        throw new Error("Fallo al enviar mensaje a WhatsApp");
    }
}

// 2. Descargar y subir multimedia
async function downloadAndUploadMedia(mediaId, mimeType, phoneNumber) {
    try {
        const metaRes = await axios.get(`https://graph.facebook.com/v17.0/${mediaId}`, {
            headers: { 'Authorization': `Bearer ${API_TOKEN}` }
        });
        const fileRes = await axios.get(metaRes.data.url, {
            responseType: 'arraybuffer',
            headers: { 'Authorization': `Bearer ${API_TOKEN}` }
        });

        const ext = mimeType.split('/')[1].split(';')[0] || 'bin';
        const fileName = `chats/${phoneNumber}/${Date.now()}_${mediaId}.${ext}`;
        const file = storage.bucket().file(fileName);

        await file.save(fileRes.data, { metadata: { contentType: mimeType } });
        await file.makePublic();
        return file.publicUrl();
    } catch (error) {
        console.error("Error media:", error);
        return null;
    }
}

// --- WEBHOOK (RECIBIR + BOT) ---
exports.webhook = onRequest({ timeoutSeconds: 60 }, async (req, res) => {
    // A. Verificación (GET)
    if (req.method === "GET") {
        if (req.query["hub.mode"] === "subscribe" && req.query["hub.verify_token"] === VERIFY_TOKEN) {
            res.status(200).send(req.query["hub.challenge"]);
        } else res.sendStatus(403);
        return;
    }

    // B. Recepción (POST)
    if (req.method === "POST") {
        const body = req.body;
        if (body.object && body.entry?.[0]?.changes?.[0]?.value?.messages) {
            const change = body.entry[0].changes[0].value;
            const message = change.messages[0];
            const phoneNumber = message.from;
            const userName = change.contacts[0]?.profile?.name || "Usuario";
            const type = message.type;
            
            let content = "";
            let mediaUrl = null;

            try {
                // 1. Procesar contenido entrante
                if (type === "text") content = message.text.body;
                else if (type === "image") {
                    content = message.image.caption || "📷 Imagen recibida";
                    mediaUrl = await downloadAndUploadMedia(message.image.id, message.image.mime_type, phoneNumber);
                } else if (type === "audio") {
                    content = "🎤 Audio recibido";
                    mediaUrl = await downloadAndUploadMedia(message.audio.id, message.audio.mime_type, phoneNumber);
                } else content = `[Archivo: ${type}]`;

                const chatRef = db.collection('chats').doc(phoneNumber);
                
                // 2. 🤖 LOGICA DEL BOT DE HORARIO 🤖
                // Obtener hora actual en Colombia
                const now = new Date();
                const bogotaHour = parseInt(now.toLocaleString("en-US", {timeZone: "America/Bogota", hour: "numeric", hour12: false}));
                
                // Configuración Horario: 8 PM (20) a 7 AM (7)
                // OJO: Si bogotaHour es 20, 21, 22, 23 OR 0, 1, 2, 3, 4, 5, 6
                const isOutOfOffice = bogotaHour >= 20 || bogotaHour < 7; 

                let autoReplySent = false;

                if (isOutOfOffice) {
                    // Verificamos si ya le respondimos automáticamente hace poco (para no hacer spam en cada mensaje)
                    const docSnap = await chatRef.get();
                    const lastAutoReply = docSnap.exists ? docSnap.data().lastAutoReply?.toDate() : null;
                    
                    // Si nunca le hemos respondido o pasaron más de 12 horas desde la última respuesta automática
                    const hoursSinceLast = lastAutoReply ? (now - lastAutoReply) / (1000 * 60 * 60) : 24;

                    if (hoursSinceLast > 12) {
                        const replyText = "Hola 👋, gracias por escribir a PixelTech.\n\n🌙 Nuestro equipo descansa en este momento, pero hemos recibido tu mensaje y te responderemos a primera hora de la mañana.";
                        
                        // Enviar respuesta a WhatsApp
                        const replyId = await sendToMeta(phoneNumber, replyText, 'text');
                        
                        // Guardar en el historial (Como mensaje saliente del sistema)
                        await chatRef.collection('messages').add({
                            type: 'outgoing', // Para que salga a la derecha
                            content: replyText,
                            messageType: 'text',
                            whatsappId: replyId,
                            isAutoReply: true, // Marca interna
                            timestamp: admin.firestore.Timestamp.now()
                        });

                        autoReplySent = true;
                    }
                }

                // 3. Guardar el mensaje del cliente y actualizar cabecera
                const updateData = {
                    clientName: userName, 
                    phoneNumber, 
                    lastMessage: content,
                    lastMessageAt: admin.firestore.FieldValue.serverTimestamp(),
                    lastCustomerInteraction: admin.firestore.FieldValue.serverTimestamp(),
                    unread: true, // IMPORTANTE: Sigue siendo true para que lo veas mañana
                    platform: 'whatsapp',
                    status: 'open'
                };

                // Si enviamos auto-respuesta, actualizamos la fecha para el control de spam
                if (autoReplySent) {
                    updateData.lastAutoReply = admin.firestore.FieldValue.serverTimestamp();
                    // Opcional: Si quieres que la auto-respuesta quite el "unread", pon unread: false. 
                    // Pero dejémoslo en true para que veas que el cliente escribió.
                }

                await chatRef.set(updateData, { merge: true });

                await chatRef.collection('messages').add({
                    type: 'incoming', 
                    content: content,
                    mediaUrl: mediaUrl,
                    messageType: type,
                    whatsappId: message.id, 
                    timestamp: admin.firestore.Timestamp.now()
                });

            } catch (e) { console.error("Error Webhook:", e); }
        }
        res.sendStatus(200);
    }
});

// --- FUNCIÓN DE ENVÍO MANUAL (PANEL ADMIN) ---
exports.sendMessage = onCall(async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'Login requerido.');
    
    const { phoneNumber, message, type, mediaUrl } = request.data;
    
    try {
        // Usamos el helper
        const waId = await sendToMeta(phoneNumber, message, type, mediaUrl);

        const chatRef = db.collection('chats').doc(phoneNumber);
        await chatRef.set({
            lastMessage: type === 'image' ? '📷 Imagen enviada' : `tú: ${message}`,
            lastMessageAt: admin.firestore.FieldValue.serverTimestamp(),
            unread: false 
        }, { merge: true });

        await chatRef.collection('messages').add({
            type: 'outgoing',
            content: message || (type === 'image' ? 'Imagen enviada' : ''),
            mediaUrl: mediaUrl || null,
            messageType: type || 'text',
            whatsappId: waId,
            timestamp: admin.firestore.Timestamp.now()
        });

        return { success: true };
    } catch (error) {
        throw new HttpsError('internal', error.message);
    }
});