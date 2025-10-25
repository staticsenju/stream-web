const browseBtn = document.getElementById('browseBtn')
const FLIXHQ_BASE = 'https://flixhq.to'
const apiProxy = (path) => `/proxy/fetch?url=${encodeURIComponent(path)}`
const decoderProxy = (url) => `/proxy/decoder?url=${encodeURIComponent(url)}`

function decodeEntities(encodedString) {
    if (typeof encodedString !== 'string') return encodedString;
    const textarea = document.createElement('textarea');
    textarea.innerHTML = encodedString;
    return textarea.value;
}

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

async function proxyFetch(url) {
  const resp = await fetch(apiProxy(url))
  if (!resp.ok) throw new Error('Fetch failed')
  return await resp.text()
}

async function search(query) {
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
    results.push({ title: decodeEntities(title), url, poster: posterUrl })
  })
  return results
}

async function animeSearch(q) {
  const resp = await fetch(`/proxy/anime/search?q=${encodeURIComponent(q)}`)
  if (!resp.ok) throw new Error('anime search failed')
  const jd = await resp.json()
  if (!jd || !jd.data) return []
  return jd.data.map(a => ({ title: decodeEntities(a.title), slug: a.session || a.id || a.slug, poster: a.poster || a.image || a.snapshot || '' }))
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
        if (sourceSelect.value === 'anime') {
          const slug = r.slug || r.url || r.session || r.id || ''
          const title = r.title || ''
          if (!slug) return alert('Invalid anime selection')
          window.location.href = `/player.html?source=anime&slug=${encodeURIComponent(slug)}&title=${encodeURIComponent(title)}&poster=${encodeURIComponent(r.poster||'')}`
          return
        }

        if (sourceSelect.value === 'flixhq') {
          const url = r.url || ''
          const title = r.title || ''
          if (!url) return alert('Invalid selection')
          window.location.href = `/player.html?source=flixhq&slug=${encodeURIComponent(url)}&title=${encodeURIComponent(title)}&poster=${encodeURIComponent(r.poster||'')}`
          return
        }

        window.location.href = `/player.html?slug=${encodeURIComponent(r.url||r.slug||r.id)}&title=${encodeURIComponent(r.title||'')}&poster=${encodeURIComponent(r.poster||'')}`
      })

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
    const title = item.title || ''
    window.location.href = `/player.html?source=anime&slug=${encodeURIComponent(slug)}&title=${encodeURIComponent(title)}&poster=${encodeURIComponent(item.poster||'')}`
    return
  }

  const isFlix = u.includes('flixhq.to') || u.includes('/tv/') || u.includes('/movie/')
  if (isFlix) {
    window.location.href = `/player.html?source=flixhq&slug=${encodeURIComponent(u)}&title=${encodeURIComponent(item.title||'')}&poster=${encodeURIComponent(item.poster||'')}`
    return
  }

  alert('Falling back to inline play (legacy).')
  try { enterTheater(true) } catch(e){}
  if (sourceSelect.value === 'anime') {
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

      c.addEventListener('click', () => {
        const title = displayTitle || item.title || ''
        window.location.href = `/player.html?source=anime&slug=${encodeURIComponent(slug)}&episode=${encodeURIComponent(ep.episode)}&title=${encodeURIComponent(title)}&poster=${encodeURIComponent(item.poster||'')}`
      })

      grid.appendChild(c)
    })
    episodesContainer.appendChild(grid)
    document.getElementById('watch').classList.remove('hidden')
    try { const first = grid.querySelector('.epcard'); if (first) first.click() } catch(e){}
    return
  }

  alert('Unknown content type for onSelectResult fallback')
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
  return { file: embed, label: `S${seasonNum}E${episodeNum} - ${ep.title}`, type: 'embed', season: seasonNum, episode: episodeNum, data_id: ep.data_id }
}

async function decodeUrl(url) {
  try {
    const resp = await fetch(decoderProxy(url))
    if (!resp.ok) {
      console.warn('[decodeUrl] decoder proxy returned not ok', resp.status)
      return [url, []]
    }
    const data = await resp.json()
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
      if (extracted) return [extracted, []]
    } catch (e) {}
    try {
      const serverResp = await fetch(`/proxy/extract?url=${encodeURIComponent(url)}`)
      if (serverResp.ok) {
        const jd = await serverResp.json()
        if (jd && jd.file) return [jd.file, []]
      }
    } catch (e) {}
  } catch (e) {}
  return [url, []]
}

async function handleMedia(mediaList, title){
  const action = actionSelect.value;
  if (action === 'play') {
    const m = Array.isArray(mediaList) ? mediaList[0] : mediaList;
    if (m.type === 'anime' && m.slug) {
      const url = `/player.html?source=anime&slug=${encodeURIComponent(m.slug)}${m.episode?`&episode=${encodeURIComponent(m.episode)}`:''}&title=${encodeURIComponent(title||m.label||'')}&poster=${encodeURIComponent(m.thumb||m.poster||'')}`
      window.location.href = url
      return
    }
    if (m.file) {
      const url = `/player.html?file=${encodeURIComponent(m.file)}&title=${encodeURIComponent(title||m.label||'')}&type=${encodeURIComponent(m.type||'embed')}&poster=${encodeURIComponent(m.thumb||m.poster||'')}`
      window.location.href = url
      return
    }
    if (m.slug || m.url) {
      const url = `/player.html?source=${encodeURIComponent(m.type||'embed')}&slug=${encodeURIComponent(m.slug||m.url)}&title=${encodeURIComponent(title||m.label||'')}&poster=${encodeURIComponent(m.thumb||m.poster||'')}`
      window.location.href = url
      return
    }
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
    return;
  }
  const episodes = Array.isArray(mediaList) ? mediaList : [mediaList];
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
    if (decoded) {
      const playerUrl = `/player.html?file=${encodeURIComponent(decoded)}&title=${encodeURIComponent(dispTitle)}&poster=${encodeURIComponent(ep.thumb||'')}`
      window.location.href = playerUrl
      return
    } else {
      const playerUrl = `/player.html?file=${encodeURIComponent(ep.file)}&title=${encodeURIComponent(dispTitle)}&poster=${encodeURIComponent(ep.thumb||'')}`
      window.location.href = playerUrl
      return
    }
  }
}

async function playUrl(url, title, opts){
  downloadLink.style.display = 'none'
  let finalUrl = url
  if (!/\.m3u8/i.test(finalUrl)) {
    const extracted = await extractM3U8FromEmbed(url)
    if (extracted) finalUrl = extracted
  }
  if (/\.m3u8/i.test(finalUrl) && !/\/proxy\/manifest\?/.test(finalUrl)) finalUrl = `/proxy/manifest?url=${encodeURIComponent(finalUrl)}`
  if (Hls.isSupported()) {
    if (window.hls) { window.hls.destroy(); window.hls = null }
    const hls = new Hls()
    window.hls = hls
    hls.loadSource(finalUrl)
    hls.attachMedia(videoEl)
    hls.on(Hls.Events.MANIFEST_PARSED, () => {
      try { setupHlsSelectors(hls) } catch(e) {}
      videoEl.play().catch(()=>{})
    })
    hls.on(Hls.Events.ERROR, (e, d) => {
      try {
        const details = d && d.details ? d.details : ''
        const fatal = d && d.fatal
        if (fatal) {
          try { hls.destroy(); window.hls = null } catch (e) {}
        }
      } catch (err) {}
    })
  } else if (videoEl.canPlayType('application/vnd.apple.mpegurl')) {
    videoEl.src = finalUrl
    videoEl.play().catch(()=>{})
  } else {
    alert('HLS not supported in this browser')
  }
}

function setupHlsSelectors(hls){
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
    window.location.href = `/player.html?file=${encodeURIComponent(file)}&title=${encodeURIComponent(entry.title||'Resume')}`
    return
  }
  if (/^https?:\/\//i.test(u) && !/flixhq\.to\//i.test(u)) {
    window.location.href = `/player.html?file=${encodeURIComponent(u)}&title=${encodeURIComponent(entry.title||'Resume')}`
    return
  }
  const item = { title: entry.title || 'Resume', url: u }
  return onSelectResult(item)
}

renderHistory()

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
});
