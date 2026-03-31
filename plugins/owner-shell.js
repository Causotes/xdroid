import { exec as rawExec } from 'child_process'
import { promisify } from 'util'

const exec = promisify(rawExec)

export default {
  command: 'r',
  aliases: ['run', 'sh', 'cmd'],
  category: 'owner',
  description: 'Ejecuta comandos de terminal',
  usage: '.r ls',
  ownerOnly: true,
  async run({ input, react, reply }) {
    if (!input.trim()) {
      return await reply('📍 *_Debes escribir un comando a ejecutar_*')
    }

    let output

    try {
      await react('🕒')
      output = await exec(input, { windowsHide: true, maxBuffer: 1024 * 1024 * 8 })
      await react('✔️')
    } catch (error) {
      output = error || {}
      await react('✖️')
    }

    const stdout = String(output?.stdout || '').trim()
    const stderr = String(output?.stderr || '').trim()

    if (stdout) await reply(stdout)
    if (stderr) await reply(stderr)
    if (!stdout && !stderr) await reply('📍 *Listo.* (sin salida)')
  }
}
