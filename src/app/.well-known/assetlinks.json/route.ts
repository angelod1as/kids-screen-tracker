import { ENV } from "varlock/env";

import { assetLinks } from "./asset-links";

export const runtime = "nodejs";
// Read at request time: the build only sees placeholders (D40).
export const dynamic = "force-dynamic";

export function GET() {
  return Response.json(
    assetLinks(ENV.TWA_PACKAGE_ID, ENV.TWA_SHA256_FINGERPRINTS),
  );
}
