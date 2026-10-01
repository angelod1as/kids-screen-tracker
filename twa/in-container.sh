#!/usr/bin/env bash
#
# Runs inside the image built from twa/Dockerfile, called by twa/apk.sh.

set -euo pipefail

node - /twa/twa-manifest.template.json /work/twa-manifest.json <<'NODE'
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
manifest.signingKey = { path: "/key/qtv.keystore", alias: "qtv" };
manifest.appVersionCode = Number(env.TWA_VERSION);
manifest.appVersion = env.TWA_VERSION;

fs.writeFileSync(target, `${JSON.stringify(manifest, null, 2)}\n`);
NODE

export BUBBLEWRAP_KEY_PASSWORD="$BUBBLEWRAP_KEYSTORE_PASSWORD"
bubblewrap update --skipVersionUpgrade
bubblewrap build

cp app-release-signed.apk /key/quanto-tempo-vale.apk
