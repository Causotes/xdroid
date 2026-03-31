import fs from 'fs/promises'
import path from 'path'
import config from '../config.js'
import { bool, boolInt, cleanName, normalizeJid, nowIso } from './helpers.js'

const DB_PATH = path.resolve(config.databasePath)
const LEGACY_EVENTS_PATH = path.resolve(config.legacyGroupEventsPath)

let db = {
  group_events: {},
  command_seen: {},
  users: {},
  store: {}
}

let saveTimer = null
let dbReady = false
let dbInit = null
const userNameCache = new Map()

function rowToState(row) {
  if (!row || typeof row !== 'object') return null
  return {
    antilink: bool(row.antilink),
    welcome: bool(row.welcome),
    avisos: bool(row.avisos)
  }
}

function scheduleSave() {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(async () => {
    try {
      await fs.writeFile(DB_PATH, JSON.stringify(db, null, 2), 'utf8')
    } catch (error) {
      console.error('[db] Error guardando xdroid.json:', error.message)
    }
  }, 700)
}

async function migrateLegacyEvents() {
  if (Object.keys(db.group_events).length > 0) return

  let raw = ''
  try {
    raw = await fs.readFile(LEGACY_EVENTS_PATH, 'utf8')
  } catch {
    return
  }

  let parsed = null
  try {
    parsed = JSON.parse(raw)
  } catch {
    parsed = null
  }

  if (!parsed || typeof parsed !== 'object') return

  for (const [jid, state] of Object.entries(parsed)) {
    const groupJid = normalizeJid(jid)
    if (!groupJid.endsWith('@g.us')) continue

    db.group_events[groupJid] = {
      antilink: boolInt(!!state?.antilink),
      welcome: boolInt(!!state?.welcome),
      avisos: boolInt(!!state?.avisos),
      updated_at: nowIso()
    }
  }

  scheduleSave()
}

async function ensureDbReady() {
  if (dbReady) return DB_PATH

  if (!dbInit) {
    dbInit = (async () => {
      await fs.mkdir(path.dirname(DB_PATH), { recursive: true })

      try {
        const raw = await fs.readFile(DB_PATH, 'utf8')
        const parsed = JSON.parse(raw)
        db.group_events = parsed.group_events || {}
        db.command_seen = parsed.command_seen || {}
        db.users = parsed.users || {}
        db.store = parsed.store || {}
      } catch {
        await fs.writeFile(DB_PATH, JSON.stringify(db, null, 2), 'utf8')
      }

      await migrateLegacyEvents()
      dbReady = true
      return DB_PATH
    })()
  }

  try {
    return await dbInit
  } catch (error) {
    dbInit = null
    throw error
  }
}

async function getGroupEvents(groupJid) {
  const jid = normalizeJid(groupJid)
  if (!jid.endsWith('@g.us')) return null
  await ensureDbReady()
  return rowToState(db.group_events[jid])
}

async function saveGroupEvents(groupJid, state = {}) {
  const jid = normalizeJid(groupJid)
  if (!jid.endsWith('@g.us')) throw new Error('Grupo inválido')

  await ensureDbReady()

  const payload = {
    antilink: boolInt(!!state.antilink),
    welcome: boolInt(!!state.welcome),
    avisos: boolInt(!!state.avisos)
  }

  db.group_events[jid] = { ...payload, updated_at: nowIso() }
  scheduleSave()

  return {
    antilink: payload.antilink === true,
    welcome: payload.welcome === true,
    avisos: payload.avisos === true
  }
}

async function markCommandSeen({ chatJid, senderJid, command }) {
  const chat = normalizeJid(chatJid)
  const sender = normalizeJid(senderJid)
  const cmd = String(command || '').toLowerCase().trim()
  if (!chat || !sender || !cmd) return false

  await ensureDbReady()

  const key = `${chat}|${sender}|${cmd}`
  const previous = db.command_seen[key]

  db.command_seen[key] = {
    chat_jid: chat,
    sender_jid: sender,
    command: cmd,
    seen: 1,
    used_count: previous ? previous.used_count + 1 : 1,
    last_used_at: nowIso()
  }

  scheduleSave()
  return true
}

async function upsertUser({ jid, name }) {
  const userJid = normalizeJid(jid)
  const userName = cleanName(name)
  if (!userJid || !userName) return false

  await ensureDbReady()
  db.users[userJid] = { name: userName, last_seen_at: nowIso() }
  userNameCache.set(userJid, userName)
  scheduleSave()
  return true
}

async function getUserName(jid) {
  const userJid = normalizeJid(jid)
  if (!userJid) return null
  if (userNameCache.has(userJid)) return userNameCache.get(userJid)

  await ensureDbReady()
  const row = db.users[userJid]
  const name = cleanName(row?.name || '')
  if (name) userNameCache.set(userJid, name)
  return name || null
}

async function getTopCommands({ chatJid = '', limit = 10 } = {}) {
  const chat = normalizeJid(chatJid)
  const safeLimit = Math.max(1, Math.min(100, Number(limit) || 10))
  await ensureDbReady()

  let rows = Object.values(db.command_seen)
  if (chat) rows = rows.filter(row => row.chat_jid === chat)

  return rows
    .sort((a, b) => b.used_count - a.used_count || b.last_used_at.localeCompare(a.last_used_at))
    .slice(0, safeLimit)
}

async function storeGet(key) {
  await ensureDbReady()
  return db.store[key] ?? null
}

async function storeSet(key, value) {
  await ensureDbReady()
  db.store[key] = value
  scheduleSave()
  return value
}

async function storeDel(key) {
  await ensureDbReady()
  delete db.store[key]
  scheduleSave()
  return true
}

async function storeIncr(key, by = 1) {
  await ensureDbReady()
  db.store[key] = (db.store[key] ?? 0) + by
  scheduleSave()
  return db.store[key]
}

function buildRuntime() {
  return {
    path: DB_PATH,
    init: ensureDbReady,
    getGroupEvents,
    saveGroupEvents,
    markCommandSeen,
    upsertUser,
    getUserName,
    getTopCommands,
    get: storeGet,
    set: storeSet,
    del: storeDel,
    incr: storeIncr
  }
}

function ensureGlobalRuntime() {
  if (global?.dbsq) return global.dbsq
  const runtime = buildRuntime()
  global.dbsq = runtime
  return runtime
}

export function getDb() {
  return ensureGlobalRuntime()
}

export async function setupDb() {
  const runtime = ensureGlobalRuntime()
  await runtime.init()
  return runtime
}
