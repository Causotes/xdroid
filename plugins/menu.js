const CATEGORY_LABELS = {
  general: 'General',
  grupo: 'Grupo',
  owner: 'Owner',
  herramientas: 'Herramientas'
}

function categoryLabel(value = '') {
  return CATEGORY_LABELS[value] || value.charAt(0).toUpperCase() + value.slice(1)
}

export default {
  command: 'menu',
  aliases: ['help'],
  category: 'general',
  description: 'Muestra el menú principal',
  usage: '.menu',
  async run({ reply, plugins, config }) {
    const grouped = new Map()

    for (const plugin of plugins) {
      if (!grouped.has(plugin.category)) grouped.set(plugin.category, [])
      grouped.get(plugin.category).push(plugin)
    }

    const sections = [...grouped.entries()].map(([category, items]) => {
      const lines = items.map(plugin => {
        const names = [plugin.command, ...plugin.aliases].filter(Boolean)
        return `◦ *${config.prefix}${plugin.command}*${names.length > 1 ? ` — ${names.slice(1).join(', ')}` : ''}`
      })
      return `🍃 *${categoryLabel(category)}*\n${lines.join('\n')}`
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
          title: '🌾 𝗖𝗼𝗺𝗺𝗮𝗻𝗱𝘀',
          body: '',
          mediaType: 1,
          thumbnailUrl: '',
          sourceUrl: '',
          renderLargerThumbnail: true
        }
      }
    })
  }
}
