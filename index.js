const { 
    default: makeWASocket, 
    useMultiFileAuthState, 
    DisconnectReason, 
    downloadContentFromMessage 
} = require('@whiskeysockets/baileys');
const pino = require('pino');
const readline = require('readline');

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});
const question = (text) => new Promise((resolve) => rl.question(text, resolve));

const BOT_LOGO_URL = 'https://i.postimg.cc/gc7hhDcF/file-00000000e328820e9000f592feb5a047.png';

async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');

    const sock = makeWASocket({
        logger: pino({ level: 'silent' }),
        auth: state,
        printQRInTerminal: false
    });

    sock.ev.on('creds.update', saveCreds);

    if (!sock.authState.creds.registered) {
        console.log('\n--- AUTENTICAÇÃO ---');
        let phoneNumber = await question('Número (com DDD): ');
        phoneNumber = phoneNumber.replace(/[^0-9]/g, '');
        if (phoneNumber) {
            setTimeout(async () => {
                const code = await sock.requestPairingCode(phoneNumber);
                console.log(`\n🔑 CÓDIGO: \x1b[32m${code}\x1b[0m\n`);
            }, 3000);
        }
    }

    sock.ev.on('connection.update', async (update) => {
        const { connection } = update;
        if (connection === 'open') console.log('\n✅ Pyda Bot conectado!');
    });

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;
        for (const msg of messages) {
            if (!msg.message) continue;
            const from = msg.key.remoteJid;
            const body = msg.message.conversation || msg.message.extendedTextMessage?.text || '';
            const prefix = '.';
            if (!body.startsWith(prefix)) continue;

            const args = body.slice(prefix.length).trim().split(/ +/);
            const command = args.shift().toLowerCase();

            if (command === 'ping') {
                await sock.sendMessage(from, { text: '🏓 Pong! Online e operante!' }, { quoted: msg });
            }

            if (command === 'menu' || command === 'ajuda') {
                const menuCaption = `
⚡ *PYDA BOT* ⚡
─────────────────────
👤 *Desenvolvedor:* Odin
🤖 *Status:* Online
─────────────────────
🛠️ *COMANDOS*
• *.revelar* - Ver fotos de visualização única.
• *.ping* - Testar conexão.
• *.dado* - Jogar dado.
• *.moeda* - Cara ou coroa.
• *.dono* - Contato do criador.
─────────────────────
💻 _Pyda Systems v1.0_`.trim();

                await sock.sendMessage(from, { 
                    image: { url: BOT_LOGO_URL }, 
                    caption: menuCaption 
                }, { quoted: msg });
            }

            if (command === 'dono') {
                await sock.sendMessage(from, { text: '👑 O desenvolvedor do Pyda Bot é o *Odin*!' }, { quoted: msg });
            }

            if (command === 'dado') {
                await sock.sendMessage(from, { text: `🎲 Você tirou o número *${Math.floor(Math.random() * 6) + 1}*!` }, { quoted: msg });
            }

            if (command === 'moeda') {
                await sock.sendMessage(from, { text: `🪙 A moeda caiu em: *${Math.random() < 0.5 ? 'Cara' : 'Coroa'}*!` }, { quoted: msg });
            }

            if (command === 'revelar' || command === 'r') {
                const quotedMsg = msg.message.extendedTextMessage?.contextInfo?.quotedMessage;
                if (!quotedMsg) {
                    await sock.sendMessage(from, { text: '⚠️ Responda a uma foto/vídeo de visualização única.' }, { quoted: msg });
                    continue;
                }
                const viewOnceMsg = quotedMsg.viewOnceMessageV2?.message || quotedMsg.viewOnceMessage?.message || quotedMsg;
                const mediaType = viewOnceMsg.imageMessage ? 'image' : viewOnceMsg.videoMessage ? 'video' : null;
                
                if (!mediaType) {
                    await sock.sendMessage(from, { text: '⚠️ Não é uma mídia de visualização única.' }, { quoted: msg });
                    continue;
                }

                const mediaMessage = mediaType === 'image' ? viewOnceMsg.imageMessage : viewOnceMsg.videoMessage;
                const stream = await downloadContentFromMessage(mediaMessage, mediaType);
                let buffer = Buffer.alloc(0);
                for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);

                await sock.sendMessage(from, { [mediaType]: buffer, caption: '🔓 *Revelado pelo Pyda!*' }, { quoted: msg });
            }
        }
    });
}

connectToWhatsApp();
