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

async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');

    const sock = makeWASocket({
        logger: pino({ level: 'silent' }),
        auth: state,
        printQRInTerminal: false
    });

    sock.ev.on('creds.update', saveCreds);

    if (!sock.authState.creds.registered) {
        console.log('\n--- AUTENTICAÇÃO POR CÓDIGO DE PAREAMENTO ---');
        let phoneNumber = await question('Digite o número do seu WhatsApp com DDD e DDI (ex: 55319XXXXXXXX): ');
        phoneNumber = phoneNumber.replace(/[^0-9]/g, '');

        if (phoneNumber) {
            setTimeout(async () => {
                try {
                    const code = await sock.requestPairingCode(phoneNumber);
                    console.log(`\n🔑 CÓDIGO DE PAREAMENTO DO PYDA: \x1b[32m${code}\x1b[0m\n`);
                    console.log('1. Abra o WhatsApp no celular.');
                    console.log('2. Vá em Configurações > Aparelhos Conectados > Conectar um aparelho.');
                    console.log('3. Toque em "Conectar com número de telefone" e digite esse código!\n');
                } catch (err) {
                    console.error('Erro ao gerar código de pareamento:', err);
                }
            }, 3000);
        }
    }

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update;

        if (connection === 'close') {
            const statusCode = lastDisconnect?.error?.output?.statusCode;
            const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

            console.log(`Conexão fechada (Código: ${statusCode}). Reconectando: ${shouldReconnect}`);

            if (shouldReconnect) {
                connectToWhatsApp();
            } else {
                console.log('Sessão encerrada. Apague a pasta auth_info_baileys e tente novamente.');
            }
        } else if (connection === 'open') {
            console.log('\n✅ Pyda Bot conectado com sucesso ao WhatsApp!');
        }
    });

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;

        for (const msg of messages) {
            if (!msg.message || msg.key.fromMe) continue;

            const from = msg.key.remoteJid;
            const body = msg.message.conversation || 
                         msg.message.extendedTextMessage?.text || 
                         msg.message.imageMessage?.caption || 
                         msg.message.videoMessage?.caption || '';

            const prefix = '.';
            if (!body.startsWith(prefix)) continue;

            const args = body.slice(prefix.length).trim().split(/ +/);
            const command = args.shift().toLowerCase();

            if (command === 'ping') {
                await sock.sendMessage(from, { text: '🏓 Pong! Pyda online!' }, { quoted: msg });
            }

            if (command === 'menu' || command === 'ajuda') {
                const menuText = `
🤖 *PYDA BOT* 🤖

📌 *Comandos Disponíveis:*
• *.ping* - Testar conexão
• *.revelar* - Revelar foto/vídeo de visualização única (marque a mensagem)
• *.menu* - Exibir este menu
`.trim();
                await sock.sendMessage(from, { text: menuText }, { quoted: msg });
            }

            if (command === 'revelar' || command === 'r') {
                try {
                    const quotedMsg = msg.message.extendedTextMessage?.contextInfo?.quotedMessage;

                    if (!quotedMsg) {
                        await sock.sendMessage(from, { text: '⚠️ Responda/Marque a foto ou vídeo de visualização única usando *.revelar*' }, { quoted: msg });
                        continue;
                    }

                    const viewOnceMsg = quotedMsg.viewOnceMessageV2?.message || quotedMsg.viewOnceMessage?.message || quotedMsg;
                    const mediaType = viewOnceMsg.imageMessage ? 'image' : viewOnceMsg.videoMessage ? 'video' : null;

                    if (!mediaType) {
                        await sock.sendMessage(from, { text: '⚠️ A mensagem marcada não contém uma foto ou vídeo.' }, { quoted: msg });
                        continue;
                    }

                    const mediaMessage = mediaType === 'image' ? viewOnceMsg.imageMessage : viewOnceMsg.videoMessage;
                    
                    const stream = await downloadContentFromMessage(mediaMessage, mediaType);
                    let buffer = Buffer.alloc(0);
                    for await (const chunk of stream) {
                        buffer = Buffer.concat([buffer, chunk]);
                    }

                    if (mediaType === 'image') {
                        await sock.sendMessage(from, { 
                            image: buffer, 
                            caption: '🔓 *Foto revelada pelo Pyda!*' 
                        }, { quoted: msg });
                    } else if (mediaType === 'video') {
                        await sock.sendMessage(from, { 
                            video: buffer, 
                            caption: '🔓 *Vídeo revelado pelo Pyda!*' 
                        }, { quoted: msg });
                    }
                } catch (err) {
                    console.error('Erro ao revelar mídia:', err);
                    await sock.sendMessage(from, { text: '❌ Falha ao revelar a mídia.' }, { quoted: msg });
                }
            }
        }
    });
}

connectToWhatsApp();

