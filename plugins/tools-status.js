import os from 'os'
import { execSync } from 'child_process'
import { formatBytes, formatUptime } from '../lib/helpers.js'

function getDiskInfo() {
  try {
    const raw = execSync('df -k / | tail -1').toString().trim().split(/\s+/)
    return {
      total: Number.parseInt(raw[1], 10) * 1024,
      used: Number.parseInt(raw[2], 10) * 1024,
      free: Number.parseInt(raw[3], 10) * 1024
    }
  } catch {
    return { total: 0, used: 0, free: 0 }
  }
}

export default {
  command: 'ping',
  aliases: ['p', 'status', 'speed'],
  category: 'herramientas',
  description: 'Muestra el ping y el estado del servidor',
  usage: '.ping',
  async run({ invokedAs, reply, config }) {
    const isStatus = invokedAs === 'status'
    const start = Date.now()

    const totalMem = os.totalmem()
    const freeMem = os.freemem()
    const usedMem = totalMem - freeMem
    const botMem = process.memoryUsage()
    const cpus = os.cpus() || []
    const cpuModel = cpus[0]?.model || 'Desconocido'
    const cpuCores = cpus.length || 0
    const loadAvg = os.loadavg()
    const pingMs = Date.now() - start
    const disk = getDiskInfo()
    const pingStatus = pingMs < 150 ? '🟢 excelente' : pingMs < 400 ? '🟡 buena' : '🔴 normal'

    const text = !isStatus
      ? [
          '🌿 *Ping*',
          `› latencia  ${pingMs} ms · ${pingStatus}`,
          `› ram       ${(usedMem / 1073741824).toFixed(1)} / ${(totalMem / 1073741824).toFixed(1)} gb`,
          `› disco     ${(disk.used / 1073741824).toFixed(1)} / ${(disk.total / 1073741824).toFixed(1)} gb`
        ].join('\n')
      : [
          '🌿 *Estado del servidor*',
          '',
          `› latencia   ${pingMs} ms · ${pingStatus}`,
          `› uptime     ${formatUptime(process.uptime())}`,
          '',
          '🍃 *Sistema*',
          `› hostname   ${os.hostname()}`,
          `› so         ${os.platform()} ${os.release()} (${os.arch()})`,
          `› node.js    ${process.version}`,
          '',
          '🌱 *CPU*',
          `› modelo     ${cpuModel}`,
          `› núcleos    ${cpuCores}`,
          `› carga      ${loadAvg.map(value => value.toFixed(2)).join(' · ')}`,
          '',
          '🌾 *Ram servidor*',
          `› usada      ${formatBytes(usedMem)}`,
          `› libre      ${formatBytes(freeMem)}`,
          `› total      ${formatBytes(totalMem)}`,
          '',
          '🍀 *Disco*',
          `› usado      ${formatBytes(disk.used)}`,
          `› libre      ${formatBytes(disk.free)}`,
          `› total      ${formatBytes(disk.total)}`,
          '',
          '🌲 *Ram bot*',
          `› rss        ${formatBytes(botMem.rss)}`,
          `› heap usado ${formatBytes(botMem.heapUsed)}`,
          `› heap total ${formatBytes(botMem.heapTotal)}`
        ].join('\n')

    await reply(text, {
      contextInfo: {
        externalAdReply: {
          title: isStatus ? '🌿 Estado del Servidor' : '🌿 Ping',
          body: '',
          mediaType: 1,
          thumbnailUrl: config.media.pingThumbnail,
          sourceUrl: '',
          renderLargerThumbnail: true
        }
      }
    })
  }
}
