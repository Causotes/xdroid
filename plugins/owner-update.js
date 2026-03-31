import { exec as rawExec } from 'child_process'
import { promisify } from 'util'
import config from '../config.js'
import { reloadPlugins } from '../lib/plugins.js'

const exec = promisify(rawExec)

export default {
  command: 'update',
  aliases: ['actualizar', 'pull', 'gitpull'],
  category: 'owner',
  description: 'Hace git pull y recarga plugins',
  usage: '.update',
  ownerOnly: true,
  async run({ reply }) {
    try {
      const start = Date.now()
      const { stdout, stderr } = await exec('git pull', { maxBuffer: 1024 * 1024 })
      const elapsed = Date.now() - start
      const result = (stdout || stderr || 'Sin cambios').trim()
      const reloaded = await reloadPlugins()
      const output = `${result}\n\n◦ *Plugins recargados:* ${reloaded.length}`

      await reply([
        '🐢 *_Ready_*',
        `◦ *Tiempo:* ${elapsed} ms`,
        '🌾 *Salida*',
        output.length > config.limits.updateReplyLength ? `${output.slice(0, config.limits.updateReplyLength)}\n...` : output
      ].join('\n'), {
        contextInfo: {
          externalAdReply: {
            title: '🦞 𝗔𝗰𝘁𝘂𝗮𝗹𝗶𝘇𝗮𝗰𝗶𝗼́𝗻 𝗖𝗼𝗺𝗽𝗹𝗲𝘁𝗮𝗱𝗮',
            mediaType: 1,
            thumbnailUrl: config.media.updateThumbnail,
            sourceUrl: '',
            renderLargerThumbnail: false
          }
        }
      })
    } catch (error) {
      const details = String(error?.stderr || error?.message || error).trim()
      await reply(`🌾 *_Algo salió mal_*\n◦ *Failed:*\n${details}`)
    }
  }
}
