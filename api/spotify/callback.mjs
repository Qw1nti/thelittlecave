import { exchangeSpotifyCode, json } from "../_lib.mjs";

export async function GET(request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");

  if (error) {
    return Response.redirect(`${url.origin}/?spotify_error=${encodeURIComponent(error)}`, 302);
  }

  if (!code || !state) {
    return Response.redirect(`${url.origin}/?spotify_error=invalid_callback`, 302);
  }

  try {
    const sessionCookie = await exchangeSpotifyCode(code, state);
    return new Response(null, {
      status: 302,
      headers: {
        Location: `${url.origin}/?spotify=connected`,
        "Set-Cookie": sessionCookie
      }
    });
  } catch (error) {
    return json({ error: error.message }, 400);
  }
}
