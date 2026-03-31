export default {
  command: 'upload',
  aliases: ['up', 'subir'],
  category: 'herramientas',
  description: 'Sube una imagen o archivo al servidor y obtén el enlace',
  usage: '.upload [reply a media] [24h|7d|30d|never]',

  async run({ m, reply, args }) {
    const quoted = m.quoted || m

    // Verificar que haya media
    if (!quoted?.mimetype) {
      return await reply(
        '❌ Debes responder a una imagen, video, audio o documento para subir.\n\n📌 *Uso:* .upload [24h | 7d | 30d | never]'
      )
    }

    const validExpirations = ['24h', '7d', '30d', 'never']
    const expiration = validExpirations.includes(args[0]) ? args[0] : '24h'

    await reply('⏳ Subiendo archivo, espera...')

    try {
      // Descargar el buffer de la media
      const { downloadMediaMessage } = await import('@whiskeysockets/baileys')
      const buffer = await downloadMediaMessage(quoted, 'buffer', {})

      const base64 = buffer.toString('base64')
      const mimetype = quoted.mimetype
      const originalName = quoted.fileName || `archivo.${mimetype.split('/')[1] || 'bin'}`

      const response = await fetch('https://adofiles.i11.eu/api/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filename: originalName,
          data: base64,
          mimetype,
          expiration
        })
      })

      if (!response.ok) {
        const err = await response.text()
        throw new Error(`HTTP ${response.status}: ${err}`)
      }

      const data = await response.json()

      const sizeKB = (data.size / 1024).toFixed(1)
      const sizeMB = (data.size / (1024 * 1024)).toFixed(2)
      const sizeStr = data.size > 1024 * 1024 ? `${sizeMB} MB` : `${sizeKB} KB`

      const expirationText = expiration === 'never' ? 'Nunca' : `En ${expiration}`

      await reply(
        [
          '✅ *Archivo subido exitosamente*',
          '',
          `📄 *Nombre:* ${data.originalName}`,
          `📦 *Tamaño:* ${sizeStr}`,
          `🗂️ *Tipo:* ${data.type}`,
          `⏰ *Expira:* ${expirationText}`,
          '',
          `🔗 *Enlace directo:*`,
          data.url
        ].join('\n')
      )
    } catch (err) {
      console.error('[upload]', err)
      await reply(`❌ Error al subir el archivo:\n${err.message}`)
    }
  }
}
L