import yts from 'yt-search'

function isYouTubeUrl(value = '') {
  return /(?:youtube\.com|youtu\.be)/i.test(String(value))
}

function extractYouTubeVideoId(input = '') {
  const value = String(input || '').trim()

  try {
    const url = new URL(value)
    const host = url.hostname.replace(/^www\./i, '').toLowerCase()

    if (host === 'youtu.be') {
      return url.pathname.split('/').filter(Boolean)[0] || ''
    }

    if (
      host === 'youtube.com' ||
      host === 'm.youtube.com' ||
      host === 'music.youtube.com'
    ) {
      if (url.searchParams.get('v')) return url.searchParams.get('v') || ''

      const parts = url.pathname.split('/').filter(Boolean)

      const shortsIndex = parts.indexOf('shorts')
      if (shortsIndex !== -1) return parts[shortsIndex + 1] || ''

      const embedIndex = parts.indexOf('embed')
      if (embedIndex !== -1) return parts[embedIndex + 1] || ''
    }
  } catch {}

  return ''
}

function normalizeVideo(result) {
  if (!result) return null
  if (Array.isArray(result?.videos)) return result.videos[0] || null
  if (Array.isArray(result)) return result[0] || null
  if (result?.url || result?.videoId || result?.title) return result
  return null
}

function formatViews(views) {
  const value = Number(views || 0)
  if (!value) return 'Desconocidas'
  return new Intl.NumberFormat('es-ES').format(value)
}

function pickAuthor(video = {}) {
  return (
    video?.author?.name ||
    video?.author?.user ||
    video?.author ||
    video?.channel?.name ||
    video?.channel ||
    'Desconocido'
  )
}

function pickDuration(video = {}, apiResult = {}) {
  return (
    apiResult?.duracion ||
    video?.timestamp ||
    video?.duration?.timestamp ||
    video?.duration?.toString?.() ||
    'Desconocida'
  )
}

function pickThumbnail(video = {}, apiResult = {}) {
  return (
    apiResult?.miniatura ||
    video?.thumbnail ||
    video?.image ||
    video?.thumbnailUrl ||
    null
  )
}

function truncate(text = '', max = 120) {
  const value = String(text || '').trim()
  return value.length > max ? `${value.slice(0, max - 3)}...` : value
}

async function resolveVideoData(input) {
  const text = String(input || '').trim()

  if (isYouTubeUrl(text)) {
    const videoId = extractYouTubeVideoId(text)

    if (videoId) {
      try {
        const result = await yts({ videoId })
        const video = normalizeVideo(result)
        if (video) return video
      } catch {}
    }

    try {
      const result = await yts(text)
      const video = normalizeVideo(result)
      if (video) return video
    } catch {}

    return {
      title: 'Audio de YouTube',
      url: text,
      timestamp: 'Desconocida',
      views: 0,
      author: { name: 'Desconocido' }
    }
  }

  const result = await yts(text)
  const video = normalizeVideo(result)
  if (!video) throw new Error('No encontré resultados en YouTube.')
  return video
}

async function getAudioData(videoUrl) {
  const endpoint = `https://apiaxi.i11.eu/down/ytaudio?url=${encodeURIComponent(videoUrl)}`
  const response = await fetch(endpoint)

  if (!response.ok) {
    const err = await response.text().catch(() => '')
    throw new Error(`HTTP ${response.status}${err ? `: ${err}` : ''}`)
  }

  const json = await response.json()

  if (!json?.status || !json?.resultado?.url_dl) {
    throw new Error('La API no devolvió un audio válido.')
  }

  return json.resultado
}

export default {
  command: 'play',
  aliases: ['yt', 'playaudio'],
  category: 'descargas',
  description: 'Descarga un vídeo de YouTube en audio por nombre o link.',
  usage: '.play <nombre o link de YouTube>',

  async run({ sock, m, from, input, reply, react }) {
    const query = String(input || '').trim()

    if (!query) {
      return await reply(
        [
          '🪴 *Uso del comando*',
          '',
          '› escribe un nombre o pega un link de YouTube',
          '› ejemplo: *.play humbe karma*',
          '› ejemplo: *.play https://youtu.be/xxxx*'
        ].join('\n')
      )
    }

    try {
      await react?.('🕑')

      const video = await resolveVideoData(query)
      const videoUrl = video?.url || query

      const audioData = await getAudioData(videoUrl)

      const title = audioData?.titulo || video?.title || 'Audio de YouTube'
      const duration = pickDuration(video, audioData)
      const author = pickAuthor(video)
      const views = formatViews(video?.views)
      const thumb = pickThumbnail(video, audioData)
      const audioUrl = audioData?.url_dl

      if (!audioUrl) {
        throw new Error('No se obtuvo el enlace de descarga del audio.')
      }

      const caption = [
        '🍄 *Downloads YouTube*',
        '',
        `› título     ${truncate(title, 140)}`,
        `› duración   ${duration}`,
        `› canal      ${truncate(author, 60)}`,
        `› vistas     ${views}`,
        '',
        '🌾 *Enlace*',
        videoUrl
      ].join('\n')

      if (thumb) {
        await sock.sendMessage(
          from,
          {
            image: { url: thumb },
            caption
          },
          { quoted: m }
        )
      } else {
        await reply(caption)
      }

      await sock.sendMessage(
        from,
        {
          audio: { url: audioUrl },
          mimetype: 'audio/mpeg',
          ptt: true,
          fileName: `${truncate(title, 80)}.mp3`
        },
        { quoted: m }
      )

      await react?.('✅')
    } catch (error) {
      console.error('[play]', error)
      await react?.('❌')
      await reply(
        [
          '🌾 *_Error en play_*',
          String(error?.message || error || 'Error desconocido')
        ].join('\n')
      )
    }
  }
}