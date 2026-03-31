import { eventLabel, getGroupEvents, listEvents, normalizeEventName, setAllGroupEvents, setGroupEvent } from '../lib/group-events.js'

function stateBadge(value) {
  return value ? 'Encendido' : 'Apagado'
}

function panelText(state = {}) {
  return [
    `◦ *Antilink:* ${stateBadge(state.antilink)}`,
    `◦ *Welcome:* ${stateBadge(state.welcome)}`,
    `◦ *Avisos:* ${stateBadge(state.avisos)}`
  ].join('\n')
}

function usageText(prefix = '.') {
  return [
    '📍 *_Uso:_*',
    `◦ ${prefix}on antilink|welcome|avisos|all`,
    `◦ ${prefix}off antilink|welcome|avisos|all`
  ].join('\n')
}

export default {
  command: 'on',
  aliases: ['off'],
  category: 'grupo',
  description: 'Activa o desactiva eventos del grupo',
  usage: '.on antilink',
  groupOnly: true,
  userAdminOnly: true,
  async run({ invokedAs, args, reply, from, config }) {
    const enable = invokedAs === 'on'
    const target = String(args?.[0] || '').toLowerCase().trim()
    const current = await getGroupEvents(from)

    if (!target) {
      return await reply([
        '🌾 *Panel de Eventos*',
        panelText(current),
        '',
        usageText(config.prefix),
        '',
        `🌵 *Disponibles:* ${listEvents().join(', ')}`
      ].join('\n'))
    }

    if (['all', 'todo', 'todos'].includes(target)) {
      const updated = await setAllGroupEvents(from, enable)
      return await reply([
        enable ? '🌴 *_Eventos activados_*' : '🌾 *_Eventos desactivados_*',
        `◦ *Modo:* ${stateBadge(enable)}`,
        '',
        '🫟 *Panel actual*',
        panelText(updated)
      ].join('\n'))
    }

    const event = normalizeEventName(target)
    if (!event) {
      return await reply([
        '🌾 *_Evento inválido_*',
        `◦ *Disponibles:* ${listEvents().join(', ')}`,
        '',
        usageText(config.prefix)
      ].join('\n'))
    }

    if (!!current[event] === enable) {
      return await reply([
        `🐢 *_${eventLabel(event)} ya estaba ${enable ? 'activado' : 'desactivado'}_*`,
        '',
        '🫟 *Panel actual*',
        panelText(current)
      ].join('\n'))
    }

    const updated = await setGroupEvent(from, event, enable)

    await reply([
      enable ? '🌴 *_Evento activado_*' : '🌾 *_Evento desactivado_*',
      `◦ *Evento:* ${eventLabel(event)}`,
      `◦ *Estado:* ${stateBadge(updated[event])}`,
      '',
      '🫟 *Panel actual*',
      panelText(updated)
    ].join('\n'))
  }
}
