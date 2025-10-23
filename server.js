const express = require('express')
const path = require('path')
const axios = require('axios')
const https = require('https')

const { decodeUrl } = require('./src/utils.js')
const animeProxy = require('./src/anime.js')
const DECODER = 'https://dec.eatmynerds.live'

const app = express()
const PORT = process.env.PORT || 3000
const http = require('http')
const server = http.createServer(app)
const { Server } = require('socket.io')

const rooms = {}

app.use(express.static(path.join(__dirname, 'web')))

app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  if (req.method === 'OPTIONS') return res.sendStatus(200)
  next()
})

app.get('/proxy/decoder', async (req, res) => {
  const url = req.query.url
  if (!url) return res.status(400).json({ error: 'url required' })
  console.log('[proxy/decoder] request for', url)
  const start = Date.now()
  try {
    const [file, subs] = await decodeUrl(url)
    const took = Date.now() - start
    console.log('[proxy/decoder] result', { file, subsCount: (subs && subs.length) || 0, tookMs: took })
    if (!file || file === url) {
      console.warn('[proxy/decoder] decoder did not resolve a m3u8 (echoed input) — returning 502 to trigger client fallback')
      return res.status(502).json({ error: 'decoder failed', file })
    }
    return res.json({ file, subs })
  } catch (err) {
    const msg = err && err.message ? err.message : 'unknown error'
    console.error('[proxy/decoder] error', msg)
    return res.status(500).json({ error: msg })
  }
})

app.get('/proxy/fetch', async (req, res) => {
  const url = req.query.url
  if (!url) return res.status(400).send('url required')
  try {
    const resp = await axiosGetWithInsecureFallback(url, { headers: { 'User-Agent': 'stream-web', Referer: req.query.ref || '' }, responseType: 'text', timeout: 20000 })
    res.set('Content-Type', 'text/plain')
    res.send(resp.data)
  } catch (e) {
    const msg = e && e.message ? e.message : 'unknown error'
    res.status(500).send(msg)
  }
})

app.get('/proxy/anime/search', async (req, res) => {
  const q = req.query.q
  if (!q) return res.status(400).json({ error: 'q required' })
  try {
    const cookie = animeProxy.genCookie()
    const data = await animeProxy.searchAnime(q, cookie)
    return res.json(data)
  } catch (e) {
    console.error('[proxy/anime/search] error', e && e.message)
    return res.status(500).json({ error: e && e.message ? e.message : 'unknown' })
  }
})

app.get('/proxy/anime/episodes', async (req, res) => {
  const slug = req.query.slug
  if (!slug) return res.status(400).json({ error: 'slug required' })
  try {
    const cookie = animeProxy.genCookie()
    const eps = await animeProxy.getAllEpisodes(slug, cookie)
    return res.json({ data: eps })
  } catch (e) {
    console.error('[proxy/anime/episodes] error', e && e.message)
    return res.status(500).json({ error: e && e.message ? e.message : 'unknown' })
  }
})

app.get('/proxy/anime/m3u8', async (req, res) => {
  const { slug, episode, audio, resolution } = req.query
  if (!slug || !episode) return res.status(400).json({ error: 'slug and episode required' })
  try {
    const cookie = animeProxy.genCookie()
    const m3u8 = await animeProxy.getEpisodeM3U8({ slug, episode, audio, resolution, cookie })
    if (!m3u8) return res.status(404).json({ error: 'not found' })
    return res.json({ file: m3u8 })
  } catch (e) {
    console.error('[proxy/anime/m3u8] error', e && e.message)
    return res.status(500).json({ error: e && e.message ? e.message : 'unknown' })
  }
})

app.get('/proxy/anime/options', async (req, res) => {
  const { slug, episode } = req.query
  if (!slug || !episode) return res.status(400).json({ error: 'slug and episode required' })
  try {
    const cookie = animeProxy.genCookie()
    const opts = await animeProxy.getEpisodeOptions({ slug, episode, cookie })
    return res.json({ data: opts })
  } catch (e) {
    console.error('[proxy/anime/options] error', e && e.message)
    return res.status(500).json({ error: e && e.message ? e.message : 'unknown' })
  }
})

app.get('/proxy/manifest', async (req, res) => {
  const url = req.query.url
  if (!url) return res.status(400).send('url required')
  try {
    const resp = await axiosGetWithInsecureFallback(url, { headers: { Referer: req.query.ref || '' , 'User-Agent': 'streamweb-web' }, responseType: 'text', timeout: 20000 })
    const base = url
    const lines = String(resp.data).split(/\r?\n/)
    const out = lines.map(line => {
      if (!line || line.startsWith('#')) return line
      try {
        const abs = new URL(line, base).toString()
        if (/\.m3u8(\?|$)/i.test(abs)) return `/proxy/manifest?url=${encodeURIComponent(abs)}&ref=${encodeURIComponent(base)}`
        return `/proxy/segment?url=${encodeURIComponent(abs)}&ref=${encodeURIComponent(base)}`
      } catch (e) {
        return line
      }
    }).join('\n')
    res.setHeader('Content-Type', 'application/vnd.apple.mpegurl')
    res.send(out)
  } catch (e) {
    const msg = e && e.message ? e.message : 'unknown error'
    res.status(500).send(msg)
  }
})

app.get('/proxy/segment', async (req, res) => {
  const url = req.query.url
  if (!url) return res.status(400).send('url required')
  try {
    const streamResp = await axiosGetWithInsecureFallback(url, { headers: { Referer: req.query.ref || '', 'User-Agent': 'stream-web' }, responseType: 'stream', timeout: 20000 })
    if (streamResp.headers['content-type']) res.setHeader('Content-Type', streamResp.headers['content-type'])
    res.setHeader('Access-Control-Allow-Origin', '*')
    streamResp.data.pipe(res)
  } catch (e) {
    const msg = e && e.message ? e.message : 'unknown error'
    res.status(500).send(msg)
  }
})

app.get('/proxy/image', async (req, res) => {
  const url = req.query.url
  if (!url) return res.status(400).send('url required')
  try {
    const resp = await axiosGetWithInsecureFallback(url, { headers: { Referer: req.query.ref || '', 'User-Agent': 'stream-web' }, responseType: 'stream', timeout: 20000 })
    if (resp.headers['content-type']) res.setHeader('Content-Type', resp.headers['content-type'])
    res.setHeader('Access-Control-Allow-Origin', '*')
    resp.data.pipe(res)
  } catch (e) {
    const msg = e && e.message ? e.message : 'unknown error'
    res.status(500).send(msg)
  }
})

app.get('/proxy/subtitle', async (req, res) => {
  const url = req.query.url
  if (!url) return res.status(400).send('url required')
  try {
    const resp = await axiosGetWithInsecureFallback(url, { headers: { Referer: req.query.ref || '', 'User-Agent': 'stream-web' }, responseType: 'stream', timeout: 20000 })
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Content-Type', 'text/vtt')
    resp.data.pipe(res)
  } catch (e) {
    const msg = e && e.message ? e.message : 'unknown error'
    res.status(500).send(msg)
  }
})

async function axiosGetWithInsecureFallback(url, opts) {
  try {
    return await axios.get(url, opts)
  } catch (err) {
    const msg = err && err.message ? err.message.toLowerCase() : ''
    if (msg.includes('certificate') || msg.includes('self signed') || msg.includes('unable to get local issuer')) {
      try {
        const insecureAgent = new https.Agent({ rejectUnauthorized: false })
        const retry = Object.assign({}, opts, { httpsAgent: insecureAgent })
        console.warn('[axiosGetWithInsecureFallback] TLS error, retrying insecurely for', url)
        return await axios.get(url, retry)
      } catch (e2) {
        throw e2
      }
    }
    throw err
  }
}

function makeCode() {
  const letters = 'ABCDEFGHJKMNPQRSTUVWXYZ';
  let s = '';
  for (let i = 0; i < 6; i++) s += letters[Math.floor(Math.random() * letters.length)];
  return s;
}

app.post('/watch/create', express.json(), (req, res) => {
  let code = makeCode();
  let attempts = 0;
  while (rooms[code] && attempts++ < 5) code = makeCode();
  rooms[code] = { hostId: null, state: null }
  console.log('[watch] created party', code)
  return res.json({ code })
})

app.get('/watch/exists/:code', (req, res) => {
  const code = String(req.params.code || '').toUpperCase()
  if (!code) return res.status(400).json({ error: 'code required' })
  console.log('[watch] exists check', code, !!rooms[code])
  return res.json({ exists: !!rooms[code] })
})

server.listen(PORT, () => console.log(`[stream-web] listening at http://localhost:${PORT}`))

const io = new Server(server, { cors: { origin: '*', methods: ['GET','POST'] } })

io.on('connection', (socket) => {
  console.log('[socket] connected', socket.id)

  socket.on('disconnecting', (reason) => {
    console.log('[socket] disconnecting', socket.id, 'reason', reason)
  })

  socket.on('watch:join', (code, cb) => {
    try {
      code = String(code||'').toUpperCase()
      console.log('[watch] join request', { socket: socket.id, code })
      if (!code || !rooms[code]) return cb && cb({ error: 'not_found' })
      socket.join(code)
      const room = rooms[code]
      const payload = { state: room.state || null }
      socket.emit('watch:joined', payload)
      cb && cb({ ok: true })
      console.log('[watch] joined', { socket: socket.id, code, payload })
    } catch (e) { cb && cb({ error: 'exception' }) }
  })

  socket.on('watch:host', (code, isHost, cb) => {
    try {
      code = String(code||'').toUpperCase()
      if (!code) return cb && cb({ error: 'code required' })
      if (!rooms[code]) rooms[code] = { hostId: null, state: null }
      if (isHost) rooms[code].hostId = socket.id
      else if (rooms[code].hostId === socket.id) rooms[code].hostId = null
      const hostIs = rooms[code].hostId === socket.id
      cb && cb({ ok: true, host: hostIs })
      console.log('[watch] host toggle', { socket: socket.id, code, isHost, hostIs })
      try {
        io.to(code).emit('watch:host', { hostId: rooms[code].hostId })
      } catch (e) { console.warn('[watch] host broadcast failed', e) }
    } catch (e) { cb && cb({ error: 'exception' }) }
  })

  socket.on('watch:state', (code, state) => {
    try {
      code = String(code||'').toUpperCase()
      if (!code || !rooms[code]) return
      const enriched = Object.assign({}, state, { _ts: Date.now(), _from: socket.id })
      rooms[code].state = enriched
      socket.to(code).emit('watch:state', enriched)
      if (state && state.action === 'load') {
        const url = state.url || state.file || (state.last && state.last.file) || null
        const seasonId = state.seasonId || (state.meta && state.meta.seasonId) || null
        const episodeId = state.episodeId || (state.meta && state.meta.episodeId) || null
        const slug = state.slug || (state.meta && state.meta.slug) || null
        console.log('[watch] load', { from: socket.id, code, url, slug, seasonId, episodeId })
      } else {
        console.log('[watch] state from', socket.id, '->', code, state && state.action ? state.action : state)
      }
    } catch (e) {
      console.warn('[watch] state handler error', e && e.message)
    }
  })

  socket.on('disconnect', () => {
    try {
      for (const code of Object.keys(rooms)) {
        if (rooms[code].hostId === socket.id) rooms[code].hostId = null
      }
    } catch (e) {}
    console.log('[socket] disconnected', socket.id)
  })
})
