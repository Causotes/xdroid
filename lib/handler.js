import config from '../config.js'
import { getDb } from './database.js'
import { getPlugin, getPlugins, loadPlugins } from './plugins.js'
import {
  getIncomingText,
  getSenderJid,
  isBotAdmin,
  isGroupJid,
  isOwnerJid,
  isUserAdmin,
  markMessageRead,
  parseCommand,
  react,
  reply,
  truncate
} from './helpers.js'

async function deny(sock, m, text) {
  await reply(sock, m, text)
}

async function markCommandUsage(sock, m, command) {
  try {
    const db = getDb()
    const from = m?.key?.remoteJid
    const sender = getSenderJid(m)
    const pushName = String(m?.pushName || '').trim()

    const jobs = [
      markMessageRead(sock, m),
      db.markCommandSeen({ chatJid: from, senderJid: sender, command })
    ]

    if (pushName && sender) jobs.push(db.upsertUser({ jid: sender, name: pushName }))
    await Promise.allSettled(jobs)
  } catch {}
}

function getPermissionError(plugin) {
  if (plugin.groupOnly) return '🪴 *_Este comando solo funciona en grupos_*'
  if (plugin.botAdminOnly) return '🌴 Lo siento, este *comando* solo puede ser *utilizado* si el bot es administrador.'
  if (plugin.userAdminOnly) return '🌴 Lo siento, este *comando* solo puede ser *utilizado* por los *administradores* del grupo.'
  if (plugin.ownerOnly) return '🐢 Lo siento, este *comando* solo puede ser *utilizado* por los *creadores.*'
  return '🌾 *_No puedes usar este comando._*'
}

export async function handleMessage(sock, m) {
  if (!m?.message) return

  const text = getIncomingText(m)
  const parsed = parseCommand(text, config.prefix)
  if (!parsed) return

  if (!getPlugins().length) await loadPlugins()

  const plugin = getPlugin(parsed.command)
  if (!plugin) return
  if (typeof plugin.run !== 'function') return await deny(sock, m, '🌾 *_Plugin inválido_* (no tiene run)')

  const from = m?.key?.remoteJid || ''
  const senderJid = getSenderJid(m)
  const isGroup = isGroupJid(from)
  const isOwner = isOwnerJid(senderJid)

  if (plugin.ownerOnly && !isOwner) return await deny(sock, m, getPermissionError(plugin))
  if (plugin.groupOnly && !isGroup) return await deny(sock, m, getPermissionError(plugin))
  if (plugin.userAdminOnly) {
    if (!isGroup) return await deny(sock, m, '🪴 *_Este comando solo funciona en grupos_*')
    const allowed = await isUserAdmin(sock, m)
    if (!allowed) return await deny(sock, m, getPermissionError(plugin))
  }
  if (plugin.botAdminOnly) {
    if (!isGroup) return await deny(sock, m, '🪴 *_Este comando solo funciona en grupos_*')
    const allowed = await isBotAdmin(sock, m)
    if (!allowed) return await deny(sock, m, getPermissionError(plugin))
  }

  const ctx = {
    sock,
    m,
    config,
    command: plugin.command,
    invokedAs: parsed.command,
    args: parsed.args,
    input: parsed.input,
    text,
    from,
    senderJid,
    senderNumber: senderJid.replace(/[^\d]/g, ''),
    isGroup,
    isOwner,
    reply: async (value, extra = {}) => await reply(sock, m, value, extra),
    react: async emoji => await react(sock, m, emoji),
    truncate,
    plugins: getPlugins()
  }

  try {
    markCommandUsage(sock, m, parsed.command)
    await plugin.run(ctx)
  } catch (error) {
    const details = truncate(String(error?.stack || error?.message || error), 3500)
    console.error(`[handler] Error ejecutando ${plugin.command}:`, error)
    await deny(sock, m, `🌾 *_Error ejecutando_* ${plugin.command}\n${details}`)
  }
}
