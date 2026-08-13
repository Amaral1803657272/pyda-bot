const { 
    default: makeWASocket, 
    useMultiFileAuthState, 
    DisconnectReason, 
    downloadContentFromMessage 
} = require('@whiskeysockets/baileys');
const pino = require('pino');
const readline = require('readline');
const fs = require('fs');
const axios = require('axios');

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});
const question = (text) => new Promise((resolve) => rl.question(text, resolve));

// Foto oficial do menu
const BOT_LOGO_URL = 'https://i.postimg.cc/gc7hhDcF/file-00000000e328820e9000f592feb5a047.png';

// Banco de dados local
const DB_FILE = './database.json';
if (!fs.existsSync(DB_FILE)) {
    fs.writeFileSync(DB_FILE, JSON.stringify({ users: {}, welcome: {}, goodbye: {}, autoresponder: {} }, null, 2));
}

function loadDB() {
    let data = JSON.parse(fs.readFileSync(DB_FILE, 'utf-8'));
    if (!data.autoresponder) data.autoresponder = {};
    return data;
}

function saveDB(data) {
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

function getUser(db, sender) {
    if (!db.users[sender]) {
        db.users[sender] = {
            carteira: 100,
            banco: 0,
            hp: 100,
            nivel: 1,
            trabalhoCooldown: 0
        };
    }
    return db.users[sender];
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
                console.log(`\n🔑 CÓDIGO: \x1b[32m${code}\x1b[0m\n`);
            }, 3000);
        }
    }

    sock.ev.on('connection.update', async (update) => {
        const { connection } = update;
        if (connection === 'open') console.log('\n✅ Pyda Bot v3.7 (Cassino & OSINT Pro) Conectado!');
    });

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;
        for (const msg of messages) {
            if (!msg.message) continue;
            const from = msg.key.remoteJid;
            const sender = msg.key.participant || msg.key.remoteJid;
            const isGroup = from.endsWith('@g.us');
            const body = msg.message.conversation || msg.message.extendedTextMessage?.text || '';
            const prefix = '.';

            const db = loadDB();

            // ==================== VERIFICAÇÃO DE AUTORESPONDER ====================
            if (!body.startsWith(prefix)) {
                const chatAuto = db.autoresponder[from] || {};
                const textLower = body.trim().toLowerCase();

                if (chatAuto[textLower]) {
                    await sock.sendMessage(from, { text: chatAuto[textLower] }, { quoted: msg });
                }
                continue;
            }

            const args = body.slice(prefix.length).trim().split(/ +/);
            const command = args.shift().toLowerCase();
            const user = getUser(db, sender);

            let commandFound = true;

            switch (command) {
                // ==================== PAINEL PRINCIPAL ====================
                case 'menu':
                case 'ajuda': {
                    const menuCaption = `
⚡ *PYDA BOT - PAINEL PRINCIPAL* ⚡
─────────────────────
👤 *Desenvolvedor:* Odin
🤖 *Status:* Online
⚙️ *Prefixo:* [ . ]
─────────────────────

Escolha uma categoria:

👑 *.menudono* - Comandos do Criador
🛡️ *.menuadm* - Moderação de Grupos
🤖 *.menuauto* - Respostas Automáticas
📥 *.menumembro* - Utilitários e Downloads
⚔️ *.menurpg* - Economia e Batalhas
🎲 *.menujogos* - Cassino e Apostas
🔍 *.menuosint* - Ferramentas OSINT & Redes

─────────────────────
💻 _Pyda Systems v3.7_
`.trim();
                    await sock.sendMessage(from, { image: { url: BOT_LOGO_URL }, caption: menuCaption }, { quoted: msg });
                    break;
                }

                case 'menudono':
                    await sock.sendMessage(from, { text: `👑 *MENU DONO (ODIN)*\n─────────────────────\n• *.bc [texto]* - Transmissão.\n• *.dono* - Info do criador.` }, { quoted: msg });
                    break;

                case 'menuadm':
                    await sock.sendMessage(from, { text: `🛡️ *MENU ADM*\n─────────────────────\n• *.grupo fechar*\n• *.grupo abrir*\n• *.apagar*` }, { quoted: msg });
                    break;

                case 'menumembro':
                    await sock.sendMessage(from, { text: `📥 *MENU MEMBRO*\n─────────────────────\n• *.tiktok [link]*\n• *.ytmp3 [link]*\n• *.ytmp4 [link]*\n• *.revelar*\n• *.ping*` }, { quoted: msg });
                    break;

                case 'menurpg':
                    await sock.sendMessage(from, { text: `⚔️ *MENU RPG*\n─────────────────────\n• *.trabalhar*\n• *.saldo*\n• *.depositar [valor]*\n• *.sacar [valor]*\n• *.dragao*\n• *.curar*` }, { quoted: msg });
                    break;

                case 'menujogos': {
                    const textJogos = `
🎰 *PYDA CASSINO & JOGOS*
─────────────────────
🚀 *.foguete [2x/3x] [aposta]* - Crash
🎰 *.tigrinho [aposta]* - Caça-níqueis 
🎯 *.roleta [vermelho/preto/0-36] [aposta]* - Roleta
🃏 *.21 [aposta]* ou *.blackjack [aposta]* - 21 Rápido
🪙 *.caraoucoroa [cara/coroa] [aposta]* - Moeda
🎲 *.dado* - Rola 1 dado simples
─────────────────────`.trim();
                    await sock.sendMessage(from, { text: textJogos }, { quoted: msg });
                    break;
                }

                case 'menuosint': {
                    const textOsint = `
🔍 *PAINEL OSINT & INFRAESTRUTURA*
─────────────────────
🌐 *.ip [ip]* - Geolocalização e provedor.
🔎 *.dns [dominio]* - Registros DNS (A/IPs).
📄 *.whois [dominio]* - Dados de registro RDAP.
🛡️ *.emailsec [dominio]* - Checagem SPF e DMARC.
🏢 *.cnpj [numero]* - Dados de empresa na Receita.
📍 *.cep [numero]* - Localização por CEP.
🌐 *.subdominios [dominio]* - Busca por certificado SSL.
🔄 *.rdns [ip]* - Reverse DNS (PTR).
📶 *.mac [mac]* - Fabricante do dispositivo.
⚡ *.httpcheck [site]* - Status, latência e servidor.
─────────────────────`.trim();
                    await sock.sendMessage(from, { text: textOsint }, { quoted: msg });
                    break;
                }

                // ==================== AUTORESPONDER ====================
                case 'menuauto': {
                    const textAuto = `
🤖 *AUTOMAÇÃO & RESPONDEDOR*
─────────────────────
💡 *Como funciona?*
Envie a palavra-chave e a resposta separadas pelo caractere *|*.

• *.addauto [gatilho] | [resposta]*
  _Exemplo:_ \`.addauto oi | Olá, tudo bem? Como posso te ajudar hoje?\`

• *.delauto [gatilho]* - Remove um gatilho.
• *.meusautos* - Lista todos os gatilhos do chat.
─────────────────────`.trim();
                    await sock.sendMessage(from, { text: textAuto }, { quoted: msg });
                    break;
                }

                case 'addauto': {
                    const content = args.join(' ');
                    const [gatilho, ...respostaParts] = content.split('|');
                    const resposta = respostaParts.join('|').trim();

                    if (!gatilho || !resposta) {
                        await sock.sendMessage(from, { 
                            text: '⚠️ *Formato incorreto!*\n\nUse: `.addauto [palavra-chave] | [resposta]`\n\n*Exemplo:*\n`.addauto oi | Olá! Seja bem-vindo!`' 
                        }, { quoted: msg });
                        break;
                    }

                    if (!db.autoresponder[from]) db.autoresponder[from] = {};
                    db.autoresponder[from][gatilho.trim().toLowerCase()] = resposta;
                    saveDB(db);

                    await sock.sendMessage(from, { 
                        text: `✅ *Autoresponder Cadastrado!*\n─────────────────────\n🔑 *Gatilho:* "${gatilho.trim().toLowerCase()}"\n💬 *Resposta:* ${resposta}` 
                    }, { quoted: msg });
                    break;
                }

                case 'delauto': {
                    const gatilho = args.join(' ').trim().toLowerCase();
                    if (!gatilho) {
                        await sock.sendMessage(from, { text: '⚠️ Uso: `.delauto [palavra-chave]`' }, { quoted: msg });
                        break;
                    }

                    if (db.autoresponder[from] && db.autoresponder[from][gatilho]) {
                        delete db.autoresponder[from][gatilho];
                        saveDB(db);
                        await sock.sendMessage(from, { text: `🗑️ Gatilho *"${gatilho}"* removido com sucesso!` }, { quoted: msg });
                    } else {
                        await sock.sendMessage(from, { text: '❌ Este gatilho não existe.' }, { quoted: msg });
                    }
                    break;
                }

                case 'meusautos': {
                    const chatAuto = db.autoresponder[from] || {};
                    const gatilhos = Object.keys(chatAuto);

                    if (gatilhos.length === 0) {
                        await sock.sendMessage(from, { text: '🤖 Nenhuma resposta automática cadastrada neste chat.' }, { quoted: msg });
                        break;
                    }

                    let lista = `🤖 *RESPOSTAS AUTOMÁTICAS ATIVAS*\n─────────────────────\n`;
                    gatilhos.forEach(g => {
                        lista += `• *Gatilho:* "${g}"\n  👉 *Resposta:* ${chatAuto[g]}\n\n`;
                    });
                    await sock.sendMessage(from, { text: lista.trim() }, { quoted: msg });
                    break;
                }

                // ==================== DOWNLOADS & UTILITÁRIOS ====================
                case 'tiktok':
                case 'tt': {
                    let url = args[0];
                    if (!url) {
                        await sock.sendMessage(from, { text: '⚠️ Envie o link do TikTok.' }, { quoted: msg });
                        break;
                    }
                    await sock.sendMessage(from, { text: '⏳ Baixando do TikTok...' }, { quoted: msg });
                    try {
                        const res = await axios.post('https://www.tikwm.com/api/', 
                            new URLSearchParams({ url, hd: '1' }), 
                            {
                                headers: {
                                    'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
                                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
                                },
                                timeout: 15000
                            }
                        );

                        if (res.data && res.data.data && res.data.data.play) {
                            const videoUrl = res.data.data.play;
                            await sock.sendMessage(from, { 
                                video: { url: videoUrl }, 
                                caption: `🎬 *${res.data.data.title || 'Pyda Bot'}*` 
                            }, { quoted: msg });
                        } else {
                            await sock.sendMessage(from, { text: '❌ Não foi possível obter o vídeo. Verifique se o link está correto.' }, { quoted: msg });
                        }
                    } catch (err) {
                        await sock.sendMessage(from, { text: '❌ Erro de conexão ao baixar o vídeo do TikTok.' }, { quoted: msg });
                    }
                    break;
                }

                // ==================== FERRAMENTAS OSINT ====================
                case 'ip': {
                    const target = args[0];
                    if (!target) {
                        await sock.sendMessage(from, { text: '⚠️ Uso: `.ip [endereço-ip]` (Ex: `.ip 8.8.8.8`)' }, { quoted: msg });
                        break;
                    }
                    try {
                        const res = await axios.get(`http://ip-api.com/json/${target}`);
                        if (res.data.status === 'fail') {
                            await sock.sendMessage(from, { text: '❌ IP inválido ou não encontrado.' }, { quoted: msg });
                            break;
                        }
                        const info = `
🌐 *INFORMAÇÕES DE IP*
─────────────────────
📌 IP: *${res.data.query}*
🏳️ País: *${res.data.country} (${res.data.countryCode})*
🏙️ Estado/Cidade: *${res.data.regionName} / ${res.data.city}*
🏢 Provedor (ISP): *${res.data.isp}*
🌐 ASN/Org: *${res.data.org}*
─────────────────────`.trim();
                        await sock.sendMessage(from, { text: info }, { quoted: msg });
                    } catch {
                        await sock.sendMessage(from, { text: '❌ Erro ao consultar o IP.' }, { quoted: msg });
                    }
                    break;
                }

                case 'dns': {
                    const domain = args[0]?.replace('https://', '').replace('http://', '').split('/')[0];
                    if (!domain) {
                        await sock.sendMessage(from, { text: '⚠️ Uso: `.dns [dominio]` (Ex: `.dns google.com`)' }, { quoted: msg });
                        break;
                    }
                    try {
                        const resA = await axios.get(`https://dns.google/resolve?name=${domain}&type=A`);
                        const ips = resA.data?.Answer?.map(a => a.data).join(', ') || 'Nenhum registro A';

                        const info = `
🔎 *REGISTROS DNS (GOOGLE DOH)*
─────────────────────
🌐 Domínio: *${domain}*
📌 Registros A (IPs): *${ips}*
─────────────────────`.trim();
                        await sock.sendMessage(from, { text: info }, { quoted: msg });
                    } catch {
                        await sock.sendMessage(from, { text: '❌ Falha ao realizar lookup DNS.' }, { quoted: msg });
                    }
                    break;
                }

                case 'whois': {
                    const domain = args[0]?.replace('https://', '').replace('http://', '').split('/')[0];
                    if (!domain) {
                        await sock.sendMessage(from, { text: '⚠️ Uso: `.whois [dominio]` (Ex: `.whois google.com`)' }, { quoted: msg });
                        break;
                    }
                    await sock.sendMessage(from, { text: '⏳ Consultando registro de domínio (RDAP)...' }, { quoted: msg });
                    try {
                        const res = await axios.get(`https://rdap.org/domain/${domain}`, { timeout: 8000 });
                        const data = res.data;
                        
                        const handle = data.handle || 'N/A';
                        const events = data.events || [];
                        const regEvent = events.find(e => e.eventAction === 'registration')?.eventDate || 'N/A';
                        const expEvent = events.find(e => e.eventAction === 'expiration')?.eventDate || 'N/A';

                        const info = `
🔎 *CONSULTA WHOIS / RDAP*
─────────────────────
🌐 Domínio: *${domain}*
🆔 ID Registro: *${handle}*
📅 Data de Criacao: *${regEvent.split('T')[0]}*
⌛ Data de Expiracao: *${expEvent.split('T')[0]}*
─────────────────────`.trim();
                        await sock.sendMessage(from, { text: info }, { quoted: msg });
                    } catch {
                        await sock.sendMessage(from, { text: '❌ Não foi possível obter dados WHOIS para este domínio.' }, { quoted: msg });
                    }
                    break;
                }

                case 'emailsec': {
                    const domain = args[0]?.replace('https://', '').replace('http://', '').split('/')[0];
                    if (!domain) {
                        await sock.sendMessage(from, { text: '⚠️ Uso: `.emailsec [dominio]` (Ex: `.emailsec github.com`)' }, { quoted: msg });
                        break;
                    }
                    try {
                        const spfRes = await axios.get(`https://dns.google/resolve?name=${domain}&type=TXT`);
                        const txtRecords = spfRes.data?.Answer?.map(a => a.data) || [];
                        const spfRecord = txtRecords.find(r => r.includes('v=spf1')) || '❌ Nenhum registro SPF encontrado';

                        const dmarcRes = await axios.get(`https://dns.google/resolve?name=_dmarc.${domain}&type=TXT`);
                        const dmarcRecords = dmarcRes.data?.Answer?.map(a => a.data) || [];
                        const dmarcRecord = dmarcRecords.find(r => r.includes('v=DMARC1')) || '❌ Nenhum registro DMARC encontrado';

                        const info = `
🛡️ *AUDITORIA DE SEGURANÇA DE E-MAIL*
─────────────────────
🌐 Domínio: *${domain}*

📧 *Registro SPF:*
\`\`\`${spfRecord.replace(/"/g, '')}\`\`\`

🔒 *Registro DMARC:*
\`\`\`${dmarcRecord.replace(/"/g, '')}\`\`\`
─────────────────────`.trim();
                        await sock.sendMessage(from, { text: info }, { quoted: msg });
                    } catch {
                        await sock.sendMessage(from, { text: '❌ Erro ao auditar registros do domínio.' }, { quoted: msg });
                    }
                    break;
                }

                case 'cnpj': {
                    const cnpjTarget = args[0] ? args[0].replace(/[^0-9]/g, '') : '';
                    if (!cnpjTarget || cnpjTarget.length !== 14) {
                        await sock.sendMessage(from, { text: '⚠️ Digite um CNPJ com 14 números. Ex: `.cnpj 00000000000000`' }, { quoted: msg });
                        break;
                    }
                    try {
                        const res = await axios.get(`https://receitaws.com.br/v1/cnpj/${cnpjTarget}`);
                        if (res.data.status === 'ERROR') {
                            await sock.sendMessage(from, { text: '❌ CNPJ não localizado.' }, { quoted: msg });
                            break;
                        }
                        const info = `
🏢 *DADOS DE EMPRESA (CNPJ)*
─────────────────────
📋 Razão Social: *${res.data.nome}*
🏷️ Nome Fantasia: *${res.data.fantasia || 'N/A'}*
📅 Abertura: *${res.data.abertura}*
⚡ Situação: *${res.data.situacao}*
📍 Cidade/UF: *${res.data.municipio}/${res.data.uf}*
💼 Atividade: *${res.data.atividade_principal[0]?.text || 'N/A'}*
─────────────────────`.trim();
                        await sock.sendMessage(from, { text: info }, { quoted: msg });
                    } catch {
                        await sock.sendMessage(from, { text: '❌ Erro na consulta do CNPJ.' }, { quoted: msg });
                    }
                    break;
                }

                case 'cep': {
                    const cepTarget = args[0] ? args[0].replace(/[^0-9]/g, '') : '';
                    if (!cepTarget || cepTarget.length !== 8) {
                        await sock.sendMessage(from, { text: '⚠️ Digite um CEP com 8 números. Ex: `.cep 01001000`' }, { quoted: msg });
                        break;
                    }
                    try {
                        const res = await axios.get(`https://viacep.com.br/ws/${cepTarget}/json/`);
                        if (res.data.erro) {
                            await sock.sendMessage(from, { text: '❌ CEP inexistente.' }, { quoted: msg });
                            break;
                        }
                        const info = `
📍 *LOCALIZAÇÃO DE CEP*
─────────────────────
📮 CEP: *${res.data.cep}*
🛣️ Endereço: *${res.data.logradouro}*
🏙️ Bairro: *${res.data.bairro}*
🌆 Cidade/UF: *${res.data.localidade}/${res.data.uf}*
─────────────────────`.trim();
                        await sock.sendMessage(from, { text: info }, { quoted: msg });
                    } catch {
                        await sock.sendMessage(from, { text: '❌ Falha ao buscar CEP.' }, { quoted: msg });
                    }
                    break;
                }

                case 'subdominios': {
                    const domain = args[0]?.replace('https://', '').replace('http://', '').split('/')[0];
                    if (!domain) {
                        await sock.sendMessage(from, { text: '⚠️ Uso: `.subdominios [dominio]` (Ex: `.subdominios github.com`)' }, { quoted: msg });
                        break;
                    }
                    await sock.sendMessage(from, { text: '⏳ Mapeando certificados SSL...' }, { quoted: msg });
                    try {
                        const res = await axios.get(`https://crt.sh/?q=%.${domain}&output=json`);
                        const rawSubs = res.data.map(item => item.name_value).join('\n').split('\n');
                        const uniqueSubs = [...new Set(rawSubs)].filter(s => !s.includes('*')).slice(0, 15);

                        if (uniqueSubs.length === 0) {
                            await sock.sendMessage(from, { text: '❌ Nenhum subdomínio encontrado.' }, { quoted: msg });
                            break;
                        }

                        const info = `
🌐 *SUBDOMÍNIOS ENCONTRADOS (CRT.SH)*
─────────────────────
${uniqueSubs.map(s => `• ${s}`).join('\n')}
─────────────────────
_Mostrando os 15 primeiros resultados._`.trim();
                        await sock.sendMessage(from, { text: info }, { quoted: msg });
                    } catch {
                        await sock.sendMessage(from, { text: '❌ Erro ao listar subdomínios.' }, { quoted: msg });
                    }
                    break;
                }

                case 'rdns': {
                    const ip = args[0];
                    if (!ip) {
                        await sock.sendMessage(from, { text: '⚠️ Uso: `.rdns [IP]` (Ex: `.rdns 8.8.8.8`)' }, { quoted: msg });
                        break;
                    }
                    try {
                        const reversedIp = ip.split('.').reverse().join('.') + '.in-addr.arpa';
                        const res = await axios.get(`https://dns.google/resolve?name=${reversedIp}&type=PTR`);
                        const hostname = res.data?.Answer?.[0]?.data || 'Nenhum PTR (Reverse DNS) encontrado.';

                        const info = `
🔄 *REVERSE DNS (PTR)*
─────────────────────
📌 IP: *${ip}*
🖥️ Hostname: *${hostname}*
─────────────────────`.trim();
                        await sock.sendMessage(from, { text: info }, { quoted: msg });
                    } catch {
                        await sock.sendMessage(from, { text: '❌ Erro ao realizar consulta Reverse DNS.' }, { quoted: msg });
                    }
                    break;
                }

                case 'mac': {
                    const macTarget = args[0];
                    if (!macTarget) {
                        await sock.sendMessage(from, { text: '⚠️ Uso: `.mac [endereço-mac]` (Ex: `.mac 00:1A:2B:3C:4D:5E`)' }, { quoted: msg });
                        break;
                    }
                    try {
                        const res = await axios.get(`https://api.macvendors.com/${encodeURIComponent(macTarget)}`);
                        const info = `
📶 *CONSULTA FABRICANTE DE MAC*
─────────────────────
🏷️ MAC: *${macTarget}*
🏢 Fabricante: *${res.data}*
─────────────────────`.trim();
                        await sock.sendMessage(from, { text: info }, { quoted: msg });
                    } catch {
                        await sock.sendMessage(from, { text: '❌ Endereço MAC não encontrado ou fabricante desconhecido.' }, { quoted: msg });
                    }
                    break;
                }

                case 'httpcheck': {
                    let targetUrl = args[0];
                    if (!targetUrl) {
                        await sock.sendMessage(from, { text: '⚠️ Uso: `.httpcheck [site]` (Ex: `.httpcheck google.com`)' }, { quoted: msg });
                        break;
                    }
                    if (!targetUrl.startsWith('http')) targetUrl = 'https://' + targetUrl;

                    const start = Date.now();
                    try {
                        const res = await axios.get(targetUrl, { timeout: 6000, maxRedirects: 5 });
                        const duration = Date.now() - start;

                        const info = `
🌐 *ANÁLISE DE STATUS HTTP*
─────────────────────
🔗 URL: *${targetUrl}*
🚦 Status: *${res.status} ${res.statusText}*
⚡ Latência: *${duration} ms*
🖥️ Servidor: *${res.headers['server'] || 'Oculto / Não informado'}*
📦 Tipo de Conteúdo: *${res.headers['content-type'] || 'N/A'}*
─────────────────────`.trim();
                        await sock.sendMessage(from, { text: info }, { quoted: msg });
                    } catch (err) {
                        const duration = Date.now() - start;
                        await sock.sendMessage(from, { 
                            text: `❌ *Falha de Conexão*\n─────────────────────\n🔗 URL: *${targetUrl}*\n⚠️ Erro: *${err.message}*\n⏱️ Tempo decorrido: *${duration} ms*` 
                        }, { quoted: msg });
                    }
                    break;
                }

                // ==================== CASSINO ====================
                case 'foguete':
                case 'crash': {
                    const targetStr = args[0] ? args[0].replace('x', '').replace(',', '.') : null;
                    const aposta = parseInt(args[1]);
                    const alvo = parseFloat(targetStr);

                    if (!alvo || isNaN(alvo) || alvo < 1.1 || !aposta || isNaN(aposta) || aposta <= 0) {
                        await sock.sendMessage(from, { text: '⚠️ Uso: `.foguete 2x 50`' }, { quoted: msg });
                        break;
                    }
                    if (user.carteira < aposta) {
                        await sock.sendMessage(from, { text: `⚠️ Saldo insuficiente! Carteira: *${user.carteira}*.` }, { quoted: msg });
                        break;
                    }

                    const rand = Math.random();
                    let crashPoint = rand < 0.05 ? 1.0 : rand < 0.60 ? parseFloat((Math.random() * 0.9 + 1.1).toFixed(2)) : parseFloat((Math.random() * 5.0 + 2.0).toFixed(2));

                    if (crashPoint >= alvo) {
                        const total = Math.floor(aposta * alvo);
                        const lucro = total - aposta;
                        user.carteira += lucro;
                        saveDB(db);
                        await sock.sendMessage(from, { text: `🚀 *FOGUETE SUBIU ATÉ ${crashPoint}x!*\n\n✅ *GANHOU!*\n💵 Retorno: *${total} PydaCoins*\n📈 Lucro: *+${lucro}*\n👛 Saldo: *${user.carteira}*` }, { quoted: msg });
                    } else {
                        user.carteira -= aposta;
                        saveDB(db);
                        await sock.sendMessage(from, { text: `💥 *EXPLODIU EM ${crashPoint}x!*\n\n❌ *PERDEU!*\n📉 Prejuízo: *-${aposta} PydaCoins*\n👛 Saldo: *${user.carteira}*` }, { quoted: msg });
                    }
                    break;
                }

                case 'tigrinho':
                case 'slots': {
                    const aposta = parseInt(args[0]);
                    if (!aposta || isNaN(aposta) || aposta <= 0) {
                        await sock.sendMessage(from, { text: '⚠️ Uso: `.tigrinho [aposta]`' }, { quoted: msg });
                        break;
                    }
                    if (user.carteira < aposta) {
                        await sock.sendMessage(from, { text: `⚠️ Saldo insuficiente!` }, { quoted: msg });
                        break;
                    }

                    const slots = ['🐯', '💎', '7️⃣', '🔔', '🍇', '🍋'];
                    const s1 = slots[Math.floor(Math.random() * slots.length)];
                    const s2 = slots[Math.floor(Math.random() * slots.length)];
                    const s3 = slots[Math.floor(Math.random() * slots.length)];

                    let mult = 0;
                    if (s1 === '🐯' && s2 === '🐯' && s3 === '🐯') mult = 10;
                    else if (s1 === s2 && s2 === s3) mult = 5;
                    else if (s1 === s2 || s2 === s3 || s1 === s3) mult = 1.5;

                    if (mult > 0) {
                        const total = Math.floor(aposta * mult);
                        const lucro = total - aposta;
                        user.carteira += lucro;
                        saveDB(db);
                        await sock.sendMessage(from, { text: `🎰 [ ${s1} | ${s2} | ${s3} ]\n\n🎉 *SOLTOU A CARTA! (${mult}x)*\n📈 Lucro: *+${lucro} PydaCoins*\n👛 Saldo: *${user.carteira}*` }, { quoted: msg });
                    } else {
                        user.carteira -= aposta;
                        saveDB(db);
                        await sock.sendMessage(from, { text: `🎰 [ ${s1} | ${s2} | ${s3} ]\n\n❌ *PERDEU!*\n📉 Prejuízo: *-${aposta} PydaCoins*\n👛 Saldo: *${user.carteira}*` }, { quoted: msg });
                    }
                    break;
                }

                case 'roleta': {
                    const escolha = args[0]?.toLowerCase();
                    const aposta = parseInt(args[1]);

                    if (!escolha || !aposta || isNaN(aposta) || aposta <= 0) {
                        await sock.sendMessage(from, { text: '⚠️ Uso: `.roleta [vermelho/preto/0-36] [aposta]`' }, { quoted: msg });
                        break;
                    }
                    if (user.carteira < aposta) {
                        await sock.sendMessage(from, { text: '⚠️ Saldo insuficiente!' }, { quoted: msg });
                        break;
                    }

                    const numSorteado = Math.floor(Math.random() * 37);
                    const corSorteada = numSorteado === 0 ? 'verde' : (numSorteado % 2 === 0 ? 'preto' : 'vermelho');

                    let ganhou = false;
                    let mult = 0;

                    if (escolha === corSorteada) {
                        ganhou = true;
                        mult = 2;
                    } else if (parseInt(escolha) === numSorteado) {
                        ganhou = true;
                        mult = 14;
                    }

                    if (ganhou) {
                        const total = aposta * mult;
                        const lucro = total - aposta;
                        user.carteira += lucro;
                        saveDB(db);
                        await sock.sendMessage(from, { text: `🎯 Roleta: *${numSorteado} (${corSorteada.toUpperCase()})*\n\n✅ *GANHOU!*\n📈 Lucro: *+${lucro}*\n👛 Saldo: *${user.carteira}*` }, { quoted: msg });
                    } else {
                        user.carteira -= aposta;
                        saveDB(db);
                        await sock.sendMessage(from, { text: `🎯 Roleta: *${numSorteado} (${corSorteada.toUpperCase()})*\n\n❌ *PERDEU!*\n📉 Prejuízo: *-${aposta}*\n👛 Saldo: *${user.carteira}*` }, { quoted: msg });
                    }
                    break;
                }

                case 'blackjack':
                case '21': {
                    const aposta = parseInt(args[0]);
                    if (!aposta || isNaN(aposta) || aposta <= 0) {
                        await sock.sendMessage(from, { text: '⚠️ Uso: `.21 [aposta]`' }, { quoted: msg });
                        break;
                    }
                    if (user.carteira < aposta) {
                        await sock.sendMessage(from, { text: '⚠️ Saldo insuficiente!' }, { quoted: msg });
                        break;
                    }

                    const voce = Math.floor(Math.random() * 6) + 15;
                    const bot = Math.floor(Math.random() * 7) + 15;

                    if (voce > bot) {
                        user.carteira += aposta;
                        saveDB(db);
                        await sock.sendMessage(from, { text: `🃏 *21 RÁPIDO*\n\n👤 Suas cartas: *${voce}*\n🤖 Pyda: *${bot}*\n\n✅ *VENCEU!*\n📈 Lucro: *+${aposta}*\n👛 Saldo: *${user.carteira}*` }, { quoted: msg });
                    } else if (voce < bot) {
                        user.carteira -= aposta;
                        saveDB(db);
                        await sock.sendMessage(from, { text: `🃏 *21 RÁPIDO*\n\n👤 Suas cartas: *${voce}*\n🤖 Pyda: *${bot}*\n\n❌ *PERDEU!*\n📉 Prejuízo: *-${aposta}*\n👛 Saldo: *${user.carteira}*` }, { quoted: msg });
                    } else {
                        await sock.sendMessage(from, { text: `🃏 EMPATE! (*${voce}* x *${bot}*) Aposta devolvida.` }, { quoted: msg });
                    }
                    break;
                }

                case 'caraoucoroa': {
                    const escolha = args[0]?.toLowerCase();
                    const aposta = parseInt(args[1]);

                    if ((escolha !== 'cara' && escolha !== 'coroa') || !aposta || isNaN(aposta) || aposta <= 0) {
                        await sock.sendMessage(from, { text: '⚠️ Uso: `.caraoucoroa [cara/coroa] [aposta]`' }, { quoted: msg });
                        break;
                    }
                    if (user.carteira < aposta) {
                        await sock.sendMessage(from, { text: '⚠️ Saldo insuficiente!' }, { quoted: msg });
                        break;
                    }

                    const resultado = Math.random() < 0.5 ? 'cara' : 'coroa';
                    if (escolha === resultado) {
                        user.carteira += aposta;
                        saveDB(db);
                        await sock.sendMessage(from, { text: `🪙 Resultado: *${resultado.toUpperCase()}*\n\n✅ *ACERTOU!*\n📈 Lucro: *+${aposta}*\n👛 Saldo: *${user.carteira}*` }, { quoted: msg });
                    } else {
                        user.carteira -= aposta;
                        saveDB(db);
                        await sock.sendMessage(from, { text: `🪙 Resultado: *${resultado.toUpperCase()}*\n\n❌ *ERROU!*\n📉 Prejuízo: *-${aposta}*\n👛 Saldo: *${user.carteira}*` }, { quoted: msg });
                    }
                    break;
                }

                // ==================== OUTROS COMANDOS ====================
                case 'trabalhar': {
                    const agora = Date.now();
                    if (agora < user.trabalhoCooldown) {
                        const min = Math.ceil((user.trabalhoCooldown - agora) / 60000);
                        await sock.sendMessage(from, { text: `⏳ Aguarde *${min} min* para trabalhar.` }, { quoted: msg });
                        break;
                    }
                    const ganho = Math.floor(Math.random() * 250) + 50;
                    user.carteira += ganho;
                    user.trabalhoCooldown = agora + (15 * 60 * 1000);
                    saveDB(db);
                    await sock.sendMessage(from, { text: `🔨 Trabalhou e ganhou *${ganho} PydaCoins*!` }, { quoted: msg });
                    break;
                }

                case 'saldo':
                    await sock.sendMessage(from, { text: `💳 Carteira: *${user.carteira}*\n🏦 Banco: *${user.banco}*\n❤️ HP: *${user.hp}/100*` }, { quoted: msg });
                    break;

                case 'ping':
                    await sock.sendMessage(from, { text: '🏓 Pong! Pyda Online!' }, { quoted: msg });
                    break;

                case 'dono':
                    await sock.sendMessage(from, { text: '👑 Criador: *Odin*' }, { quoted: msg });
                    break;

                case 'dado':
                    await sock.sendMessage(from, { text: `🎲 Número: *${Math.floor(Math.random() * 6) + 1}*` }, { quoted: msg });
                    break;

                case 'revelar':
                case 'r': {
                    const quotedMsg = msg.message.extendedTextMessage?.contextInfo?.quotedMessage;
                    if (!quotedMsg) break;
                    const viewOnceMsg = quotedMsg.viewOnceMessageV2?.message || quotedMsg.viewOnceMessage?.message || quotedMsg;
                    const mediaType = viewOnceMsg.imageMessage ? 'image' : viewOnceMsg.videoMessage ? 'video' : null;
                    if (!mediaType) break;

                    const mediaMessage = mediaType === 'image' ? viewOnceMsg.imageMessage : viewOnceMsg.videoMessage;
                    const stream = await downloadContentFromMessage(mediaMessage, mediaType);
                    let buffer = Buffer.alloc(0);
                    for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);

                    await sock.sendMessage(from, { [mediaType]: buffer, caption: '🔓 *Revelado!*' }, { quoted: msg });
                    break;
                }

                default:
                    commandFound = false;
                    break;
            }

            // AVISO DE COMANDO INEXISTENTE
            if (!commandFound) {
                await sock.sendMessage(from, { 
                    text: `❓ *Comando não encontrado!*\n\nO comando \`.${command}\` não existe.\nDigite *.menu* para ver os comandos disponíveis.` 
                }, { quoted: msg });
            }
        }
    });
}

connectToWhatsApp();
