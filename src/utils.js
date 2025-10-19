const axios = require('axios')
const DECODER = 'https://dec.eatmynerds.live'

async function decodeUrl(url) {
  try {
    const endpoint = `${DECODER}?url=${encodeURIComponent(url)}`
    console.log('[src/utils.decodeUrl] fetching', endpoint)
    const resp = await axios.get(endpoint, { headers: { 'Referer': 'https://flixhq.to' }, timeout: 15000 })
    console.log('[src/utils.decodeUrl] decoder resp.status=', resp.status)
    const data = resp.data
    if (resp.status === 200) {
      try {
        if (data && typeof data === 'object') console.log('[src/utils.decodeUrl] decoder data keys=', Object.keys(data).slice(0,10))
        else console.log('[src/utils.decodeUrl] decoder data preview=', String(data).slice(0,500))
      } catch (e) {}
      if (data && data.sources && data.sources.length) {
        const file = data.sources[0].file
        const subs = (data.tracks||[]).filter(t=>t.kind==='captions'&&t.file).map(t=>t.file)
        return [file, subs]
      }
      if (data && (data.link || data.url || data.file)) return [data.link||data.url||data.file, []]
      const txt = typeof data === 'string' ? data : JSON.stringify(data)
      const m = txt.match(/"file":"([^\"]*\.m3u8[^\"]*)"/)
      if (m) return [m[1], []]
    }
  } catch (err) {
    console.error('[src/utils.decodeUrl] error', err && err.message)
  }
  return [url, []]
}

module.exports = { decodeUrl }
