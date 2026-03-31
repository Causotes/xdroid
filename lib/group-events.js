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

function unique(items = []) {
  return Array.from(new Set(items.filter(Boolean)))
}

function hasOwn(obj, key) {
  return Object.prototype.hasOwnProperty.call(obj || {}, key)
}

function resolvePhoneJid(raw = '') {
  const jid = normalizeJid(raw)
  if (!jid) return ''

  if (jid.endsWith('@s.whatsapp.net')) return jid

  const number = jidToNumber(jid)
  return number ? `${number}@s.whatsapp.net` : ''
}

function collectIdentityValues(source) {
  const ids = []
  const phones = []

  const pushId = value => {
    const jid = normalizeJid(value)
    if (!jid || jid === '[object Object]') return
    ids.push(jid)
  }

  const pushPhone = value => {
    const jid = resolvePhoneJid(value)
    if (!jid || jid === '[object Object]') return
    phones.push(jid)
  }

  if (typeof source === 'string' || typeof source === 'number') {
    pushId(source)
    pushPhone(source)
    return { ids: unique(ids), phones: unique(phones) }
  }

  if (typeof source === 'object' && source !== null) {
    const idKeys = ['id', 'jid', 'lid', 'participant', 'author', 'subjectOwner', 'descOwner', 'owner']
    const phoneKeys = ['phone', 'phoneNumber', 'pn', 'participantPn', 'authorPn', 'subjectOwnerPn', 'descOwnerPn', 'ownerPn']

    for (const key of idKeys) pushId(source[key])
    for (const key of phoneKeys) pushPhone(source[key])
  }

  return { ids: unique(ids), phones: unique(phones) }
}

function resolveParticipantEntry(raw) {
  const { ids, phones } = collectIdentityValues(raw)
  const jid = ids[0] || phones[0] || ''
  const phone = phones[0] || resolvePhoneJid(jid) || ''
  return { jid, phone }
}

function resolveEntityInfo(meta, ...sources) {
  const ids = []
  const phones = []

  for (const source of sources) {
    const values = collectIdentityValues(source)
    ids.push(...values.ids)
    phones.push(...values.phones)
  }

  const participant = meta
    ? findParticipant(meta, buildCandidateJids([...ids, ...phones]))
    : null

  const phoneJid = resolvePhoneJid(
    participant?.phoneNumber ||
    participant?.pn ||
    phones[0] ||
    ''
  )

  const fallback = normalizeJid(
    participant?.id ||
    participant?.jid ||
    participant?.lid ||
    ids[0] ||
    phoneJid ||
    ''
  )

  const mentionBase = phoneJid || fallback
  const jid = mentionBase ? mentionJid(mentionBase) : ''
  const tag = mentionBase ? mentionTag(mentionBase) : '@usuario'

  return {
    jid,
    tag,
    raw: fallback || mentionBase,
    number: jidToNumber(mentionBase),
    participant
  }
}

function sameEntity(a, b) {
  const aNumber = jidToNumber(a?.jid || a?.raw || '')
  const bNumber = jidToNumber(b?.jid || b?.raw || '')

  if (aNumber && bNumber) return aNumber === bNumber
  return normalizeJid(a?.raw || a?.jid || '') === normalizeJid(b?.raw || b?.jid || '')
}

function formatActorTail(actor, targets = []) {
  if (!actor?.jid) return ''
  if (targets.some(target => sameEntity(actor, target))) return ''
  return ` por ${actor.tag}`
}

function formatTargets(targets = []) {
  return targets.map(item => item.tag).join(', ') || '@usuario'
}

function formatDuration(seconds) {
  if (seconds === 0) return 'desactivados'
  if (seconds === 86400) return '24 horas'
  if (seconds === 604800) return '7 días'
  if (seconds === 7776000) return '90 días'
  return `${seconds} segundos`
}

function isMemberAddModeOpen(value) {
  if (value === 'admin_add' || value === false || value === 'off' || value === 'admins_only') return false
  if (value === true || value === 'all_member_add' || value === 'on' || value === 'all') return true
  return !!value
}

function isJoinApprovalEnabled(value) {
  if (value === true || value === 'on' || value === 'enabled') return true
  if (value === false || value === 'off' || value === 'disabled') return false
  return !!value
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

async function sendAvisoParticipantsEvent({ sock, groupJid, action, participants, meta, quoted, update }) {
  if (!['add', 'remove', 'promote', 'demote'].includes(action)) return false

  const groupName = meta?.subject || 'el grupo'
  const memberCount = meta?.participants?.length ?? '?'
  const targets = participants
    .map(item => resolveEntityInfo(meta, item))
    .filter(item => item.jid || item.raw)

  if (!targets.length) return false

  const actor = resolveEntityInfo(meta, update, update?.author, update?.authorPn)
  const tags = formatTargets(targets)
  const plural = targets.length > 1
  const actorDidIt = actor?.jid && !targets.some(target => sameEntity(actor, target))
  const mentions = unique([
    ...targets.map(item => item.jid),
    actor?.jid
  ])

  const contextInfo = groupCard(groupName, memberCount)

  const messages = {
  add: actorDidIt
    ? `🌴 ${tags} ${plural ? 'fueron agregados' : 'fue agregado'} a *${groupName}* por ${actor.tag}.`
    : null,

  remove: actorDidIt
    ? `🌾 ${tags} ${plural ? 'fueron removidos' : 'fue removido'} de *${groupName}* por ${actor.tag}.`
    : null,

  promote: `🐢 ${tags} ${plural ? 'recibieron' : 'recibió'} *admin* en *${groupName}*${formatActorTail(actor, targets)}.`,

  demote: `🦞 ${tags} ${plural ? 'perdieron' : 'perdió'} *admin* en *${groupName}*${formatActorTail(actor, targets)}.`
}

  await safeSend(sock, groupJid, { text: messages[action], mentions, contextInfo }, quoted)
  return true
}

async function sendWelcomeEvent({ sock, groupJid, action, participants, meta }) {
  if (!['add', 'remove'].includes(action)) return false

  const groupName = meta?.subject || 'el grupo'
  const memberCount = meta?.participants?.length ?? '?'

  for (const participant of participants) {
    const info = resolveEntityInfo(meta, participant)
    if (!info?.jid) continue

    let picture = config.media.defaultProfile
    try {
      const fetched = await getProfilePicture(sock, info.jid)
      if (fetched) picture = fetched
    } catch {}

    const text = action === 'add'
      ? [
          '🌴 *Welcome*',
          `◦ *Usuario:* ${info.tag}`,
          `◦ *Grupo:* ${groupName}`,
          `◦ *Miembros:* ${memberCount}`,
          '',
          '📍 Bienvenido/a, respeta las reglas y disfruta tu estadía. 🐢'
        ].join('\n')
      : [
          '🌾 *Despedida*',
          `◦ *Usuario:* ${info.tag}`,
          `◦ *Grupo:* ${groupName}`,
          '',
          '📍 Gracias por haber estado aquí, te deseamos lo mejor. 🐢'
        ].join('\n')

    await safeSend(sock, groupJid, {
      text,
      mentions: [info.jid],
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

  const genericActor = resolveEntityInfo(meta, update, update?.author, update?.authorPn)
  const subjectActor = resolveEntityInfo(
    meta,
    { id: update?.subjectOwner || meta?.subjectOwner, phoneNumber: update?.subjectOwnerPn || meta?.subjectOwnerPn },
    update,
    update?.author,
    update?.authorPn
  )
  const descActor = resolveEntityInfo(
    meta,
    { id: update?.descOwner || meta?.descOwner, phoneNumber: update?.descOwnerPn || meta?.descOwnerPn },
    update,
    update?.author,
    update?.authorPn
  )
  const ownerInfo = resolveEntityInfo(
    meta,
    { id: update?.owner || meta?.owner, phoneNumber: update?.ownerPn || meta?.ownerPn }
  )

  const send = async (text, mentions = []) => {
    await safeSend(sock, groupJid, {
      text,
      mentions: unique(mentions),
      contextInfo
    })
  }

  if (hasOwn(update, 'announce') && typeof update?.announce === 'boolean') {
    await send(
      update.announce
        ? `🌾 *${groupName}* fue *cerrado*: solo los administradores pueden enviar mensajes${formatActorTail(genericActor)}.`
        : `🌴 *${groupName}* fue *abierto*: todos pueden enviar mensajes${formatActorTail(genericActor)}.`,
      [genericActor?.jid]
    )
  }

  if (hasOwn(update, 'restrict') && typeof update?.restrict === 'boolean') {
    await send(
      update.restrict
        ? `🌾 La edición de *${groupName}* quedó restringida a administradores${formatActorTail(genericActor)}.`
        : `🌴 Todos los miembros de *${groupName}* pueden editar la información del grupo${formatActorTail(genericActor)}.`,
      [genericActor?.jid]
    )
  }

  if (hasOwn(update, 'subject') && typeof update?.subject === 'string' && update.subject.trim()) {
    await send(
      `📍 El nombre del grupo ahora es *${update.subject.trim()}*${formatActorTail(subjectActor)}.`,
      [subjectActor?.jid]
    )
  }

  if (hasOwn(update, 'desc') && typeof update?.desc === 'string') {
    await send(
      update.desc.trim()
        ? `📍 La descripción de *${groupName}* fue actualizada${formatActorTail(descActor)}.`
        : `🌾 La descripción de *${groupName}* fue eliminada${formatActorTail(descActor)}.`,
      [descActor?.jid]
    )
  }

  if (hasOwn(update, 'ephemeralDuration') && typeof update?.ephemeralDuration === 'number') {
    await send(
      update.ephemeralDuration === 0
        ? `📍 Los mensajes temporales de *${groupName}* fueron *desactivados*${formatActorTail(genericActor)}.`
        : `📍 Los mensajes de *${groupName}* ahora duran *${formatDuration(update.ephemeralDuration)}*${formatActorTail(genericActor)}.`,
      [genericActor?.jid]
    )
  }

  if (hasOwn(update, 'inviteCode') && typeof update?.inviteCode === 'string') {
    await send(
      `📍 El enlace de invitación de *${groupName}* fue renovado${formatActorTail(genericActor)}.`,
      [genericActor?.jid]
    )
  }

  if (hasOwn(update, 'locked') && typeof update?.locked === 'boolean') {
    await send(
      update.locked
        ? `🌾 *${groupName}* fue *bloqueado*${formatActorTail(genericActor)}.`
        : `🌴 *${groupName}* fue *desbloqueado*${formatActorTail(genericActor)}.`,
      [genericActor?.jid]
    )
  }

  if (hasOwn(update, 'memberAddMode')) {
    const open = isMemberAddModeOpen(update.memberAddMode)
    await send(
      open
        ? `📍 Todos los miembros de *${groupName}* pueden agregar nuevos contactos${formatActorTail(genericActor)}.`
        : `📍 Solo los administradores de *${groupName}* pueden agregar miembros${formatActorTail(genericActor)}.`,
      [genericActor?.jid]
    )
  }

  if (hasOwn(update, 'joinApprovalMode')) {
    const enabled = isJoinApprovalEnabled(update.joinApprovalMode)
    await send(
      enabled
        ? `📍 Los administradores de *${groupName}* deben aprobar los nuevos ingresos${formatActorTail(genericActor)}.`
        : `📍 Cualquiera puede unirse a *${groupName}* sin aprobación${formatActorTail(genericActor)}.`,
      [genericActor?.jid]
    )
  }

  if (update?.profilePictureUpdated === true || (hasOwn(update, 'profilePictureUrl') && typeof update?.profilePictureUrl === 'string')) {
    await send(
      `📍 La foto de *${groupName}* fue actualizada${formatActorTail(genericActor)}.`,
      [genericActor?.jid]
    )
  }

  if (update?.profilePictureDeleted === true) {
    await send(
      `🌾 La foto de *${groupName}* fue eliminada${formatActorTail(genericActor)}.`,
      [genericActor?.jid]
    )
  }

  if (hasOwn(update, 'owner') || hasOwn(update, 'ownerPn')) {
    await send(
      ownerInfo?.jid
        ? `👑 *${groupName}* cambió de propietario. Nuevo dueño: ${ownerInfo.tag}${formatActorTail(genericActor, [ownerInfo])}.`
        : `👑 *${groupName}* cambió de propietario${formatActorTail(genericActor)}.`,
      [ownerInfo?.jid, genericActor?.jid]
    )
  }

  if (hasOwn(update, 'linkedParent')) {
    await send(
      update?.linkedParent
        ? `📍 *${groupName}* fue vinculado a una comunidad${formatActorTail(genericActor)}.`
        : `📍 *${groupName}* fue desvinculado de su comunidad${formatActorTail(genericActor)}.`,
      [genericActor?.jid]
    )
  }

  if (hasOwn(update, 'isCommunity') && typeof update?.isCommunity === 'boolean') {
    await send(
      update.isCommunity
        ? `📍 *${groupName}* ahora funciona como comunidad${formatActorTail(genericActor)}.`
        : `📍 *${groupName}* dejó de ser una comunidad${formatActorTail(genericActor)}.`,
      [genericActor?.jid]
    )
  }

  if (hasOwn(update, 'isCommunityAnnounce') && typeof update?.isCommunityAnnounce === 'boolean') {
    await send(
      update.isCommunityAnnounce
        ? `📍 *${groupName}* ahora es un grupo de anuncios de comunidad${formatActorTail(genericActor)}.`
        : `📍 *${groupName}* dejó de ser un grupo de anuncios de comunidad${formatActorTail(genericActor)}.`,
      [genericActor?.jid]
    )
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
  if (state.avisos) await sendAvisoParticipantsEvent({ sock, groupJid, action, participants, meta, update })
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