import { importTrackToDrive, json, resolveImportPath } from "../_lib.mjs";

export async function POST(request) {
  try {
    const relativePath = resolveImportPath(
      request.headers.get("x-relative-path"),
      request.headers.get("x-file-name")
    );
    const fileBuffer = Buffer.from(await request.arrayBuffer());
    if (!fileBuffer.length) {
      return json({ error: "Uploaded file is empty." }, 400);
    }

    const result = await importTrackToDrive(
      relativePath,
      fileBuffer,
      request.headers.get("content-type") || "application/octet-stream"
    );
    return json(
      {
        message: "Track imported.",
        ...result
      },
      201
    );
  } catch (error) {
    return json({ error: error.message }, 400);
  }
}
