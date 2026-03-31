function formatCategoryLabel(value = '') {
  return String(value || 'general')
    .trim()
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .split(' ')
    .filter(Boolean)
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

function sortCategories(a = '', b = '') {
  if (a === 'general') return -1
  if (b === 'general') return 1
  return a.localeCompare(b, 'es', { sensitivity: 'base' })
}

export default {
  command: 'menu',
  aliases: ['help'],
  category: 'general',
  description: 'Muestra el menú principal',
  usage: '.menu',

  async run({ reply, plugins = [], config }) {
    const grouped = new Map()

    for (const plugin of plugins) {
      if (!plugin?.command || typeof plugin.run !== 'function') continue

      const category = String(plugin.category || 'general').trim().toLowerCase() || 'general'
      if (!grouped.has(category)) grouped.set(category, [])
      grouped.get(category).push(plugin)
    }

    const sections = [...grouped.entries()]
      .sort(([a], [b]) => sortCategories(a, b))
      .map(([category, items]) => {
        const lines = items
          .sort((a, b) => String(a.command).localeCompare(String(b.command), 'es', { sensitivity: 'base' }))
          .map(plugin => {
            const description = String(plugin.description || 'Sin descripción').trim()
            return `◦ *${config.prefix}${plugin.command}* — ${description}`
          })

        return `🍃 *${formatCategoryLabel(category)}*\n${lines.join('\n')}`
      })

    const text = [
      `🌴 ¡Hola! Soy *${config.bot.name}*, un gusto ayudarte.`,
      '*[🍄]* *Aquí tienes mi lista de comandos*',
      '',
      ...sections,
      '',
      `🌾 *Prefix actual:* ${config.prefix}`
    ].join('\n')

    await reply(text, {
      contextInfo: {
        externalAdReply: {
          title: '',
          body: '',
          mediaType: 1,
          thumbnailUrl: 'https://adofiles.i11.eu/dl/4e210018.jpg',
          sourceUrl: '',
          renderLargerThumbnail: true
        }
      }
    })
  }
}