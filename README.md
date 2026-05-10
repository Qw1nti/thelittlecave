# thelittlecave

A music-focused web app with Spotify account integration, persistent library uploads, and a Vercel-compatible serverless backend.

## What it does

- Plays audio files from a persistent cloud-backed library.
- Lets you import local files or folders directly in the browser and keep them after refreshes.
- Streams audio through Vercel Functions from here.now Drive storage.
- Connects to your Spotify account with OAuth and shows profile, playlists, recent tracks, and search results.
- Includes multiple monochrome presets plus per-theme custom color pickers stored in `localStorage`.
- Still supports the original local `server.js` workflow for machine-local development.

## Vercel deployment model

This repository now supports two modes:

- **Hosted / Vercel mode**
  - static frontend from `public/`
  - serverless API routes in `api/`
  - persistent media stored in here.now Drive
  - Spotify session stored in encrypted cookies
  - `spotdl` downloads are intentionally disabled
- **Local mode**
  - legacy `server.js`
  - local `library/` and `downloads/`
  - local `spotdl` execution

## Required environment variables for Vercel

Set these in your Vercel project settings:

- `SPOTIFY_CLIENT_ID`
- `SPOTIFY_CLIENT_SECRET`
- `SESSION_SECRET`
- `HERENOW_API_KEY`

Optional:

- `SPOTIFY_REDIRECT_URI`
- `HERENOW_DRIVE_ID`
- `HERENOW_DRIVE_NAME`
- `SPOTIFY_SCOPES`

If `SPOTIFY_REDIRECT_URI` is not set, the app computes it from the deployment origin as:

`https://your-domain/api/spotify/callback`

## Spotify setup

Create a Spotify app in the Spotify Developer Dashboard and add the redirect URI that matches your deployment:

- Vercel: `https://your-domain/api/spotify/callback`
- Local: `http://127.0.0.1:4310/api/spotify/callback`

## Local setup

1. Copy `.env.example` to `.env`.
2. Fill in `SPOTIFY_CLIENT_ID`, `SPOTIFY_CLIENT_SECRET`, and `SESSION_SECRET`.
3. Optionally set `HERENOW_API_KEY` if you want local imports mirrored into here.now Drive.
4. Install `spotdl` and make sure `spotdl` is on your `PATH`, or set `SPOTDL_BIN`.
5. Run `node server.js`.
6. Open `http://127.0.0.1:4310`.

## spotdl install example

`spotdl` is external to this repo. One common setup is:

```powershell
pip install spotdl
```

If you install it somewhere custom, point `SPOTDL_BIN` at that executable in `.env`.

## Notes

- Hosted Spotify routes only work after OAuth login with your own app credentials.
- Hosted uploads require `HERENOW_API_KEY` so files can persist in here.now Drive.
- Hosted mode does not run `spotdl`; downloads stay a local-only feature unless moved to a separate worker.
