#!/usr/bin/env bash
#
# D54: builds the side-load APK on the owner's machine. Domain, package and key
# come from the environment, never from the repository. See twa/README.md.

set -euo pipefail

: "${TWA_HOST:?set TWA_HOST, the production domain without https://}"
: "${TWA_PACKAGE_ID:?set TWA_PACKAGE_ID, e.g. app.quantotempovale.twa}"
: "${TWA_KEYSTORE:?set TWA_KEYSTORE, the path to the .keystore file}"
export TWA_KEY_ALIAS="${TWA_KEY_ALIAS:-qtv}"
export TWA_VERSION="${TWA_VERSION:-1}"

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
out="$here/build"
mkdir -p "$out"

node - "$here/twa-manifest.template.json" "$out/twa-manifest.json" <<'NODE'
const fs = require("node:fs");
const [template, target] = process.argv.slice(2);
const env = process.env;
const manifest = JSON.parse(fs.readFileSync(template, "utf8"));
const origin = `https://${env.TWA_HOST}`;

manifest.host = env.TWA_HOST;
manifest.packageId = env.TWA_PACKAGE_ID;
manifest.iconUrl = origin + manifest.iconUrl;
manifest.maskableIconUrl = origin + manifest.maskableIconUrl;
manifest.webManifestUrl = origin + manifest.webManifestUrl;
manifest.signingKey = { path: env.TWA_KEYSTORE, alias: env.TWA_KEY_ALIAS };
manifest.appVersionCode = Number(env.TWA_VERSION);
manifest.appVersion = env.TWA_VERSION;

fs.writeFileSync(target, `${JSON.stringify(manifest, null, 2)}\n`);
NODE

cd "$out"
# Pinned so a rebuild a year from now makes the same project.
bubblewrap=(npx --yes @bubblewrap/cli@1.25.0)
"${bubblewrap[@]}" update --skipVersionUpgrade
"${bubblewrap[@]}" build

echo
echo "APK: $out/app-release-signed.apk"
echo "Fingerprint for TWA_SHA256_FINGERPRINTS in Coolify:"
keytool -list -v -keystore "$TWA_KEYSTORE" -alias "$TWA_KEY_ALIAS" | grep "SHA256:"
