'use strict';

const {
    default: makeWASocket,
    useMultiFileAuthState,
    DisconnectReason,
    downloadContentFromMessage,
    makeCacheableSignalKeyStore,
    fetchLatestBaileysVersion
} = require('@whiskeysockets/baileys');

const pino = require('pino');
const readline = require('readline');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const crypto = require('crypto');

require('dotenv').config();

// ============================================================
// CONFIGURAÇÕES
// ============================================================

const PREFIX = '.';
const BOT_NAME = 'Pyda Bot';
const BOT_VERSION = '5.0.0';

const BOT_LOGO_URL =
    'https://i.postimg.cc/gc7hhDcF/file-00000000e328820e9000f592feb5a047.png';

const AUTH_DIR = path.join(__dirname, 'auth_info_baileys');
const DB_FILE = path.join(__dirname, 'database.json');
const DB_BACKUP = path.join(__dirname, 'database.backup.json');

const OWNER_NUMBER = String(process.env.OWNER_NUMBER || '')
    .replace(/\D/g, '');

const PHONE_NUMBER = String(process.env.PHONE_NUMBER || '')
    .replace(/\D/g, '');

const SERPAPI_KEY = String(process.env.SERPAPI_KEY || '');

const logger = pino({
    level: process.env.LOG_LEVEL || 'silent'
});

// ============================================================
// READLINE
// ============================================================

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

const question = (text) =>
    new Promise((resolve) => rl.question(text, resolve));

// ============================================================
// BANCO DE DADOS
// ============================================================

const DEFAULT_DB = {
    users: {},
    groups: {},
    autoresponder: {}
};

function ensureDatabase() {
    if (!fs.existsSync(DB_FILE)) {
        fs.writeFileSync(
            DB_FILE,
            JSON.stringify(DEFAULT_DB, null, 2),
            'utf8'
        );
    }
}

function loadDB() {
    ensureDatabase();

    try {
        const raw = fs.readFileSync(DB_FILE, 'utf8');
        const data = JSON.parse(raw);

        return {
            users: data.users || {},
            groups: data.groups || {},
            autoresponder: data.autoresponder || {}
        };
    } catch (error) {
        console.error('❌ Erro ao carregar database.json:', error.message);

        try {
            if (fs.existsSync(DB_FILE)) {
                fs.copyFileSync(DB_FILE, DB_BACKUP);
                console.log('💾 Backup do banco criado.');
            }
        } catch (backupError) {
            console.error(
                '❌ Erro ao criar backup:',
                backupError.message
            );
        }

        return {
            users: {},
            groups: {},
            autoresponder: {}
        };
    }
}

function saveDB(db) {
    try {
        const tempFile = `${DB_FILE}.tmp`;

        fs.writeFileSync(
            tempFile,
            JSON.stringify(db, null, 2),
            'utf8'
        );

        fs.renameSync(tempFile, DB_FILE);

        return true;
    } catch (error) {
        console.error(
            '❌ Erro ao salvar database:',
            error.message
        );

        return false;
    }
}

// ============================================================
// UTILITÁRIOS
// ============================================================

function normalizeJid(jid) {
    if (!jid) return '';

    return String(jid)
        .replace(/:\d+(?=@)/, '');
}

function getNumberFromJid(jid) {
    return normalizeJid(jid)
        .split('@')[0]
        .replace(/\D/g, '');
}

function isOwner(jid) {
    if (!OWNER_NUMBER) return false;

    return getNumberFromJid(jid) === OWNER_NUMBER;
}

function formatMoney(value) {
    const number = Number(value) || 0;

    return number.toLocaleString('pt-BR', {
        minimumFractionDigits: 0,
        maximumFractionDigits: 2
    });
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function randomInt(min, max) {
    return Math.floor(
        Math.random() * (max - min + 1)
    ) + min;
}

function generatePassword(length = 12) {
    const chars =
        'ABCDEFGHIJKLMNOPQRSTUVWXYZ' +
        'abcdefghijklmnopqrstuvwxyz' +
        '0123456789' +
        '!@#$%^&*()_+-=';

    let password = '';

    for (let i = 0; i < length; i++) {
        const index = crypto.randomInt(0, chars.length);
        password += chars[index];
    }

    return password;
}

function getBody(message) {
    if (!message) return '';

    return (
        message.conversation ||
        message.extendedTextMessage?.text ||
        message.imageMessage?.caption ||
        message.videoMessage?.caption ||
        message.documentMessage?.caption ||
        message.buttonsResponseMessage?.selectedButtonId ||
        message.listResponseMessage?.singleSelectReply?.selectedRowId ||
        message.templateButtonReplyMessage?.selectedId ||
        ''
    );
}

function getQuotedMessage(msg) {
    return (
        msg.message?.extendedTextMessage?.contextInfo
            ?.quotedMessage || null
    );
}

function getQuotedParticipant(msg) {
    return (
        msg.message?.extendedTextMessage?.contextInfo
            ?.participant || null
    );
}

function getMentionedJid(msg) {
    return (
        msg.message?.extendedTextMessage?.contextInfo
            ?.mentionedJid?.[0] || null
    );
}

function getTargetJid(msg) {
    return getMentionedJid(msg) || getQuotedParticipant(msg);
}

// ============================================================
// USUÁRIO
// ============================================================

function getUser(db, jid, name = 'Usuário') {
    const id = normalizeJid(jid);

    if (!db.users[id]) {
        db.users[id] = {
            nome: name || 'Usuário',
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

    const user = db.users[id];

    user.nome = name || user.nome || 'Usuário';

    if (typeof user.carteira !== 'number') {
        user.carteira = 200;
    }

    if (typeof user.banco !== 'number') {
        user.banco = 0;
    }

    if (typeof user.xp !== 'number') {
        user.xp = 0;
    }

    if (typeof user.nivel !== 'number') {
        user.nivel = 1;
    }

    if (typeof user.hp !== 'number') {
        user.hp = 100;
    }

    if (typeof user.jogos !== 'number') {
        user.jogos = 0;
    }

    if (typeof user.vitorias !== 'number') {
        user.vitorias = 0;
    }

    if (typeof user.warnings !== 'number') {
        user.warnings = 0;
    }

    if (typeof user.dailyCooldown !== 'number') {
        user.dailyCooldown = 0;
    }

    if (typeof user.workCooldown !== 'number') {
        user.workCooldown = 0;
    }

    return user;
}

// ============================================================
// XP
// ============================================================

function addXP(user, amount) {
    const gained = Math.max(0, Number(amount) || 0);

    user.xp += gained;

    let levels = 0;

    while (user.xp >= user.nivel * 100) {
        user.nivel++;
        levels++;
    }

    return levels;
}

// ============================================================
// ADMINISTRAÇÃO DE GRUPO
// ============================================================

async function getGroupMetadata(sock, jid) {
    try {
        return await sock.groupMetadata(jid);
    } catch (error) {
        console.error(
            '❌ Erro ao obter metadados do grupo:',
            error.message
        );

        return null;
    }
}

function isAdmin(metadata, jid) {
    if (!metadata || !jid) return false;

    const normalized = normalizeJid(jid);

    return metadata.participants.some(participant => {
        return (
            normalizeJid(participant.id) === normalized &&
            (
                participant.admin === 'admin' ||
                participant.admin === 'superadmin' ||
                participant.admin === true
            )
        );
    });
}

function getBotJid(sock) {
    return normalizeJid(sock.user?.id || '');
}

function isBotAdmin(metadata, sock) {
    return isAdmin(metadata, getBotJid(sock));
}

// ============================================================
// DOWNLOAD DE MÍDIA
// ============================================================

async function downloadMedia(message, type) {
    const stream = await downloadContentFromMessage(
        message,
        type
    );

    const chunks = [];

    for await (const chunk of stream) {
        chunks.push(chunk);
    }

    return Buffer.concat(chunks);
}

// ============================================================
// CONEXÃO
// ============================================================

let reconnecting = false;

async function connectToWhatsApp() {
    if (reconnecting) return;

    reconnecting = false;

    ensureDatabase();

    console.log('\n======================================');
    console.log(`🤖 ${BOT_NAME} v${BOT_VERSION}`);
    console.log('======================================');

    const {
        state,
        saveCreds
    } = await useMultiFileAuthState(AUTH_DIR);

    let version;

    try {
        const latest = await fetchLatestBaileysVersion();
        version = latest.version;

        console.log(
            `📦 Baileys: ${version.join('.')}`
        );
    } catch {
        console.log(
            '⚠️ Não foi possível consultar a versão do Baileys.'
        );
    }

    const socketOptions = {
        logger,
        auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(
                state.keys,
                logger
            )
        },
        browser: [
            'Pyda Bot',
            'Chrome',
            '1.0.0'
        ],
        markOnlineOnConnect: false,
        generateHighQualityLinkPreview: false,
        syncFullHistory: false
    };

    if (version) {
        socketOptions.version = version;
    }

    const sock = makeWASocket(socketOptions);

    sock.ev.on(
        'creds.update',
        saveCreds
    );

    // ========================================================
    // PAREAMENTO
    // ========================================================

    if (!state.creds.registered) {
        console.log('\n--- AUTENTICAÇÃO ---');

        let phoneNumber = PHONE_NUMBER;

        if (!phoneNumber) {
            phoneNumber = await question(
                'Digite o número com DDD: '
            );

            phoneNumber = phoneNumber
                .replace(/\D/g, '');
        }

        if (!phoneNumber) {
            console.log(
                '❌ Número inválido.'
            );

            process.exit(1);
        }

        try {
            await sleep(3000);

            const code =
                await sock.requestPairingCode(
                    phoneNumber
                );

            console.log(
                `\n🔑 CÓDIGO DE PAREAMENTO: \x1b[32m${code}\x1b[0m\n`
            );
        } catch (error) {
            console.error(
                '❌ Erro ao gerar código:',
                error.message
            );
        }
    }

    // ========================================================
    // CONNECTION UPDATE
    // ========================================================

    sock.ev.on(
        'connection.update',
        async update => {
            const {
                connection,
                lastDisconnect
            } = update;

            if (connection === 'open') {
                reconnecting = false;

                console.log(
                    '\n✅ Pyda Bot conectado com sucesso!'
                );

                console.log(
                    `🤖 Número: ${getNumberFromJid(getBotJid(sock))}`
                );
            }

            if (connection === 'close') {
                const statusCode =
                    lastDisconnect?.error
                        ?.output?.statusCode;

                const shouldReconnect =
                    statusCode !==
                    DisconnectReason.loggedOut;

                console.log(
                    '\n⚠️ Conexão encerrada.'
                );

                console.log(
                    `Código: ${statusCode || 'desconhecido'}`
                );

                if (shouldReconnect) {
                    console.log(
                        '🔄 Reconectando em 5 segundos...'
                    );

                    if (!reconnecting) {
                        reconnecting = true;

                        setTimeout(() => {
                            connectToWhatsApp()
                                .catch(error => {
                                    reconnecting = false;

                                    console.error(
                                        '❌ Erro na reconexão:',
                                        error.message
                                    );
                                });
                        }, 5000);
                    }
                } else {
                    console.log(
                        '🚪 Sessão encerrada. Será necessário autenticar novamente.'
                    );
                }
            }
        }
    );

    // ========================================================
    // MENSAGENS
    // ========================================================

    sock.ev.on(
        'messages.upsert',
        async ({ messages, type }) => {
            if (type !== 'notify') return;

            for (const msg of messages) {
                try {
                    if (!msg?.message) continue;

                    if (msg.key?.remoteJid === 'status@broadcast') {
                        continue;
                    }

                    const from =
                        msg.key?.remoteJid;

                    if (!from) continue;

                    const isGroup =
                        from.endsWith('@g.us');

                    const sender =
                        normalizeJid(
                            msg.key.fromMe
                                ? getBotJid(sock)
                                : (
                                    msg.key.participant ||
                                    from
                                )
                        );

                    const pushName =
                        msg.pushName ||
                        'Membro';

                    const body =
                        getBody(msg.message);

                    const bodyTrimmed =
                        body.trim();

                    const db = loadDB();

                    // =========================================
                    // REGISTRA GRUPO
                    // =========================================

                    if (isGroup) {
                        if (!db.groups[from]) {
                            db.groups[from] = {
                                ativo: true,
                                criadoEm: Date.now()
                            };

                            saveDB(db);
                        }
                    }

                    // =========================================
                    // USUÁRIO
                    // =========================================

                    const user =
                        getUser(
                            db,
                            sender,
                            pushName
                        );

                    const levels =
                        addXP(user, 10);

                    if (levels > 0 && isGroup) {
                        const metadata =
                            await getGroupMetadata(
                                sock,
                                from
                            );

                        if (
                            metadata &&
                            isBotAdmin(
                                metadata,
                                sock
                            )
                        ) {
                            await sock.sendMessage(
                                from,
                                {
                                    text:
                                        `🎉 Parabéns @${getNumberFromJid(sender)}!\n\n` +
                                        `⭐ Você alcançou o *Nível ${user.nivel}*!`,
                                    mentions: [
                                        sender
                                    ]
                                },
                                {
                                    quoted: msg
                                }
                            );
                        }
                    }

                    saveDB(db);

                    // =========================================
                    // AUTORESPONDER
                    // =========================================

                    if (
                        !bodyTrimmed.startsWith(
                            PREFIX
                        )
                    ) {
                        const auto =
                            db.autoresponder[from] ||
                            {};

                        const trigger =
                            bodyTrimmed.toLowerCase();

                        if (
                            trigger &&
                            auto[trigger]
                        ) {
                            await sock.sendMessage(
                                from,
                                {
                                    text: auto[trigger]
                                },
                                {
                                    quoted: msg
                                }
                            );
                        }

                        continue;
                    }

                    // =========================================
                    // PARSE DO COMANDO
                    // =========================================

                    const commandLine =
                        bodyTrimmed
                            .slice(PREFIX.length)
                            .trim();

                    if (!commandLine) {
                        continue;
                    }

                    const parts =
                        commandLine.split(/\s+/);

                    const command =
                        parts.shift()
                            .toLowerCase();

                    const args = parts;

                    // =========================================
                    // SWITCH
                    // =========================================

                    switch (command) {

                        // =====================================
                        // MENU
                        // =====================================

                        case 'menu':
                        case 'ajuda': {
                            const menu =
`╭━━━「 🤖 PYDA BOT 」━━━╮
┃
┃ 👤 Desenvolvedor: Odin
┃ 🤖 Status: Online
┃ ⚙️ Prefixo: [ ${PREFIX} ]
┃
┣━━「 📚 CATEGORIAS 」━━
┃
┃ 👑 .menudono
┃ 🛡️ .menuadm
┃ 🤖 .menuauto
┃ 🧰 .menumembro
┃ 🎨 .menufig
┃ ⚔️ .menurpg
┃ 🎮 .menujogos
┃ 🧠 .menuia
┃ 🛠️ .menuferramentas
┃ 🔎 .menuosint
┃
┃ 👤 .perfil
┃ 🏓 .ping
┃
╰━━━━━━━━━━━━━━━━━━━━╯
💻 Pyda Systems`;

                            try {
                                await sock.sendMessage(
                                    from,
                                    {
                                        image: {
                                            url: BOT_LOGO_URL
                                        },
                                        caption: menu
                                    },
                                    {
                                        quoted: msg
                                    }
                                );
                            } catch {
                                await sock.sendMessage(
                                    from,
                                    {
                                        text: menu
                                    },
                                    {
                                        quoted: msg
                                    }
                                );
                            }

                            break;
                        }

                        // =====================================
                        // MENU DONO
                        // =====================================

                        case 'menudono': {
                            await sock.sendMessage(
                                from,
                                {
                                    text:
`╭━━━「 👑 MENU DONO 」━━━╮
┃
┃ 📢 .bc [texto]
┃ 👤 .dono
┃ ⚙️ .restart
┃
╰━━━━━━━━━━━━━━━━━━━━╯`
                                },
                                {
                                    quoted: msg
                                }
                            );

                            break;
                        }

                        // =====================================
                        // MENU AUTO
                        // =====================================

                        case 'menuauto': {
                            await sock.sendMessage(
                                from,
                                {
                                    text:
`╭━━━「 🤖 AUTOMAÇÃO 」━━━╮
┃
┃ 💬 .addauto gatilho | resposta
┃ ❌ .delauto gatilho
┃ 📋 .listauto
┃
╰━━━━━━━━━━━━━━━━━━━━╯`
                                },
                                {
                                    quoted: msg
                                }
                            );

                            break;
                        }

                        // =====================================
                        // MENU RPG
                        // =====================================

                        case 'menurpg': {
                            await sock.sendMessage(
                                from,
                                {
                                    text:
`╭━━━「 ⚔️ RPG & ECONOMIA 」━━━╮
┃
┃ 💼 .trabalhar
┃ 💳 .saldo
┃ 👤 .perfil
┃ 🏦 .depositar [valor]
┃ 🏧 .sacar [valor]
┃ 💊 .curar
┃
╰━━━━━━━━━━━━━━━━━━━━╯`
                                },
                                {
                                    quoted: msg
                                }
                            );

                            break;
                        }

                        // =====================================
                        // MENU JOGOS
                        // =====================================

                        case 'menujogos': {
                            await sock.sendMessage(
                                from,
                                {
                                    text:
`╭━━━「 🎮 JOGOS 」━━━╮
┃
┃ 🎰 .tigrinho [aposta]
┃ 🪙 .caraoucoroa [cara/coroa] [aposta]
┃ 🎲 .dado
┃ 🎁 .daily
┃
╰━━━━━━━━━━━━━━━━━━━━╯`
                                },
                                {
                                    quoted: msg
                                }
                            );

                            break;
                        }

                        // =====================================
                        // MENU MEMBRO
                        // =====================================

                        case 'menumembro': {
                            await sock.sendMessage(
                                from,
                                {
                                    text:
`╭━━━「 🧰 UTILITÁRIOS 」━━━╮
┃
┃ 🔍 .ping
┃ 👁️ .revelar
┃
╰━━━━━━━━━━━━━━━━━━━━╯`
                                },
                                {
                                    quoted: msg
                                }
                            );

                            break;
                        }

                        // =====================================
                        // MENU IA
                        // =====================================

                        case 'menuia': {
                            await sock.sendMessage(
                                from,
                                {
                                    text:
`╭━━━「 🧠 INTELIGÊNCIA ARTIFICIAL 」━━━╮
┃
┃ 🤖 .ia [pergunta]
┃
╰━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━╯`
                                },
                                {
                                    quoted: msg
                                }
                            );

                            break;
                        }

                        // =====================================
                        // MENU ADM
                        // =====================================

                        case 'menuadm': {
                            await sock.sendMessage(
                                from,
                                {
                                    text:
`╭━━━「 🛡️ MENU ADM 」━━━╮
┃
┃ 📢 .hidetag [texto]
┃ 🛑 .ban / .kick
┃ 👑 .promover
┃ ⬇️ .rebaixar
┃ ⚠️ .warn
┃
╰━━━━━━━━━━━━━━━━━━━━╯`
                                },
                                {
                                    quoted: msg
                                }
                            );

                            break;
                        }

                        // =====================================
                        // MENU OSINT
                        // =====================================

                        case 'menuosint': {
                            await sock.sendMessage(
                                from,
                                {
                                    text:
`╭━━━「 🔎 FERRAMENTAS 」━━━╮
┃
┃ 🔎 .search [termo]
┃ 🌐 .ip [ip]
┃ 🏢 .cnpj [cnpj]
┃ 📍 .cep [cep]
┃
╰━━━━━━━━━━━━━━━━━━━━╯`
                                },
                                {
                                    quoted: msg
                                }
                            );

                            break;
                        }

                        // =====================================
                        // MENU FERRAMENTAS
                        // =====================================

                        case 'menuferramentas': {
                            await sock.sendMessage(
                                from,
                                {
                                    text:
`╭━━━「 🛠️ FERRAMENTAS 」━━━╮
┃
┃ 🔑 .senha [tamanho]
┃ 🔗 .encurtar [link]
┃
╰━━━━━━━━━━━━━━━━━━━━╯`
                                },
                                {
                                    quoted: msg
                                }
                            );

                            break;
                        }

                        // =====================================
                        // MENU FIGURINHAS
                        // =====================================

                        case 'menufig': {
                            await sock.sendMessage(
                                from,
                                {
                                    text:
`╭━━━「 🎨 FIGURINHAS 」━━━╮
┃
┃ 🖼️ Responda uma imagem/vídeo
┃
┃ .s
┃ .fig
┃ .sticker
┃
╰━━━━━━━━━━━━━━━━━━━━╯`
                                },
                                {
                                    quoted: msg
                                }
                            );

                            break;
                        }

                        // =====================================
                        // IA
                        // =====================================

                        case 'ia':
                        case 'gpt': {
                            const prompt =
                                args.join(' ').trim();

                            if (!prompt) {
                                await sock.sendMessage(
                                    from,
                                    {
                                        text:
                                            '⚠️ Digite sua pergunta.\n\nExemplo:\n.ia explique o que é JavaScript'
                                    },
                                    {
                                        quoted: msg
                                    }
                                );

                                break;
                            }

                            await sock.sendMessage(
                                from,
                                {
                                    text:
                                        '🤖 *Processando...*'
                                },
                                {
                                    quoted: msg
                                }
                            );

                            try {
                                const response =
                                    await axios.get(
                                        'https://api.simsimi.vn/v1/simtalk',
                                        {
                                            params: {
                                                text: prompt,
                                                lc: 'pt'
                                            },
                                            timeout: 15000
                                        }
                                    );

                                const reply =
                                    response.data?.message ||
                                    'Não consegui obter uma resposta.';

                                await sock.sendMessage(
                                    from,
                                    {
                                        text:
                                            `🧠 *Pyda IA:*\n\n${reply}`
                                    },
                                    {
                                        quoted: msg
                                    }
                                );
                            } catch (error) {
                                await sock.sendMessage(
                                    from,
                                    {
                                        text:
                                            '❌ O serviço de IA está indisponível no momento.'
                                    },
                                    {
                                        quoted: msg
                                    }
                                );
                            }

                            break;
                        }

                        // =====================================
                        // PING
                        // =====================================

                        case 'ping': {
                            const start =
                                Date.now();

                            await sock.sendMessage(
                                from,
                                {
                                    text:
                                        '🏓 *Pong!*'
                                },
                                {
                                    quoted: msg
                                }
                            );

                            console.log(
                                `🏓 Ping: ${Date.now() - start}ms`
                            );

                            break;
                        }

                        // =====================================
                        // DONO
                        // =====================================

                        case 'dono': {
                            await sock.sendMessage(
                                from,
                                {
                                    text:
`👤 *Desenvolvedor:* Odin
🤖 *Bot:* Pyda
📱 *Status:* Online`
                                },
                                {
                                    quoted: msg
                                }
                            );

                            break;
                        }

                        // =====================================
                        // FIGURINHA
                        // =====================================

                        case 's':
                        case 'fig':
                        case 'sticker': {
                            let target =
                                msg.message;

                            const quoted =
                                getQuotedMessage(msg);

                            if (quoted) {
                                target = quoted;
                            }

                            const imageMsg =
                                target?.imageMessage;

                            const videoMsg =
                                target?.videoMessage;

                            if (
                                !imageMsg &&
                                !videoMsg
                            ) {
                                await sock.sendMessage(
                                    from,
                                    {
                                        text:
                                            '⚠️ Envie ou responda uma imagem ou vídeo com *.s*.'
                                    },
                                    {
                                        quoted: msg
                                    }
                                );

                                break;
                            }

                            try {
                                const mediaType =
                                    imageMsg
                                        ? 'image'
                                        : 'video';

                                const buffer =
                                    await downloadMedia(
                                        imageMsg ||
                                        videoMsg,
                                        mediaType
                                    );

                                /*
                                 * O Baileys aceita WebP como sticker.
                                 * Para vídeos/GIFs, o arquivo precisa estar
                                 * previamente convertido para WebP.
                                 */

                                if (mediaType === 'image') {
                                    await sock.sendMessage(
                                        from,
                                        {
                                            sticker: buffer
                                        },
                                        {
                                            quoted: msg
                                        }
                                    );
                                } else {
                                    await sock.sendMessage(
                                        from,
                                        {
                                            sticker: buffer
                                        },
                                        {
                                            quoted: msg
                                        }
                                    );
                                }
                            } catch (error) {
                                console.error(
                                    'Erro sticker:',
                                    error.message
                                );

                                await sock.sendMessage(
                                    from,
                                    {
                                        text:
                                            '❌ Não foi possível transformar essa mídia em figurinha.'
                                    },
                                    {
                                        quoted: msg
                                    }
                                );
                            }

                            break;
                        }

                        // =====================================
                        // AUTORESPONDER
                        // =====================================

                        case 'addauto': {
                            const fullText =
                                args.join(' ');

                            const separator =
                                fullText.indexOf('|');

                            if (
                                separator === -1
                            ) {
                                await sock.sendMessage(
                                    from,
                                    {
                                        text:
                                            '⚠️ Use:\n.addauto gatilho | resposta'
                                    },
                                    {
                                        quoted: msg
                                    }
                                );

                                break;
                            }

                            const trigger =
                                fullText
                                    .slice(0, separator)
                                    .trim()
                                    .toLowerCase();

                            const response =
                                fullText
                                    .slice(separator + 1)
                                    .trim();

                            if (
                                !trigger ||
                                !response
                            ) {
                                await sock.sendMessage(
                                    from,
                                    {
                                        text:
                                            '⚠️ O gatilho e a resposta não podem ficar vazios.'
                                    },
                                    {
                                        quoted: msg
                                    }
                                );

                                break;
                            }

                            if (
                                !db.autoresponder[from]
                            ) {
                                db.autoresponder[from] = {};
                            }

                            db.autoresponder[from][trigger] =
                                response;

                            saveDB(db);

                            await sock.sendMessage(
                                from,
                                {
                                    text:
                                        `✅ Autoresposta adicionada!\n\n💬 Gatilho: *${trigger}*`
                                },
                                {
                                    quoted: msg
                                }
                            );

                            break;
                        }

                        // =====================================
                        // DEL AUTO
                        // =====================================

                        case 'delauto': {
                            const trigger =
                                args.join(' ')
                                    .trim()
                                    .toLowerCase();

                            if (
                                !trigger ||
                                !db.autoresponder[from] ||
                                !db.autoresponder[from][trigger]
                            ) {
                                await sock.sendMessage(
                                    from,
                                    {
                                        text:
                                            '⚠️ Gatilho não encontrado.'
                                    },
                                    {
                                        quoted: msg
                                    }
                                );

                                break;
                            }

                            delete db.autoresponder[from][trigger];

                            saveDB(db);

                            await sock.sendMessage(
                                from,
                                {
                                    text:
                                        `✅ Autoresposta *${trigger}* removida.`
                                },
                                {
                                    quoted: msg
                                }
                            );

                            break;
                        }

                        // =====================================
                        // LIST AUTO
                        // =====================================

                        case 'listauto': {
                            const auto =
                                db.autoresponder[from] ||
                                {};

                            const keys =
                                Object.keys(auto);

                            if (!keys.length) {
                                await sock.sendMessage(
                                    from,
                                    {
                                        text:
                                            '📋 Nenhuma autoresposta cadastrada neste chat.'
                                    },
                                    {
                                        quoted: msg
                                    }
                                );

                                break;
                            }

                            let text =
                                '📋 *AUTORESPOSTAS*\n\n';

                            keys.forEach(
                                (key, index) => {
                                    text +=
                                        `${index + 1}. *${key}* ➜ ${auto[key]}\n`;
                                }
                            );

                            await sock.sendMessage(
                                from,
                                {
                                    text
                                },
                                {
                                    quoted: msg
                                }
                            );

                            break;
                        }

                        // =====================================
                        // PERFIL
                        // =====================================

                        case 'perfil':
                        case 'saldo': {
                            await sock.sendMessage(
                                from,
                                {
                                    text:
`👤 *PERFIL*

╭────────────────────
│ 👤 Nome: ${user.nome}
│ 🪙 Carteira: R$ ${formatMoney(user.carteira)}
│ 🏦 Banco: R$ ${formatMoney(user.banco)}
│ ⭐ Nível: ${user.nivel}
│ ✨ XP: ${user.xp}
│ ❤️ HP: ${user.hp}/100
│ 🎮 Jogos: ${user.jogos}
│ 🏆 Vitórias: ${user.vitorias}
│ ⚠️ Warns: ${user.warnings}/3
╰────────────────────`
                                },
                                {
                                    quoted: msg
                                }
                            );

                            break;
                        }

                        // =====================================
                        // TRABALHAR
                        // =====================================

                        case 'trabalhar': {
                            const now =
                                Date.now();

                            const cooldown =
                                5 * 60 * 1000;

                            if (
                                now -
                                user.workCooldown <
                                cooldown
                            ) {
                                const remaining =
                                    cooldown -
                                    (
                                        now -
                                        user.workCooldown
                                    );

                                const minutes =
                                    Math.ceil(
                                        remaining /
                                        60000
                                    );

                                await sock.sendMessage(
                                    from,
                                    {
                                        text:
                                            `⏳ Aguarde aproximadamente *${minutes} minuto(s)*.`
                                    },
                                    {
                                        quoted: msg
                                    }
                                );

                                break;
                            }

                            const ganho =
                                randomInt(
                                    50,
                                    200
                                );

                            user.carteira += ganho;

                            user.workCooldown =
                                now;

                            saveDB(db);

                            await sock.sendMessage(
                                from,
                                {
                                    text:
                                        `💼 Você trabalhou e recebeu *R$ ${formatMoney(ganho)}*!`
                                },
                                {
                                    quoted: msg
                                }
                            );

                            break;
                        }

                        // =====================================
                        // DAILY
                        // =====================================

                        case 'daily': {
                            const now =
                                Date.now();

                            const cooldown =
                                24 * 60 * 60 * 1000;

                            if (
                                now -
                                user.dailyCooldown <
                                cooldown
                            ) {
                                const remaining =
                                    cooldown -
                                    (
                                        now -
                                        user.dailyCooldown
                                    );

                                const hours =
                                    Math.ceil(
                                        remaining /
                                        3600000
                                    );

                                await sock.sendMessage(
                                    from,
                                    {
                                        text:
                                            `⏳ Você já recebeu seu bônus. Tente novamente em aproximadamente *${hours} hora(s)*.`
                                    },
                                    {
                                        quoted: msg
                                    }
                                );

                                break;
                            }

                            const bonus =
                                500;

                            user.carteira +=
                                bonus;

                            user.dailyCooldown =
                                now;

                            saveDB(db);

                            await sock.sendMessage(
                                from,
                                {
                                    text:
                                        `🎁 Você recebeu seu bônus diário de *R$ ${formatMoney(bonus)}*!`
                                },
                                {
                                    quoted: msg
                                }
                            );

                            break;
                        }

                        // =====================================
                        // DEPOSITAR
                        // =====================================

                        case 'depositar': {
                            const value =
                                Number(
                                    args[0]
                                );

                            if (
                                !Number.isInteger(value) ||
                                value <= 0
                            ) {
                                await sock.sendMessage(
                                    from,
                                    {
                                        text:
                                            '⚠️ Informe um valor inteiro positivo.'
                                    },
                                    {
                                        quoted: msg
                                    }
                                );

                                break;
                            }

                            if (
                                user.carteira <
                                value
                            ) {
                                await sock.sendMessage(
                                    from,
                                    {
                                        text:
                                            '❌ Saldo insuficiente na carteira.'
                                    },
                                    {
                                        quoted: msg
                                    }
                                );

                                break;
                            }

                            user.carteira -=
                                value;

                            user.banco +=
                                value;

                            saveDB(db);

                            await sock.sendMessage(
                                from,
                                {
                                    text:
                                        `🏦 Você depositou *R$ ${formatMoney(value)}*.`
                                },
                                {
                                    quoted: msg
                                }
                            );

                            break;
                        }

                        // =====================================
                        // SACAR
                        // =====================================

                        case 'sacar': {
                            const value =
                                Number(
                                    args[0]
                                );

                            if (
                                !Number.isInteger(value) ||
                                value <= 0
                            ) {
                                await sock.sendMessage(
                                    from,
                                    {
                                        text:
                                            '⚠️ Informe um valor inteiro positivo.'
                                    },
                                    {
                                        quoted: msg
                                    }
                                );

                                break;
                            }

                            if (
                                user.banco <
                                value
                            ) {
                                await sock.sendMessage(
                                    from,
                                    {
                                        text:
                                            '❌ Saldo insuficiente no banco.'
                                    },
                                    {
                                        quoted: msg
                                    }
                                );

                                break;
                            }

                            user.banco -=
                                value;

                            user.carteira +=
                                value;

                            saveDB(db);

                            await sock.sendMessage(
                                from,
                                {
                                    text:
                                        `🏧 Você sacou *R$ ${formatMoney(value)}*.`
                                },
                                {
                                    quoted: msg
                                }
                            );

                            break;
                        }

                        // =====================================
                        // CURAR
                        // =====================================

                        case 'curar': {
                            const price =
                                50;

                            if (
                                user.hp >=
                                100
                            ) {
                                await sock.sendMessage(
                                    from,
                                    {
                                        text:
                                            '❤️ Seu HP já está cheio.'
                                    },
                                    {
                                        quoted: msg
                                    }
                                );

                                break;
                            }

                            if (
                                user.carteira <
                                price
                            ) {
                                await sock.sendMessage(
                                    from,
                                    {
                                        text:
                                            `❌ Você precisa de R$ ${price} para se curar.`
                                    },
                                    {
                                        quoted: msg
                                    }
                                );

                                break;
                            }

                            user.carteira -=
                                price;

                            user.hp =
                                100;

                            saveDB(db);

                            await sock.sendMessage(
                                from,
                                {
                                    text:
                                        '💊 Seu HP foi restaurado para *100/100*!'
                                },
                                {
                                    quoted: msg
                                }
                            );

                            break;
                        }
                    // =========================================================
                    // IA
                    // =========================================================

                    case 'ia':
                    case 'gpt': {
                        const prompt = args.join(' ').trim();

                        if (!prompt) {
                            await sock.sendMessage(
                                from,
                                {
                                    text: '⚠️ Envie uma pergunta.\n\nExemplo:\n.ia explique o que é JavaScript'
                                },
                                { quoted: msg }
                            );
                            break;
                        }

                        await sock.sendMessage(
                            from,
                            { text: '🤖 *Pensando...*' },
                            { quoted: msg }
                        );

                        try {
                            const response = await axios.get(
                                'https://api.simsimi.vn/v1/simtalk',
                                {
                                    params: {
                                        text: prompt,
                                        lc: 'pt'
                                    },
                                    timeout: 15000
                                }
                            );

                            const reply =
                                response.data?.message ||
                                'Não consegui obter uma resposta agora.';

                            await sock.sendMessage(
                                from,
                                {
                                    text: `🧠 *Pyda IA*\n\n${reply}`
                                },
                                { quoted: msg }
                            );

                        } catch (error) {
                            console.error('Erro IA:', error.message);

                            await sock.sendMessage(
                                from,
                                {
                                    text: '❌ O serviço de IA está indisponível no momento.'
                                },
                                { quoted: msg }
                            );
                        }

                        break;
                    }


                    // =========================================================
                    // FIGURINHA
                    // =========================================================

                    case 's':
                    case 'fig':
                    case 'sticker': {

                        let targetMessage = msg.message;

                        const contextInfo =
                            msg.message?.extendedTextMessage?.contextInfo;

                        if (contextInfo?.quotedMessage) {
                            targetMessage = contextInfo.quotedMessage;
                        }

                        // Suporte a visualização única
                        if (targetMessage?.viewOnceMessage?.message) {
                            targetMessage =
                                targetMessage.viewOnceMessage.message;
                        }

                        if (targetMessage?.viewOnceMessageV2?.message) {
                            targetMessage =
                                targetMessage.viewOnceMessageV2.message;
                        }

                        if (targetMessage?.viewOnceMessageV2Extension?.message) {
                            targetMessage =
                                targetMessage.viewOnceMessageV2Extension.message;
                        }

                        const imageMessage =
                            targetMessage?.imageMessage;

                        const videoMessage =
                            targetMessage?.videoMessage;

                        if (!imageMessage && !videoMessage) {
                            await sock.sendMessage(
                                from,
                                {
                                    text:
                                        '⚠️ Envie ou responda a uma imagem ou vídeo usando:\n\n' +
                                        '*.s*'
                                },
                                { quoted: msg }
                            );
                            break;
                        }

                        try {
                            const mediaType = imageMessage
                                ? 'image'
                                : 'video';

                            const mediaMessage =
                                imageMessage || videoMessage;

                            const stream =
                                await downloadContentFromMessage(
                                    mediaMessage,
                                    mediaType
                                );

                            const chunks = [];

                            for await (const chunk of stream) {
                                chunks.push(chunk);
                            }

                            const buffer = Buffer.concat(chunks);

                            if (!buffer.length) {
                                throw new Error('Mídia vazia.');
                            }

                            await sock.sendMessage(
                                from,
                                {
                                    sticker: buffer
                                },
                                { quoted: msg }
                            );

                        } catch (error) {
                            console.error(
                                'Erro ao criar figurinha:',
                                error.message
                            );

                            await sock.sendMessage(
                                from,
                                {
                                    text:
                                        '❌ Não foi possível criar a figurinha.\n\n' +
                                        'Para vídeos, verifique se o FFmpeg está instalado.'
                                },
                                { quoted: msg }
                            );
                        }

                        break;
                    }


                    // =========================================================
                    // DONO
                    // =========================================================

                    case 'dono': {

                        await sock.sendMessage(
                            from,
                            {
                                text:
                                    '👤 *DESENVOLVEDOR*\n' +
                                    '─────────────────────\n' +
                                    '👑 Odin\n' +
                                    '✈️ Telegram: t.me/Odinadm'
                            },
                            { quoted: msg }
                        );

                        break;
                    }


                    // =========================================================
                    // PING
                    // =========================================================

                    case 'ping': {

                        const inicio = Date.now();

                        await sock.sendMessage(
                            from,
                            {
                                text: '🏓 *Pong!*'
                            },
                            { quoted: msg }
                        );

                        const tempo = Date.now() - inicio;

                        await sock.sendMessage(
                            from,
                            {
                                text: `⚡ Latência: *${tempo}ms*`
                            }
                        );

                        break;
                    }


                    // =========================================================
                    // AUTORESPONDER
                    // =========================================================

                    case 'addauto': {

                        const fullText = args.join(' ');
                        const parts = fullText.split('|');

                        if (parts.length < 2) {
                            await sock.sendMessage(
                                from,
                                {
                                    text:
                                        '⚠️ Formato correto:\n\n' +
                                        '.addauto gatilho | resposta'
                                },
                                { quoted: msg }
                            );
                            break;
                        }

                        const trigger =
                            parts.shift().trim().toLowerCase();

                        const response =
                            parts.join('|').trim();

                        if (!trigger || !response) {
                            await sock.sendMessage(
                                from,
                                {
                                    text: '⚠️ Gatilho e resposta são obrigatórios.'
                                },
                                { quoted: msg }
                            );
                            break;
                        }

                        if (!db.autoresponder[from]) {
                            db.autoresponder[from] = {};
                        }

                        db.autoresponder[from][trigger] = response;

                        saveDB(db);

                        await sock.sendMessage(
                            from,
                            {
                                text:
                                    `✅ *Autoresposta adicionada!*\n\n` +
                                    `💬 Gatilho: *${trigger}*\n` +
                                    `🤖 Resposta: ${response}`
                            },
                            { quoted: msg }
                        );

                        break;
                    }


                    case 'delauto': {

                        const trigger =
                            args.join(' ').trim().toLowerCase();

                        if (!trigger) {
                            await sock.sendMessage(
                                from,
                                {
                                    text:
                                        '⚠️ Informe o gatilho.\n\n' +
                                        'Exemplo: .delauto oi'
                                },
                                { quoted: msg }
                            );
                            break;
                        }

                        if (!db.autoresponder[from]?.[trigger]) {
                            await sock.sendMessage(
                                from,
                                {
                                    text:
                                        `❌ Não existe autoresposta para *${trigger}*.`
                                },
                                { quoted: msg }
                            );
                            break;
                        }

                        delete db.autoresponder[from][trigger];

                        saveDB(db);

                        await sock.sendMessage(
                            from,
                            {
                                text:
                                    `✅ Autoresposta *${trigger}* removida.`
                            },
                            { quoted: msg }
                        );

                        break;
                    }


                    case 'listauto': {

                        const chatAuto =
                            db.autoresponder[from] || {};

                        const triggers =
                            Object.keys(chatAuto);

                        if (!triggers.length) {
                            await sock.sendMessage(
                                from,
                                {
                                    text:
                                        '📋 Nenhuma autoresposta cadastrada neste chat.'
                                },
                                { quoted: msg }
                            );
                            break;
                        }

                        let text =
                            '📋 *AUTORESPONDER*\n' +
                            '─────────────────────\n\n';

                        triggers.forEach((trigger, index) => {
                            text +=
                                `${index + 1}. *${trigger}*\n` +
                                `↳ ${chatAuto[trigger]}\n\n`;
                        });

                        await sock.sendMessage(
                            from,
                            { text },
                            { quoted: msg }
                        );

                        break;
                    }


                    // =========================================================
                    // PERFIL / ECONOMIA
                    // =========================================================

                    case 'perfil':
                    case 'saldo': {

                        await sock.sendMessage(
                            from,
                            {
                                text:
                                    `👤 *PERFIL DE ${user.nome}*\n` +
                                    `─────────────────────\n` +
                                    `🪙 Carteira: *R$ ${user.carteira}*\n` +
                                    `🏦 Banco: *R$ ${user.banco}*\n` +
                                    `⭐ Nível: *${user.nivel}*\n` +
                                    `✨ XP: *${user.xp}*\n` +
                                    `❤️ HP: *${user.hp}/100*\n` +
                                    `⚠️ Warns: *${user.warnings}/3*`
                            },
                            { quoted: msg }
                        );

                        break;
                    }


                    case 'trabalhar': {

                        const agora = Date.now();
                        const cooldown = 5 * 60 * 1000;

                        if (
                            agora - (user.workCooldown || 0) <
                            cooldown
                        ) {
                            const restante =
                                cooldown -
                                (agora - (user.workCooldown || 0));

                            const minutos =
                                Math.ceil(restante / 60000);

                            await sock.sendMessage(
                                from,
                                {
                                    text:
                                        `⏳ Você precisa esperar aproximadamente *${minutos} minuto(s)*.`
                                },
                                { quoted: msg }
                            );

                            break;
                        }

                        const ganho =
                            Math.floor(Math.random() * 151) + 50;

                        user.carteira += ganho;
                        user.workCooldown = agora;

                        const subiuNivel =
                            addXP(user, 15);

                        saveDB(db);

                        let resposta =
                            `💼 *TRABALHO CONCLUÍDO!*\n\n` +
                            `💰 Você recebeu: *R$ ${ganho}*`;

                        if (subiuNivel) {
                            resposta +=
                                `\n\n🎉 *LEVEL UP!*\n` +
                                `⭐ Novo nível: *${user.nivel}*`;
                        }

                        await sock.sendMessage(
                            from,
                            { text: resposta },
                            { quoted: msg }
                        );

                        break;
                    }


                    case 'daily': {

                        const agora = Date.now();
                        const cooldown = 24 * 60 * 60 * 1000;

                        if (
                            agora - (user.dailyCooldown || 0) <
                            cooldown
                        ) {
                            const restante =
                                cooldown -
                                (agora - (user.dailyCooldown || 0));

                            const horas =
                                Math.ceil(restante / 3600000);

                            await sock.sendMessage(
                                from,
                                {
                                    text:
                                        `⏳ Você já pegou seu Daily.\n\n` +
                                        `Tente novamente em aproximadamente *${horas}h*.`
                                },
                                { quoted: msg }
                            );

                            break;
                        }

                        user.carteira += 500;
                        user.dailyCooldown = agora;

                        addXP(user, 10);

                        saveDB(db);

                        await sock.sendMessage(
                            from,
                            {
                                text:
                                    '🎁 *DAILY RESGATADO!*\n\n' +
                                    '💰 +R$ 500\n' +
                                    '✨ +10 XP'
                            },
                            { quoted: msg }
                        );

                        break;
                    }


                    case 'depositar': {

                        const valorTexto =
                            args[0]?.replace(',', '.');

                        const valor =
                            Number(valorTexto);

                        if (
                            !Number.isFinite(valor) ||
                            valor <= 0 ||
                            !Number.isInteger(valor)
                        ) {
                            await sock.sendMessage(
                                from,
                                {
                                    text:
                                        '⚠️ Informe um valor inteiro válido.\n\n' +
                                        'Exemplo: *.depositar 500*'
                                },
                                { quoted: msg }
                            );
                            break;
                        }

                        if (user.carteira < valor) {
                            await sock.sendMessage(
                                from,
                                {
                                    text:
                                        '❌ Você não possui esse valor na carteira.'
                                },
                                { quoted: msg }
                            );
                            break;
                        }

                        user.carteira -= valor;
                        user.banco += valor;

                        saveDB(db);

                        await sock.sendMessage(
                            from,
                            {
                                text:
                                    `🏦 Depósito realizado!\n\n` +
                                    `💰 Valor: *R$ ${valor}*\n` +
                                    `🪙 Carteira: *R$ ${user.carteira}*\n` +
                                    `🏦 Banco: *R$ ${user.banco}*`
                            },
                            { quoted: msg }
                        );

                        break;
                    }


                    case 'sacar': {

                        const valorTexto =
                            args[0]?.replace(',', '.');

                        const valor =
                            Number(valorTexto);

                        if (
                            !Number.isFinite(valor) ||
                            valor <= 0 ||
                            !Number.isInteger(valor)
                        ) {
                            await sock.sendMessage(
                                from,
                                {
                                    text:
                                        '⚠️ Informe um valor inteiro válido.\n\n' +
                                        'Exemplo: *.sacar 500*'
                                },
                                { quoted: msg }
                            );
                            break;
                        }

                        if (user.banco < valor) {
                            await sock.sendMessage(
                                from,
                                {
                                    text:
                                        '❌ Você não possui esse valor no banco.'
                                },
                                { quoted: msg }
                            );
                            break;
                        }

                        user.banco -= valor;
                        user.carteira += valor;

                        saveDB(db);

                        await sock.sendMessage(
                            from,
                            {
                                text:
                                    `🏧 Saque realizado!\n\n` +
                                    `💰 Valor: *R$ ${valor}*\n` +
                                    `🪙 Carteira: *R$ ${user.carteira}*\n` +
                                    `🏦 Banco: *R$ ${user.banco}*`
                            },
                            { quoted: msg }
                        );

                        break;
                    }


                    case 'curar': {

                        if (user.hp >= 100) {
                            await sock.sendMessage(
                                from,
                                {
                                    text:
                                        '❤️ Seu HP já está cheio!'
                                },
                                { quoted: msg }
                            );
                            break;
                        }

                        const custo = 50;

                        if (user.carteira < custo) {
                            await sock.sendMessage(
                                from,
                                {
                                    text:
                                        `❌ Você precisa de *R$ ${custo}* para se curar.`
                                },
                                { quoted: msg }
                            );
                            break;
                        }

                        user.carteira -= custo;
                        user.hp = 100;

                        saveDB(db);

                        await sock.sendMessage(
                            from,
                            {
                                text:
                                    '💊 *CURA REALIZADA!*\n\n' +
                                    '❤️ HP restaurado para *100/100*.\n' +
                                    `💰 Custo: *R$ ${custo}*`
                            },
                            { quoted: msg }
                        );

                        break;
                    }
                    // =========================================================
                    // JOGOS & CASSINO
                    // =========================================================

                    case 'tigrinho': {
                        const aposta = Number(args[0]);

                        if (!Number.isInteger(aposta) || aposta <= 0) {
                            return await sock.sendMessage(
                                from,
                                {
                                    text: '⚠️ Informe uma aposta válida.\n\nExemplo: *.tigrinho 100*'
                                },
                                { quoted: msg }
                            );
                        }

                        if (aposta > user.carteira) {
                            return await sock.sendMessage(
                                from,
                                {
                                    text: `⚠️ Saldo insuficiente.\n💰 Sua carteira: *R$ ${user.carteira}*`
                                },
                                { quoted: msg }
                            );
                        }

                        // Aposta é retirada antes do resultado
                        user.carteira -= aposta;
                        user.jogos = (user.jogos || 0) + 1;

                        const venceu = Math.random() < 0.45;

                        if (venceu) {
                            const premio = aposta * 2;
                            user.carteira += premio;
                            user.vitorias = (user.vitorias || 0) + 1;

                            saveDB(db);

                            await sock.sendMessage(
                                from,
                                {
                                    text:
                                        `🎰 *PYDA TIGRINHO*\n` +
                                        `━━━━━━━━━━━━━━━━━━━━\n` +
                                        `🎉 *VOCÊ GANHOU!*\n\n` +
                                        `💰 Aposta: *R$ ${aposta}*\n` +
                                        `🏆 Prêmio: *R$ ${premio}*\n` +
                                        `💳 Carteira: *R$ ${user.carteira}*\n` +
                                        `━━━━━━━━━━━━━━━━━━━━`
                                },
                                { quoted: msg }
                            );
                        } else {
                            saveDB(db);

                            await sock.sendMessage(
                                from,
                                {
                                    text:
                                        `🎰 *PYDA TIGRINHO*\n` +
                                        `━━━━━━━━━━━━━━━━━━━━\n` +
                                        `😿 Você perdeu!\n\n` +
                                        `💸 Perda: *R$ ${aposta}*\n` +
                                        `💳 Carteira: *R$ ${user.carteira}*\n` +
                                        `━━━━━━━━━━━━━━━━━━━━`
                                },
                                { quoted: msg }
                            );
                        }

                        break;
                    }

                    case 'caraoucoroa': {
                        const escolha = args[0]?.toLowerCase();
                        const aposta = Number(args[1]);

                        if (!['cara', 'coroa'].includes(escolha)) {
                            return await sock.sendMessage(
                                from,
                                {
                                    text:
                                        '⚠️ Escolha *cara* ou *coroa*.\n\n' +
                                        'Exemplo:\n*.caraoucoroa cara 100*'
                                },
                                { quoted: msg }
                            );
                        }

                        if (!Number.isInteger(aposta) || aposta <= 0) {
                            return await sock.sendMessage(
                                from,
                                {
                                    text: '⚠️ Informe uma aposta válida.'
                                },
                                { quoted: msg }
                            );
                        }

                        if (aposta > user.carteira) {
                            return await sock.sendMessage(
                                from,
                                {
                                    text: '⚠️ Você não possui saldo suficiente.'
                                },
                                { quoted: msg }
                            );
                        }

                        const resultado =
                            Math.random() < 0.5 ? 'cara' : 'coroa';

                        user.carteira -= aposta;
                        user.jogos = (user.jogos || 0) + 1;

                        if (escolha === resultado) {
                            user.carteira += aposta * 2;
                            user.vitorias = (user.vitorias || 0) + 1;

                            saveDB(db);

                            await sock.sendMessage(
                                from,
                                {
                                    text:
                                        `🪙 *CARA OU COROA*\n` +
                                        `━━━━━━━━━━━━━━━━━━━━\n` +
                                        `🪙 Resultado: *${resultado.toUpperCase()}*\n` +
                                        `🎉 Você acertou!\n\n` +
                                        `🏆 Prêmio: *R$ ${aposta * 2}*\n` +
                                        `💳 Carteira: *R$ ${user.carteira}*\n` +
                                        `━━━━━━━━━━━━━━━━━━━━`
                                },
                                { quoted: msg }
                            );
                        } else {
                            saveDB(db);

                            await sock.sendMessage(
                                from,
                                {
                                    text:
                                        `🪙 *CARA OU COROA*\n` +
                                        `━━━━━━━━━━━━━━━━━━━━\n` +
                                        `🪙 Resultado: *${resultado.toUpperCase()}*\n` +
                                        `❌ Você perdeu!\n\n` +
                                        `💸 Perda: *R$ ${aposta}*\n` +
                                        `💳 Carteira: *R$ ${user.carteira}*\n` +
                                        `━━━━━━━━━━━━━━━━━━━━`
                                },
                                { quoted: msg }
                            );
                        }

                        break;
                    }

                    case 'dado': {
                        const numero = Math.floor(Math.random() * 6) + 1;

                        const faces = {
                            1: '⚀',
                            2: '⚁',
                            3: '⚂',
                            4: '⚃',
                            5: '⚄',
                            6: '⚅'
                        };

                        await sock.sendMessage(
                            from,
                            {
                                text:
                                    `🎲 *DADO*\n` +
                                    `━━━━━━━━━━━━━━━━━━━━\n` +
                                    `${faces[numero]} Você tirou *${numero}*!\n` +
                                    `━━━━━━━━━━━━━━━━━━━━`
                            },
                            { quoted: msg }
                        );

                        break;
                    }

                    // =========================================================
                    // OSINT / CONSULTAS PÚBLICAS
                    // =========================================================

                    case 'cep': {
                        const cleanCep = args.join('').replace(/\D/g, '');

                        if (cleanCep.length !== 8) {
                            return await sock.sendMessage(
                                from,
                                {
                                    text:
                                        '⚠️ Informe um CEP válido com 8 dígitos.\n\n' +
                                        'Exemplo: *.cep 01001000*'
                                },
                                { quoted: msg }
                            );
                        }

                        try {
                            const response = await axios.get(
                                `https://viacep.com.br/ws/${cleanCep}/json/`,
                                { timeout: 8000 }
                            );

                            const data = response.data;

                            if (data.erro) {
                                return await sock.sendMessage(
                                    from,
                                    {
                                        text: '❌ CEP não encontrado.'
                                    },
                                    { quoted: msg }
                                );
                            }

                            const resultado =
                                `📍 *CONSULTA DE CEP*\n` +
                                `━━━━━━━━━━━━━━━━━━━━\n` +
                                `📮 CEP: *${data.cep || cleanCep}*\n` +
                                `🏠 Logradouro: *${data.logradouro || 'N/A'}*\n` +
                                `🏡 Bairro: *${data.bairro || 'N/A'}*\n` +
                                `🌆 Cidade: *${data.localidade || 'N/A'}*\n` +
                                `🇧🇷 UF: *${data.uf || 'N/A'}*\n` +
                                `📞 DDD: *${data.ddd || 'N/A'}*\n` +
                                `━━━━━━━━━━━━━━━━━━━━`;

                            await sock.sendMessage(
                                from,
                                { text: resultado },
                                { quoted: msg }
                            );
                        } catch (error) {
                            console.error('Erro CEP:', error.message);

                            await sock.sendMessage(
                                from,
                                {
                                    text:
                                        '❌ Não foi possível consultar o CEP agora.'
                                },
                                { quoted: msg }
                            );
                        }

                        break;
                    }

                    case 'cnpj': {
                        const cleanCnpj = args.join('').replace(/\D/g, '');

                        if (cleanCnpj.length !== 14) {
                            return await sock.sendMessage(
                                from,
                                {
                                    text:
                                        '⚠️ Informe um CNPJ válido com 14 dígitos.\n\n' +
                                        'Exemplo: *.cnpj 11222333000181*'
                                },
                                { quoted: msg }
                            );
                        }

                        try {
                            let data = null;

                            // Primeira API
                            try {
                                const response = await axios.get(
                                    `https://brasilapi.com.br/api/cnpj/v1/${cleanCnpj}`,
                                    { timeout: 8000 }
                                );

                                data = response.data;
                            } catch (error) {
                                // Segunda API
                                try {
                                    const response = await axios.get(
                                        `https://minhareceita.org/${cleanCnpj}`,
                                        { timeout: 8000 }
                                    );

                                    data = response.data;
                                } catch (error2) {
                                    data = null;
                                }
                            }

                            if (!data) {
                                return await sock.sendMessage(
                                    from,
                                    {
                                        text:
                                            '❌ Não foi possível localizar esse CNPJ.'
                                    },
                                    { quoted: msg }
                                );
                            }

                            const razao =
                                data.razao_social ||
                                data.nome_empresarial ||
                                data.razaoSocial ||
                                'N/A';

                            const fantasia =
                                data.nome_fantasia ||
                                data.nomeFantasia ||
                                'N/A';

                            const situacao =
                                data.descricao_situacao_cadastral ||
                                data.situacao_cadastral ||
                                data.situacao ||
                                'N/A';

                            const abertura =
                                data.data_inicio_atividade ||
                                data.data_de_inicio_atividade ||
                                data.data_abertura ||
                                'N/A';

                            const cidade =
                                data.municipio ||
                                data.cidade ||
                                'N/A';

                            const uf = data.uf || 'N/A';

                            const resultado =
                                `🏢 *CONSULTA DE CNPJ*\n` +
                                `━━━━━━━━━━━━━━━━━━━━\n` +
                                `📄 CNPJ: *${cleanCnpj}*\n` +
                                `🏷️ Razão Social: *${razao}*\n` +
                                `📌 Nome Fantasia: *${fantasia}*\n` +
                                `🟢 Situação: *${situacao}*\n` +
                                `📅 Abertura: *${abertura}*\n` +
                                `🌆 Cidade/UF: *${cidade} - ${uf}*\n` +
                                `━━━━━━━━━━━━━━━━━━━━`;

                            await sock.sendMessage(
                                from,
                                { text: resultado },
                                { quoted: msg }
                            );
                        } catch (error) {
                            console.error('Erro CNPJ:', error.message);

                            await sock.sendMessage(
                                from,
                                {
                                    text:
                                        '❌ Erro ao consultar o CNPJ.'
                                },
                                { quoted: msg }
                            );
                        }

                        break;
                    }

                    case 'ip': {
                        const ipQuery = args[0]?.trim();

                        if (!ipQuery) {
                            return await sock.sendMessage(
                                from,
                                {
                                    text:
                                        '⚠️ Informe um endereço IP.\n\n' +
                                        'Exemplo: *.ip 8.8.8.8*'
                                },
                                { quoted: msg }
                            );
                        }

                        try {
                            const response = await axios.get(
                                `http://ip-api.com/json/${encodeURIComponent(ipQuery)}?fields=status,message,query,country,regionName,city,zip,isp,org,lat,lon`,
                                { timeout: 8000 }
                            );

                            const data = response.data;

                            if (data.status !== 'success') {
                                return await sock.sendMessage(
                                    from,
                                    {
                                        text:
                                            `❌ Não foi possível consultar o IP.\n` +
                                            `Motivo: ${data.message || 'IP inválido'}`
                                    },
                                    { quoted: msg }
                                );
                            }

                            const resultado =
                                `🌐 *CONSULTA DE IP*\n` +
                                `━━━━━━━━━━━━━━━━━━━━\n` +
                                `🖥️ IP: *${data.query}*\n` +
                                `🌍 País: *${data.country || 'N/A'}*\n` +
                                `🏙️ Região: *${data.regionName || 'N/A'}*\n` +
                                `🌆 Cidade: *${data.city || 'N/A'}*\n` +
                                `📮 CEP: *${data.zip || 'N/A'}*\n` +
                                `📡 Provedor: *${data.isp || 'N/A'}*\n` +
                                `🏢 Organização: *${data.org || 'N/A'}*\n` +
                                `📍 Coordenadas: *${data.lat ?? 'N/A'}, ${data.lon ?? 'N/A'}*\n` +
                                `━━━━━━━━━━━━━━━━━━━━`;

                            await sock.sendMessage(
                                from,
                                { text: resultado },
                                { quoted: msg }
                            );
                        } catch (error) {
                            console.error('Erro IP:', error.message);

                            await sock.sendMessage(
                                from,
                                {
                                    text:
                                        '❌ Falha ao consultar o IP.'
                                },
                                { quoted: msg }
                            );
                        }

                        break;
                    }

                    case 'search': {
                        const searchQuery = args.join(' ').trim();

                        if (!searchQuery) {
                            return await sock.sendMessage(
                                from,
                                {
                                    text:
                                        '⚠️ Digite algo para pesquisar.\n\n' +
                                        'Exemplo: *.search Termux Linux*'
                                },
                                { quoted: msg }
                            );
                        }

                        if (!SERPAPI_KEY) {
                            return await sock.sendMessage(
                                from,
                                {
                                    text:
                                        '❌ A chave da SerpAPI não está configurada.'
                                },
                                { quoted: msg }
                            );
                        }

                        try {
                            const response = await axios.get(
                                'https://serpapi.com/search.json',
                                {
                                    params: {
                                        q: searchQuery,
                                        api_key: SERPAPI_KEY,
                                        hl: 'pt-br',
                                        gl: 'br'
                                    },
                                    timeout: 12000
                                }
                            );

                            const results =
                                response.data?.organic_results?.slice(0, 5) || [];

                            if (results.length === 0) {
                                return await sock.sendMessage(
                                    from,
                                    {
                                        text:
                                            '❌ Nenhum resultado encontrado.'
                                    },
                                    { quoted: msg }
                                );
                            }

                            let resultado =
                                `🔎 *RESULTADOS DA PESQUISA*\n` +
                                `━━━━━━━━━━━━━━━━━━━━\n`;

                            results.forEach((item, index) => {
                                resultado +=
                                    `\n*${index + 1}. ${item.title || 'Sem título'}*\n` +
                                    `🔗 ${item.link || 'Sem link'}\n` +
                                    `📝 ${item.snippet || 'Sem descrição'}\n`;
                            });

                            resultado +=
                                `\n━━━━━━━━━━━━━━━━━━━━`;

                            await sock.sendMessage(
                                from,
                                { text: resultado },
                                { quoted: msg }
                            );
                        } catch (error) {
                            console.error('Erro SerpAPI:', error.message);

                            await sock.sendMessage(
                                from,
                                {
                                    text:
                                        '❌ Erro ao realizar a pesquisa.'
                                },
                                { quoted: msg }
                            );
                        }

                        break;
                    }

                    // =========================================================
                    // REVELAR MÍDIA DE VISUALIZAÇÃO ÚNICA
                    // =========================================================

                    case 'revelar': {
                        let quotedMsg =
                            msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;

                        if (!quotedMsg) {
                            return await sock.sendMessage(
                                from,
                                {
                                    text:
                                        '⚠️ Responda a uma mídia de visualização única com *.revelar*.'
                                },
                                { quoted: msg }
                            );
                        }

                        // Compatibilidade com diferentes versões do WhatsApp
                        if (quotedMsg.viewOnceMessage?.message) {
                            quotedMsg = quotedMsg.viewOnceMessage.message;
                        }

                        if (quotedMsg.viewOnceMessageV2?.message) {
                            quotedMsg = quotedMsg.viewOnceMessageV2.message;
                        }

                        if (quotedMsg.viewOnceMessageV2Extension?.message) {
                            quotedMsg =
                                quotedMsg.viewOnceMessageV2Extension.message;
                        }

                        const imageMsg = quotedMsg.imageMessage;
                        const videoMsg = quotedMsg.videoMessage;

                        if (!imageMsg && !videoMsg) {
                            return await sock.sendMessage(
                                from,
                                {
                                    text:
                                        '⚠️ A mensagem marcada não contém uma mídia compatível.'
                                },
                                { quoted: msg }
                            );
                        }

                        try {
                            const mediaType = imageMsg ? 'image' : 'video';

                            const stream =
                                await downloadContentFromMessage(
                                    imageMsg || videoMsg,
                                    mediaType
                                );

                            const chunks = [];

                            for await (const chunk of stream) {
                                chunks.push(chunk);
                            }

                            const buffer = Buffer.concat(chunks);

                            if (!buffer.length) {
                                throw new Error('Mídia vazia');
                            }

                            if (mediaType === 'image') {
                                await sock.sendMessage(
                                    from,
                                    {
                                        image: buffer,
                                        caption: '🔓 *Mídia revelada!*'
                                    },
                                    { quoted: msg }
                                );
                            } else {
                                await sock.sendMessage(
                                    from,
                                    {
                                        video: buffer,
                                        caption: '🔓 *Mídia revelada!*'
                                    },
                                    { quoted: msg }
                                );
                            }
                        } catch (error) {
                            console.error(
                                'Erro ao revelar mídia:',
                                error.message
                            );

                            await sock.sendMessage(
                                from,
                                {
                                    text:
                                        '❌ Não foi possível baixar a mídia.'
                                },
                                { quoted: msg }
                            );
                        }

                        break;
                    }

                    // =========================================================
                    // FERRAMENTAS
                    // =========================================================

                    case 'senha': {
                        let length = Number(args[0]);

                        if (!Number.isInteger(length)) {
                            length = 12;
                        }

                        // Evita senhas absurdamente grandes
                        length = Math.max(4, Math.min(length, 64));

                        const chars =
                            'ABCDEFGHIJKLMNOPQRSTUVWXYZ' +
                            'abcdefghijklmnopqrstuvwxyz' +
                            '0123456789' +
                            '!@#$%^&*()_+-=';

                        let password = '';

                        for (let i = 0; i < length; i++) {
                            password +=
                                chars[Math.floor(Math.random() * chars.length)];
                        }

                        await sock.sendMessage(
                            from,
                            {
                                text:
                                    `🔐 *SENHA GERADA*\n` +
                                    `━━━━━━━━━━━━━━━━━━━━\n` +
                                    `🔑 \`${password}\`\n` +
                                    `📏 Tamanho: *${length} caracteres*\n` +
                                    `━━━━━━━━━━━━━━━━━━━━`
                            },
                            { quoted: msg }
                        );

                        break;
                    }

                    case 'encurtar': {
                        const url = args[0]?.trim();

                        if (!url) {
                            return await sock.sendMessage(
                                from,
                                {
                                    text:
                                        '⚠️ Envie uma URL.\n\n' +
                                        'Exemplo: *.encurtar https://google.com*'
                                },
                                { quoted: msg }
                            );
                        }

                        try {
                            const response = await axios.get(
                                'https://tinyurl.com/api-create.php',
                                {
                                    params: {
                                        url
                                    },
                                    timeout: 10000
                                }
                            );

                            const shortUrl = String(response.data || '').trim();

                            if (!shortUrl.startsWith('http')) {
                                throw new Error('URL encurtada inválida');
                            }

                            await sock.sendMessage(
                                from,
                                {
                                    text:
                                        `🔗 *LINK ENCURTADO*\n` +
                                        `━━━━━━━━━━━━━━━━━━━━\n` +
                                        `${shortUrl}\n` +
                                        `━━━━━━━━━━━━━━━━━━━━`
                                },
                                { quoted: msg }
                            );
                        } catch (error) {
                            console.error(
                                'Erro TinyURL:',
                                error.message
                            );

                            await sock.sendMessage(
                                from,
                                {
                                    text:
                                        '❌ Não foi possível encurtar esse link.'
                                },
                                { quoted: msg }
                            );
                        }

                        break;
                    }

                    // =========================================================
                    // ADMINISTRAÇÃO DE GRUPOS
                    // =========================================================

                    case 'hidetag': {
                        if (!isGroup) {
                            return await sock.sendMessage(
                                from,
                                {
                                    text:
                                        '⚠️ Este comando só funciona em grupos.'
                                },
                                { quoted: msg }
                            );
                        }

                        try {
                            const groupMetadata =
                                await sock.groupMetadata(from);

                            const senderParticipant =
                                groupMetadata.participants.find(
                                    p => p.id === sender
                                );

                            if (!senderParticipant?.admin) {
                                return await sock.sendMessage(
                                    from,
                                    {
                                        text:
                                            '❌ Apenas administradores podem usar este comando.'
                                    },
                                    { quoted: msg }
                                );
                            }

                            const participants =
                                groupMetadata.participants.map(p => p.id);

                            const textHide =
                                args.join(' ').trim() ||
                                '📢 Comunicado Geral!';

                            await sock.sendMessage(
                                from,
                                {
                                    text: textHide,
                                    mentions: participants
                                },
                                { quoted: msg }
                            );
                        } catch (error) {
                            console.error(
                                'Erro hidetag:',
                                error.message
                            );

                            await sock.sendMessage(
                                from,
                                {
                                    text:
                                        '❌ Não foi possível executar o hidetag.'
                                },
                                { quoted: msg }
                            );
                        }

                        break;
                    }

                    case 'ban':
                    case 'kick': {
                        if (!isGroup) {
                            return await sock.sendMessage(
                                from,
                                {
                                    text:
                                        '⚠️ Este comando só funciona em grupos.'
                                },
                                { quoted: msg }
                            );
                        }

                        try {
                            const groupMetadata =
                                await sock.groupMetadata(from);

                            const senderParticipant =
                                groupMetadata.participants.find(
                                    p => p.id === sender
                                );

                            if (!senderParticipant?.admin) {
                                return await sock.sendMessage(
                                    from,
                                    {
                                        text:
                                            '❌ Apenas administradores podem remover membros.'
                                    },
                                    { quoted: msg }
                                );
                            }

                            const botId =
                                sock.user?.id?.split(':')[0] +
                                '@s.whatsapp.net';

                            const botParticipant =
                                groupMetadata.participants.find(
                                    p =>
                                        p.id === botId ||
                                        p.id?.split(':')[0] ===
                                            sock.user?.id?.split(':')[0]
                                );

                            if (!botParticipant?.admin) {
                                return await sock.sendMessage(
                                    from,
                                    {
                                        text:
                                            '❌ O Pyda precisa ser Administrador do grupo.'
                                    },
                                    { quoted: msg }
                                );
                            }

                            const contextInfo =
                                msg.message?.extendedTextMessage
                                    ?.contextInfo;

                            const quotedSender =
                                contextInfo?.participant;

                            const mentioned =
                                contextInfo?.mentionedJid?.[0] ||
                                quotedSender;

                            if (!mentioned) {
                                return await sock.sendMessage(
                                    from,
                                    {
                                        text:
                                            '⚠️ Mencione o membro ou responda à mensagem dele.'
                                    },
                                    { quoted: msg }
                                );
                            }

                            if (mentioned === botId) {
                                return await sock.sendMessage(
                                    from,
                                    {
                                        text:
                                            '🤖 Eu não posso remover a mim mesmo.'
                                    },
                                    { quoted: msg }
                                );
                            }

                            await sock.groupParticipantsUpdate(
                                from,
                                [mentioned],
                                'remove'
                            );

                            await sock.sendMessage(
                                from,
                                {
                                    text:
                                        `🚨 @${mentioned.split('@')[0]} foi removido do grupo!`,
                                    mentions: [mentioned]
                                },
                                { quoted: msg }
                            );
                        } catch (error) {
                            console.error(
                                'Erro ao remover membro:',
                                error.message
                            );

                            await sock.sendMessage(
                                from,
                                {
                                    text:
                                        '❌ Não foi possível remover o membro. Verifique se o bot possui administrador.'
                                },
                                { quoted: msg }
                            );
                        }

                        break;
                    }

                    case 'promover': {
                        if (!isGroup) {
                            return await sock.sendMessage(
                                from,
                                {
                                    text:
                                        '⚠️ Este comando só funciona em grupos.'
                                },
                                { quoted: msg }
                            );
                        }

                        try {
                            const groupMetadata =
                                await sock.groupMetadata(from);

                            const senderParticipant =
                                groupMetadata.participants.find(
                                    p => p.id === sender
                                );

                            if (!senderParticipant?.admin) {
                                return await sock.sendMessage(
                                    from,
                                    {
                                        text:
                                            '❌ Apenas administradores podem promover membros.'
                                    },
                                    { quoted: msg }
                                );
                            }

                            const botNumber =
                                sock.user?.id?.split(':')[0];

                            const botParticipant =
                                groupMetadata.participants.find(
                                    p =>
                                        p.id?.split(':')[0] ===
                                        botNumber
                                );

                            if (!botParticipant?.admin) {
                                return await sock.sendMessage(
                                    from,
                                    {
                                        text:
                                            '❌ O Pyda precisa ser Administrador do grupo.'
                                    },
                                    { quoted: msg }
                                );
                            }

                            const contextInfo =
                                msg.message?.extendedTextMessage
                                    ?.contextInfo;

                            const mentioned =
                                contextInfo?.mentionedJid?.[0] ||
                                contextInfo?.participant;

                            if (!mentioned) {
                                return await sock.sendMessage(
                                    from,
                                    {
                                        text:
                                            '⚠️ Mencione o membro ou responda à mensagem dele.'
                                    },
                                    { quoted: msg }
                                );
                            }

                            await sock.groupParticipantsUpdate(
                                from,
                                [mentioned],
                                'promote'
                            );

                            await sock.sendMessage(
                                from,
                                {
                                    text:
                                        `👑 @${mentioned.split('@')[0]} agora é Administrador!`,
                                    mentions: [mentioned]
                                },
                                { quoted: msg }
                            );
                        } catch (error) {
                            console.error(
                                'Erro promover:',
                                error.message
                            );

                            await sock.sendMessage(
                                from,
                                {
                                    text:
                                        '❌ Não foi possível promover o membro.'
                                },
                                { quoted: msg }
                            );
                        }

                        break;
                    }

                    case 'rebaixar': {
                        if (!isGroup) {
                            return await sock.sendMessage(
                                from,
                                {
                                    text:
                                        '⚠️ Este comando só funciona em grupos.'
                                },
                                { quoted: msg }
                            );
                        }

                        try {
                            const groupMetadata =
                                await sock.groupMetadata(from);

                            const senderParticipant =
                                groupMetadata.participants.find(
                                    p => p.id === sender
                                );

                            if (!senderParticipant?.admin) {
                                return await sock.sendMessage(
                                    from,
                                    {
                                        text:
                                            '❌ Apenas administradores podem rebaixar membros.'
                                    },
                                    { quoted: msg }
                                );
                            }

                            const botNumber =
                                sock.user?.id?.split(':')[0];

                            const botParticipant =
                                groupMetadata.participants.find(
                                    p =>
                                        p.id?.split(':')[0] ===
                                        botNumber
                                );

                            if (!botParticipant?.admin) {
                                return await sock.sendMessage(
                                    from,
                                    {
                                        text:
                                            '❌ O Pyda precisa ser Administrador do grupo.'
                                    },
                                    { quoted: msg }
                                );
                            }

                            const contextInfo =
                                msg.message?.extendedTextMessage
                                    ?.contextInfo;

                            const mentioned =
                                contextInfo?.mentionedJid?.[0] ||
                                contextInfo?.participant;

                            if (!mentioned) {
                                return await sock.sendMessage(
                                    from,
                                    {
                                        text:
                                            '⚠️ Mencione o membro ou responda à mensagem dele.'
                                    },
                                    { quoted: msg }
                                );
                            }

                            await sock.groupParticipantsUpdate(
                                from,
                                [mentioned],
                                'demote'
                            );

                            await sock.sendMessage(
                                from,
                                {
                                    text:
                                        `📉 @${mentioned.split('@')[0]} foi rebaixado.`,
                                    mentions: [mentioned]
                                },
                                { quoted: msg }
                            );
                        } catch (error) {
                            console.error(
                                'Erro rebaixar:',
                                error.message
                            );

                            await sock.sendMessage(
                                from,
                                {
                                    text:
                                        '❌ Não foi possível rebaixar o membro.'
                                },
                                { quoted: msg }
                            );
                        }

                        break;
                    }

                    case 'warn': {
                        if (!isGroup) {
                            return await sock.sendMessage(
                                from,
                                {
                                    text:
                                        '⚠️ Este comando só funciona em grupos.'
                                },
                                { quoted: msg }
                            );
                        }

                        try {
                            const groupMetadata =
                                await sock.groupMetadata(from);

                            const senderParticipant =
                                groupMetadata.participants.find(
                                    p => p.id === sender
                                );

                            if (!senderParticipant?.admin) {
                                return await sock.sendMessage(
                                    from,
                                    {
                                        text:
                                            '❌ Apenas administradores podem aplicar advertências.'
                                    },
                                    { quoted: msg }
                                );
                            }

                            const contextInfo =
                                msg.message?.extendedTextMessage
                                    ?.contextInfo;

                            const mentioned =
                                contextInfo?.mentionedJid?.[0] ||
                                contextInfo?.participant;

                            if (!mentioned) {
                                return await sock.sendMessage(
                                    from,
                                    {
                                        text:
                                            '⚠️ Mencione o membro ou responda à mensagem dele.'
                                    },
                                    { quoted: msg }
                                );
                            }

                            const warnedUser =
                                getUser(db, mentioned, 'Membro');

                            warnedUser.warnings =
                                Number(warnedUser.warnings || 0) + 1;

                            if (warnedUser.warnings >= 3) {
                                const botNumber =
                                    sock.user?.id?.split(':')[0];

                                const botParticipant =
                                    groupMetadata.participants.find(
                                        p =>
                                            p.id?.split(':')[0] ===
                                            botNumber
                                    );

                                if (botParticipant?.admin) {
                                    try {
                                        await sock.groupParticipantsUpdate(
                                            from,
                                            [mentioned],
                                            'remove'
                                        );

                                        warnedUser.warnings = 0;
                                        saveDB(db);

                                        await sock.sendMessage(
                                            from,
                                            {
                                                text:
                                                    `🚨 @${mentioned.split('@')[0]} atingiu *3 advertências* e foi removido!`,
                                                mentions: [mentioned]
                                            },
                                            { quoted: msg }
                                        );
                                    } catch (error) {
                                        saveDB(db);

                                        await sock.sendMessage(
                                            from,
                                            {
                                                text:
                                                    `⚠️ @${mentioned.split('@')[0]} atingiu *3/3 advertências*, mas não consegui removê-lo.`,
                                                mentions: [mentioned]
                                            },
                                            { quoted: msg }
                                        );
                                    }
                                } else {
                                    saveDB(db);

                                    await sock.sendMessage(
                                        from,
                                        {
                                            text:
                                                `⚠️ @${mentioned.split('@')[0]} atingiu *3/3 advertências*, mas o Pyda precisa ser administrador para removê-lo.`,
                                            mentions: [mentioned]
                                        },
                                        { quoted: msg }
                                    );
                                }
                            } else {
                                saveDB(db);

                                await sock.sendMessage(
                                    from,
                                    {
                                        text:
                                            `⚠️ @${mentioned.split('@')[0]} recebeu uma advertência!\n\n` +
                                            `📊 Advertências: *${warnedUser.warnings}/3*`,
                                        mentions: [mentioned]
                                    },
                                    { quoted: msg }
                                );
                            }
                        } catch (error) {
                            console.error(
                                'Erro warn:',
                                error.message
                            );

                            await sock.sendMessage(
                                from,
                                {
                                    text:
                                        '❌ Não foi possível aplicar a advertência.'
                                },
                                { quoted: msg }
                            );
                        }

                        break;
                    }

                    // =========================================================
                    // COMANDOS DO DONO
                    // =========================================================

                    case 'bc': {
                        /*
                         * Segurança:
                         * msg.key.fromMe significa que o comando foi enviado
                         * pela própria conta conectada ao bot.
                         *
                         * Assim, o comando não fica liberado para qualquer
                         * administrador do grupo.
                         */
                        if (!msg.key.fromMe) {
                            return await sock.sendMessage(
                                from,
                                {
                                    text:
                                        '❌ Este comando é exclusivo do dono do bot.'
                                },
                                { quoted: msg }
                            );
                        }

                        const textBc = args.join(' ').trim();

                        if (!textBc) {
                            return await sock.sendMessage(
                                from,
                                {
                                    text:
                                        '⚠️ Digite a mensagem da transmissão.\n\n' +
                                        'Exemplo: *.bc Bom dia, pessoal!*'
                                },
                                { quoted: msg }
                            );
                        }

                        const chats = Object.keys(db.groups);

                        if (chats.length === 0) {
                            return await sock.sendMessage(
                                from,
                                {
                                    text:
                                        '⚠️ Nenhum grupo registrado no banco de dados.'
                                },
                                { quoted: msg }
                            );
                        }

                        let enviados = 0;
                        let falhas = 0;

                        for (const chatId of chats) {
                            try {
                                await sock.sendMessage(
                                    chatId,
                                    {
                                        text:
                                            `📢 *TRANSMISSÃO PYDA*\n\n${textBc}`
                                    }
                                );

                                enviados++;

                                // Pequena pausa para evitar disparos
                                // extremamente rápidos.
                                await new Promise(resolve =>
                                    setTimeout(resolve, 500)
                                );
                            } catch (error) {
                                falhas++;
                                console.error(
                                    `Erro BC em ${chatId}:`,
                                    error.message
                                );
                            }
                        }

                        await sock.sendMessage(
                            from,
                            {
                                text:
                                    `✅ *TRANSMISSÃO FINALIZADA*\n\n` +
                                    `📨 Enviados: *${enviados}*\n` +
                                    `❌ Falhas: *${falhas}*`
                            },
                            { quoted: msg }
                        );

                        break;
                    }

                    case 'restart': {
                        if (!msg.key.fromMe) {
                            return await sock.sendMessage(
                                from,
                                {
                                    text:
                                        '❌ Este comando é exclusivo do dono do bot.'
                                },
                                { quoted: msg }
                            );
                        }

                        await sock.sendMessage(
                            from,
                            {
                                text:
                                    '⚙️ *Reiniciando o Pyda...*\n\nAguarde alguns segundos.'
                            },
                            { quoted: msg }
                        );

                        /*
                         * O processo será encerrado.
                         *
                         * Se você estiver usando PM2, Docker ou outro
                         * gerenciador de processos, ele poderá iniciar
                         * novamente automaticamente.
                         */
                        setTimeout(() => {
                            process.exit(0);
                        }, 1000);

                        break;
                    }

                    // =========================================================
                    // COMANDO DESCONHECIDO
                    // =========================================================

                    default: {
                        await sock.sendMessage(
                            from,
                            {
                                text:
                                    `❓ Comando *.${command}* não encontrado.\n\n` +
                                    `Digite *.menu* para ver os comandos disponíveis.`
                            },
                            { quoted: msg }
                        );

                        break;
                    }
                }
            } catch (err) {
                console.error(
                    '❌ Erro ao processar mensagem:',
                    err
                );

                try {
                    if (from) {
                        await sock.sendMessage(
                            from,
                            {
                                text:
                                    '❌ Ocorreu um erro interno ao processar o comando.'
                            },
                            { quoted: msg }
                        );
                    }
                } catch (sendError) {
                    console.error(
                        'Erro ao enviar mensagem de erro:',
                        sendError.message
                    );
                }
            }
        }
    });
}

// =========================================================
// INICIALIZAÇÃO DO PYDA
// =========================================================

connectToWhatsApp().catch(error => {
    console.error(
        '❌ Erro fatal ao iniciar o Pyda:',
        error
    );

    process.exit(1);
});
