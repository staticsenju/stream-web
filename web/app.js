const browseBtn = document.getElementById('browseBtn')
const FLIXHQ_BASE = 'https://flixhq.to'
const apiProxy = (path) => `/proxy/fetch?url=${encodeURIComponent(path)}`
const decoderProxy = (url) => `/proxy/decoder?url=${encodeURIComponent(url)}`

const resultsGrid = document.getElementById('results')
const actionSelect = document.getElementById('actionSelect') || { value: 'play' }
const sourceSelect = document.getElementById('sourceSelect') || { value: 'anime' }
const videoEl = document.getElementById('video')
const titleEl = document.getElementById('title')
const audioSelect = document.getElementById('audio')
const resSelect = document.getElementById('res')
const skipFillersBtn = document.getElementById('skipFillers')
const recentWrap = document.getElementById('recent')
const recentEmpty = document.getElementById('recentEmpty')
let downloadLink = document.getElementById('downloadLink')
if (!downloadLink) { downloadLink = document.createElement('a'); downloadLink.id = 'downloadLink'; downloadLink.style.display = 'none'; downloadLink.textContent = 'Download'; if (videoEl && videoEl.parentNode) videoEl.parentNode.appendChild(downloadLink) }
const autoplayNext = document.getElementById('autoplayNext') || { checked: false }
const seasonsContainer = document.createElement('div')
seasonsContainer.id = 'seasons'
resultsGrid.appendChild(seasonsContainer)
const _existingEpisodes = document.getElementById('episodes')
const episodesContainer = _existingEpisodes || document.createElement('div')
episodesContainer.id = 'episodes'
if (!_existingEpisodes) resultsGrid.appendChild(episodesContainer)

function saveHistory(entry) {
  const h = JSON.parse(localStorage.getItem('streamweb_history')||'[]')
  const key = `${entry.url}::${entry.season||''}::${entry.episode||''}`
  const filtered = h.filter(a=>`${a.url}::${a.season||''}::${a.episode||''}` !== key)
  filtered.unshift({...entry, ts: Date.now()})
  localStorage.setItem('streamweb_history', JSON.stringify(filtered.slice(0,200)))
  renderHistory()
}
function renderHistory(){
  const h = JSON.parse(localStorage.getItem('streamweb_history')||'[]')
  recentWrap.innerHTML = ''
  if (!h.length) { recentEmpty.style.display = 'block'; return }
  const byTitle = {}
  for (const item of h) {
    const key = (item.title||'').toLowerCase()
    if (!key) continue
    if (!byTitle[key]) byTitle[key] = item
  }
  const unique = Object.values(byTitle)
  recentEmpty.style.display = 'none'
  unique.slice(0,20).forEach((it,i)=>{
    const card = document.createElement('div')
    card.className = 'recentcard'
    const img = document.createElement('img')
    img.src = it.thumb ? `/proxy/image?url=${encodeURIComponent(it.thumb)}` : ''
    const lbl = document.createElement('div')
    lbl.className = 'label'
    lbl.textContent = it.title || 'Unknown'
    card.appendChild(img)
    card.appendChild(lbl)
    card.addEventListener('click', ()=>{ if (it.url) resumeEntry(it) })
    recentWrap.appendChild(card)
  })
}

console.log('[streamweb-web] app.js loaded')

async function proxyFetch(url) {
  const resp = await fetch(apiProxy(url))
  if (!resp.ok) throw new Error('Fetch failed')
  return await resp.text()
}

async function search(query) {
  console.log('[search] query=', query, 'source=', sourceSelect.value)
  if (sourceSelect.value === 'anime') return await animeSearch(query)
  const q = query.replace(/\s+/g,'-')
  const url = `${FLIXHQ_BASE}/search/${q}`
  const body = await proxyFetch(url)
  const parser = new DOMParser()
  const doc = parser.parseFromString(body, 'text/html')
  const items = doc.querySelectorAll('.flw-item')
  const results = []
  items.forEach((el, i)=>{
    const poster = el.querySelector('.film-poster a')
    const titleElem = el.querySelector('.film-detail h2.film-name a')
    const imgEl = el.querySelector('.film-poster img')
    const title = titleElem ? (titleElem.getAttribute('title') || titleElem.textContent) : 'Unknown Title'
    const url = poster ? new URL(poster.getAttribute('href'), FLIXHQ_BASE).toString() : null
    let posterUrl = ''
    if (imgEl) {
      const src = imgEl.getAttribute('data-src') || imgEl.getAttribute('src') || ''
      try { posterUrl = new URL(src, FLIXHQ_BASE).toString() } catch(e) { posterUrl = src }
    }
    results.push({ title, url, poster: posterUrl })
  })
  return results
}

async function animeSearch(q) {
  const resp = await fetch(`/proxy/anime/search?q=${encodeURIComponent(q)}`)
  if (!resp.ok) throw new Error('anime search failed')
  const jd = await resp.json()
  if (!jd || !jd.data) return []
  return jd.data.map(a => ({ title: a.title, slug: a.session || a.id || a.slug, poster: a.poster || a.image || a.snapshot || '' }))
}

async function animeGetEpisodes(slug) {
  const resp = await fetch(`/proxy/anime/episodes?slug=${encodeURIComponent(slug)}`)
  if (!resp.ok) throw new Error('anime episodes failed')
  const jd = await resp.json()
  return jd.data || []
}

async function animeGetM3U8(slug, episode, audio, resolution) {
  const qs = new URLSearchParams({ slug, episode })
  if (audio) qs.set('audio', audio)
  if (resolution) qs.set('resolution', resolution)
  const resp = await fetch(`/proxy/anime/m3u8?${qs.toString()}`)
  if (!resp.ok) throw new Error('anime m3u8 failed')
  const jd = await resp.json()
  return jd.file
}

const searchBtn = document.getElementById('search')
const searchInput = document.getElementById('q')
const btnAnime = document.getElementById('btnAnime')
const btnTV = document.getElementById('btnTV')
let currentContext = { type: null, anime: null }
function setSourceButtonActive(src){
  if (btnAnime) btnAnime.classList.toggle('primary', src === 'anime')
  if (btnTV) btnTV.classList.toggle('primary', src === 'flixhq')
}
if (btnAnime) btnAnime.addEventListener('click', ()=>{ sourceSelect.value = 'anime'; if (searchInput) searchInput.placeholder = 'Search anime...'; setSourceButtonActive('anime') })
if (btnTV) btnTV.addEventListener('click', ()=>{ sourceSelect.value = 'flixhq'; if (searchInput) searchInput.placeholder = 'Search TV / movies...'; setSourceButtonActive('flixhq') })
setSourceButtonActive(sourceSelect.value || 'anime')
searchBtn.addEventListener('click', async ()=>{
  const q = (searchInput && searchInput.value || '').trim()
  if (!q) return
  resultsGrid.innerHTML = '<div>Searching...</div>'
  try {
    const res = await search(q)
    resultsGrid.innerHTML = ''
    if (recentWrap) recentWrap.style.display = 'none'
    res.forEach((r)=>{
      const card = document.createElement('div')
      card.className = 'card'
      const img = document.createElement('img')
      img.src = r.poster ? `/proxy/image?url=${encodeURIComponent(r.poster)}` : ''
      const overlay = document.createElement('div')
      overlay.className = 'overlay'
      overlay.textContent = r.title
      card.appendChild(img)
      card.appendChild(overlay)
      card.addEventListener('click', ()=>{
        const watch = document.getElementById('watch')
        if (watch) watch.classList.remove('hidden')
        try { enterTheater(true) } catch(e){}
        onSelectResult(r)
      })
      if (sourceSelect.value === 'anime') {
        card.addEventListener('click', async ()=>{})
      }
      resultsGrid.appendChild(card)
    })
  } catch (e) { resultsGrid.innerHTML = `<div>Error: ${e.message}</div>` }
})

async function onSelectResult(item){
  const u = item.url || item.slug || item.session || item.id || ''
  if (!u) return alert('Invalid item')
  if (sidePanel) { sidePanel.classList.add('hidden'); sidePanel.classList.remove('open') }
  if (sideEpisodes) sideEpisodes.innerHTML = ''

  if (sourceSelect.value === 'anime' && !/^https?:\/\//.test(u)) {
    const slug = u
    const displayTitle = item.title || ''
    const eps = await animeGetEpisodes(slug)
    if (!eps.length) return alert('No episodes')
    const grid = document.createElement('div')
    grid.className = 'epgrid'
    episodesContainer.innerHTML = ''
    eps.forEach((ep) => {
      const c = document.createElement('div')
      c.className = 'epcard'
      const img = document.createElement('img')
      img.src = (ep.snapshot || ep.thumb) ? `/proxy/image?url=${encodeURIComponent(ep.snapshot||ep.thumb)}` : ''
      const lbl = document.createElement('div')
      lbl.className = 'label'
      lbl.textContent = `${ep.episode}. ${ep.title || ''}`
      c.appendChild(img)
      c.appendChild(lbl)
      c.addEventListener('click', async () => {
        try { enterTheater(true) } catch(e) {}
        const optsResp = await fetch(`/proxy/anime/options?slug=${encodeURIComponent(slug)}&episode=${encodeURIComponent(ep.episode)}`)
        let opts = []
        if (optsResp.ok) { const jd = await optsResp.json(); opts = jd && jd.data ? jd.data : [] }
        if (audioSelect) { audioSelect.innerHTML = ''; const uniqueAudio = Array.from(new Set(opts.map(o=>o.audio||'default'))); uniqueAudio.forEach(a => { const o = document.createElement('option'); o.value = a; o.textContent = a || 'default'; audioSelect.appendChild(o) }) }
        if (resSelect) { resSelect.innerHTML = ''; const uniqueRes = Array.from(new Set(opts.map(o=>o.resolution||'auto'))); uniqueRes.forEach(r => { const o = document.createElement('option'); o.value = r; o.textContent = r || 'auto'; resSelect.appendChild(o) }) }
        if (titleEl) titleEl.textContent = `${displayTitle} — ${ep.title || 'Ep ' + ep.episode}`
        document.getElementById('watch').classList.remove('hidden')
        currentContext = { type: 'anime', anime: { slug, episode: ep.episode } }
        const reload = async () => {
          const selAudio = audioSelect && audioSelect.value
          const selRes = resSelect && resSelect.value
          const file = await animeGetM3U8(slug, ep.episode, selAudio, selRes)
          if (!file) return alert('Could not get stream')
          return handleMedia([{ file, label: `Ep ${ep.episode}`, type: 'anime', episode: ep.episode, episodeTitle: ep.title, thumb: ep.snapshot||ep.thumb }], displayTitle)
        }
        if (audioSelect) audioSelect.onchange = reload
        if (resSelect) resSelect.onchange = reload
        await reload()
      })
      grid.appendChild(c)
    })
    episodesContainer.appendChild(grid)
    document.getElementById('watch').classList.remove('hidden')
    try { const first = grid.querySelector('.epcard'); if (first) first.click() } catch(e){}
    return
  }

  const isMovie = u.includes('/movie/')
  const isSeries = u.includes('/tv/')
  if (isMovie) {
    const m = u.match(/\/movie\/[^/]*-(\d+)/)
    if (!m) return alert('Invalid movie URL')
    const id = m[1]
    const ajax = `${FLIXHQ_BASE}/ajax/movie/episodes/${id}`
    const body = await proxyFetch(ajax)
    const match = body.match(/href=\"([^\"]*)\"[^>]*title=\"Vidcloud\"/)
    if (!match) return alert('Could not get movie stream')
    const moviePage = new URL(match[1], FLIXHQ_BASE).toString()
    const ematch = moviePage.match(/-(\d+)\.(\d+)$/)
    if (!ematch) return alert('Could not get movie stream')
    const episodeId = ematch[2]
    const embed = await getEmbedLink(episodeId)
    if (!embed) return alert('Could not get movie stream')
    const [decoded] = await decodeUrl(embed)
    const file = decoded || embed
    const watch = document.getElementById('watch')
    if (watch) watch.classList.remove('hidden')
    try { enterTheater(true) } catch(e) {}
    return handleMedia([{ file, label: item.title || 'Movie', type: (/\.m3u8/i).test(file) ? 'anime' : 'embed', thumb: item.poster || '' }], item.title)
  }

  if (isSeries) {
    const m = u.match(/\/tv\/[^/]*-(\d+)/)
    if (!m) return alert('Invalid series URL')
    const mediaId = m[1]
    const seasonsUrl = `${FLIXHQ_BASE}/ajax/v2/tv/seasons/${mediaId}`
    const seasonsBody = await proxyFetch(seasonsUrl)
    const re = /href=\"[^\"]*-(\d+)\"[^>]*>([^<]*)<\/a>/g
    const seasons = []
    let mm
    while ((mm = re.exec(seasonsBody))) seasons.push({ id: mm[1], title: mm[2].trim() })
    if (!seasons.length) return alert('No seasons')
    const watch = document.getElementById('watch')
    if (watch) watch.classList.remove('hidden')
    try { enterTheater(true) } catch(e) {}
    const s0 = seasons[0]
    if (s0) {
      try {
        const epsBody = await proxyFetch(`${FLIXHQ_BASE}/ajax/v2/season/episodes/${s0.id}`)
        const epRe = /data-id=\"(\d+)\"[^>]*title=\"([^\"]*)\"/g
        const eps = []
        let mm2
        while ((mm2 = epRe.exec(epsBody))) eps.push({ data_id: mm2[1], title: mm2[2].trim() })
        if (eps.length) {
          const data = await getEpisodeData(eps[0], 1, 1)
          if (data) {
            const [decoded] = await decodeUrl(data.file)
            const file = decoded || data.file
            await handleMedia([{ ...data, file, type: (/\.m3u8/i).test(file) ? 'anime' : 'embed', thumb: item.poster || '' }], item.title)
          }
        }
      } catch(e){}
    }
    
    
    
    const side = document.getElementById('sideEpisodes')
    const header = document.querySelector('#sidePanel .side-header strong')
    if (header) header.textContent = 'Seasons'
    if (side) {
      side.innerHTML = ''
      seasons.forEach((s, idx) => {
        const b = document.createElement('button')
        b.className = 'toggle'
        b.style.margin = '6px 6px 0 0'
        b.textContent = s.title || `Season ${idx+1}`
        b.addEventListener('click', async ()=>{
          const epsBody = await proxyFetch(`${FLIXHQ_BASE}/ajax/v2/season/episodes/${s.id}`)
          const epRe = /data-id=\"(\d+)\"[^>]*title=\"([^\"]*)\"/g
          const eps = []
          let mm2
          while ((mm2 = epRe.exec(epsBody))) eps.push({ data_id: mm2[1], title: mm2[2].trim() })
          if (header) header.textContent = s.title || `Season ${idx+1}`
          side.innerHTML = ''
          eps.forEach((ep, ei)=>{
            const btn = document.createElement('button')
            btn.className = 'toggle'
            btn.style.margin = '6px 6px 0 0'
            btn.textContent = `${ei+1}. ${ep.title}`
            btn.addEventListener('click', async ()=>{
              const data = await getEpisodeData(ep, idx+1, ei+1)
              if (!data) return alert('Could not get episode data')
              const [decoded] = await decodeUrl(data.file)
              const file = decoded || data.file
              return handleMedia([{ ...data, file, type: (/\.m3u8/i).test(file) ? 'anime' : 'embed', thumb: item.poster || '' }], item.title)
            })
            side.appendChild(btn)
          })
        })
        side.appendChild(b)
      })
    }
    return
  }

  alert('Unknown content type')
}

async function getEpisodeServers(dataId, preferred='Vidcloud'){
  const url = `${FLIXHQ_BASE}/ajax/v2/episode/servers/${dataId}`
  const body = await proxyFetch(url)
  const re = /data-id=\"(\d+)\"[^>]*title=\"([^\"]*)\"/g
  const servers = []
  let m
  while ((m = re.exec(body))) servers.push({ id: m[1], name: m[2].trim() })
  for (const s of servers) if (s.name.toLowerCase().includes(preferred.toLowerCase())) return s.id
  return servers.length ? servers[0].id : null
}

async function getEmbedLink(episodeId){
  const url = `${FLIXHQ_BASE}/ajax/episode/sources/${episodeId}`
  const respText = await proxyFetch(url)
  const m = respText.match(/\"link\":\"([^\"]*)\"/)
  if (m) return m[1]
  return null
}

async function getEpisodeData(ep, seasonNum, episodeNum){
  const episodeId = await getEpisodeServers(ep.data_id, 'Vidcloud')
  if (!episodeId) return null
  const embed = await getEmbedLink(episodeId)
  if (!embed) return null
  return { file: embed, label: `S${seasonNum}E${episodeNum} - ${ep.title}`, type: 'embed', season: seasonNum, episode: episodeNum }
}

async function decodeUrl(url) {
  try {
    const resp = await fetch(decoderProxy(url))
    if (!resp.ok) {
      console.warn('[decodeUrl] decoder proxy returned not ok', resp.status)
      return [url, []]
    }
    const data = await resp.json()
    console.log('[decodeUrl] decoder response:', data)
    if (data && data.sources && data.sources.length) {
      const file = data.sources[0].file
      const subs = (data.tracks||[]).filter(t=>t.kind==='captions'&&t.file).map(t=>t.file)
      return [file, subs]
    }
    if (data && (data.link || data.url || data.file)) return [data.link||data.url||data.file, []]
    const txt = typeof data === 'string' ? data : JSON.stringify(data)
    const m = txt.match(/"file":"([^"]*\.m3u8[^"]*)"/)
    if (m) return [m[1], []]

    try {
      const extracted = await extractM3U8FromEmbed(url)
      if (extracted) {
        console.log('[decodeUrl] fallback extracted m3u8:', extracted)
        return [extracted, []]
      }
    } catch (e) { console.warn('[decodeUrl] fallback extractor failed', e && e.message) }

    try {
      const serverResp = await fetch(`/proxy/extract?url=${encodeURIComponent(url)}`)
      if (serverResp.ok) {
        const jd = await serverResp.json()
        if (jd && jd.file) {
          console.log('[decodeUrl] server extractor found m3u8:', jd.file)
          return [jd.file, []]
        }
      } else {
        console.warn('[decodeUrl] server extractor returned', serverResp.status)
      }
    } catch (e) { console.warn('[decodeUrl] server extractor error', e && e.message) }

  } catch (e) { console.warn('[decodeUrl] error', e && e.message) }
  return [url, []]
}

async function handleMedia(mediaList, title){
  const action = actionSelect.value;
  if (action === 'play') {
    await provideData(mediaList, title);
  } else {
    const m = mediaList[0]
    let file
    if (m.type === 'anime' || (/\.m3u8/i).test(m.file)) {
      file = m.file
    } else {
      ;[file] = await decodeUrl(m.file)
    }
    downloadLink.style.display = 'inline-block'
    downloadLink.href = file
    downloadLink.textContent = 'Download stream (may be m3u8)'
  }
}

async function provideData(mediaList, parentTitle) {
  if (!mediaList) {
    console.log('No media selected for playback');
    return;
  }
  const episodes = Array.isArray(mediaList) ? mediaList : [mediaList];
  const autoplay = autoplayNext.checked;
  for (let i = 0; i < episodes.length; i++) {
    const ep = episodes[i];
    let decoded, subs
    if (ep.type === 'anime' || (/\.m3u8/i).test(ep.file)) {
      decoded = ep.file
      subs = []
    } else {
      ;[decoded, subs] = await decodeUrl(ep.file)
    }
    const dispTitle = parentTitle || ep.showTitle || ep.movie_title || ep.episode_title || ep.label;
    await playUrl(decoded, dispTitle, subs);
    saveHistory({ title: dispTitle, url: ep.file, season: ep.season, episode: ep.episode, label: ep.label, episodeTitle: ep.episodeTitle || ep.label, thumb: ep.thumb || ep.snapshot || '' });
    if (i < episodes.length - 1 && !autoplay) {
      if (!confirm('Continue to next episode?')) break;
    }
  }
}

async function playUrl(url, title, subs){
  downloadLink.style.display = 'none'
  let finalUrl = url
  if (!/\.m3u8/i.test(url)) {
    const extracted = await extractM3U8FromEmbed(url)
    if (extracted) finalUrl = extracted
  }
  if (/\.m3u8/i.test(finalUrl)) finalUrl = `/proxy/manifest?url=${encodeURIComponent(finalUrl)}`
  console.log('[playUrl] finalUrl=', finalUrl)
  if (Hls.isSupported()) {
    if (window.hls) { window.hls.destroy(); window.hls = null }
    const hls = new Hls()
    window.hls = hls
    hls.loadSource(finalUrl)
    hls.attachMedia(videoEl)
    hls.on(Hls.Events.MANIFEST_PARSED, () => {
      try { setupHlsSelectors(hls) } catch(e) { console.warn('setupHlsSelectors failed', e && e.message) }
      videoEl.play().catch(()=>{})
    })
    hls.on(Hls.Events.ERROR, (e, d) => {
      console.error('hls error', e, d)
      try {
        const details = d && d.details ? d.details : ''
        const fatal = d && d.fatal
        if (details && (details === 'bufferAddCodecError' || details === 'bufferAppendError')) {
          downloadLink.style.display = 'inline-block'
          downloadLink.href = finalUrl
          downloadLink.textContent = 'Open stream / download manifest'
          try { hls.destroy(); window.hls = null } catch (e) {}
          try { videoEl.src = finalUrl; videoEl.play().catch(()=>{}) } catch (e) {}
          return
        }
        if (fatal) {
          console.warn('hls fatal error, destroying hls')
          try { hls.destroy(); window.hls = null } catch (e) {}
        }
      } catch (err) { console.error('error handling hls error', err) }
    })
  } else if (videoEl.canPlayType('application/vnd.apple.mpegurl')) {
    videoEl.src = finalUrl
    videoEl.play().catch(()=>{})
  } else {
    alert('HLS not supported in this browser')
  }
}

function setupHlsSelectors(hls){
  if (currentContext && currentContext.type === 'anime') return
  if (!hls) return
  if (resSelect) {
    resSelect.innerHTML = ''
    const auto = document.createElement('option')
    auto.value = 'auto'
    auto.textContent = 'Auto'
    resSelect.appendChild(auto)
    ;(hls.levels||[]).forEach((lvl, i)=>{
      const o = document.createElement('option')
      o.value = String(i)
      const height = lvl.height || (lvl.attrs && (lvl.attrs.RESOLUTION || '').split('x')[1]) || ''
      const bitrate = lvl.bitrate ? Math.round(lvl.bitrate/1000) + 'kbps' : ''
      o.textContent = `${height || 'Level '+i} ${bitrate}`.trim()
      resSelect.appendChild(o)
    })
    resSelect.onchange = () => {
      if (!window.hls) return
      const v = resSelect.value
      window.hls.currentLevel = v === 'auto' ? -1 : Number(v)
    }
    resSelect.value = 'auto'
  }
  if (audioSelect) {
    audioSelect.innerHTML = ''
    const tracks = hls.audioTracks || []
    if (!tracks.length) {
      const o = document.createElement('option')
      o.value = 'default'
      o.textContent = 'Default'
      audioSelect.appendChild(o)
      audioSelect.onchange = null
    } else {
      tracks.forEach((t, idx)=>{
        const o = document.createElement('option')
        o.value = String(idx)
        o.textContent = t.name || t.lang || `Track ${idx+1}`
        audioSelect.appendChild(o)
      })
      try { audioSelect.value = String(hls.audioTrack || 0) } catch {}
      audioSelect.onchange = () => {
        if (!window.hls) return
        const idx = Number(audioSelect.value)
        if (!Number.isNaN(idx)) window.hls.audioTrack = idx
      }
    }
  }
}

async function resumeEntry(entry){
  const u = entry.url
  if (!u) return
  if (/\.m3u8/i.test(u)) {
    const file = /\/proxy\/manifest\?/.test(u) ? u : `/proxy/manifest?url=${encodeURIComponent(u)}`
    return handleMedia([{ file, label: entry.title || 'Resume', type: 'anime' }], entry.title)
  }
  if (/^https?:\/\//i.test(u) && !/flixhq\.to\//i.test(u)) {
    return handleMedia([{ file: u, label: entry.title || 'Resume', type: 'embed' }], entry.title)
  }
  const item = { title: entry.title || 'Resume', url: u }
  return onSelectResult(item)
}

renderHistory()

const theaterBtn = document.getElementById('theaterBtn')
const sidePanel = document.getElementById('sidePanel')
const sideClose = document.getElementById('sideClose')
const sideEpisodes = document.getElementById('sideEpisodes')
const watchSection = document.getElementById('watch')

function enterTheater(auto) {
  if (!watchSection) return
  watchSection.classList.add('theater')
  if (sidePanel) { sidePanel.classList.add('hidden'); sidePanel.classList.remove('open') }
  if (theaterBtn) theaterBtn.textContent = 'Exit Theater'
  populateSideEpisodes()
  try {
    const hero = document.getElementById('hero')
    const recentWrapSec = document.getElementById('recentWrap')
    const resultsSec = document.getElementById('results')
    if (hero) hero.style.display = 'none'
    if (recentWrapSec) recentWrapSec.style.display = 'none'
    if (resultsSec) resultsSec.style.display = 'none'
  } catch(e){}
}

function exitTheater() {
  if (!watchSection) return
  watchSection.classList.remove('theater')
  if (sidePanel) { sidePanel.classList.add('hidden'); sidePanel.classList.remove('open') }
  if (theaterBtn) theaterBtn.textContent = 'Theater'
  try {
    const hero = document.getElementById('hero')
    const recentWrapSec = document.getElementById('recentWrap')
    const resultsSec = document.getElementById('results')
    if (hero) hero.style.display = ''
    if (recentWrapSec) recentWrapSec.style.display = ''
    if (resultsSec) resultsSec.style.display = ''
  } catch(e){}
}

if (theaterBtn) theaterBtn.addEventListener('click', ()=>{
  if (!watchSection) return
  if (watchSection.classList.contains('theater')) exitTheater(); else enterTheater()
})
if (sideClose) sideClose.addEventListener('click', ()=>{ if (sidePanel) sidePanel.classList.remove('open') })

if (browseBtn) browseBtn.addEventListener('click', ()=>{
  if (!sidePanel) return
  const opening = !sidePanel.classList.contains('open')
  if (opening) sidePanel.classList.remove('hidden')
  sidePanel.classList.toggle('open')
  if (!opening) setTimeout(()=>{ if (!sidePanel.classList.contains('open')) sidePanel.classList.add('hidden') }, 250)
})

function populateSideEpisodes(){
  if (!sideEpisodes) return
  sideEpisodes.innerHTML = ''
  const eps = document.querySelectorAll('#episodes .epcard')
  if (!eps || !eps.length) return
  eps.forEach((el, i)=>{
    try {
      const clone = el.cloneNode(true)
      clone.addEventListener('click', ()=>{
        const originals = document.querySelectorAll('#episodes .epcard')
        if (originals && originals[i]) originals[i].click()
        exitTheater()
      })
      sideEpisodes.appendChild(clone)
    } catch(e){}
  })
}

document.addEventListener('keydown', (e)=>{
  if (e.key === 'Escape') {
    if (watchSection && watchSection.classList.contains('theater')) exitTheater()
  }
})
