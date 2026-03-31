import { buildStickerFromMessage } from '../lib/sticker.js'

export default {
  command: 's',
  aliases: ['sticker', 'stik', 'stiker'],
  category: 'herramientas',
  description: 'Crea stickers desde imagen, video o webp',
  usage: '.s',
  async run({ sock, m, react, reply }) {
    try {
      await react('🕒')
      const sticker = await buildStickerFromMessage(m)
      await sock.sendMessage(m.key.remoteJid, { sticker }, { quoted: m })
      await react('✔️')
    } catch (error) {
      await react('✖️')
      await reply(String(error?.message || error))
    }
  }
}
