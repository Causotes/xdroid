import * as bail from 'bail'
import { formatBytes, getQuotedMessage } from '../lib/helpers.js'

const VALID_EXPIRATIONS = new Set(['24h', '7d', '30d', 'never'])

const EXPIRATION_LABELS = {
  '24h': 'En 24 horas',
  '7d': 'En 7 días',
  '30d': 'En 30 días',
  never: 'Nunca'
}

function getMediaInfo(message = {}) {
  if (message.imageMessage) {
    return {
      node: message.imageMessage,
      type: 'image',
      mimetype: message.imageMessage.mimetype || 'image/jpeg',
      fileName: message.imageMessage.fileName || null
    }
  }

  if (message.videoMessage) {
    return {
      node: message.videoMessage,
      type: 'video',
      mimetype: message.videoMessage.mimetype || 'video/mp4',
      fileName: message.videoMessage.fileName || null
    }
  }

  if (message.audioMessage) {
    return {
      node: message.audioMessage,
      type: 'audio',
      mimetype: message.audioMessage.mimetype || 'audio/mpeg',
      fileName: message.audioMessage.fileName || null
    }
  }

  if (message.documentMessage) {
    return {
      node: message.documentMessage,
      type: 'document',
      mimetype: message.documentMessage.mimetype || 'application/octet-stream',
      fileName: message.documentMessage.fileName || null
    }
  }

  if (message.stickerMessage) {
    return {
      node: message.stickerMessage,
      type: 'sticker',
      mimetype: message.stickerMessage.mimetype || 'image/webp',
      fileName: message.stickerMessage.fileName || 'sticker.webp'
    }
  }

  return null
}

function extensionFromMime(mimetype = '') {
  const clean = String(mimetype).split(';')[0].trim().toLowerCase()

  const map = {
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/gif': 'gif',
    'video/mp4': 'mp4',
    'video/webm': 'webm',
    'video/3gpp': '3gp',
    'audio/mpeg': 'mp3',
    'audio/mp3': 'mp3',
    'audio/ogg': 'ogg',
    'audio/mp4': 'm4a',
    'audio/aac': 'aac',
    'application/pdf': 'pdf',
    'text/plain': 'txt',
    'application/zip': 'zip',
    'application/x-rar-compressed': 'rar'
  }

  if (map[clean]) return map[clean]

  const rawExt = clean.split('/')[1] || 'bin'
  return rawExt.replace(/[^a-z0-9]/gi, '') || 'bin'
}

function resolveFileName(media) {
  if (media?.fileName) return media.fileName
  return `archivo.${extensionFromMime(media?.mimetype)}`
}

async function downloadToBuffer(media) {
  const stream = await bail.downloadContentFromMessage(media.node, media.type)
  const chunks = []

  for await (const chunk of stream) {
    chunks.push(chunk)
  }

  return Buffer.concat(chunks)
}

export default {
  command: 'upload',
  aliases: ['up', 'subir'],
  category: 'herramientas',
  description: 'Sube una imagen o archivo a un cdn.',
  usage: '.upload [reply a media] [24h|7d|30d|never]',

  async run({ m, reply, args, react, config }) {
    const quoted = getQuotedMessage(m)
    const target = quoted || m
    const media = getMediaInfo(target?.message || {})

    if (!media) {
  return await reply(
    [
      '🪴 *Uso del comando*',
      '',
      '› responde a una *imagen, video, audio, sticker o documento*',
      '› luego usa: *.upload [24h|7d|30d|never]*'
    ].join('\n')
  )
}

    const requestedExpiration = String(args?.[0] || '').trim().toLowerCase()
    const expiration = VALID_EXPIRATIONS.has(requestedExpiration) ? requestedExpiration : '24h'

    try {
      await react?.('🕑')

      const buffer = await downloadToBuffer(media)
      if (!buffer?.length) throw new Error('No se pudo descargar el archivo.')

      const filename = resolveFileName(media)

      const response = await fetch('https://adofiles.i11.eu/api/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filename,
          data: buffer.toString('base64'),
          mimetype: media.mimetype,
          expiration
        })
      })

      if (!response.ok) {
        const errorText = await response.text().catch(() => '')
        throw new Error(`HTTP ${response.status}${errorText ? `: ${errorText}` : ''}`)
      }

      const data = await response.json()
      const fileUrl = data?.url || data?.link || ''
      if (!fileUrl) throw new Error('La API no devolvió un enlace válido.')

      const fileSize = Number(data?.size || buffer.length || 0)
      const originalName = data?.originalName || filename
      const fileType = data?.type || media.mimetype
      const expirationText = EXPIRATION_LABELS[expiration] || expiration

      await react?.('✅')

      await reply(
        [
          '🌿 *Archivo subido*',
          '',
          `› nombre     ${originalName}`,
          `› tamaño     ${formatBytes(fileSize)}`,
          `› tipo       ${fileType}`,
          `› expira     ${expirationText}`,
          '',
          '🍃 *Enlace directo*',
          fileUrl
        ].join('\n'),
        {
          contextInfo: {
            externalAdReply: {
              title: '🍄 Upload To Adofiles',
              body: '',
              mediaType: 1,
              thumbnailUrl: config.media.updateThumbnail || config.media.pingThumbnail,
              sourceUrl: fileUrl,
              renderLargerThumbnail: true
            }
          }
        }
      )
    } catch (error) {
      console.error('[upload]', error)
      await react?.('❌')

      await reply(
        [
          '🌾 *_Error al subir el archivo_*',
          String(error?.message || error || 'Error desconocido')
        ].join('\n')
      )
    }
  }
}