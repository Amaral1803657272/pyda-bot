const { 
    default: makeWASocket, 
    useMultiFileAuthState, 
    DisconnectReason, 
    downloadContentFromMessage 
} = require('@whiskeysockets/baileys');
const pino = require('pino');
const readline = require('readline');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const ffmpeg = require('fluent-ffmpeg');
const exifParser = require('exif-parser');

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});
const question = (text) => new Promise((resolve) => rl.question(text, resolve));

// Foto oficial do menu e Chave do SerpApi
const BOT_LOGO_URL = 'https://i.postimg.cc/gc7hhDcF/file-00000000e328820e9000f592feb5a047.png';
const SERPAPI_KEY = '620a2024ca25d90d361ce248a15d6c2ca740ae0687ce3e8d95eccdac14d6ce7e';

// Banco de Dados Local
const DB_FILE = './database.json';
if (!fs.existsSync(DB_FILE)) {
    fs.writeFileSync(DB_FILE, JSON.stringify({ users: {}, groups: {}, autoresponder: {} }, null, 2));
}

function loadDB() {
    let data = JSON.parse(fs.readFileSync(DB_FILE, 'utf-8'));
    if (!data.users) data.users = {};
    if (!data.groups) data.groups = {};
    if (!data.autoresponder) data.autoresponder = {};
    return data;
}

function saveDB(data) {
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

function getUser(db, sender, name = 'Usuário') {
    if (!db.users[sender]) {
        db.users[sender] = {
            nome: name,
            carteira: 200,
            banco: 0,
            xp: 0,
            nivel: 1,
            hp: 100,
            jogos: 0,
            vitorias: 0,
            dailyCooldown: 0,
            workCooldown: 0,
            warnings: 0
        };
    }
    db.users[sender].nome = name;
    if (db.users[sender].hp === undefined) db.users[sender].hp = 100;
    return db.users[sender];
}

function addXP(user, amount) {
    user.xp += amount;
    const nextLevel = user.nivel * 100;
    if (user.xp >= nextLevel) {
        user.nivel += 1;
        return true;
    }
    return false;
}

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
                console.log(`\n🔑 CÓDIGO DE PAREAMENTO: \x1b[32m${code}\x1b[0m\n`);
            }, 3000);
        }
    }

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'open') {
            console.log('\n✅ Pyda Bot v4.0 Conectado com Sucesso!');
        } else if (connection === 'close') {
            const reconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            if (reconnect) connectToWhatsApp();
        }
    });

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;
        for (const msg of messages) {
            if (!msg.message) continue;
            const from = msg.key.remoteJid;
            const isGroup = from.endsWith('@g.us');

            // Metadados GPS em Fotos
            if (msg.message?.imageMessage) {
                try {
                    const stream = await downloadContentFromMessage(msg.message.imageMessage, 'image');
                    let buffer = Buffer.alloc(0);
                    for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);
                    const parser = exifParser.create(buffer);
                    const result = parser.parse();

                    if (result.tags.GPSLatitude) {
                        const gps = `📍 *Metadados GPS Detectados!*\n─────────────────────\n🌐 Lat: ${result.tags.GPSLatitude}\n🌐 Long: ${result.tags.GPSLongitude}\n📸 Câmera: ${result.tags.Model || 'Desconhecido'}\n─────────────────────`;
                        await sock.sendMessage(from, { text: gps }, { quoted: msg });
                    }
                } catch (e) { /* Sem EXIF */ }
            }

            const sender = msg.key.fromMe 
                ? (sock.user?.id.split(':')[0] + '@s.whatsapp.net') 
                : (msg.key.participant || msg.key.remoteJid);
            const pushName = msg.pushName || 'Membro';

            const body = msg.message.conversation || 
                         msg.message.extendedTextMessage?.text || 
                         msg.message.imageMessage?.caption || 
                         msg.message.videoMessage?.caption || '';
                         
            const prefix = '.';
            const db = loadDB();
            const user = getUser(db, sender, pushName);
            
            const levelUp = addXP(user, 10);
            if (levelUp) {
                await sock.sendMessage(from, { text: `🎉 Parabéns @${sender.split('@')[0]}! Subiu para o *Nível ${user.nivel}*!`, mentions: [sender] });
            }
            saveDB(db);

            const bodyTrimmed = body.trim();
            const isCommand = bodyTrimmed.startsWith(prefix);

            if (!isCommand) {
                const chatAuto = db.autoresponder[from] || {};
                const textLower = bodyTrimmed.toLowerCase();
                if (chatAuto[textLower]) {
                    await sock.sendMessage(from, { text: chatAuto[textLower] }, { quoted: msg });
                }
                continue;
            }

            const args = bodyTrimmed.slice(prefix.length).trim().split(/ +/);
            const command = args.shift().toLowerCase();

            switch (command) {
                case 'menu':
                case 'ajuda': {
                    const menuCaption = `
╭━━━「 PYDA BOT v4.0 」━━━╮
┃
┃ 👤 Desenvolvedor: Odin
┃ 🤖 Status: Online
┃ ⚙️ Prefixo: [ . ]
┃
┣━━「 📚 CATEGORIAS 」━━
┃
┃ 👑 .menudono
┃ ┣ Comandos do Criador
┃
┃ 🛡️ .menuadm
┃ ┣ Administração do Grupo
┃
┃ 🤖 .menuauto
┃ ┣ Automação & Respostas
┃
┃ 🧰 .menumembro
┃ ┣ Utilitários Rápidos
┃
┃ 🎨 .menufig
┃ ┣ Figurinhas & Mídia
┃
┃ ⚔️ .menurpg
┃ ┣ RPG & Economia
┃
┃ 🎮 .menujogos
┃ ┣ Jogos & Cassino
┃
┃ 🧠 .menuia
┃ ┣ Inteligência Artificial
┃
┃ 📥 .menudownload
┃ ┣ Downloads
┃
┃ 🛠️ .menuferramentas
┃ ┣ Ferramentas & Utilidades
┃
┃ 👤 .perfil
┃ ┣ Seu Status & Moedas
┃
┃ 🏆 .rank
┃ ┣ Ranking do Grupo
┃
┃ 🔎 .menuosint
┃ ┣ Ferramentas OSINT
┃
╰━━━━━━━━━━━━━━━━━━━━╯
        💻 Pyda Systems v4.0`.trim();
                    try {
                        await sock.sendMessage(from, { image: { url: BOT_LOGO_URL }, caption: menuCaption }, { quoted: msg });
                    } catch {
                        await sock.sendMessage(from, { text: menuCaption }, { quoted: msg });
                    }
                    break;
                }

                case 'menudono': {
                    const txt = `
╭━━━「 👑 MENU DONO 」━━━╮
┃
┃ 📢 *.bc [texto]* - Transmissão Geral
┃ 👤 *.dono* - Contato do Criador
┃ ⚙️ *.restart* - Reiniciar Bot
┃
╰━━━━━━━━━━━━━━━━━━━━╯`.trim();
                    await sock.sendMessage(from, { text: txt }, { quoted: msg });
                    break;
                }

                case 'menuauto': {
                    const txt = `
╭━━━「 🤖 AUTOMAÇÃO 」━━━╮
┃
┃ 💬 *.addauto [gatilho] | [resposta]*
┃ ❌ *.delauto [gatilho]*
┃ 📋 *.listauto*
┃
╰━━━━━━━━━━━━━━━━━━━━╯`.trim();
                    await sock.sendMessage(from, { text: txt }, { quoted: msg });
                    break;
                }

                case 'menurpg': {
                    const txt = `
╭━━━「 ⚔️ RPG & ECONOMIA 」━━━╮
┃
┃ 💼 *.trabalhar* - Ganhe dinheiro
┃ 💳 *.saldo* - Veja suas finanças
┃ 🏦 *.depositar [valor]* - Guardar dinheiro
┃ 🏧 *.sacar [valor]* - Retirar dinheiro
┃ 🐉 *.dragao* - Enfrente o Dragão
┃ 💊 *.curar* - Restaurar HP (R$ 50)
┃
╰━━━━━━━━━━━━━━━━━━━━╯`.trim();
                    await sock.sendMessage(from, { text: txt }, { quoted: msg });
                    break;
                }

                case 'menujogos': {
                    const txt = `
╭━━━「 🎮 CASSINO & JOGOS 」━━━╮
┃
┃ 🚀 *.foguete [2x/3x] [aposta]*
┃ 🎰 *.tigrinho [aposta]*
┃ 🎯 *.roleta [cor] [aposta]*
┃ 🃏 *.21 [aposta]*
┃ 🪙 *.caraoucoroa [cara/coroa] [aposta]*
┃ 🎲 *.dado*
┃ 🎁 *.daily* - Bônus Diário
┃
╰━━━━━━━━━━━━━━━━━━━━╯`.trim();
                    await sock.sendMessage(from, { text: txt }, { quoted: msg });
                    break;
                }

                case 'menumembro': {
                    const txt = `
╭━━━「 🧰 UTILITÁRIOS 」━━━╮
┃
┃ 🖼️ *.s* / *.fig* - Criar Sticker
┃ 🔍 *.ping* - Testar Velocidade
┃ 👁️ *.revelar* - Baixar Mídia Única
┃
╰━━━━━━━━━━━━━━━━━━━━╯`.trim();
                    await sock.sendMessage(from, { text: txt }, { quoted: msg });
                    break;
                }

                case 'menuia': {
                    const txt = `
╭━━━「 🧠 INTELIGÊNCIA ARTIFICIAL 」━━━╮
┃
┃ 🤖 *.ia [pergunta]*
┃ 💬 *.chat [mensagem]*
┃ 📝 *.resuma [texto]*
┃ 🌐 *.traduz [texto]*
┃ 💻 *.codigo [pedido]*
┃
╰━━━━━━━━━━━━━━━━━━━━╯`.trim();
                    await sock.sendMessage(from, { text: txt }, { quoted: msg });
                    break;
                }

                case 'menuadm': {
                    const txt = `
╭━━━「 🛡️ MENU ADM 」━━━╮
┃
┃ 📢 *.hidetag [texto]* - Marcação oculta
┃ 🛑 *.ban* / *.kick [@membro]* - Banir membro
┃ 👑 *.promover [@membro]* - Dar ADM
┃ ⬇️ *.rebaixar [@membro]* - Tirar ADM
┃ ⚠️ *.warn [@membro]* - Dar advertência
┃ 📋 *.warnings [@membro]* - Ver advertências
┃ 🚪 *.grupo [abrir/fechar]* - Trancar/Abrir grupo
┃ 📢 *.marcartodos [motivo]* - Marcar todos
┃ 🗑️ *.apagar* - Apagar mensagem do bot
┃
╰━━━━━━━━━━━━━━━━━━━━╯`.trim();
                    await sock.sendMessage(from, { text: txt }, { quoted: msg });
                    break;
                }

                case 'menufig': {
                    const txt = `
╭━━━「 🎨 FIGURINHAS 」━━━╮
┃
┃ 🖼️ *.s* / *.fig* - Sticker de Foto/Vídeo
┃ 🔤 *.ttp [texto]* - Sticker Texto Estático
┃ ⚡ *.attp [texto]* - Sticker Texto Colorido
┃
╰━━━━━━━━━━━━━━━━━━━━╯`.trim();
                    await sock.sendMessage(from, { text: txt }, { quoted: msg });
                    break;
                }

                case 'menudownload': {
                    const txt = `
╭━━━「 📥 DOWNLOADS 」━━━╮
┃
┃ 🖼️ Utilizar comandos gerais de mídia.
┃
╰━━━━━━━━━━━━━━━━━━━━╯`.trim();
                    await sock.sendMessage(from, { text: txt }, { quoted: msg });
                    break;
                }

                case 'menuferramentas': {
                    const txt = `
╭━━━「 🛠️ FERRAMENTAS 」━━━╮
┃
┃ 🔳 *.qrcode [texto]*
┃ 🌤️ *.clima [cidade]*
┃ 🔗 *.encurtar [link]*
┃ 🔑 *.senha [tamanho]*
┃
╰━━━━━━━━━━━━━━━━━━━━╯`.trim();
                    await sock.sendMessage(from, { text: txt }, { quoted: msg });
                    break;
                }

                case 'menuosint': {
                    const txt = `
╭━━━「 🔎 FERRAMENTAS OSINT 」━━━╮
┃
┃ 🔎 *.search [termo]* - Google
┃ 🌐 *.ip [ip]* - Localizar IP
┃ 🏢 *.cnpj [cnpj]* - Dados da Empresa
┃ 📍 *.cep [cep]* - Buscar Endereço
┃
╰━━━━━━━━━━━━━━━━━━━━╯`.trim();
                    await sock.sendMessage(from, { text: txt }, { quoted: msg });
                    break;
                }

                case 'hidetag': {
                    if (!isGroup) return await sock.sendMessage(from, { text: '⚠️ Este comando só funciona em grupos.' }, { quoted: msg });

                    const groupMetadata = await sock.groupMetadata(from);
                    const groupAdmins = groupMetadata.participants.filter(p => p.admin !== null).map(p => p.id);
                    const isAdmin = groupAdmins.includes(sender);

                    if (!isAdmin) return await sock.sendMessage(from, { text: '❌ Apenas administradores do grupo podem usar este comando.' }, { quoted: msg });

                    const participants = groupMetadata.participants.map(p => p.id);
                    const quotedMsg = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
                    const textHide = args.join(' ') || (quotedMsg?.conversation || quotedMsg?.extendedTextMessage?.text || '📢 Aviso da Administração!');

                    await sock.sendMessage(from, { text: textHide, mentions: participants });
                    break;
                }

                case 'ban':
                case 'kick': {
                    if (!isGroup) return await sock.sendMessage(from, { text: '⚠️ Este comando só funciona em grupos.' }, { quoted: msg });

                    const groupMetadata = await sock.groupMetadata(from);
                    const groupAdmins = groupMetadata.participants.filter(p => p.admin !== null).map(p => p.id);
                    const isAdmin = groupAdmins.includes(sender);
                    const isBotAdmin = groupAdmins.includes(sock.user?.id.split(':')[0] + '@s.whatsapp.net');

                    if (!isAdmin) return await sock.sendMessage(from, { text: '❌ Você precisa ser Administrador para usar este comando.' }, { quoted: msg });
                    if (!isBotAdmin) return await sock.sendMessage(from, { text: '❌ O Bot precisa ser Administrador do grupo!' }, { quoted: msg });

                    const quotedSender = msg.message?.extendedTextMessage?.contextInfo?.participant;
                    const mentioned = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0] || quotedSender;

                    if (!mentioned) return await sock.sendMessage(from, { text: '⚠️ Marque ou responda à mensagem da pessoa que deseja remover.' }, { quoted: msg });

                    try {
                        await sock.groupParticipantsUpdate(from, [mentioned], 'remove');
                        await sock.sendMessage(from, { text: `🚨 @${mentioned.split('@')[0]} foi removido com sucesso!`, mentions: [mentioned] }, { quoted: msg });
                    } catch {
                        await sock.sendMessage(from, { text: '❌ Erro ao tentar remover o usuário.' }, { quoted: msg });
                    }
                    break;
                }

                case 'promover': {
                    if (!isGroup) return await sock.sendMessage(from, { text: '⚠️ Este comando só funciona em grupos.' }, { quoted: msg });

                    const groupMetadata = await sock.groupMetadata(from);
                    const groupAdmins = groupMetadata.participants.filter(p => p.admin !== null).map(p => p.id);
                    const isAdmin = groupAdmins.includes(sender);
                    const isBotAdmin = groupAdmins.includes(sock.user?.id.split(':')[0] + '@s.whatsapp.net');

                    if (!isAdmin) return await sock.sendMessage(from, { text: '❌ Apenas ADMs podem promover membros.' }, { quoted: msg });
                    if (!isBotAdmin) return await sock.sendMessage(from, { text: '❌ O Bot precisa ser ADM do grupo!' }, { quoted: msg });

                    const quotedSender = msg.message?.extendedTextMessage?.contextInfo?.participant;
                    const mentioned = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0] || quotedSender;

                    if (!mentioned) return await sock.sendMessage(from, { text: '⚠️ Marque ou responda à pessoa que deseja promover.' }, { quoted: msg });

                    await sock.groupParticipantsUpdate(from, [mentioned], 'promote');
                    await sock.sendMessage(from, { text: `👑 @${mentioned.split('@')[0]} agora é um Administrador!`, mentions: [mentioned] }, { quoted: msg });
                    break;
                }

                case 'rebaixar': {
                    if (!isGroup) return await sock.sendMessage(from, { text: '⚠️ Este comando só funciona em grupos.' }, { quoted: msg });

                    const groupMetadata = await sock.groupMetadata(from);
                    const groupAdmins = groupMetadata.participants.filter(p => p.admin !== null).map(p => p.id);
                    const isAdmin = groupAdmins.includes(sender);
                    const isBotAdmin = groupAdmins.includes(sock.user?.id.split(':')[0] + '@s.whatsapp.net');

                    if (!isAdmin) return await sock.sendMessage(from, { text: '❌ Apenas ADMs podem rebaixar membros.' }, { quoted: msg });
                    if (!isBotAdmin) return await sock.sendMessage(from, { text: '❌ O Bot precisa ser ADM do grupo!' }, { quoted: msg });

                    const quotedSender = msg.message?.extendedTextMessage?.contextInfo?.participant;
                    const mentioned = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0] || quotedSender;

                    if (!mentioned) return await sock.sendMessage(from, { text: '⚠️ Marque ou responda à pessoa que deseja rebaixar.' }, { quoted: msg });

                    await sock.groupParticipantsUpdate(from, [mentioned], 'demote');
                    await sock.sendMessage(from, { text: `📉 @${mentioned.split('@')[0]} perdeu o cargo de Administrador.`, mentions: [mentioned] }, { quoted: msg });
                    break;
                }

                case 'warn': {
                    if (!isGroup) return await sock.sendMessage(from, { text: '⚠️ Este comando só funciona em grupos.' }, { quoted: msg });

                    const groupMetadata = await sock.groupMetadata(from);
                    const groupAdmins = groupMetadata.participants.filter(p => p.admin !== null).map(p => p.id);
                    const isAdmin = groupAdmins.includes(sender);
                    const isBotAdmin = groupAdmins.includes(sock.user?.id.split(':')[0] + '@s.whatsapp.net');

                    if (!isAdmin) return await sock.sendMessage(from, { text: '❌ Apenas ADMs podem dar advertências.' }, { quoted: msg });

                    const quotedSender = msg.message?.extendedTextMessage?.contextInfo?.participant;
                    const mentioned = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0] || quotedSender;

                    if (!mentioned) return await sock.sendMessage(from, { text: '⚠️ Marque ou responda ao membro.' }, { quoted: msg });

                    const targetUser = getUser(db, mentioned);
                    targetUser.warnings += 1;
                    
                    if (targetUser.warnings >= 3) {
                        targetUser.warnings = 0;
                        saveDB(db);
                        await sock.sendMessage(from, { text: `🚨 @${mentioned.split('@')[0]} atingiu 3/3 advertências e foi removido!`, mentions: [mentioned] });
                        if (isBotAdmin) {
                            await sock.groupParticipantsUpdate(from, [mentioned], 'remove');
                        }
                    } else {
                        saveDB(db);
                        await sock.sendMessage(from, { text: `⚠️ Advertência aplicada a @${mentioned.split('@')[0]}! (${targetUser.warnings}/3)`, mentions: [mentioned] });
                    }
                    break;
                }

                case 'warnings': {
                    const quotedSender = msg.message?.extendedTextMessage?.contextInfo?.participant;
                    const mentioned = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid?.[0] || quotedSender || sender;
                    const targetUser = getUser(db, mentioned);
                    await sock.sendMessage(from, { text: `📋 O usuário @${mentioned.split('@')[0]} possui *${targetUser.warnings}/3* advertências.`, mentions: [mentioned] }, { quoted: msg });
                    break;
                }

                case 'grupo': {
                    if (!isGroup) return await sock.sendMessage(from, { text: '⚠️ Este comando só funciona em grupos.' }, { quoted: msg });

                    const groupMetadata = await sock.groupMetadata(from);
                    const groupAdmins = groupMetadata.participants.filter(p => p.admin !== null).map(p => p.id);
                    const isAdmin = groupAdmins.includes(sender);
                    const isBotAdmin = groupAdmins.includes(sock.user?.id.split(':')[0] + '@s.whatsapp.net');

                    if (!isAdmin) return await sock.sendMessage(from, { text: '❌ Apenas ADMs podem alterar as configurações do grupo.' }, { quoted: msg });
                    if (!isBotAdmin) return await sock.sendMessage(from, { text: '❌ O Bot precisa ser ADM do grupo!' }, { quoted: msg });

                    const action = args[0]?.toLowerCase();
                    if (action === 'fechar') {
                        await sock.groupSettingUpdate(from, 'announcement');
                        await sock.sendMessage(from, { text: '🔒 Grupo fechado! Apenas administradores podem enviar mensagens.' }, { quoted: msg });
                    } else if (action === 'abrir') {
                        await sock.groupSettingUpdate(from, 'not_announcement');
                        await sock.sendMessage(from, { text: '🔓 Grupo aberto! Todos os membros podem enviar mensagens.' }, { quoted: msg });
                    } else {
                        await sock.sendMessage(from, { text: '⚠️ Use `.grupo abrir` ou `.grupo fechar`.' }, { quoted: msg });
                    }
                    break;
                }

                case 'marcartodos': {
                    if (!isGroup) return await sock.sendMessage(from, { text: '⚠️ Este comando só funciona em grupos.' }, { quoted: msg });

                    const groupMetadata = await sock.groupMetadata(from);
                    const groupAdmins = groupMetadata.participants.filter(p => p.admin !== null).map(p => p.id);
                    const isAdmin = groupAdmins.includes(sender);

                    if (!isAdmin) return await sock.sendMessage(from, { text: '❌ Apenas ADMs podem marcar todos.' }, { quoted: msg });

                    const participants = groupMetadata.participants.map(p => p.id);
                    const motivo = args.join(' ') || 'Atenção todos!';
                    await sock.sendMessage(from, { text: `📢 *CHAMADA GERAL*\n💬 *Motivo:* ${motivo}\n\n` + participants.map(p => `@${p.split('@')[0]}`).join(' '), mentions: participants });
                    break;
                }

                case 'apagar': {
                    const quotedMsgKey = msg.message?.extendedTextMessage?.contextInfo?.stanzaId;
                    const participant = msg.message?.extendedTextMessage?.contextInfo?.participant;
                    if (!quotedMsgKey) return await sock.sendMessage(from, { text: '⚠️ Responda à mensagem que deseja apagar.' }, { quoted: msg });
                    await sock.sendMessage(from, { delete: { remoteJid: from, fromMe: false, id: quotedMsgKey, participant } });
                    break;
                }

                case 'ia':
                case 'chat':
                case 'resuma':
                case 'traduz':
                case 'codigo': {
                    const prompt = args.join(' ');
                    if (!prompt) return await sock.sendMessage(from, { text: '⚠️ Digite algo para a Inteligência Artificial.' }, { quoted: msg });
                    await sock.sendMessage(from, { text: '🧠 *Processando...*' }, { quoted: msg });
                    try {
                        const res = await axios.get(`https://api.simsimi.vn/v2/simsimi?text=${encodeURIComponent(prompt)}&lc=pt`);
                        const reply = res.data.success || 'Não consegui processar o pedido.';
                        await sock.sendMessage(from, { text: `🤖 *Pyda IA:* ${reply}` }, { quoted: msg });
                    } catch {
                        await sock.sendMessage(from, { text: '❌ O servidor de IA está indisponível no momento.' }, { quoted: msg });
                    }
                    break;
                }

                case 'addauto': {
                    const content = args.join(' ').split('|');
                    if (content.length < 2) return await sock.sendMessage(from, { text: '⚠️ Uso correto: `.addauto gatilho | resposta`' }, { quoted: msg });
                    const gatilho = content[0].trim().toLowerCase();
                    const resposta = content[1].trim();
                    
                    if (!db.autoresponder[from]) db.autoresponder[from] = {};
                    db.autoresponder[from][gatilho] = resposta;
                    saveDB(db);
                    await sock.sendMessage(from, { text: `✅ Resposta criada para: *${gatilho}*` }, { quoted: msg });
                    break;
                }

                case 'delauto': {
                    const gatilho = args.join(' ').trim().toLowerCase();
                    if (!gatilho || !db.autoresponder[from]?.[gatilho]) return await sock.sendMessage(from, { text: '⚠️ Gatilho não encontrado.' }, { quoted: msg });
                    delete db.autoresponder[from][gatilho];
                    saveDB(db);
                    await sock.sendMessage(from, { text: `🗑️ Resposta removida!` }, { quoted: msg });
                    break;
                }

                case 'listauto': {
                    const list = db.autoresponder[from];
                    if (!list || Object.keys(list).length === 0) return await sock.sendMessage(from, { text: 'ℹ️ Nenhuma resposta automática cadastrada neste chat.' }, { quoted: msg });
                    let txt = `📋 *RESPOSTAS AUTOMÁTICAS:*\n─────────────────────\n`;
                    for (let g in list) txt += `• *${g}* ➔ ${list[g]}\n`;
                    await sock.sendMessage(from, { text: txt }, { quoted: msg });
                    break;
                }

                case 'saldo': {
                    const txt = `
💳 *SEU SALDO*
─────────────────────
👤 *Nome:* ${user.nome}
💵 *Carteira:* R$ ${user.carteira}
🏦 *Banco:* R$ ${user.banco}
❤️ *Vida (HP):* ${user.hp}/100
⭐ *Nível:* ${user.nivel} (${user.xp} XP)
─────────────────────`.trim();
                    await sock.sendMessage(from, { text: txt }, { quoted: msg });
                    break;
                }

                case 'trabalhar': {
                    const cooldown = 3600000;
                    const now = Date.now();
                    if (user.workCooldown && (now - user.workCooldown < cooldown)) {
                        const remaining = Math.ceil((cooldown - (now - user.workCooldown)) / 60000);
                        return await sock.sendMessage(from, { text: `⏳ Você está cansado. Espere ${remaining} minutos para trabalhar de novo.` }, { quoted: msg });
                    }
                    const ganho = Math.floor(Math.random() * 250) + 50;
                    user.carteira += ganho;
                    user.workCooldown = now;
                    saveDB(db);
                    await sock.sendMessage(from, { text: `🛠️ Você trabalhou e ganhou *R$ ${ganho}*!` }, { quoted: msg });
                    break;
                }

                case 'depositar': {
                    const val = parseInt(args[0]);
                    if (isNaN(val) || val <= 0) return await sock.sendMessage(from, { text: '⚠️ Digite um valor válido. Ex: `.depositar 100`' }, { quoted: msg });
                    if (user.carteira < val) return await sock.sendMessage(from, { text: '❌ Saldo insuficiente em carteira.' }, { quoted: msg });
                    user.carteira -= val;
                    user.banco += val;
                    saveDB(db);
                    await sock.sendMessage(from, { text: `🏦 R$ ${val} depositados com sucesso no banco!` }, { quoted: msg });
                    break;
                }

                case 'sacar': {
                    const val = parseInt(args[0]);
                    if (isNaN(val) || val <= 0) return await sock.sendMessage(from, { text: '⚠️ Digite um valor válido. Ex: `.sacar 100`' }, { quoted: msg });
                    if (user.banco < val) return await sock.sendMessage(from, { text: '❌ Saldo insuficiente no banco.' }, { quoted: msg });
                    user.banco -= val;
                    user.carteira += val;
                    saveDB(db);
                    await sock.sendMessage(from, { text: `🏧 R$ ${val} sacados do banco!` }, { quoted: msg });
                    break;
                }

                case 'dragao': {
                    if (user.hp <= 20) return await sock.sendMessage(from, { text: '❌ Sua vida está muito baixa! Use `.curar` primeiro.' }, { quoted: msg });
                    const resultado = Math.random() > 0.4;
                    user.jogos += 1;
                    if (resultado) {
                        const premio = Math.floor(Math.random() * 400) + 200;
                        user.carteira += premio;
                        user.vitorias += 1;
                        saveDB(db);
                        await sock.sendMessage(from, { text: `⚔️ 🐉 *VITÓRIA!* Você derrotou o Dragão e ganhou *R$ ${premio}*!` }, { quoted: msg });
                    } else {
                        const dano = Math.floor(Math.random() * 30) + 20;
                        user.hp -= dano;
                        saveDB(db);
                        await sock.sendMessage(from, { text: `⚔️ 💥 *DERROTA!* O Dragão te atacou e você perdeu ${dano} de HP. (HP Atual: ${user.hp})` }, { quoted: msg });
                    }
                    break;
                }

                case 'curar': {
                    if (user.carteira < 50) return await sock.sendMessage(from, { text: '❌ Você precisa de R$ 50 na carteira para se curar.' }, { quoted: msg });
                    user.carteira -= 50;
                    user.hp = 100;
                    saveDB(db);
                    await sock.sendMessage(from, { text: `💊 Você usou uma poção de cura e seu HP voltou para 100!` }, { quoted: msg });
                    break;
                }

                case 'daily': {
                    const now = Date.now();
                    const cooldown = 86400000;
                    if (now - user.dailyCooldown < cooldown) {
                        const remaining = Math.ceil((cooldown - (now - user.dailyCooldown)) / 3600000);
                        return await sock.sendMessage(from, { text: `⏳ Bônus já resgatado! Volte em ${remaining} horas.` }, { quoted: msg });
                    }
                    user.carteira += 500;
                    user.dailyCooldown = now;
                    saveDB(db);
                    await sock.sendMessage(from, { text: `🎁 *Prêmio Diário!* Você ganhou R$ 500 moedas.` }, { quoted: msg });
                    break;
                }

                case 'dado': {
                    const num = Math.floor(Math.random() * 6) + 1;
                    await sock.sendMessage(from, { text: `🎲 Você jogou o dado e tirou: *${num}*` }, { quoted: msg });
                    break;
                }

                case 'caraoucoroa': {
                    const escolha = args[0]?.toLowerCase();
                    const aposta = parseInt(args[1]);
                    if (!['cara', 'coroa'].includes(escolha) || isNaN(aposta) || aposta <= 0) {
                        return await sock.sendMessage(from, { text: '⚠️ Uso correto: `.caraoucoroa [cara/coroa] [aposta]`' }, { quoted: msg });
                    }
                    if (user.carteira < aposta) return await sock.sendMessage(from, { text: '❌ Saldo insuficiente.' }, { quoted: msg });

                    const resultado = Math.random() > 0.5 ? 'cara' : 'coroa';
                    if (escolha === resultado) {
                        user.carteira += aposta;
                        user.vitorias += 1;
                        saveDB(db);
                        await sock.sendMessage(from, { text: `🪙 Deu *${resultado.toUpperCase()}*! Você venceu e ganhou R$ ${aposta}!` }, { quoted: msg });
                    } else {
                        user.carteira -= aposta;
                        saveDB(db);
                        await sock.sendMessage(from, { text: `🪙 Deu *${resultado.toUpperCase()}*! Você perdeu R$ ${aposta}.` }, { quoted: msg });
                    }
                    break;
                }

                case 'tigrinho':
                case 'foguete': {
                    const aposta = parseInt(args[0]);
                    if (isNaN(aposta) || aposta <= 0) return await sock.sendMessage(from, { text: '⚠️ Digite o valor da aposta. Ex: `.tigrinho 50`' }, { quoted: msg });
                    if (user.carteira < aposta) return await sock.sendMessage(from, { text: '❌ Saldo insuficiente na carteira.' }, { quoted: msg });

                    const venceu = Math.random() > 0.6;
                    if (venceu) {
                        const premio = aposta * 2;
                        user.carteira += premio;
                        saveDB(db);
                        await sock.sendMessage(from, { text: `🎰 🚀 *LUCKY WIN!* Você apostou R$ ${aposta} e multiplicou para *R$ ${premio}*!` }, { quoted: msg });
                    } else {
                        user.carteira -= aposta;
                        saveDB(db);
                        await sock.sendMessage(from, { text: `💥 *CRASH!* Você perdeu a aposta de R$ ${aposta}.` }, { quoted: msg });
                    }
                    break;
                }

                case 'perfil': {
                    const status = `
╭━━━「 👤 PERFIL DO USUÁRIO 」━━━╮
┃
┃ 📛 *Nome:* ${user.nome}
┃ 💰 *Carteira:* R$ ${user.carteira}
┃ 🏦 *Banco:* R$ ${user.banco}
┃ ❤️ *HP:* ${user.hp}/100
┃ ⭐ *XP Total:* ${user.xp}
┃ 🏆 *Nível:* ${user.nivel}
┃ 🎮 *Partidas:* ${user.jogos}
┃ 🥇 *Vitórias:* ${user.vitorias}
┃ ⚠️ *Advertências:* ${user.warnings}/3
┃
╰━━━━━━━━━━━━━━━━━━━━╯`.trim();
                    await sock.sendMessage(from, { text: status }, { quoted: msg });
                    break;
                }

                case 'rank': {
                    const allUsers = Object.keys(db.users)
                        .map(k => ({ id: k, ...db.users[k] }))
                        .sort((a, b) => b.xp - a.xp)
                        .slice(0, 10);

                    let rankMsg = `🏆 *RANKING DO GRUPO*\n─────────────────────\n`;
                    allUsers.forEach((u, idx) => {
                        const pos = idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : `${idx + 1}.`;
                        rankMsg += `${pos} *${u.nome}* — Lv. ${u.nivel} (${u.xp} XP)\n`;
                    });
                    await sock.sendMessage(from, { text: rankMsg.trim() }, { quoted: msg });
                    break;
                }

                case 's':
                case 'sticker':
                case 'fig': {
                    const quotedMsg = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
                    const isMedia = msg.message?.imageMessage || msg.message?.videoMessage;
                    const isQuotedMedia = quotedMsg?.imageMessage || quotedMsg?.videoMessage;
                    if (!isMedia && !isQuotedMedia) return await sock.sendMessage(from, { text: '⚠️ Envie ou responda a uma foto ou vídeo.' }, { quoted: msg });

                    const mediaMessage = isMedia ? (msg.message.imageMessage || msg.message.videoMessage) : (quotedMsg.imageMessage || quotedMsg.videoMessage);
                    const isVideo = !!(msg.message?.videoMessage || quotedMsg?.videoMessage);
                    
                    await sock.sendMessage(from, { text: '⏳ Gerando sticker...' }, { quoted: msg });
                    try {
                        const stream = await downloadContentFromMessage(mediaMessage, isVideo ? 'video' : 'image');
                        let buffer = Buffer.alloc(0);
                        for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);

                        const tempInput = path.join(__dirname, `temp_${Date.now()}.${isVideo ? 'mp4' : 'jpg'}`);
                        const tempOutput = path.join(__dirname, `temp_${Date.now()}.webp`);
                        fs.writeFileSync(tempInput, buffer);

                        ffmpeg(tempInput)
                            .outputOptions(['-vcodec libwebp', '-vf scale=\'min(320,iw)\':\'min(320,ih)\':force_original_aspect_ratio=decrease,fps=15,pad=320:320:(320-iw)/2:(320-ih)/2:color=0x00000000'])
                            .toFormat('webp')
                            .save(tempOutput)
                            .on('end', async () => {
                                await sock.sendMessage(from, { sticker: fs.readFileSync(tempOutput) }, { quoted: msg });
                                if (fs.existsSync(tempInput)) fs.unlinkSync(tempInput);
                                if (fs.existsSync(tempOutput)) fs.unlinkSync(tempOutput);
                            })
                            .on('error', () => {
                                sock.sendMessage(from, { text: '❌ Erro ao converter arquivo de mídia.' }, { quoted: msg });
                            });
                    } catch {
                        await sock.sendMessage(from, { text: '❌ Falha ao baixar mídia.' }, { quoted: msg });
                    }
                    break;
                }

                case 'ttp':
                case 'attp': {
                    const text = args.join(' ');
                    if (!text) return await sock.sendMessage(from, { text: '⚠️ Digite o texto.' }, { quoted: msg });
                    try {
                        const imgUrl = `https://dummyimage.com/512x512/000000/fff.png&text=${encodeURIComponent(text)}`;
                        const res = await axios.get(imgUrl, { responseType: 'arraybuffer' });
                        const tempInput = path.join(__dirname, `temp_${Date.now()}.png`);
                        const tempOutput = path.join(__dirname, `temp_${Date.now()}.webp`);
                        fs.writeFileSync(tempInput, res.data);

                        ffmpeg(tempInput)
                            .outputOptions(['-vcodec libwebp', '-vf scale=320:320'])
                            .toFormat('webp')
                            .save(tempOutput)
                            .on('end', async () => {
                                await sock.sendMessage(from, { sticker: fs.readFileSync(tempOutput) }, { quoted: msg });
                                if (fs.existsSync(tempInput)) fs.unlinkSync(tempInput);
                                if (fs.existsSync(tempOutput)) fs.unlinkSync(tempOutput);
                            });
                    } catch {
                        await sock.sendMessage(from, { text: '❌ Erro ao gerar texto em sticker.' }, { quoted: msg });
                    }
                    break;
                }

                case 'qrcode': {
                    const text = args.join(' ');
                    if (!text) return await sock.sendMessage(from, { text: '⚠️ Digite um texto/link.' }, { quoted: msg });
                    const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(text)}`;
                    await sock.sendMessage(from, { image: { url: qrUrl }, caption: `✅ QR Code Gerado!` }, { quoted: msg });
                    break;
                }

                case 'clima': {
                    const cidade = args.join(' ');
                    if (!cidade) return await sock.sendMessage(from, { text: '⚠️ Digite a cidade.' }, { quoted: msg });
                    try {
                        const res = await axios.get(`https://wttr.in/${encodeURIComponent(cidade)}?format=3`);
                        await sock.sendMessage(from, { text: `🌤️ *Clima:* ${res.data}` }, { quoted: msg });
                    } catch {
                        await sock.sendMessage(from, { text: '❌ Erro ao obter dados do clima.' }, { quoted: msg });
                    }
                    break;
                }

                case 'search': {
                    const query = args.join(' ');
                    if (!query) return await sock.sendMessage(from, { text: '⚠️ Digite o termo de pesquisa.' }, { quoted: msg });
                    try {
                        const url = `https://serpapi.com/search.json?q=${encodeURIComponent(query)}&engine=google&hl=pt-br&gl=br&api_key=${SERPAPI_KEY}`;
                        const res = await axios.get(url);
                        const results = res.data.organic_results;
                        if (!results || results.length === 0) return await sock.sendMessage(from, { text: '❌ Nenhum resultado encontrado.' }, { quoted: msg });

                        let resposta = `🔎 *RESULTADOS DA PESQUISA:*\n\n`;
                        results.slice(0, 4).forEach((item, index) => {
                            resposta += `*${index+1}. ${item.title}*\n🔗 ${item.link}\n\n`;
                        });
                        await sock.sendMessage(from, { text: resposta }, { quoted: msg });
                    } catch {
                        await sock.sendMessage(from, { text: '❌ Erro ao pesquisar no Google.' }, { quoted: msg });
                    }
                    break;
                }

                case 'ip': {
                    const target = args[0];
                    if (!target) return await sock.sendMessage(from, { text: '⚠️ Digite o IP.' }, { quoted: msg });
                    try {
                        const res = await axios.get(`http://ip-api.com/json/${target}`);
                        const info = `🌐 *IP:* ${res.data.query}\n🏳️ *País:* ${res.data.country}\n🏙️ *Cidade:* ${res.data.city}\n🏢 *ISP:* ${res.data.isp}`;
                        await sock.sendMessage(from, { text: info }, { quoted: msg });
                    } catch { await sock.sendMessage(from, { text: '❌ Erro ao consultar IP.' }, { quoted: msg }); }
                    break;
                }

                case 'ping': {
                    await sock.sendMessage(from, { text: '🏓 *Pong!* Pyda Bot v4.0 Ativo e Operacional!' }, { quoted: msg });
                    break;
                }

                default: {
                    await sock.sendMessage(from, { 
                        text: `⚠️ *Comando incorreto ou inexistente!*\n\nO comando *${prefix}${command}* não foi encontrado. Digite *.menu* para ver a lista de comandos disponíveis.` 
                    }, { quoted: msg });
                    break;
                }
            }
        }
    });
}

connectToWhatsApp();
