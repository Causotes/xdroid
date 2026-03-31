import makeWASocket, {
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  useMultiFileAuthState
} from 'bail'
import chalk from 'chalk'
import fs from 'fs-extra'
import pino from 'pino'
import readlineSync from 'readline-sync'
import config from './config.js'
import { setupDb } from './lib/database.js'
import { handleGroupMessageEvents, handleGroupParticipantsUpdate, handleGroupsUpdate } from './lib/group-events.js'
import { handleMessage } from './lib/handler.js'
import { logIncomingMessage } from './lib/logger.js'
import { reloadPlugins } from './lib/plugins.js'
import { wait } from './lib/helpers.js'

const credsPath = `${config.sessionDir}/creds.json`
fs.ensureDirSync(config.sessionDir)

let usePairingCode = false
let pairingNumber = ''
let generatingPairingCode = false
let reconnectAttempts = 0

function log(message, type = 'info') {
  const palette = {
    info: chalk.cyan,
    ok: chalk.green,
    warn: chalk.yellow,
    error: chalk.red
  }

  const icons = {
    info: '•',
    ok: '✓',
    warn: '!',
    error: 'x'
  }

  const color = palette[type] || palette.info
  console.log(color(`${icons[type] || '•'} ${message}`))
}

async function bootstrap() {
  console.clear()
  console.log(chalk.bold.cyan(`\n${config.bot.name}\n`))

  if (!fs.existsSync(credsPath)) {
    console.log(chalk.gray('[1] Código QR'))
    console.log(chalk.gray('[2] Código de 8 dígitos\n'))

    usePairingCode = readlineSync.question('Selecciona una opción (1/2): ').trim() === '2'

    if (usePairingCode) {
      const suggestedNumber = config.pairing.phoneNumber || ''
      const input = readlineSync.question(`Número (ej: 5218144380378${suggestedNumber ? ` | Enter = ${suggestedNumber}` : ''}): `)
      pairingNumber = (input || suggestedNumber).replace(/[^\d]/g, '')
    }
  }

  await setupDb()
  await reloadPlugins()
  await startBot()
}

async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState(config.sessionDir)
  const { version } = await fetchLatestBaileysVersion()
  const logger = pino({ level: 'silent' })

  const sock = makeWASocket({
    version,
    logger,
    printQRInTerminal: !usePairingCode && !fs.existsSync(credsPath),
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, logger)
    },
    browser: config.browser
  })

  sock.ev.on('creds.update', saveCreds)

  sock.ev.on('connection.update', async ({ connection, lastDisconnect }) => {
    const code =
      lastDisconnect?.error?.output?.statusCode ??
      lastDisconnect?.error?.output?.payload?.statusCode ??
      lastDisconnect?.error?.statusCode

    if (connection === 'open') {
      reconnectAttempts = 0
      generatingPairingCode = false
      const account = sock.user?.id?.split(':')[0] || '?'
      log(`Conectado como ${sock.user?.name || config.bot.name} (${account})`, 'ok')
      return
    }

    if (connection === 'close') {
      const loggedOut = code === DisconnectReason.loggedOut

      if (loggedOut) {
        return log(`Sesión cerrada. Elimina '${config.sessionDir}' y vuelve a iniciar.`, 'error')
      }

      if (reconnectAttempts >= config.limits.reconnectAttempts) {
        return log(`Reconexión cancelada. Se alcanzó el límite de ${config.limits.reconnectAttempts} intentos.`, 'error')
      }

      reconnectAttempts += 1
      generatingPairingCode = false
      log(`Conexión cerrada (código ${code || '?'}). Reintentando ${reconnectAttempts}/${config.limits.reconnectAttempts}...`, 'warn')

      const delay = Math.min(30000, 1000 * (2 ** Math.min(6, reconnectAttempts))) + Math.floor(Math.random() * 750)
      await wait(delay)
      await startBot()
      return
    }

    if (usePairingCode && !state.creds.registered && !fs.existsSync(credsPath) && !generatingPairingCode) {
      generatingPairingCode = true

      setTimeout(async () => {
        try {
          if (!pairingNumber) throw new Error('Número inválido')

          const pairingCode = await sock.requestPairingCode(pairingNumber)
          console.log(chalk.bold.green(`\nCódigo de vinculación: ${pairingCode}\n`))
          console.log(chalk.gray('WhatsApp > Dispositivos vinculados > Vincular con número de teléfono\n'))
        } catch (error) {
          log(String(error?.message || error), 'error')
          generatingPairingCode = false
        }
      }, 2500)
    }
  })

  sock.ev.on('messages.upsert', async ({ messages }) => {
    const message = messages?.[0]
    if (!message || message.key?.remoteJid === 'status@broadcast') return

    await logIncomingMessage(sock, message, { prefix: config.prefix })

    const blocked = await handleGroupMessageEvents(sock, message)
    if (blocked) return

    await handleMessage(sock, message)
  })

  sock.ev.on('group-participants.update', async update => {
    try {
      await handleGroupParticipantsUpdate(sock, update)
    } catch {}
  })

  sock.ev.on('groups.update', async updates => {
    try {
      await handleGroupsUpdate(sock, updates)
    } catch {}
  })

  return sock
}

bootstrap().catch(error => {
  console.error(error)
  process.exit(1)
})
