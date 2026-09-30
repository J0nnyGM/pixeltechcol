const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const axios = require('axios');

const PHONE_ID = process.env.WHATSAPP_PHONE_ID;
const API_TOKEN = process.env.WHATSAPP_API_TOKEN;

// Argumentos desde la línea de comandos
// Uso:
//   node block-number.js                      -> Bloquea +573174534110 por defecto
//   node block-number.js +573001234567        -> Bloquea ese número
//   node block-number.js list                 -> Lista números bloqueados en Meta
//   node block-number.js unblock +573174534110 -> Desbloquea el número en Meta
const args = process.argv.slice(2);
let command = 'block';
let rawPhone = '+573174534110';

if (args.length === 1) {
    if (args[0] === 'list' || args[0] === '--list' || args[0] === '-l') {
        command = 'list';
    } else {
        rawPhone = args[0];
        command = 'block';
    }
} else if (args.length >= 2) {
    command = args[0].toLowerCase();
    rawPhone = args[1];
}

// Limpiar formato del teléfono (quitar +, espacios, guiones)
let cleanPhone = rawPhone.replace(/\D/g, '');
if (cleanPhone.length === 10 && !cleanPhone.startsWith('57')) {
    cleanPhone = '57' + cleanPhone; // Si ingresan solo 3174534110, anteponer 57
}

async function run() {
    console.log(`====================================================`);
    console.log(`🛡️  GESTIÓN DE BLOQUEO WHATSAPP CLOUD API`);
    console.log(`====================================================`);
    console.log(`🔑 Phone ID: ${PHONE_ID}`);

    if (!PHONE_ID || !API_TOKEN) {
        console.error('❌ Error: WHATSAPP_PHONE_ID o WHATSAPP_API_TOKEN no encontrados en functions/.env');
        process.exit(1);
    }

    const baseUrl = `https://graph.facebook.com/v17.0/${PHONE_ID}/block_users`;
    const headers = {
        'Authorization': `Bearer ${API_TOKEN}`,
        'Content-Type': 'application/json'
    };

    if (command === 'list') {
        console.log(`📋 Consultando lista de números bloqueados en Meta...`);
        try {
            const res = await axios.get(baseUrl, { headers });
            const list = res.data.data || [];
            console.log(`\n✅ Actualmente hay ${list.length} número(s) bloqueado(s):`);
            list.forEach((item, index) => {
                console.log(`   ${index + 1}. +${item.wa_id}`);
            });
            console.log(``);
        } catch (err) {
            console.error('❌ Error al consultar lista en Meta:', err.response?.data || err.message);
        }
        console.log(`====================================================`);
        return;
    }

    if (command === 'unblock') {
        console.log(`🔓 Desbloqueando número: ${rawPhone} (wa_id: ${cleanPhone})...`);
        try {
            const res = await axios.delete(baseUrl, {
                headers,
                data: {
                    messaging_product: 'whatsapp',
                    block_users: [{ user: cleanPhone }]
                }
            });
            console.log(`✅ ¡Éxito! El número +${cleanPhone} ha sido desbloqueado en Meta.`);
            console.log(`Respuesta:`, JSON.stringify(res.data, null, 2));
        } catch (err) {
            console.error('❌ Error al desbloquear en Meta:', err.response?.data || err.message);
        }
        console.log(`====================================================`);
        return;
    }

    // Comando por defecto: BLOCK
    console.log(`🚫 Bloqueando número: ${rawPhone} (wa_id: ${cleanPhone})...`);
    try {
        const res = await axios.post(baseUrl, {
            messaging_product: 'whatsapp',
            block_users: [{ user: cleanPhone }]
        }, { headers });

        console.log(`✅ ¡Éxito! El número +${cleanPhone} ha sido BLOQUEADO en Meta.`);
        console.log(`Respuesta de Meta:`, JSON.stringify(res.data, null, 2));
    } catch (err) {
        console.error('❌ Error al bloquear en Meta:', err.response?.data || err.message);
    }

    // Consultar lista actualizada
    try {
        console.log(`----------------------------------------------------`);
        console.log(`📋 Verificando estado en Meta...`);
        const listRes = await axios.get(baseUrl, { headers });
        const list = listRes.data.data || [];
        console.log(`Lista oficial de bloqueados en Meta (${list.length}):`);
        list.forEach((item, idx) => {
            console.log(`   ${idx + 1}. +${item.wa_id}`);
        });
    } catch (e) {}

    console.log(`====================================================`);
}

run();
