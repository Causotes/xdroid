import config from '../config.js'
import { getDb } from './database.js'
import {
  bool,
  buildCandidateJids,
  findParticipant,
  getGroupMeta,
  getIncomingText,
  isAdminFlag,
  isGroupJid,
  jidToNumber,
  mentionJid,
  mentionTag,
  normalizeJid,
  safeSend,
  unwrapMessage
} from './helpers.js'

const EVENT_DEFS = Object.freeze({
  antilink: { label: 'Antilink' },
  welcome: { label: 'Welcome' },
  avisos: { label: 'Avisos' }
})

const DEFAULT_STATE = Object.freeze({
  antilink: false,
  welcome: false,
  avisos: false
})

const WA_GROUP_REGEX = /https?:\/\/(?:chat\.)?whatsapp\.com\/(?:invite\/)?([0-9A-Za-z]{20,30})/i
const WA_CHANNEL_REGEX = /https?:\/\/whatsapp\.com\/channel\/([0-9A-Za-z]+)/i

function sanitizeState(state = {}) {
  return {
    antilink: bool(state.antilink),
    welcome: bool(state.welcome),
    avisos: bool(state.avisos)
  }
}

function resolveParticipantEntry(raw) {
  if (typeof raw === 'string') {
    const jid = normalizeJid(raw)
    const number = jidToNumber(jid)
    return { jid, phone: number ? `${number}@s.whatsapp.net` : jid }
  }

  if (typeof raw === 'object' && raw !== null) {
    const jid = normalizeJid(raw?.id || raw?.jid || '')
    const phoneRaw = normalizeJid(raw?.phoneNumber || raw?.pn || '')
    const number = jidToNumber(phoneRaw || jid)
    return {
      jid,
      phone: phoneRaw.endsWith('@s.whatsapp.net') ? phoneRaw : number ? `${number}@s.whatsapp.net` : jid
    }
  }

  return { jid: '', phone: '' }
}

function warningKey(groupJid, senderJid) {
  return `warn:${groupJid}|${senderJid}`
}

function groupCard(groupName, memberCount) {
  return {
    externalAdReply: {
      title: groupName,
      body: `${memberCount} miembros`,
      mediaType: 1,
      thumbnailUrl: config.media.eventsBanner,
      renderLargerThumbnail: false
    }
  }
}

function detectWaLink(text = '') {
  const groupMatch = text.match(WA_GROUP_REGEX)
  if (groupMatch) return { type: 'grupo', code: groupMatch[1] }

  const channelMatch = text.match(WA_CHANNEL_REGEX)
  if (channelMatch) return { type: 'canal', code: channelMatch[1] }

  return null
}

async function getProfilePicture(sock, participantJid) {
  const number = jidToNumber(participantJid)
  const jid = number ? `${number}@s.whatsapp.net` : normalizeJid(participantJid)
  return await sock.profilePictureUrl(jid, 'image')
}

async function getSameGroupCode(sock, groupJid) {
  try {
    return (await sock.groupInviteCode(groupJid)) || null
  } catch {
    return null
  }
}

export function listEvents() {
  return Object.keys(EVENT_DEFS)
}

export function normalizeEventName(name = '') {
  const value = String(name || '').toLowerCase().trim()
  if (!value) return null
  if (['antilink', 'anti-link', 'anti_link', 'link', 'links'].includes(value)) return 'antilink'
  if (['welcome', 'bienvenida', 'bienvenidas', 'welcomes'].includes(value)) return 'welcome'
  if (['avisos', 'aviso', 'alerta', 'alertas', 'notices'].includes(value)) return 'avisos'
  return null
}

export function eventLabel(name = '') {
  const key = normalizeEventName(name)
  return key ? EVENT_DEFS[key].label : null
}

export async function getGroupEvents(jid) {
  const groupJid = normalizeJid(jid)
  if (!isGroupJid(groupJid)) return { ...DEFAULT_STATE }

  const db = getDb()
  const savedState = await db.getGroupEvents(groupJid)
  return { ...DEFAULT_STATE, ...sanitizeState(savedState || {}) }
}

export async function setGroupEvent(jid, event, enabled) {
  const groupJid = normalizeJid(jid)
  const key = normalizeEventName(event)
  if (!isGroupJid(groupJid)) throw new Error('Grupo inválido')
  if (!key) throw new Error('Evento inválido')

  const db = getDb()
  const current = { ...DEFAULT_STATE, ...sanitizeState(await db.getGroupEvents(groupJid) || {}) }
  current[key] = !!enabled
  return await db.saveGroupEvents(groupJid, current)
}

export async function setAllGroupEvents(jid, enabled) {
  const groupJid = normalizeJid(jid)
  if (!isGroupJid(groupJid)) throw new Error('Grupo inválido')
  const value = !!enabled
  const db = getDb()
  return await db.saveGroupEvents(groupJid, { antilink: value, welcome: value, avisos: value })
}

async function sendAvisoParticipantsEvent({ sock, groupJid, action, participants, meta, quoted }) {
  if (!['add', 'remove', 'promote', 'demote'].includes(action)) return false

  const groupName = meta?.subject || 'el grupo'
  const memberCount = meta?.participants?.length ?? '?'
  const tags = participants.map(item => mentionTag(item.jid || item.phone)).join(', ')
  const mentions = participants.map(item => mentionJid(item.jid || item.phone))
  const contextInfo = groupCard(groupName, memberCount)

  const messages = {
    add: `🌴 ${tags} se *unió* a *${groupName}.* 🐢`,
    remove: `🌾 ${tags} *salió* de *${groupName}.*`,
    promote: `🐢 ${tags} fue *ascendido* a administrador en *${groupName}.*`,
    demote: `🦞 ${tags} fue *removido* de administrador en *${groupName}.*`
  }

  await safeSend(sock, groupJid, { text: messages[action], mentions, contextInfo }, quoted)
  return true
}

async function sendWelcomeEvent({ sock, groupJid, action, participants, meta }) {
  if (!['add', 'remove'].includes(action)) return false

  const groupName = meta?.subject || 'el grupo'
  const memberCount = meta?.participants?.length ?? '?'
  const members = meta?.participants || []

  for (const participant of participants) {
    const participantJid = normalizeJid(participant?.jid || participant || '')
    const rawNumber = jidToNumber(participant?.phone || '')

    const found = members.find(item => {
      const id = normalizeJid(item?.id || '')
      const phone = normalizeJid(item?.phoneNumber || '')
      return id === participantJid || phone === participantJid
    })

    const phoneJid = normalizeJid(
      found?.phoneNumber ||
      found?.id ||
      (rawNumber ? `${rawNumber}@s.whatsapp.net` : '') ||
      participant?.phone ||
      participant?.jid ||
      participant ||
      ''
    )

    const userId = phoneJid.includes('@s.whatsapp.net')
      ? phoneJid.split('@')[0]
      : rawNumber || jidToNumber(phoneJid)

    const mention = userId ? `${userId}@s.whatsapp.net` : `${participantJid.split('@')[0]}@s.whatsapp.net`
    const tag = userId ? `@${userId}` : `@${participantJid.split('@')[0]}`

    let picture = config.media.defaultProfile
    try {
      const fetched = await getProfilePicture(sock, mention)
      if (fetched) picture = fetched
    } catch {}

    const text = action === 'add'
      ? [
          '🌴 *Welcome*',
          `◦ *Usuario:* ${tag}`,
          `◦ *Grupo:* ${groupName}`,
          `◦ *Miembros:* ${memberCount}`,
          '',
          '📍 Bienvenido/a, respeta las reglas y disfruta tu estadía. 🐢'
        ].join('\n')
      : [
          '🌾 *Despedida*',
          `◦ *Usuario:* ${tag}`,
          `◦ *Grupo:* ${groupName}`,
          '',
          '📍 Gracias por haber estado aquí, te deseamos lo mejor. 🐢'
        ].join('\n')

    await safeSend(sock, groupJid, {
      text,
      mentions: [mention],
      contextInfo: {
        externalAdReply: {
          title: '',
          body: '',
          mediaType: 1,
          thumbnailUrl: picture,
          renderLargerThumbnail: true
        }
      }
    })
  }

  return true
}

async function sendAvisoGroupsUpdate({ sock, groupJid, update, meta }) {
  const groupName = meta?.subject || 'el grupo'
  const memberCount = meta?.participants?.length ?? '?'
  const contextInfo = groupCard(groupName, memberCount)
  const send = async text => await safeSend(sock, groupJid, { text, contextInfo })
  const duration = update?.ephemeralDuration

  if (typeof update?.announce === 'boolean') {
    await send(update.announce
      ? `🌾 *${groupName}* fue *cerrado,* solo los administradores pueden enviar mensajes.`
      : `🌴 *${groupName}* fue *abierto,* todos pueden enviar mensajes.`)
  }

  if (typeof update?.restrict === 'boolean') {
    await send(update.restrict
      ? `🌾 La edición de *${groupName}* quedó restringida a administradores.`
      : `🌴 Todos los miembros de *${groupName}* pueden editar la información del grupo.`)
  }

  if (typeof update?.subject === 'string' && update.subject.trim()) {
    await send(`📍 El nombre del grupo fue actualizado a *${update.subject.trim()}.*`)
  }

  if (typeof update?.desc === 'string') {
    await send(update.desc.trim()
      ? `📍 La descripción de *${groupName}* fue actualizada.`
      : `🌾 La descripción de *${groupName}* fue eliminada.`)
  }

  if (typeof duration === 'number') {
    await send(
      duration === 0 ? `📍 Los mensajes temporales de *${groupName}* fueron *desactivados.*`
      : duration === 86400 ? `📍 Los mensajes de *${groupName}* se eliminarán en *24 horas.*`
      : duration === 604800 ? `📍 Los mensajes de *${groupName}* se eliminarán en *7 días.*`
      : `📍 Los mensajes de *${groupName}* se eliminarán en *90 días.*`
    )
  }

  if (typeof update?.inviteCode === 'string') {
    await send(`📍 El enlace de invitación de *${groupName}* fue renovado.`)
  }

  if (typeof update?.locked === 'boolean') {
    await send(update.locked
      ? `🌾 *${groupName}* fue *bloqueado* por un administrador.`
      : `🌴 *${groupName}* fue *desbloqueado.*`)
  }

  if (update?.memberAddMode) {
    await send(update.memberAddMode === 'admin_add'
      ? `📍 Solo los administradores de *${groupName}* pueden agregar miembros.`
      : `📍 Todos los miembros de *${groupName}* pueden agregar nuevos contactos.`)
  }

  if (update?.joinApprovalMode) {
    await send(update.joinApprovalMode === 'on'
      ? `📍 Los administradores de *${groupName}* deben aprobar los nuevos ingresos.`
      : `📍 Cualquiera puede unirse a *${groupName}* sin aprobación.`)
  }

  if (update?.profilePictureUpdated === true || typeof update?.profilePictureUrl === 'string') {
    await send(`📍 La foto de *${groupName}* fue actualizada.`)
  }

  if (update?.profilePictureDeleted === true) {
    await send(`🌾 La foto de *${groupName}* fue eliminada.`)
  }

  return true
}

async function handleAntilinkEvent({ sock, m, groupJid, meta }) {
  const text = getIncomingText(m)
  if (!text) return false

  const waLink = detectWaLink(text)
  if (!waLink) return false

  const sender = normalizeJid(m?.key?.participant || m?.participant || '')
  if (!sender) return false

  const senderParticipant = findParticipant(meta, buildCandidateJids(sender, jidToNumber(sender)))
  if (isAdminFlag(senderParticipant?.admin)) return false

  const db = getDb()

  if (waLink.type === 'grupo') {
    const ownCode = await getSameGroupCode(sock, groupJid)
    if (ownCode && ownCode === waLink.code) {
      const key = warningKey(groupJid, sender)
      const count = await db.incr(key)

      if (count <= config.limits.antilinkWarnings) {
        await safeSend(sock, groupJid, {
          text: `🌾 ${mentionTag(sender)} advertencia *${count}/${config.limits.antilinkWarnings}*`,
          mentions: [mentionJid(sender)]
        }, m)
        return true
      }

      await db.del(key)
    }
  }

  const user = sock?.user || {}
  const botParticipant = findParticipant(meta, buildCandidateJids(
    user.id,
    user.jid,
    user.lid,
    user.phoneNumber,
    user.pn,
    user.user,
    jidToNumber(user.id),
    jidToNumber(user.jid),
    jidToNumber(user.lid)
  ))

  const state = await getGroupEvents(groupJid)

  if (!isAdminFlag(botParticipant?.admin)) {
    if (state.avisos) {
      await safeSend(sock, groupJid, {
        text: '🌾 Se detectó un enlace, pero no soy administrador, no puedo remover usuarios.'
      }, m)
    }
    return false
  }

  try {
    await sock.groupParticipantsUpdate(groupJid, [sender], 'remove')
    await db.del(warningKey(groupJid, sender))
    await safeSend(sock, groupJid, {
      text: `🌴 ${mentionTag(sender)} fue removido por compartir un *enlace de ${waLink.type}* de WhatsApp.`,
      mentions: [mentionJid(sender)]
    }, m)
    return true
  } catch {
    if (state.avisos) {
      await safeSend(sock, groupJid, {
        text: `🌾 Se detectó un enlace de ${waLink.type} de ${mentionTag(sender)} pero no se pudo remover.`,
        mentions: [mentionJid(sender)]
      }, m)
    }
    return false
  }
}

export async function handleGroupMessageEvents(sock, m) {
  const groupJid = normalizeJid(m?.key?.remoteJid || '')
  if (!isGroupJid(groupJid) || m?.key?.fromMe) return false

  const state = await getGroupEvents(groupJid)
  if (!state.antilink) return false

  const meta = await getGroupMeta(sock, groupJid)
  if (!meta?.participants?.length) return false

  return await handleAntilinkEvent({ sock, m, groupJid, meta })
}

export async function handleGroupParticipantsUpdate(sock, update) {
  const groupJid = normalizeJid(update?.id || update?.jid || '')
  if (!isGroupJid(groupJid)) return

  const participants = Array.isArray(update?.participants)
    ? update.participants.map(resolveParticipantEntry).filter(item => item.jid || item.phone)
    : []

  if (!participants.length) return

  const action = String(update?.action || '').toLowerCase()
  const state = await getGroupEvents(groupJid)
  const meta = await getGroupMeta(sock, groupJid)
  if (!meta) return

  if (state.welcome) await sendWelcomeEvent({ sock, groupJid, action, participants, meta })
  if (state.avisos) await sendAvisoParticipantsEvent({ sock, groupJid, action, participants, meta })
}

export async function handleGroupsUpdate(sock, updates = []) {
  for (const update of updates || []) {
    const groupJid = normalizeJid(update?.id || update?.jid || '')
    if (!isGroupJid(groupJid)) continue

    const state = await getGroupEvents(groupJid)
    if (!state.avisos) continue

    const meta = await getGroupMeta(sock, groupJid)
    if (!meta) continue

    await sendAvisoGroupsUpdate({ sock, groupJid, update, meta })
  }
}
