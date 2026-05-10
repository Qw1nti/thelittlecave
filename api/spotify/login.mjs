import { createSpotifyLoginUrl, isSpotifyConfigured, json } from "../_lib.mjs";

export async function GET(request) {
  if (!isSpotifyConfigured()) {
    return json(
      {
        error: "Spotify credentials are not configured. Set SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET, and SESSION_SECRET in Vercel."
      },
      400
    );
  }

  return Response.redirect(createSpotifyLoginUrl(request), 302);
}
