import { getTrackStream, json } from "../_lib.mjs";

export async function GET(request, context) {
  try {
    return await getTrackStream(context.params.trackId, request);
  } catch (error) {
    return json({ error: error.message }, 404);
  }
}
