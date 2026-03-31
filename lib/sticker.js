import fs from 'fs'
import os from 'os'
import path from 'path'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { downloadContentFromMessage } from 'bail'
import webpmux from 'node-webpmux'
import config from '../config.js'
import { getQuotedMessage, truncate } from './helpers.js'

const { Image: WebpImage } = webpmux
const execFileAsync = promisify(execFile)

function getMime(message, type) {
  try {
    const media = message[type]
    return media?.mimetype || media?.mimeType || ''
  } catch {
    return ''
  }
}

function guessImageExtension(mime) {
  if (/png/i.test(mime)) return 'png'
  if (/jpe?g/i.test(mime)) return 'jpg'
  if (/webp/i.test(mime)) return 'webp'
  if (/gif/i.test(mime)) return 'gif'
  return 'jpg'
}

function guessVideoExtension(mime) {
  if (/mp4/i.test(mime)) return 'mp4'
  if (/webm/i.test(mime)) return 'webm'
  if (/3gpp/i.test(mime)) return '3gp'
  if (/mkv/i.test(mime)) return 'mkv'
  return 'mp4'
}

function buildExif(packname, author) {
  const json = {
    'sticker-pack-id': 'xdroid-causotes',
    'sticker-pack-name': String(packname || ''),
    'sticker-pack-publisher': String(author || ''),
    emojis: ['✨']
  }

  const exifAttr = Buffer.from([
    0x49, 0x49, 0x2A, 0x00, 0x08, 0x00, 0x00, 0x00,
    0x01, 0x00, 0x41, 0x57, 0x07, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x16, 0x00, 0x00, 0x00
  ])

  const jsonBuffer = Buffer.from(JSON.stringify(json), 'utf8')
  const exif = Buffer.concat([exifAttr, jsonBuffer])
  exif.writeUIntLE(jsonBuffer.length, 14, 4)
  exif.writeUIntLE(exifAttr.length, 18, 4)
  return exif
}

async function addStickerExif(buffer, packname, author) {
  const image = new WebpImage()
  await image.load(buffer)
  image.exif = buildExif(packname, author)
  return await image.save(null)
}

async function runFfmpeg(args) {
  try {
    await execFileAsync('ffmpeg', args, { windowsHide: true })
  } catch (error) {
    const stderr = error?.stderr ? String(error.stderr) : ''
    throw new Error(stderr || error?.message || 'ffmpeg error')
  }
}

async function toWebpImage(input, output) {
  await runFfmpeg([
    '-y',
    '-i', input,
    '-vf',
    'scale=512:512:force_original_aspect_ratio=decrease,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=0x00000000,format=rgba',
    '-vcodec', 'libwebp',
    '-lossless', '0',
    '-q:v', '70',
    '-preset', 'picture',
    '-an',
    output
  ])
}

async function toWebpVideo(input, output) {
  await runFfmpeg([
    '-y',
    '-i', input,
    '-t', String(config.limits.ffmpegStickerSeconds),
    '-vf',
    'fps=15,scale=512:512:force_original_aspect_ratio=decrease,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=0x00000000,format=rgba',
    '-vcodec', 'libwebp',
    '-q:v', '60',
    '-preset', 'default',
    '-loop', '0',
    '-an',
    '-vsync', '0',
    output
  ])
}

async function downloadMedia(targetMessage) {
  const message = targetMessage?.message || {}

  let type = null
  if (message.imageMessage) type = 'image'
  else if (message.videoMessage) type = 'video'
  else if (message.stickerMessage) type = 'sticker'
  else if (message.documentMessage) type = 'document'
  else throw new Error('No media content')

  const content =
    type === 'image' ? message.imageMessage
    : type === 'video' ? message.videoMessage
    : type === 'sticker' ? message.stickerMessage
    : message.documentMessage

  const stream = await downloadContentFromMessage(content, type)
  const chunks = []
  for await (const chunk of stream) chunks.push(chunk)
  return Buffer.concat(chunks)
}

function safeRemove(target) {
  try {
    fs.rmSync(target, { recursive: true, force: true })
  } catch {}
}

export async function buildStickerFromMessage(m) {
  const quoted = getQuotedMessage(m)
  const target = quoted || m
  const message = target?.message || {}

  const hasImage = !!message.imageMessage
  const hasVideo = !!message.videoMessage
  const hasSticker = !!message.stickerMessage
  const hasDocument = !!message.documentMessage

  if (!hasImage && !hasVideo && !hasSticker && !hasDocument) {
    throw new Error('🌳 *Uso:* responde a una *imagen, video, gif* con *.s*')
  }

  const type = hasImage ? 'imageMessage' : hasVideo ? 'videoMessage' : hasSticker ? 'stickerMessage' : 'documentMessage'
  let mime = getMime(message, type)

  if (type === 'documentMessage') {
    const isMediaDocument = /^image\//i.test(mime) || /^video\//i.test(mime)
    if (!isMediaDocument) {
      throw new Error('🐢 Responde a una *imagen/video/gif* para crear un sticker.')
    }
  }

  if (!mime) {
    throw new Error('📍 *Algo salió mal, no se pudo detectar el tipo de archivo.*')
  }

  const isWebp = /image\/webp/i.test(mime)
  const isImage = /^image\//i.test(mime)
  const isVideo = /^video\//i.test(mime)

  if (!isWebp && !isImage && !isVideo) {
    throw new Error('🦞 Solo puedes responder a una *imagen / video / gif / webp*.')
  }

  const mediaBuffer = await downloadMedia(target)
  if (!mediaBuffer?.length) throw new Error('🌾 No se pudo descargar el archivo.')

  if (isWebp) {
    try {
      return await addStickerExif(mediaBuffer, config.bot.packageName, config.bot.packageAuthor)
    } catch {
      return mediaBuffer
    }
  }

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'xdroid-stk-'))
  const inputPath = path.join(tempDir, `input.${isImage ? guessImageExtension(mime) : guessVideoExtension(mime)}`)
  const outputPath = path.join(tempDir, 'output.webp')

  try {
    fs.writeFileSync(inputPath, mediaBuffer)
    if (isImage) await toWebpImage(inputPath, outputPath)
    else await toWebpVideo(inputPath, outputPath)

    const webp = fs.readFileSync(outputPath)
    return await addStickerExif(webp, config.bot.packageName, config.bot.packageAuthor)
  } catch (error) {
    throw new Error(`📍 Failed with ffmpeg:\n${truncate(error?.message || error, 3500)}`)
  } finally {
    safeRemove(tempDir)
  }
}
