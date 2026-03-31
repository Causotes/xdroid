import fs from 'fs/promises'
import path from 'path'
import { pathToFileURL } from 'url'
import { sortByText } from './helpers.js'

const PLUGINS_DIR = path.resolve('./plugins')
const plugins = []
const commandIndex = new Map()

function normalizePlugin(definition = {}, file = '') {
  const command = String(definition.command || definition.name || '').trim().toLowerCase()
  const aliases = Array.from(new Set(
    (Array.isArray(definition.aliases) ? definition.aliases : definition.alias || [])
      .map(value => String(value || '').trim().toLowerCase())
      .filter(Boolean)
  ))

  return {
    file,
    command,
    aliases,
    category: String(definition.category || 'general').trim().toLowerCase(),
    description: String(definition.description || 'Sin descripción').trim(),
    usage: String(definition.usage || '').trim(),
    ownerOnly: definition.ownerOnly === true,
    groupOnly: definition.groupOnly === true,
    userAdminOnly: definition.userAdminOnly === true || definition.useradmin === true,
    botAdminOnly: definition.botAdminOnly === true || definition.botadmin === true,
    run: typeof definition.run === 'function' ? definition.run : definition.exec,
    raw: definition
  }
}

function rebuildIndex() {
  commandIndex.clear()
  for (const plugin of plugins) {
    if (!plugin.command || typeof plugin.run !== 'function') continue
    commandIndex.set(plugin.command, plugin)
    for (const alias of plugin.aliases) commandIndex.set(alias, plugin)
  }
}

export async function loadPlugins() {
  const files = await fs.readdir(PLUGINS_DIR)
  const loaded = []

  for (const file of files.sort()) {
    if (!file.endsWith('.js')) continue
    const filePath = path.resolve(PLUGINS_DIR, file)
    const url = pathToFileURL(filePath).href

    try {
      const module = await import(`${url}?update=${Date.now()}`)
      const plugin = normalizePlugin(module?.default || {}, file)
      if (plugin.command && typeof plugin.run === 'function') loaded.push(plugin)
    } catch (error) {
      console.error(`[plugins] Error cargando ${file}:`, error)
    }
  }

  plugins.length = 0
  plugins.push(...sortByText(loaded, item => `${item.category}-${item.command}`))
  rebuildIndex()
  return plugins
}

export async function reloadPlugins() {
  return await loadPlugins()
}

export function getPlugin(command = '') {
  return commandIndex.get(String(command || '').toLowerCase().trim()) || null
}

export function getPlugins() {
  return [...plugins]
}

export function getPluginsByCategory() {
  const map = new Map()

  for (const plugin of plugins) {
    if (!map.has(plugin.category)) map.set(plugin.category, [])
    map.get(plugin.category).push(plugin)
  }

  return map
}
