import { json, listLibraryTracks } from "./_lib.mjs";

export async function GET() {
  const tracks = await listLibraryTracks();
  return json({ tracks });
}
