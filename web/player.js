(function() {
		const FLIXHQ_BASE = 'https://flixhq.to'
		const apiProxy = (path) => `/proxy/fetch?url=${encodeURIComponent(path)}`
		const decoderProxy = (url) => `/proxy/decoder?url=${encodeURIComponent(url)}`
		const playerRoot = document.getElementById('player-root') || document.body
		const video = document.getElementById('video')
		const playBtn = document.getElementById('playpause')
		const rewBtn = document.getElementById('rew10')
		const fwdBtn = document.getElementById('fwd10')
		const timeEl = document.getElementById('time')
		const seek = document.getElementById('seek')
		const progressPlay = document.getElementById('progress-play')
		const progressBuffer = document.getElementById('progress-buffer')
		const fsBtn = document.getElementById('fullscreen')
		const openSelector = document.getElementById('open-selector') || document.getElementById('episodes-toggle') || document.getElementById('browseBtn')
		const selectorModal = document.getElementById('selector-modal')
		const closeSelector = document.getElementById('close-selector')
		const seasonsList = document.getElementById('seasons-list') || document.getElementById('sideEpisodes')
		const seriesTitleEl = document.getElementById('selector-series-title') || document.getElementById('title') || document.getElementById('crumb')
		const crumb = document.getElementById('crumb')
		const episodeTitle = document.getElementById('episode-title')
		const audioSelect = document.getElementById('audio-select') || document.getElementById('audio') || document.querySelector('[data-audio-select]')
		const qualitySelect = document.getElementById('quality-select') || document.getElementById('res') || document.querySelector('[data-quality-select]')
		let hls = null
		let seriesData = null
		let current = {
			seasonId: null,
			episodeId: null,
			epMeta: null
		}
		const params = new URLSearchParams(window.location.search)
		const SLUG_RAW = params.get('slug') || params.get('q') || null
		const SOURCE = (params.get('source') || 'anime').toLowerCase()
		const FILE_PARAM = params.get('file') || null
		const URL_TITLE = params.get('title') ? decodeURIComponent(params.get('title')) : null
		const URL_EPISODE = params.get('episode') || null
		const URL_SEASON_INDEX = params.get('seasonIndex') ? Number(params.get('seasonIndex')) : null
		const URL_EPISODE_INDEX = params.get('episodeIndex') ? Number(params.get('episodeIndex')) : null
		const URL_DATA_ID = params.get('dataId') || params.get('data_id') || null
		const SLUG = SLUG_RAW ? decodeURIComponent(SLUG_RAW) : null
		let hideTimer = null
		const HIDE_DELAY = 3000
		let generatedObjectUrls = []

		let watchSocket = null
		let watchPartyCode = null
		let watchAmHost = false
		let watchApplyingRemote = false

		function watchLog(...args) { try { console.log('[watch]', ...args) } catch (e) {} }

		function watchEmitState(state) {
			if (!watchSocket || !watchPartyCode) return
			watchLog('emit state', watchPartyCode, state)
			try { watchSocket.emit('watch:state', watchPartyCode, state) } catch (e) { watchLog('emit error', e) }
		}

		function watchApplyRemoteState(state, forceSeek=false) {
			if (!state) return
			try {
				watchApplyingRemote = true
				watchLog('apply remote state', state)
				if (state.url && state.url !== (window.location.search.includes('file=') ? decodeURIComponent(new URLSearchParams(window.location.search).get('file')) : null)) {
					watchLog('remote requested media load', state.url)
					const params = new URLSearchParams(window.location.search)
					params.set('file', state.url)
					window.location.search = params.toString()
					return
				}
				if (state.action === 'play') {
					if (video) {
						if (typeof state.time === 'number') video.currentTime = state.time || 0
						video.play().then(()=>watchLog('remote play ok')).catch(err=>watchLog('remote play failed', err))
					}
				} else if (state.action === 'pause') {
					if (video) {
						if (typeof state.time === 'number') video.currentTime = state.time || 0
						video.pause()
					}
				} else if (state.action === 'seek') {
					if (video && typeof state.time === 'number') {
						const diff = Math.abs((video.currentTime||0) - state.time)
						if (forceSeek || diff > 0.5) video.currentTime = state.time
					}
				} else if (state.action === 'load') {
					if (state.url) publicPlay(state.url, state.title||'')
				}
			} catch (e) { watchLog('apply remote exception', e) }
			setTimeout(()=>watchApplyingRemote = false, 250)
		}

		function resetHideTimer() {
			showControls();
			if (hideTimer) clearTimeout(hideTimer);
			hideTimer = setTimeout(hideControls, HIDE_DELAY)
		}

		function showControls() {
			const t = document.querySelector('.topbar');
			if (t) t.style.opacity = '1';
			const c = document.querySelector('.controls');
			if (c) c.style.opacity = '1'
		}

		function hideControls() {
			if (!video || video.paused) return;
			const t = document.querySelector('.topbar');
			if (t) t.style.opacity = '0';
			const c = document.querySelector('.controls');
			if (c) c.style.opacity = '0'
		}
		['mousemove', 'touchstart', 'pointermove'].forEach(ev => document.addEventListener(ev, resetHideTimer, {
			passive: true
		}))
		resetHideTimer()

		function formatTime(sec) {
			if (!sec || isNaN(sec) || !isFinite(sec)) return '00:00';
			const h = Math.floor(sec / 3600);
			const m = Math.floor((sec % 3600) / 60).toString().padStart(2, '0');
			const s = Math.floor(sec % 60).toString().padStart(2, '0');
			return h > 0 ? `${h}:${m}:${s}` : `${m}:${s}`
		}

		function revokeGeneratedUrls() {
			try {
				generatedObjectUrls.forEach(u => {
					try {
						URL.revokeObjectURL(u)
					} catch (e) {}
				});
				generatedObjectUrls = []
			} catch (e) {}
		}

		function clearHlsState(preserveSelectors) {
			if (!preserveSelectors) {
				if (qualitySelect) qualitySelect.innerHTML = `<option value="-1">Auto</option>`;
				if (audioSelect) audioSelect.innerHTML = `<option value="">Audio</option>`
			}
			if (hls) {
				try {
					hls.destroy()
				} catch (e) {}
				hls = null
			}
			if (video) {
				try {
					video.removeAttribute('src');
					video.load()
				} catch (e) {}
			}
			if (!preserveSelectors) revokeGeneratedUrls()
		}

		function attachHls(src, orig) {
			const preserve = animeOptionsPopulated();
			clearHlsState(preserve);
			if (!src) return;
			const isDataOrBlob = String(src).startsWith('data:') || String(src).startsWith('blob:');
			if (isDataOrBlob) {
				fetch(src).then(async r => {
					try {
						const text = await r.text();
						if (text && text.indexOf('#EXTM3U') > -1) {
							const b = new Blob([text], {
								type: 'application/vnd.apple.mpegurl'
							});
							const obj = URL.createObjectURL(b);
							generatedObjectUrls.push(obj);
							doAttach(obj, orig)
						} else doAttach(src, orig)
					} catch (e) {
						doAttach(src, orig)
					}
				}).catch(() => doAttach(src, orig));
				return
			}
			doAttach(src, orig)
		}

		function doAttach(src, orig) {
			if (window.Hls && Hls.isSupported()) {
				hls = new Hls({
					enableWorker: true
				});
				hls.attachMedia(video);
				hls.on(Hls.Events.MEDIA_ATTACHED, () => hls.loadSource(src));
				hls.on(Hls.Events.MANIFEST_PARSED, () => {
					if (!animeOptionsPopulated()) {
						populateQualityFromLevels(hls.levels);
						populateAudioFromTracks(hls.audioTracks || [])
					}
					video.play().catch(() => {});
					saveContinueWatching(orig)
				});
				hls.on(Hls.Events.LEVELS_UPDATED, () => {
					if (!animeOptionsPopulated()) populateQualityFromLevels(hls.levels)
				});
				hls.on(Hls.Events.AUDIO_TRACKS_UPDATED, () => {
					if (!animeOptionsPopulated()) populateAudioFromTracks(hls.audioTracks || [])
				});
				hls.on(Hls.Events.ERROR, (ev, data) => {
					if (data && data.fatal) {
						try {
							hls.destroy()
						} catch (e) {}
						hls = null
					}
				})
			} else {
				video.src = src;
				video.load();
				video.addEventListener('loadedmetadata', () => {
					video.play().catch(() => {});
					saveContinueWatching(orig)
				}, {
					once: true
				})
			}
		}

		function populateQualityFromLevels(levels) {
			if (!qualitySelect) return;
			qualitySelect.innerHTML = `<option value="-1">Auto</option>`;
			if (!levels || !levels.length) return;
			levels.forEach((lvl, idx) => {
				const label = lvl.height ? `${lvl.height}p` : `${Math.round((lvl.bitrate||0)/1000)} kbps`;
				const opt = document.createElement('option');
				opt.value = String(idx);
				opt.textContent = label;
				qualitySelect.appendChild(opt)
			});
			qualitySelect.onchange = () => {
				if (!hls) return;
				const v = qualitySelect.value;
				hls.currentLevel = v === '-1' ? -1 : Number(v)
			}
		}

		function populateAudioFromTracks(tracks) {
			if (!audioSelect) return;
			audioSelect.innerHTML = '';
			if (!tracks || !tracks.length) {
				const o = document.createElement('option');
				o.value = '';
				o.textContent = 'Default';
				audioSelect.appendChild(o);
				audioSelect.onchange = null;
				return
			}
			tracks.forEach((t, idx) => {
				const o = document.createElement('option');
				o.value = String(idx);
				o.textContent = t.name || t.lang || `Track ${idx+1}`;
				audioSelect.appendChild(o)
			});
			audioSelect.onchange = () => {
				if (!hls) return;
				const v = Number(audioSelect.value);
				if (!Number.isNaN(v)) hls.audioTrack = v
			}
		}

		function animeOptionsPopulated() {
			if (!audioSelect || !qualitySelect) return false;
			const audioHas = audioSelect.children.length > 1;
			const qualityHas = qualitySelect.children.length > 1 && [...qualitySelect.children].some(o => o.value !== '-1');
			return audioHas || qualityHas
		}
		async function fetchAnimeOptions(slug, episode) {
			try {
				const url = `/proxy/anime/options?slug=${encodeURIComponent(slug)}&episode=${encodeURIComponent(episode)}`;
				const resp = await fetch(url);
				if (!resp.ok) throw new Error();
				const jd = await resp.json();
				return jd && jd.data ? jd.data : []
			} catch (e) {
				return []
			}
		}

		function populateAnimeOptions(opts) {
			if (!Array.isArray(opts)) return;
			const prevAudio = audioSelect && audioSelect.value ? audioSelect.value : null;
			const prevQuality = qualitySelect && qualitySelect.value ? qualitySelect.value : null;
			const audios = Array.from(new Set(opts.map(o => (o.audio || 'default'))));
			const ress = Array.from(new Set(opts.map(o => (o.resolution || 'auto'))));
			if (audioSelect) {
				audioSelect.innerHTML = '';
				audios.forEach(a => {
					const o = document.createElement('option');
					o.value = a || 'default';
					o.textContent = a || 'default';
					audioSelect.appendChild(o)
				});
				if (prevAudio && [...audioSelect.options].some(o => o.value === prevAudio)) audioSelect.value = prevAudio;
				audioSelect.onchange = async () => {
					if (current && current.epMeta) {
						const pos = (video && !isNaN(video.currentTime)) ? video.currentTime : 0;
						await loadEpisode(current.seasonId, current.episodeId, {
							resumeAt: pos,
							skipOptionsFetch: true
						})
					}
				}
			}
			if (qualitySelect) {
				qualitySelect.innerHTML = '';
				const auto = document.createElement('option');
				auto.value = '-1';
				auto.textContent = 'Auto';
				qualitySelect.appendChild(auto);
				ress.forEach(r => {
					const o = document.createElement('option');
					o.value = String(r);
					o.textContent = r ? `${r}p` : 'auto';
					qualitySelect.appendChild(o)
				});
				if (prevQuality && [...qualitySelect.options].some(o => o.value === prevQuality)) qualitySelect.value = prevQuality;
				else qualitySelect.value = '-1';
				qualitySelect.onchange = async () => {
					if (current && current.epMeta) {
						const pos = (video && !isNaN(video.currentTime)) ? video.currentTime : 0;
						await loadEpisode(current.seasonId, current.episodeId, {
							resumeAt: pos,
							skipOptionsFetch: true
						})
					}
				}
			}
        }

			function extractMediaIdFromFlixUrl(u) {
				try {
					const m = u.match(/\/tv\/[^/]*-(\d+)/);
					if (m) return m[1];
					const m2 = u.match(/\/movie\/[^/]*-(\d+)/);
					if (m2) return m2[1];
					if (/^\d+$/.test(u)) return u
				} catch (e) {}
				return null
			}
			async function fetchFlixSeasons(mediaId) {
				const url = `${FLIXHQ_BASE}/ajax/v2/tv/seasons/${mediaId}`;
				const resp = await fetch(apiProxy(url));
				if (!resp.ok) throw new Error();
				const text = await resp.text();
				const re = /href=\"[^\"]*-(\d+)\"[^>]*>([^<]*)<\/a>/g;
				const seasons = [];
				let mm;
				while ((mm = re.exec(text))) seasons.push({
					id: mm[1],
					name: mm[2].trim()
				});
				return seasons
			}
			async function fetchFlixSeasonEpisodes(seasonId) {
				const url = `${FLIXHQ_BASE}/ajax/v2/season/episodes/${seasonId}`;
				const resp = await fetch(apiProxy(url));
				if (!resp.ok) throw new Error();
				const text = await resp.text();
				const epRe = /data-id=\"(\d+)\"[^>]*title=\"([^\"]*)\"/g;
				const eps = [];
				let m;
				while ((m = epRe.exec(text))) eps.push({
					data_id: m[1],
					title: m[2].trim()
				});
				return eps
			}
			async function getFlixEpisodeServers(dataId, preferred = 'Vidcloud') {
				const url = `${FLIXHQ_BASE}/ajax/v2/episode/servers/${dataId}`;
				const resp = await fetch(apiProxy(url));
				if (!resp.ok) throw new Error();
				const text = await resp.text();
				const re = /data-id=\"(\d+)\"[^>]*title=\"([^\"]*)\"/g;
				const servers = [];
				let mm;
				while ((mm = re.exec(text))) servers.push({
					id: mm[1],
					name: mm[2].trim()
				});
				for (const s of servers)
					if (s.name.toLowerCase().includes(preferred.toLowerCase())) return s.id;
				return servers.length ? servers[0].id : null
			}
			async function getFlixEmbedLink(serverId) {
				const url = `${FLIXHQ_BASE}/ajax/episode/sources/${serverId}`;
				const resp = await fetch(apiProxy(url));
				if (!resp.ok) throw new Error();
				const text = await resp.text();
				const m = text.match(/"link":"([^"]*)"/);
				if (m) return m[1];
				return null
			}
			async function playFlixMovieFromSlug(slugUrl, titleLabel) {
				try {
					const m = slugUrl.match(/\/movie\/[^/]*-(\d+)/);
					if (!m) throw new Error('invalid');
					const id = m[1];
					const ajaxUrl = `${FLIXHQ_BASE}/ajax/movie/episodes/${id}`;
					const resp = await fetch(apiProxy(ajaxUrl));
					if (!resp.ok) throw new Error();
					const body = await resp.text();
					const match = body.match(/href=\"([^\"]*)\"[^>]*title=\"Vidcloud\"/);
					if (!match) throw new Error();
					const moviePage = new URL(match[1], FLIXHQ_BASE).toString();
					let embedOrFile = null;
					try {
						const dec = await fetch(decoderProxy(moviePage));
						if (dec.ok) {
							const jd = await dec.json();
							embedOrFile = jd && (jd.file || jd.link || jd.url) ? (jd.file || jd.link || jd.url) : null
						}
					} catch (e) {}
					if (!embedOrFile) {
						const em = moviePage.match(/-(\d+)\.(\d+)$/);
						if (em) {
							const episodeId = em[2];
							try {
								const sourcesUrl = `${FLIXHQ_BASE}/ajax/episode/sources/${episodeId}`;
								const resp2 = await fetch(apiProxy(sourcesUrl));
								if (resp2.ok) {
									const t = await resp2.text();
									const mm = t.match(/"link":"([^"]*)"/);
									if (mm) embedOrFile = mm[1]
								}
							} catch (e) {}
						}
					}
					if (!embedOrFile) throw new Error('no embed');
					let file = null;
					if (/\.m3u8/i.test(embedOrFile)) file = embedOrFile;
					else {
						try {
							const dec2 = await fetch(decoderProxy(embedOrFile));
							if (dec2.ok) {
								const jd2 = await dec2.json();
								file = jd2 && (jd2.file || jd2.link || jd2.url) ? (jd2.file || jd2.link || jd2.url) : null
							}
						} catch (e) {}
					}
					const final = file ? (file.startsWith('/proxy/') ? file : `/proxy/manifest?url=${encodeURIComponent(file)}&ref=${encodeURIComponent(file)}`) : embedOrFile;
					attachHls(final, file || embedOrFile);
					if (seriesTitleEl) seriesTitleEl.textContent = titleLabel || seriesTitleEl.textContent;
					if (episodeTitle) episodeTitle.textContent = titleLabel || ''
				} catch (e) {
					console.error(e);
					alert('Movie playback failed')
				}
			}
			async function playFlixEpisodeByDataId(dataId, titleLabel) {
				try {
					const serverId = await getFlixEpisodeServers(dataId, 'Vidcloud');
					if (!serverId) throw new Error('no server');
					const embed = await getFlixEmbedLink(serverId);
					if (!embed) throw new Error('no embed');
					let file = null;
					try {
						const dec = await fetch(decoderProxy(embed));
						if (dec.ok) {
							const jd = await dec.json();
							file = jd && (jd.file || jd.link || jd.url) ? (jd.file || jd.link || jd.url) : null
						}
					} catch (e) {}
					if (!file && /\.m3u8/i.test(embed)) file = embed;
					const final = file ? (file.startsWith('/proxy/') ? file : `/proxy/manifest?url=${encodeURIComponent(file)}&ref=${encodeURIComponent(file)}`) : embed;
					attachHls(final, file || embed);
					if (seriesTitleEl) seriesTitleEl.textContent = titleLabel || seriesTitleEl.textContent;
					if (episodeTitle) episodeTitle.textContent = titleLabel || ''
				} catch (e) {
					console.error(e);
					alert('Could not play episode')
				}
			}

			function renderSeasons() {
				if (seriesTitleEl) seriesTitleEl.textContent = seriesData?.title || URL_TITLE || 'Series';
				if (crumb) crumb.textContent = seriesData?.title || URL_TITLE || '';
				if (!seasonsList) return;
				seasonsList.innerHTML = '';
				(seriesData?.seasons || []).forEach((season) => {
					const sEl = document.createElement('div');
					sEl.className = 'season';
					const title = document.createElement('div');
					title.className = 'season-title';
					title.innerHTML = `<strong>${season.name}</strong><span>▸</span>`;
					sEl.appendChild(title);
					const episodesEl = document.createElement('div');
					episodesEl.className = 'episodes';
					episodesEl.style.display = 'none';
					async function renderEpisodesList(eps) {
						episodesEl.innerHTML = '';
						(eps || []).forEach((ep, idx) => {
							const epEl = document.createElement('div');
							epEl.className = 'episode';
							epEl.dataset.seasonId = season.id;
							epEl.dataset.episodeId = ep.data_id || ep.id || ep.episode || (idx + 1);
							epEl.textContent = ((idx + 1) + '. ' + (ep.title || `Episode ${idx+1}`));
							epEl.addEventListener('click', async () => {
								if (SOURCE === 'flixhq' && ep.data_id) {
									await playFlixEpisodeByDataId(ep.data_id, `${seriesData.title} · ${ep.title}`);
									hideSelector();
									return
								}
								await loadEpisode(season.id, ep.id || ep.episode || String(idx + 1));
								hideSelector()
							});
							episodesEl.appendChild(epEl)
						})
					}
					title.addEventListener('click', async () => {
						if (episodesEl.style.display === 'block') {
							episodesEl.style.display = 'none';
							return
						}
						if (SOURCE === 'flixhq' && (!season.episodes || !season.episodes.length)) {
							try {
								const eps = await fetchFlixSeasonEpisodes(season.id);
								eps.forEach((e, i) => e.index = i + 1);
								season.episodes = eps;
								await renderEpisodesList(eps)
							} catch (e) {
								episodesEl.innerHTML = '<div style="padding:8px;color:var(--muted)">Failed to load episodes</div>'
							}
						} else {
							await renderEpisodesList(season.episodes || [])
						}
						episodesEl.style.display = 'block'
					});
					sEl.appendChild(episodesEl);
					seasonsList.appendChild(sEl)
				});
				markCurrent()
			}

			function markCurrent() {
				document.querySelectorAll('.episode').forEach(el => {
					el.classList.toggle('current', el.dataset.seasonId === current.seasonId && el.dataset.episodeId === current.episodeId)
				})
			}
			async function loadSeries() {
				if (FILE_PARAM) {
					const fileDecoded = decodeURIComponent(FILE_PARAM);
					if (seriesTitleEl && URL_TITLE) seriesTitleEl.textContent = URL_TITLE;
					await publicPlay(fileDecoded, URL_TITLE, {
						type: 'embed'
					});
					return
				}
				if (!SLUG) {
					seriesData = {
						title: URL_TITLE || 'Series',
						seasons: []
					};
					renderSeasons();
					return
				}
				if (SOURCE === 'flixhq' && /\/movie\//i.test(SLUG)) {
					await playFlixMovieFromSlug(SLUG, URL_TITLE || SLUG);
					seriesData = {
						title: URL_TITLE || SLUG,
						seasons: []
					};
					renderSeasons();
					return
				}
				if (SOURCE === 'flixhq') {
					let mediaId = extractMediaIdFromFlixUrl(SLUG);
					if (!mediaId && /^https?:\/\//i.test(SLUG)) {
						try {
							const pageResp = await fetch(apiProxy(SLUG));
							if (pageResp.ok) {
								const html = await pageResp.text();
								mediaId = extractMediaIdFromFlixUrl(html) || extractMediaIdFromFlixUrl(SLUG)
							}
						} catch (e) {}
					}
					if (!mediaId) {
						seriesData = {
							title: URL_TITLE || SLUG,
							seasons: []
						};
						renderSeasons();
						return
					}
					try {
						const seasons = await fetchFlixSeasons(mediaId);
						seriesData = {
							title: URL_TITLE || ('Series ' + mediaId),
							seasons: seasons.map(s => ({
								id: s.id,
								name: s.name,
								episodes: []
							}))
						};
						try {
							const pageResp = await fetch(apiProxy(`https://flixhq.to/tv/${mediaId}`));
							if (pageResp.ok) {
								const html = await pageResp.text();
								const og = html.match(/<meta[^>]*property=["']og:title["'][^>]*content=["']([^"']+)["']/i);
								if (og && og[1]) seriesData.title = og[1].trim()
							}
						} catch (e) {}
						renderSeasons();
						if (URL_SEASON_INDEX && URL_EPISODE_INDEX) {
							const sIndex = Math.max(1, URL_SEASON_INDEX);
							const eIndex = Math.max(1, URL_EPISODE_INDEX);
							const season = seriesData.seasons[sIndex - 1];
							if (season) {
								try {
									const eps = await fetchFlixSeasonEpisodes(season.id);
									season.episodes = eps;
									const ep = eps[eIndex - 1];
									if (ep) {
										await playFlixEpisodeByDataId(ep.data_id, `${seriesData.title} · ${ep.title}`);
										return
									}
								} catch (e) {}
							}
						}
						if (URL_DATA_ID) {
							await playFlixEpisodeByDataId(URL_DATA_ID, seriesData.title);
							return
						}
						if (seriesData.seasons && seriesData.seasons[0]) {
							try {
								const firstSeason = seriesData.seasons[0];
								const eps = await fetchFlixSeasonEpisodes(firstSeason.id);
								firstSeason.episodes = eps;
								if (eps && eps[0]) {
									await playFlixEpisodeByDataId(eps[0].data_id, `${seriesData.title} · ${eps[0].title}`)
								}
							} catch (e) {}
						}
						return
					} catch (e) {
						seriesData = {
							title: URL_TITLE || SLUG,
							seasons: []
						};
						renderSeasons();
						return
					}
				}
				if (SOURCE === 'anime') {
					try {
						const resp = await fetch(`/proxy/anime/episodes?slug=${encodeURIComponent(SLUG)}`);
						if (!resp.ok) throw new Error('anime episodes fetch failed');
						const jd = await resp.json();
						const payload = jd && jd.data ? jd.data : jd;
						if (payload && payload.seasons && Array.isArray(payload.seasons)) {
							seriesData = {
								title: jd.title || URL_TITLE || SLUG,
								seasons: payload.seasons.map(s => ({
									id: s.id || s.name,
									name: s.name || s.title,
									episodes: (s.episodes || []).map(e => ({
										id: e.id || e.episode || String(Math.random()).slice(2),
										title: e.title || e.name || '',
										episodeNumber: e.episode || e.ep,
										hlsUrl: e.file || e.url || null,
										pageUrl: e.pageUrl || e.link || null,
										snapshot: e.snapshot || e.thumb || ''
									}))
								}))
							}
						} else {
							const eps = Array.isArray(payload) ? payload.map((e, i) => ({
								id: e.id || e.episode || String(i + 1),
								title: e.title || e.name || `Episode ${i+1}`,
								episodeNumber: e.episode || e.ep,
								hlsUrl: e.file || e.url || null,
								pageUrl: e.pageUrl || e.link || null,
								snapshot: e.snapshot || e.thumb || ''
							})) : [];
							seriesData = {
								title: jd.title || URL_TITLE || SLUG,
								seasons: [{
									id: 's1',
									name: 'Season 1',
									episodes: eps
								}]
							}
						}
						renderSeasons();
						if (URL_EPISODE) {
							for (const s of seriesData.seasons) {
								const ep = (s.episodes || []).find(e => String(e.episodeNumber) === String(URL_EPISODE) || String(e.id) === String(URL_EPISODE));
								if (ep) {
									await loadEpisode(s.id, ep.id);
									return
								}
							}
						}
						const first = seriesData.seasons?.[0]?.episodes?.[0];
						if (first) await loadEpisode(seriesData.seasons[0].id, first.id);
						return
					} catch (e) {
						seriesData = {
							title: URL_TITLE || SLUG,
							seasons: []
						};
						renderSeasons();
						return
					}
				}
				seriesData = {
					title: URL_TITLE || SLUG || 'Series',
					seasons: []
				};
				renderSeasons()
			}
			async function loadEpisode(seasonId, episodeId, options = {}) {
				if (!seriesData) return;
				const s = seriesData.seasons.find(ss => ss.id === seasonId);
				if (!s) return;
				const epMeta = s.episodes.find(e => String(e.id) === String(episodeId));
				if (!epMeta) return;
				current = {
					seasonId,
					episodeId,
					epMeta
				};
				markCurrent();
				if (episodeTitle) episodeTitle.textContent = `${seriesData.title} · ${epMeta.title||('Ep '+(epMeta.episodeNumber||episodeId))}`;
				if (SOURCE === 'anime' && SLUG && !options.skipOptionsFetch) {
					const epNum = epMeta.episodeNumber ? String(epMeta.episodeNumber) : String(epMeta.id || episodeId);
					const optsList = await fetchAnimeOptions(SLUG, epNum);
					if (optsList && optsList.length) populateAnimeOptions(optsList);
					else {
						if (audioSelect) audioSelect.innerHTML = `<option value="">Audio</option>`;
						if (qualitySelect) qualitySelect.innerHTML = `<option value="-1">Auto</option>`
					}
				}
				let finalSrc = epMeta.hlsUrl || epMeta.file || epMeta.url || epMeta.pageUrl || null;
				if (SOURCE === 'anime' && SLUG) {
					const epNum = epMeta.episodeNumber ? String(epMeta.episodeNumber) : String(epMeta.id || episodeId);
					const qs = new URLSearchParams({
						slug: SLUG,
						episode: epNum
					});
					if (audioSelect && audioSelect.value) qs.set('audio', audioSelect.value);
					if (qualitySelect && qualitySelect.value && qualitySelect.value !== '-1') {
						const val = qualitySelect.value;
						if (/^\d+$/.test(String(val))) qs.set('resolution', val)
					}
					const url = `/proxy/anime/m3u8?${qs.toString()}`;
					try {
						const resp = await fetch(url);
						if (resp.ok) {
							const jd = await resp.json();
							finalSrc = jd && jd.file ? jd.file : finalSrc
						}
					} catch (e) {}
					if (!finalSrc && epMeta.pageUrl) {
						try {
							const dec = await fetch(decoderProxy(epMeta.pageUrl));
							if (dec.ok) {
								const dj = await dec.json();
								finalSrc = dj && (dj.file || dj.link || dj.url) ? (dj.file || dj.link || dj.url) : finalSrc
							}
						} catch (e) {}
					}
				}
				if (!finalSrc) return;
				const proxied = finalSrc.startsWith('/proxy/') ? finalSrc : `/proxy/manifest?url=${encodeURIComponent(finalSrc)}&ref=${encodeURIComponent(finalSrc)}`;
				const resumeAt = options.resumeAt || 0;
				let attachSrc = proxied;
				if (String(finalSrc).startsWith('blob:') || String(finalSrc).startsWith('data:')) attachSrc = finalSrc;
				attachHls(attachSrc, finalSrc);
				try {
					localStorage.setItem('watch_last', JSON.stringify({ slug: SLUG || '', seasonId, episodeId, file: finalSrc }))
				} catch (e) {}

				try {
					if (watchAmHost && watchPartyCode) {
						watchEmitState({ action: 'load', url: finalSrc, title: seriesData?.title || URL_TITLE || '' })
						watchLog('host emitted load for', finalSrc)
					}
				} catch (e) { watchLog('loadEpisode emit error', e) }
				if (resumeAt && video) {
					const trySeek = () => {
						try {
							if (video.duration && resumeAt < (video.duration - 1)) {
								video.currentTime = resumeAt;
								return true
							}
							return false
						} catch (e) {
							return false
						}
					};
					if (!trySeek()) {
						const id = setInterval(() => {
							if (trySeek()) clearInterval(id)
						}, 250);
						setTimeout(() => clearInterval(id), 5000)
					}
				}
			}

			function showSelector() {
				selectorModal?.classList.remove('hidden');
				selectorModal?.setAttribute('aria-hidden', 'false')
			}

			function hideSelector() {
				selectorModal?.classList.add('hidden');
				selectorModal?.setAttribute('aria-hidden', 'true')
			}
			openSelector?.addEventListener('click', showSelector)
			closeSelector?.addEventListener('click', hideSelector)
			selectorModal?.addEventListener('click', e => {
				if (e.target === selectorModal) hideSelector()
			})
			async function publicPlay(urlOrPage, displayTitle, opts = {}) {
				let final = urlOrPage;
				if (!/\.m3u8/i.test(final) && !/\/proxy\/manifest\?/i.test(final)) {
					try {
						const dec = await fetch(decoderProxy(final));
						if (dec.ok) {
							const jd = await dec.json();
							const candidate = jd && (jd.file || jd.link || jd.url) ? (jd.file || jd.link || jd.url) : null;
							if (candidate) final = candidate
						}
					} catch (e) {}
				}
				if (/\.m3u8/i.test(final)) {
					final = final.startsWith('/proxy/') ? final : `/proxy/manifest?url=${encodeURIComponent(final)}&ref=${encodeURIComponent(final)}`;
					attachHls(final, final);
					if (seriesTitleEl && displayTitle) seriesTitleEl.textContent = displayTitle;
					if (episodeTitle && opts && opts.episodeTitle) episodeTitle.textContent = `${displayTitle} · ${opts.episodeTitle}`;
					return
				}
				try {
					const dec = await fetch(decoderProxy(urlOrPage));
					if (dec.ok) {
						const jd = await dec.json();
						const candidate = jd && (jd.file || jd.link || jd.url) ? (jd.file || jd.link || jd.url) : null;
						if (candidate && /\.m3u8/i.test(candidate)) {
							const proxied = candidate.startsWith('/proxy/') ? candidate : `/proxy/manifest?url=${encodeURIComponent(candidate)}&ref=${encodeURIComponent(candidate)}`;
							attachHls(proxied, candidate);
							return
						}
					}
				} catch (e) {}
				try {
					video.src = urlOrPage;
					video.load();
					video.play().catch(() => {})
				} catch (e) {}
			}
			playBtn?.addEventListener('click', () => {
				if (!video) return;
				if (video.paused) video.play();
				else video.pause();
				resetHideTimer()
			})
			video?.addEventListener('play', resetHideTimer)
			video?.addEventListener('pause', resetHideTimer)
			rewBtn?.addEventListener('click', () => {
				if (video) video.currentTime = Math.max(0, video.currentTime - 10)
			})
			fwdBtn?.addEventListener('click', () => {
				if (video) video.currentTime = Math.min(video.duration || 0, video.currentTime + 10)
			})
			let seeking = false
			video?.addEventListener('timeupdate', () => {
				if (!video) return;
				if (!seeking) {
					const pct = (video.currentTime / (video.duration || 1)) * 100;
					if (progressPlay) progressPlay.style.width = `${pct}%`;
					if (seek) seek.value = isFinite(pct) ? pct : 0;
					if (timeEl) timeEl.textContent = `${formatTime(video.currentTime)} / ${formatTime(video.duration)}`
				}
				try {
					const b = video.buffered;
					if (b && b.length) {
						const end = b.end(b.length - 1);
						const pct2 = (end / (video.duration || 1)) * 100;
						if (progressBuffer) progressBuffer.style.width = `${Math.min(100,pct2)}%`
					}
				} catch (e) {}
			})
			seek?.addEventListener('input', e => {
				seeking = true;
				const val = Number(e.target.value);
				if (progressPlay) progressPlay.style.width = `${val}%`;
				if (timeEl) timeEl.textContent = `${formatTime((val/100)*(video.duration||0))} / ${formatTime(video.duration)}`
			})
			seek?.addEventListener('change', e => {
				const val = Number(e.target.value);
				const t = (val / 100) * (video.duration || 0);
				if (video) video.currentTime = t;
				seeking = false
			})
			fsBtn?.addEventListener('click', async () => {
				try {
					if (!document.fullscreenElement) {
						if (playerRoot && playerRoot.requestFullscreen) await playerRoot.requestFullscreen();
						else if (video && video.webkitEnterFullscreen) try {
							video.webkitEnterFullscreen()
						} catch (e) {} else await document.documentElement.requestFullscreen()
					} else await document.exitFullscreen()
				} catch (e) {}
			})
			async function saveContinueWatching(orig) {
				try {
					if (!seriesData || !current || !current.epMeta) return;
					const title = seriesData.title || URL_TITLE || document.title;
					let url = SLUG || orig || FILE_PARAM || '';
					let seasonIndex = null;
					let episodeIndex = null;
					for (let i = 0; i < seriesData.seasons.length; i++) {
						if (seriesData.seasons[i].id === current.seasonId) {
							seasonIndex = i + 1;
							const epIndex = (seriesData.seasons[i].episodes || []).findIndex(e => String(e.id) === String(current.epMeta.id) || String(e.data_id) === String(current.epMeta.data_id) || String(e.episodeNumber) === String(current.epMeta.episodeNumber));
							if (epIndex >= 0) episodeIndex = epIndex + 1;
							break
						}
					}
					let thumb = '';
					if (SOURCE === 'anime') {
						thumb = current.epMeta.snapshot || current.epMeta.thumb || current.epMeta.poster || params.get('poster') || ''
					} else {
						thumb = params.get('poster') || seriesData.poster || current.epMeta.thumb || current.epMeta.poster || ''
					}
					const entry = {
						title,
						slug: SLUG || '',
						url: url,
						season: current.seasonId,
						episode: current.epMeta.episodeNumber || current.epMeta.id || '',
						seasonIndex,
						episodeIndex,
						data_id: current.epMeta.data_id || '',
						thumb
					};
					const key = `${entry.url}::${entry.season||''}::${entry.episode||''}`;
					const h = JSON.parse(localStorage.getItem('streamweb_history') || '[]');
					const filtered = h.filter(a => `${a.url}::${a.season||''}::${a.episode||''}` !== key);
					filtered.unshift({
						...entry,
						ts: Date.now()
					});
					localStorage.setItem('streamweb_history', JSON.stringify(filtered.slice(0, 200)))
				} catch (e) {
					console.warn('saveContinueWatching failed', e)
				}
			}
			async function resumeEntry(entry) {
				const u = entry.url;
				if (!u) return;
				const fileRegex = /\.m3u8/i;
				if (fileRegex.test(u)) {
					const file = /\/proxy\/manifest\?/.test(u) ? u : `/proxy/manifest?url=${encodeURIComponent(u)}`;
					window.location.href = `/player.html?file=${encodeURIComponent(file)}&title=${encodeURIComponent(entry.title||'Resume')}`;
					return
				}
				if (/^https?:\/\//i.test(u) && !/flixhq\.to\//i.test(u)) {
					window.location.href = `/player.html?file=${encodeURIComponent(u)}&title=${encodeURIComponent(entry.title||'Resume')}`;
					return
				}
				const item = {
					title: entry.title || 'Resume',
					url: u
				};
				if (entry.season && entry.episode && /anime/i.test(entry.type || '')) {
					const slug = entry.url || entry.slug || '';
					if (!slug) {
						alert('Missing slug for resume');
						return
					}
					window.location.href = `/player.html?source=anime&slug=${encodeURIComponent(slug)}&episode=${encodeURIComponent(entry.episode)}&title=${encodeURIComponent(entry.title||'')}&poster=${encodeURIComponent(entry.thumb||'')}`;
					return
				}
				if (entry.seasonIndex && entry.episodeIndex && entry.url && (entry.url.includes('flixhq.to') || entry.source === 'flixhq')) {
					window.location.href = `/player.html?source=flixhq&slug=${encodeURIComponent(entry.url)}&seasonIndex=${encodeURIComponent(entry.seasonIndex)}&episodeIndex=${encodeURIComponent(entry.episodeIndex)}&title=${encodeURIComponent(entry.title||'')}&poster=${encodeURIComponent(entry.thumb||'')}`;
					return
				}
				if (entry.data_id && entry.url && entry.url.includes('flixhq.to')) {
					window.location.href = `/player.html?source=flixhq&slug=${encodeURIComponent(entry.url)}&dataId=${encodeURIComponent(entry.data_id)}&title=${encodeURIComponent(entry.title||'')}&poster=${encodeURIComponent(entry.thumb||'')}`;
					return
				}
				window.location.href = `/player.html?source=flixhq&slug=${encodeURIComponent(entry.url)}&title=${encodeURIComponent(entry.title||'')}&poster=${encodeURIComponent(entry.thumb||'')}`
			}
			document.addEventListener('keydown', e => {
				if ((e.key === ' ' || e.code === 'Space') && !(document.activeElement && /input|textarea/i.test(document.activeElement.tagName))) {
					e.preventDefault();
					if (video) {
						if (video.paused) video.play();
						else video.pause()
					}
				}
				if (e.key === 'Escape') {
					if (document.fullscreenElement) document.exitFullscreen()
				}
			})
			window.player = window.player || {};
			window.player.play = publicPlay;
			window.player.playFlixEpisode = playFlixEpisodeByDataId;
			window.player.loadSeries = loadSeries
			loadSeries()
			try {
				watchSocket = (typeof io === 'function') ? io() : null;
				if (watchSocket) watchLog('socket initialized', watchSocket.id || '(no id yet)')
				try {
					const saved = JSON.parse(localStorage.getItem('watch_party') || 'null')
					if (saved && saved.code) {
						watchPartyCode = saved.code
						watchAmHost = !!saved.host
						watchLog('restored saved party', watchPartyCode, 'host=', watchAmHost)
					}
				} catch (e) { }

				const rightTop = document.querySelector('.right-top') || document.querySelector('.topbar');
				if (rightTop && watchSocket) {
					const dropdown = document.createElement('div');
					dropdown.className = 'watch-dropdown';
					rightTop.appendChild(dropdown);

					const toggle = document.createElement('button');
					toggle.className = 'watch-toggle';
					toggle.type = 'button';
					toggle.textContent = 'Party';
					dropdown.appendChild(toggle);

					const panel = document.createElement('div');
					panel.className = 'watch-panel';
					panel.innerHTML = `
						<div style="display:flex;align-items:center;gap:6px">
							<input id="watch-code" placeholder="CODE" maxlength="6" />
							<button id="create-party">Create</button>
							<button id="join-party">Join</button>
							<button id="host-toggle">Host</button>
						</div>
						<div class="status" id="watch-status">Not in party</div>
					`;
					dropdown.appendChild(panel);

					toggle.addEventListener('click', () => panel.classList.toggle('open'))

					const codeInput = panel.querySelector('#watch-code');
					const createBtn = panel.querySelector('#create-party');
					const joinBtn = panel.querySelector('#join-party');
					const hostBtn = panel.querySelector('#host-toggle');
					const statusEl = panel.querySelector('#watch-status');

					function setStatus(txt) { statusEl.textContent = txt; console.log('[watch][status]', txt) }

					createBtn.addEventListener('click', async () => {
						try {
							console.log('[watch][client] creating party...')
							const resp = await fetch('/watch/create', { method: 'POST', headers: { 'Content-Type': 'application/json' } });
							if (!resp.ok) { setStatus('create failed'); console.warn('[watch][client] create failed', resp.status); return }
							const jd = await resp.json();
							partyCode = jd.code;
							watchPartyCode = partyCode;
							codeInput.value = partyCode;
							localStorage.setItem('watch_party', JSON.stringify({ code: watchPartyCode, host: watchAmHost }))
							setStatus('Created '+partyCode)
							console.log('[watch][client] created', partyCode)
						} catch (e) { setStatus('create err'); console.error('[watch][client] create error', e) }
					})

					joinBtn.addEventListener('click', () => {
						const code = (codeInput.value||'').trim().toUpperCase();
						if (!code) return setStatus('enter code')
						watchPartyCode = code;
						localStorage.setItem('watch_party', JSON.stringify({ code: watchPartyCode, host: watchAmHost }))
						watchLog('joining', watchPartyCode)
						watchSocket.emit('watch:join', watchPartyCode, (res) => {
							watchLog('join cb', res)
							if (res && res.error) { setStatus('not found'); console.warn('[watch][client] join not found', watchPartyCode); return }
							setStatus('Joined '+watchPartyCode)
						})
					})

					hostBtn.addEventListener('click', () => {
						if (!watchPartyCode) return setStatus('no code')
						watchAmHost = !watchAmHost;
						hostBtn.textContent = watchAmHost ? 'Hosting' : 'Host';
						watchLog('host toggle', { code: watchPartyCode, host: watchAmHost })
						watchSocket.emit('watch:host', watchPartyCode, watchAmHost, (res) => {
							watchLog('host cb', res)
						})
						localStorage.setItem('watch_party', JSON.stringify({ code: watchPartyCode, host: watchAmHost }))
						setStatus(watchAmHost ? 'Hosting' : 'Joined '+watchPartyCode)
					})

					watchSocket.on('connect', () => watchLog('socket connect', watchSocket.id))
					watchSocket.on('disconnect', (reason) => watchLog('socket disconnect', reason))
					watchSocket.on('connect_error', (err) => watchLog('connect_error', err))

					watchSocket.on('watch:joined', (payload) => {
						watchLog('received watch:joined', payload)
						if (payload && payload.state) watchApplyRemoteState(payload.state, true)
					})

					watchSocket.on('watch:state', (state) => {
						watchLog('received watch:state', state)
						watchApplyRemoteState(state)
					})

					function emitState(state) {
						if (!watchSocket || !watchPartyCode) return
						watchLog('emitState', state)
						watchSocket.emit('watch:state', watchPartyCode, state)
					}


					video?.addEventListener('play', () => {
						watchLog('local play', { host: watchAmHost, code: watchPartyCode, applyingRemote: watchApplyingRemote, time: video?.currentTime })
						if (!watchAmHost || !watchPartyCode || watchApplyingRemote) return;
						emitState({ action: 'play', time: video.currentTime })
					})
					video?.addEventListener('pause', () => {
						watchLog('local pause', { host: watchAmHost, code: watchPartyCode, applyingRemote: watchApplyingRemote, time: video?.currentTime })
						if (!watchAmHost || !watchPartyCode || watchApplyingRemote) return;
						emitState({ action: 'pause', time: video.currentTime })
					})
					let seekTimeout = null;
					video?.addEventListener('seeking', () => {
						if (!watchAmHost || !watchPartyCode || watchApplyingRemote) return;
						if (seekTimeout) clearTimeout(seekTimeout);
						seekTimeout = setTimeout(()=>{
							emitState({ action: 'seek', time: video.currentTime })
						}, 150)
					})

					const origPublicPlay = publicPlay;
					publicPlay = async function(url, displayTitle, opts = {}) {
						await origPublicPlay(url, displayTitle, opts)
						if (watchAmHost && watchPartyCode) {
							watchEmitState({ action: 'load', url, title: displayTitle || '' })
							watchLog('publicPlay emitted load', url)
						}
					}

					try {
						const saved = JSON.parse(localStorage.getItem('watch_party') || 'null')
						if (saved && saved.code) {
							codeInput.value = saved.code
							watchPartyCode = saved.code
							watchAmHost = !!saved.host
							watchLog('auto-rejoin', watchPartyCode, 'host=', watchAmHost)
							watchSocket.emit('watch:join', watchPartyCode, (res) => {
								watchLog('auto join cb', res)
								if (res && res.error) return setStatus('join failed')
								setStatus('Joined '+watchPartyCode)
								if (watchAmHost) watchSocket.emit('watch:host', watchPartyCode, true, ()=>{})
							})
						}
					} catch (e) { watchLog('auto rejoin error', e) }
				}
			} catch (e) {
				console.error('[watch][client] initialization error', e)
			}
		})();
