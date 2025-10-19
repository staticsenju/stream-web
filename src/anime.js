const crypto = require('crypto')
const { URL } = require('url')
const cheerio = require('cheerio')
const vm = require('vm')
const os = require('os')
const path = require('path')
const fs = require('fs')

const DEFAULT_HEADERS = {
  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  'accept': '*/*',
  'accept-language': 'en-US,en;q=0.9',
  'cache-control': 'no-cache',
  'pragma': 'no-cache'
}

const HOST = 'https://animepahe.si'
const API_URL = `${HOST}/api`
const REFERER = HOST

function genCookie() { return `__ddg2_=${crypto.randomBytes(12).toString('hex')}` }

async function httpGet(url, { headers = {}, signal } = {}) {
  const res = await fetch(url, { headers: { ...DEFAULT_HEADERS, ...headers }, redirect: 'follow', signal })
  if (!res.ok) throw new Error(`GET ${url} ${res.status}`)
  return res
}
async function httpText(url, opts) { const res = await httpGet(url, opts); return await res.text() }

async function searchAnime(q, cookie) {
  const url = `${API_URL}?m=search&q=${encodeURIComponent(q)}`
  const res = await httpGet(url, { headers: { cookie } })
  return await res.json()
}

async function getReleasePage(slug, page, cookie) {
  const url = `${API_URL}?m=release&id=${encodeURIComponent(slug)}&sort=episode_asc&page=${page}`
  const res = await httpGet(url, { headers: { cookie } })
  return await res.json()
}
async function getAllEpisodes(slug, cookie) {
  const first = await getReleasePage(slug, 1, cookie)
  let data = first.data || []
  const last = first.last_page || 1
  if (last > 1) {
    const tasks = []
    for (let p = 2; p <= last; p++) tasks.push(getReleasePage(slug, p, cookie))
    const pages = await Promise.all(tasks)
    for (const pg of pages) data = data.concat(pg.data || [])
  }
  data.sort((a, b) => Number(a.episode) - Number(b.episode))
  return data
}

function extractEvalScript(html) {
  const $ = cheerio.load(html)
  const scripts = $('script').map((_, s) => $(s).html() || '').get()
  for (const sc of scripts) {
    if (!sc) continue
    if (sc.includes('eval(')) return sc
    if (sc.includes('source=') && sc.includes('.m3u8')) return sc
  }
  return ''
}
function transformEvalScript(sc) { return sc.replace(/document/g, 'process').replace(/window/g, 'globalThis').replace(/querySelector/g, 'exit').replace(/eval\(/g, 'console.log(') }
function parseSourceFromLogs(out) {
  const lines = out.split('\n')
  for (const line of lines) {
    const m = line.match(/(?:var|let|const)\s+source\s*=\s*['"]([^'\"]+\.m3u8)['"]/)
    if (m) return m[1]
    const any = line.match(/https?:\/\/[^\"]*?\.m3u8/i)
    if (any) return any[0]
  }
  return ''
}

async function getEpisodeM3U8({ slug, episode, audio, resolution, cookie }) {
  const episodes = await getAllEpisodes(slug, cookie)
  const ep = episodes.find(e => Number(e.episode) === Number(episode))
  if (!ep) return ''
  const playUrl = `${HOST}/play/${encodeURIComponent(slug)}/${ep.session}`
  const html = await httpText(playUrl, { headers: { cookie, Referer: REFERER } })
  const $ = cheerio.load(html)
  const buttons = []
  $('button[data-src]').each((_, el) => {
    const e = $(el)
    buttons.push({
      audio: (e.attr('data-audio')||'').toLowerCase(),
      resolution: e.attr('data-resolution')||'',
      av1: e.attr('data-av1')||'',
      src: e.attr('data-src')||''
    })
  })
  let chosen = null
  if (audio || resolution) {
    chosen = buttons.find(b => (audio ? (b.audio === String(audio).toLowerCase()) : true) && (resolution ? (String(b.resolution) === String(resolution)) : true))
  }
  if (!chosen) chosen = buttons[0] || null
  if (!chosen || !chosen.src) return ''
  const kwikHtml = await httpText(chosen.src, { headers: { cookie, Referer: REFERER } })
  const raw = extractEvalScript(kwikHtml)
  if (!raw) return ''
  const transformed = transformEvalScript(raw)
  let output = ''
  const context = { console: { log: (...a) => { output += a.join(' ') + '\n' } }, atob: (b) => Buffer.from(b, 'base64').toString('binary'), btoa: (s) => Buffer.from(s, 'binary').toString('base64'), process: {}, globalThis: {}, navigator: { userAgent: DEFAULT_HEADERS['user-agent'] } }
  try { vm.createContext(context); new vm.Script(transformed).runInContext(context, { timeout: 2000 }) } catch {}
  const m3u8 = parseSourceFromLogs(output)
  return m3u8
}

async function getEpisodeOptions({ slug, episode, cookie }) {
  const episodes = await getAllEpisodes(slug, cookie)
  const ep = episodes.find(e => Number(e.episode) === Number(episode))
  if (!ep) return []
  const playUrl = `${HOST}/play/${encodeURIComponent(slug)}/${ep.session}`
  const html = await httpText(playUrl, { headers: { cookie, Referer: REFERER } })
  const $ = cheerio.load(html)
  const out = []
  $('button[data-src]').each((_, el) => {
    const e = $(el)
    out.push({
      audio: (e.attr('data-audio')||'').toLowerCase(),
      resolution: e.attr('data-resolution')||'',
      av1: e.attr('data-av1')||'',
      src: e.attr('data-src')||''
    })
  })
  return out
}

module.exports = { searchAnime, getAllEpisodes, getEpisodeM3U8, getEpisodeOptions, genCookie }
