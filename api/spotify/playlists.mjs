import { json, spotifyApiRequest } from "../_lib.mjs";

export async function GET(request) {
  try {
    const result = await spotifyApiRequest(request, "https://api.spotify.com/v1/me/playlists?limit=12");
    const payload = await result.response.json();
    return json(payload, result.response.status, result.setCookie ? { "Set-Cookie": result.setCookie } : {});
  } catch (error) {
    return json({ error: error.message }, 500);
  }
}
