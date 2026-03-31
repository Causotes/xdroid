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
    pingThumbnail: 'https://adofiles.i11.eu/dl/9f78f366.jpg',
    updateThumbnail: 'https://adofiles.i11.eu/dl/9f78f366.jpg',
    eventsBanner: 'https://adofiles.i11.eu/dl/14ce36bb.jpg',
    defaultProfile: 'https://adofiles.i11.eu/dl/9f78f366.jpg'
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
