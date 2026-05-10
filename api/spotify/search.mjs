import { json, spotifyApiRequest } from "../_lib.mjs";

export async function GET(request) {
  const url = new URL(request.url);
  const query = url.searchParams.get("q") || "";
  if (!query.trim()) {
    return json({ error: "Missing search query." }, 400);
  }

  try {
    const result = await spotifyApiRequest(
      request,
      `https://api.spotify.com/v1/search?type=track&limit=8&q=${encodeURIComponent(query)}`
    );
    const payload = await result.response.json();
    return json(payload, result.response.status, result.setCookie ? { "Set-Cookie": result.setCookie } : {});
  } catch (error) {
    return json({ error: error.message }, 500);
  }
}
