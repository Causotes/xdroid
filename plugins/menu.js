import fetch from 'node-fetch'
import {
  proto,
  prepareWAMessageMedia,
  generateWAMessageFromContent
} from '@whiskeysockets/bail'

async function getBuffer(url) {
  const res = await fetch(url)

  if (!res.ok) {
    throw new Error(`Error descargando ${url}: ${res.status}`)
  }

  return Buffer.from(await res.arrayBuffer())
}

async function resizeThumbnail(buffer) {
  try {
    const jimpModule = await import('jimp')
    const Jimp = jimpModule.Jimp || jimpModule.default

    const img = await Jimp.read(buffer)

    if (typeof img.cover === 'function') {
      img.cover(400, 180)
    } else {
      img.resize(400, 180)
    }

    if (typeof img.quality === 'function') {
      img.quality(85)
    }

    if (typeof img.getBufferAsync === 'function') {
      return await img.getBufferAsync('image/jpeg')
    }

    return await img.getBuffer('image/jpeg')
  } catch (e) {
    console.warn('No se pudo redimensionar thumbnail:', e.message)
    return buffer
  }
}

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

  async run({ m, conn, plugins = [], config }) {
    const grouped = new Map()

    for (const plugin of plugins) {
      if (!plugin?.command || typeof plugin.run !== 'function') continue

      const category = String(plugin.category || 'general')
        .trim()
        .toLowerCase() || 'general'

      if (!grouped.has(category)) grouped.set(category, [])
      grouped.get(category).push(plugin)
    }

    const sections = [...grouped.entries()]
      .sort(([a], [b]) => sortCategories(a, b))
      .map(([category, items]) => {
        const lines = items
          .sort((a, b) =>
            String(a.command).localeCompare(
              String(b.command),
              'es',
              { sensitivity: 'base' }
            )
          )
          .map(plugin => {
            const description = String(
              plugin.description || 'Sin descripción'
            ).trim()

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

    try {
      const thumbUrl =
        'https://adofiles.i11.eu/dl/4e210018.jpg'

      const thumbOriginal =
        await getBuffer(thumbUrl)

      const thumbResized =
        await resizeThumbnail(
          thumbOriginal
        )

      const fakeDocument =
        Buffer.from(text, 'utf-8')

      const prepared =
        await prepareWAMessageMedia(
          {
            document: fakeDocument,
            mimetype:
              'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            fileName:
              `🍄 ${config.bot.name} Menu.xlsx`
          },
          {
            upload:
              conn.waUploadToServer
          }
        )

      const documentMessage =
        prepared.documentMessage

      documentMessage.fileName =
        `🍄 ${config.bot.name} Menu.xlsx`

      documentMessage.title =
        `${config.bot.name} Menu`

      documentMessage.caption =
        text

      documentMessage.mimetype =
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

      documentMessage.pageCount = 0

      documentMessage.jpegThumbnail =
        thumbResized

      documentMessage.thumbnailWidth = 400
      documentMessage.thumbnailHeight = 180

      const waMsg =
        generateWAMessageFromContent(
          m.chat,
          {
            documentMessage:
              proto.Message.DocumentMessage.fromObject(
                documentMessage
              )
          },
          {
            userJid:
              conn.user?.id
          }
        )

      await conn.relayMessage(
        m.chat,
        waMsg.message,
        {
          messageId:
            waMsg.key.id
        }
      )
    } catch (e) {
      console.error(e)
      await m.reply(
        'Error enviando el menú.'
      )
    }
  }
}