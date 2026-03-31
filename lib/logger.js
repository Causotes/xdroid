import chalk from 'chalk'
import gradient from 'gradient-string'
import { getDb } from './database.js'
import { cleanName, getIncomingText, normalizeJid } from './helpers.js'

const groupCache = new Map()
const line = chalk.hex('#2d3748')('─'.repeat(62))

function timestamp() {
  const formatter = new Intl.DateTimeFormat('es-ES', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  })

  return formatter.format(new Date()).replace(',', '')
}

async function getGroupName(sock, jid) {
  if (groupCache.has(jid)) return groupCache.get(jid)

  try {
    const meta = await sock.groupMetadata(jid)
    const name = meta?.subject || 'Desconocido'
    groupCache.set(jid, name)
    return name
  } catch {
    const name = 'Desconocido'
    groupCache.set(jid, name)
    return name
  }
}

async function resolveUserName(senderJid, pushName = '') {
  const liveName = cleanName(pushName)
  const db = getDb()

  if (liveName) {
    Promise.resolve(db.upsertUser({ jid: senderJid, name: liveName })).catch(() => {})
    return liveName
  }

  try {
    const saved = await db.getUserName(senderJid)
    if (saved) return cleanName(saved)
  } catch {}

  return 'Desconocido'
}

export async function logIncomingMessage(sock, m, { prefix = '.' } = {}) {
  const from = normalizeJid(m?.key?.remoteJid || '?')
  const isGroup = from.endsWith('@g.us')
  const senderJid = isGroup ? normalizeJid(m?.key?.participant || from) : from
  const senderNumber = senderJid.replace(/[^\d]/g, '') || senderJid
  const pushName = await resolveUserName(senderJid, m?.pushName)
  const text = getIncomingText(m)
  const isCommand = text.startsWith(prefix)

  let chatName = 'Privado'
  let chatIdLine = chalk.hex('#7dd3fc')(`↳ ${from}`)

  if (isGroup) {
    const groupName = await getGroupName(sock, from)
    chatName = groupName
    chatIdLine = gradient('#7dd3fc', '#c4b5fd')(`↳ ${from}`)
  }

  const body = (text || '[sin texto]').replace(/\n+/g, ' ⏎ ')
  const badge = isCommand
    ? chalk.bgHex('#7c2d12').hex('#fed7aa')(' CMD ')
    : chalk.bgHex('#1e3a8a').hex('#bfdbfe')(' MSG ')
  const title = gradient('#5eead4', '#60a5fa')('XDroid Console')

  console.log(
    '\n' +
      line +
      '\n' +
      `${chalk.hex('#94a3b8')('●')} ${title} ${badge}` +
      '\n' +
      `${chalk.hex('#94a3b8')('⏱')} ${chalk.hex('#e2e8f0')(timestamp())}` +
      '\n' +
      `${chalk.hex('#94a3b8')('👤')} ${chalk.bold.hex('#f8fafc')(pushName)} ${chalk.hex('#64748b')(`(${senderNumber})`)}` +
      '\n' +
      `${chalk.hex('#94a3b8')('😱')} ${chalk.hex('#a7f3d0')(chatName)}` +
      '\n' +
      `${chatIdLine}` +
      '\n' +
      `${chalk.hex('#94a3b8')('»')} ${isCommand ? chalk.hex('#fde68a')(body) : chalk.hex('#e2e8f0')(body)}` +
      '\n' +
      line
  )

  return { text, isCommand, from, senderJid, isGroup, pushName }
}
