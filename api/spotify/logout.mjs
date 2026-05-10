import { clearSpotifySessionCookie, json } from "../_lib.mjs";

export async function POST(request) {
  return json(
    { ok: true },
    200,
    {
      "Set-Cookie": clearSpotifySessionCookie(request)
    }
  );
}
