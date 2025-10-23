# stream-web

Minimal static frontend for searching and playing anime / TV / movies using a small proxy backend for CORS, decoding embeds and manifest proxying.

## Contents

- Features
- Requirements
- Quick start 
- Config / environment
- Usage (player query params)
- Continue-watching / history
- Troubleshooting
- Contributing
- License

---

## Requirements

- Node.js 18+ (for running optional proxy)
- npm (or yarn)
- Modern browser (Chrome, Firefox, Safari)
- A proxy backend that exposes the `/proxy/*` endpoints used by the frontend (instructions below include a minimal example)

---

## Quick start
1. Clone the repo

```bash
git clone https://github.com/staticsenju/stream-web.git
cd stream-web
```

2. Install packages & run the server.

```bash
npm install && npm start
```

3. Open the app

- App: http://localhost:3000/
- Player page: http://localhost:3000/player.html
---

## Player query parameters

Open `player.html` with these query parameters:

- `source=anime|flixhq`
- `slug` — anime slug OR flixhq URL OR numeric media ID
- `episode` — anime episode number (for direct open)
- `seasonIndex` & `episodeIndex` — flixhq 1-based indices (for resume/direct open)
- `dataId` — flixhq episode `data_id` (preferred for direct play)
- `file` — direct m3u8 or embed URL; player will attempt to decode
- `title` — display title
- `poster` — poster image url (used for continue-watching thumbnail)

Examples:

- Anime: `/player.html?source=anime&slug=15732c54-...&episode=1`
- FlixHQ TV: `/player.html?source=flixhq&slug=<encoded-flix-url>`
- Movie: `/player.html?source=flixhq&slug=<encoded-flix-movie-url>`

---

## Continue-watching / history

- History is stored in localStorage under the key `streamweb_history`.
- Each entry includes: title, slug, url, season, episode, seasonIndex, episodeIndex, data_id, thumb, ts.
- The player saves a history entry automatically when playback starts (it uses episode snapshot for anime; poster for TV/movies — ensure the `poster` query param is passed from the search page to player).

---

## Troubleshooting

- Selectors (audio/resolution) not updating playback:
  - The player re-requests `/proxy/anime/m3u8?slug=...&episode=...&audio=...&resolution=...`. Confirm your proxy returns a valid JSON with `file` pointing to a playable `.m3u8`.
  - If selectors populate but selecting an option does nothing: check that the `quality` selector values are numeric resolution strings (e.g. `360`, `720`) for anime flow. For HLS-level selection (non-anime), the value is the hls.js level index.

- "Media resource ... could not be decoded":
  - Open network panel and inspect the `.m3u8` URL returned by `/proxy/anime/m3u8` or `/proxy/decoder`; try opening that URL directly in your browser or with `curl` to confirm validity.
  - If site uses hotlink protection, referer or cookies are required; implement those headers in the proxy.

- CORS errors when calling third-party endpoints:
  - The frontend expects `/proxy/fetch` — run the proxy on the same origin or configure CORS correctly.

- Continue-watching not saving:
  - Confirm localStorage is available and not blocked by browser or private mode.
  - Confirm the player is calling the save function after attaching the manifest (search for `saveContinueWatching` calls in `player.js`).

---

## Development notes

- `web/index.html` and `web/app.js` handle search and navigation. They redirect to `player.html`.
- `web/player.html` and `web/player.js` handle playback, HLS handling and selectors.
- Frontend uses hls.js (included via CDN in player) for HLS playback.
- The proxy/decoder is intentionally server-side; it must do the heavy lifting: scraping embed pages and extracting playable streams.

---

## Contributing

- Fork the repo, create a branch, make changes, and open a PR.
- Keep the proxy extraction logic isolated on the server.
- Include tests or manual verification instructions when changing player logic or decoder behavior.

---

## License

This project is licensed under the MIT license. 
