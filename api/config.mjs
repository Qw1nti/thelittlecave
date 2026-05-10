import { getAppConfig, json } from "./_lib.mjs";

export async function GET(request) {
  return json(getAppConfig(request));
}
