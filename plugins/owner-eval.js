import { format } from 'util'

export default {
  command: 'e',
  aliases: ['ex', 'eval', 'exec'],
  category: 'owner',
  description: 'Evalúa JavaScript desde el chat',
  usage: '.e 2 + 2',
  ownerOnly: true,
  async run({ input, args, m, sock, react, reply, invokedAs }) {
    if (!input.trim()) {
      return await reply('🍄 *_Debes escribir un comando a ejecutar_*')
    }

    try {
      await react('🕒')
      let printsLeft = 15

      const print = async (...values) => {
        if (--printsLeft < 0) return
        await reply(format(...values))
      }

      const source = invokedAs === 'e' ? `return (${input})` : input
      const executor = new (async () => {}).constructor('print', 'm', 'sock', 'args', 'process', source)
      const result = await executor(print, m, sock, args, process)
      await react('✔️')
      await reply(format(result))
    } catch (error) {
      await react('✖️')
      await reply(format(error))
    }
  }
}
