export default {
  command: 'banana',
  aliases: ['pp', 'pene'],
  category: 'general',
  description: 'Mide tu banana 🍌',
  usage: '.banana',
  async run({ reply, m }) {
    const nombre = m.pushName || 'Anónimo'
    const size = Math.floor(Math.random() * 20) + 1
    const barra = '8' + '='.repeat(size) + 'D'

    await reply(`⏳ Calculando...`)

    await new Promise(r => setTimeout(r, 2000))

    await reply([
      `🍌 *Medidor de Banana*`,
      ``,
      `👤 *${nombre}* tiene:`,
      ``,
      barra,
      ``,
      `📏 *${size} cm*`,
      size <= 5 ? `💀 Hasta los frijoles te quedan grandes` :
      size <= 10 ? `😐 Normalito, nada del otro mundo` :
      size <= 15 ? `😏 Con eso te defiendes` :
      `🏆 Eso ya es pa' presumir`
    ].join('\n'))
  }
}