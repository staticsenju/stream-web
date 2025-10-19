const express = require('express')
const path = require('path')
const axios = require('axios')
const https = require('https')

const { decodeUrl } = require('./src/utils.js')
const animeProxy = require('./src/anime.js')
const DECODER = 'https://dec.eatmynerds.live'

const app = express()
const PORT = process.env.PORT || 3000

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

app.listen(PORT, () => console.log(`[stream-web] listening at http://localhost:${PORT}`))
