const config = {
  prefix: '.',
  sessionDir: './sesiones',
  databasePath: './lib/xdroid.json',
  legacyGroupEventsPath: './lib/group-events.json',
  browser: ['Ubuntu', 'Chrome', '120.0.0.0'],
  pairing: {
    enabled: true,
    phoneNumber: ''
  },
  owners: ['573135180876', '50498273976'],
  bot: {
    name: 'XDroid',
    packageName: '🌵 XDroid',
    packageAuthor: '• 𝗺ᴀᴅᴇ ʙʏ causotes'
  },
  media: {
    pingThumbnail: 'https://adofiles.i11.eu/dl/jf7f.jpg',
    updateThumbnail: 'https://adofiles.i11.eu/dl/xutg.png',
    eventsBanner: 'https://adofiles.i11.eu/dl/031n.jpeg',
    defaultProfile: 'http://adofiles.i11.eu/dl/zm06.jpg'
  },
  limits: {
    reconnectAttempts: 15,
    antilinkWarnings: 2,
    ffmpegStickerSeconds: 10,
    commandReplyLength: 3800,
    updateReplyLength: 1200
  }
}

export default config
