import { getAppConfig, getSpotifySession, json } from "../_lib.mjs";

export async function GET(request) {
  const config = getAppConfig(request);
  if (!config.spotifyConfigured) {
    return json({
      configured: false,
      connected: false
    });
  }

  try {
    const sessionResult = await getSpotifySession(request);
    return json(
      {
        configured: true,
        connected: Boolean(sessionResult?.session),
        expiresAt: sessionResult?.session?.expiresAt || null
      },
      200,
      sessionResult?.setCookie ? { "Set-Cookie": sessionResult.setCookie } : {}
    );
  } catch (error) {
    return json({ configured: true, connected: false, error: error.message });
  }
}
