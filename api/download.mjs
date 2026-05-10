import { json } from "./_lib.mjs";

export async function POST() {
  return json(
    {
      error: "Hosted downloads are not available on Vercel.",
      message: "spotdl requires a local or separate worker environment."
    },
    501
  );
}
