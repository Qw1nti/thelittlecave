import { json } from "./_lib.mjs";

export async function GET() {
  return json({
    jobs: [],
    supported: false,
    message: "Hosted downloads are not available on Vercel."
  });
}
