# syntax=docker/dockerfile:1

# D20: Node 22 LTS. The .nvmrc pins the host and `engines` pins the install;
# this pins every machine that runs the image. Alpine is what keeps it small.
# Pinned by digest for the same reason the workflow actions were in #37: a
# floating tag makes two builds on different days resolve to different
# binaries. The tag stays in the comment because the digest does not say which
# version it is. This is the multi-arch index digest, so arm64 and amd64 both
# keep resolving. Bump the two together.
# node:22.23-alpine
FROM node@sha256:c610fcdfb1d5b4740dd70c284ed3cb16bb857e0f7166196e36a5501df7a3aa32 AS base
# Every `next build` reports usage to Vercel unless this is set, and CLAUDE.md
# says no external services. Declared here so the build stages inherit it.
ENV NEXT_TELEMETRY_DISABLED=1
WORKDIR /app
# D40: fail the build if a real secret is in its environment — Coolify's
# "Available at Buildtime" puts one in as an ARG after every FROM, and every
# RUN then records it in the image history. Every stage runs this before any
# RUN of its own. It lives in /usr/local/bin, not /app, so it is not part of
# the application tree; COPY records no build argument.
COPY --chmod=755 scripts/assert-no-build-secrets.sh /usr/local/bin/assert-no-build-secrets
RUN assert-no-build-secrets


# --- build base ------------------------------------------------------------
# Everything the two build stages share and the runtime must not inherit.
FROM base AS build-base
# D40, before any other RUN of this stage (see base). Two lines under FROM so
# the source excerpt of a failure does not show an ARG inserted after it.
RUN assert-no-build-secrets
# corepack reads `packageManager` from package.json, so pnpm arrives at the
# exact version the lockfile was written with.
RUN corepack enable
# The toolchain is here for better-sqlite3, which lands with the schema in #8.
# It ships a binding.gyp and no install script, so pnpm falls back to
# `node-gyp rebuild`, and node-gyp needs python3 and make just to evaluate that
# file — without them the install dies with "Could not find any Python
# installation to use". The gyp target then resolves the musl prebuild that
# ships in the tarball; g++ is what keeps this working if a future version
# stops shipping a prebuild for this platform.
RUN apk add --no-cache python3 make g++


# --- dependencies ----------------------------------------------------------
# Separate stage so a source-only change reuses the installed tree.
FROM build-base AS deps
# D40, before any other RUN of this stage (see base). Two lines under FROM so
# the source excerpt of a failure does not show an ARG inserted after it.
RUN assert-no-build-secrets
# pnpm-workspace.yaml is not optional here: it carries `engineStrict` (D20) and
# the `allowBuilds` allowlist. Without it pnpm refuses to run the build script
# of a native module and, with no TTY, that is an error rather than a prompt —
# `ERR_PNPM_IGNORED_BUILDS`, exit 1.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile
# `output: "standalone"` traces what the application imports, and no source
# file imports the varlock CLI — so the traced tree would not carry it and the
# runtime CMD would have nothing to run. Take the single package out of the
# pnpm store here (`-L` dereferences the symlink; varlock declares no
# dependencies and ships bundled) so the runner can copy 4.5 MB instead of
# inheriting a whole node_modules with the devDependencies in it.
RUN cp -RL node_modules/varlock /varlock

# The database CLIs of #44 run inside the published container and open the file
# with the same driver the app does, so better-sqlite3 has to be here too. The
# installed package is 26.3 MB and all but 2.4 MB of it is build input: the
# SQLite amalgamation under deps/, the C++ under src/, binding.gyp, and eight
# prebuilt binaries for platforms this image will never be. lib/binding.js
# picks `prebuilds/linuxmusl-<arch>.node` at require time by reading
# process.platform and process.arch — measured, and the reason `lib/`,
# `package.json` and the one matching prebuild are the whole runtime contract.
# TARGETARCH comes from BuildKit, so a build for either platform of the base
# image digest takes its own binary and no other.
ARG TARGETARCH
RUN set -eux; \
    case "$TARGETARCH" in \
      amd64) prebuild=linuxmusl-x64 ;; \
      arm64) prebuild=linuxmusl-arm64 ;; \
      *) echo "unsupported TARGETARCH: '${TARGETARCH}'" >&2; exit 1 ;; \
    esac; \
    mkdir -p /better-sqlite3/prebuilds; \
    cp -RL node_modules/better-sqlite3/lib /better-sqlite3/lib; \
    cp -L node_modules/better-sqlite3/package.json /better-sqlite3/package.json; \
    cp -L "node_modules/better-sqlite3/prebuilds/${prebuild}.node" \
       "/better-sqlite3/prebuilds/${prebuild}.node"


# --- build -----------------------------------------------------------------
FROM build-base AS builder
# D40, before any other RUN of this stage (see base). Two lines under FROM so
# the source excerpt of a failure does not show an ARG inserted after it.
RUN assert-no-build-secrets
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# `output: "standalone"` does not include public/ — Next documents that the
# folder has to be copied next to the server. The repo has no public/ yet, and
# a COPY of a path that does not exist fails the build, so create it here: the
# copy below is then valid whether the folder is empty or holds the first asset
# of #8, instead of the asset turning into a silent 404 nobody notices.
RUN mkdir -p public
# Varlock validates the schema during `next build` and exits 1 when a required
# item is empty, so the build cannot run bare. It must not run against the real
# values either. `pnpm build` now strips the resolved environment varlock
# writes into .next (#60), and the smoke checks the image for it, but a layer
# is a record of everything its step saw — a real value in scope here is one
# bug away from shipping. The .dockerignore keeps the owner's file out
# of the context (D23); these throwaway values are what satisfies the schema.
# None of them survives into the runtime — the CMD re-resolves every item.
RUN DATABASE_PATH=/data/kids.db \
    SESSION_SECRET=docker-build-placeholder-never-a-real-secret \
    pnpm build

# #44: `pnpm db:migrate` and `pnpm db:seed` run tsx over scripts/, src/db/ and
# drizzle/, and none of that reaches the runtime — `output: standalone` traces
# what a route imports, and no route imports a migration runner, so the traced
# tree never carries one. esbuild turns each script into one self-contained
# .mjs instead. That is what lets the published container migrate and seed with
# no tsx, no src/ and no toolchain in the final image. It runs here, in the
# stage that already holds the devDependencies, so esbuild itself never crosses
# into the runner. No environment is needed: the bundler reads types, not
# values, and the two `ENV.` reads stay as imports of `varlock/env`.
RUN pnpm db:bundle


# --- runtime ---------------------------------------------------------------
# From `base`, not `build-base`: no pnpm, no python3, no compiler.
FROM base AS runner
# D40, before any other RUN of this stage (see base). Two lines under FROM so
# the source excerpt of a failure does not show an ARG inserted after it.
RUN assert-no-build-secrets
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# The database file lives inside the volume, never in an image layer — that is
# the whole point of the issue: a redeploy replaces the container, not the data.
ENV DATABASE_PATH=/data/kids.db
RUN mkdir -p /data && chown node:node /data
VOLUME ["/data"]

# `output: "standalone"` (D22) already emits a node_modules holding only the
# production dependencies the build traced — no devDependencies, no pnpm store.
# Copying it under the same path it has in the repo keeps the start command
# identical on the host and in the image.
COPY --from=builder --chown=node:node /app/.next/standalone ./.next/standalone
COPY --from=builder --chown=node:node /app/.next/static ./.next/standalone/.next/static
COPY --from=builder --chown=node:node /app/public ./.next/standalone/public

# The two files `varlock run` needs at runtime. The schema is what says which
# items exist and which are required; the CLI is what reads it, resolves the
# values from the process environment and refuses to start when one is empty.
COPY --from=builder --chown=node:node /app/.env.schema ./.env.schema
COPY --from=deps --chown=node:node /varlock ./node_modules/varlock
# The schema asks varlock to generate this type file, and `varlock run` acts on
# that on every start. Taking the one the build already produced means the
# runtime rewrites a file it owns instead of dying with EACCES trying to create
# it in a directory owned by root — verified running, the container exited on
# the first start without it.
COPY --from=builder --chown=node:node /app/env.d.ts ./env.d.ts

# #44: the two database CLIs, and the three things they need.
#
# The bundles are self-contained apart from two imports left external on
# purpose. `varlock/env` resolves to the copy above, which keeps the runtime
# reading the same resolved environment the server does. `better-sqlite3`
# cannot be bundled at all — it loads a native binary — so the trimmed package
# from the deps stage lands beside varlock. Node resolves both by walking up
# from /app/dist/db to /app/node_modules.
COPY --from=builder --chown=node:node /app/dist ./dist
COPY --from=deps --chown=node:node /better-sqlite3 ./node_modules/better-sqlite3
# The .sql files, plus the meta/ journal the drizzle migrator reads to know
# what it has already applied. `migrationsFolder` in src/db/migrate.ts is
# `new URL("../../drizzle", import.meta.url)`, and a bundler keeps that
# expression as written — inside the bundle it resolves against the bundle's
# own path, not against the path the source file had. So /app/dist/db sits two
# directories under /app, the same two that src/db sits under the repo root,
# and /app/drizzle is where both of them point. The RUN further down is what
# proves that, at build time, rather than on a deploy night.
COPY --from=builder --chown=node:node /app/drizzle ./drizzle

USER node
EXPOSE 3000

# #43: two failures that used to wait for `docker run` and now happen during
# `docker build`. As `node`, because that is the user that will hit them.
#
# The first is the varlock copy. Taking one directory out of the pnpm store
# with `cp -RL` is only correct while varlock declares no dependencies; the day
# a release declares one, the copied tree is short a package and the container
# dies on start with MODULE_NOT_FOUND — in production, on a Sunday. Asking the
# CLI for its version is enough to load it and find out here instead.
#
# The second is the whole of #44, end to end: the bundles parse, better-sqlite3
# finds a prebuild for this architecture, `migrationsFolder` resolves to
# /app/drizzle, the migrator builds the schema from zero and the seed fills it.
#
# The values are throwaway, and the layer deletes the database it made. Same
# rule as the build stage and for the same reason: whatever a layer sees gets
# written down, so nothing real may be in scope when one is. The icon cache is
# varlock's own scratch directory, deleted for the same reason: a build step
# leaves the image as it found it.
RUN set -eu; \
    node node_modules/varlock/bin/cli.js --version; \
    DATABASE_PATH=/tmp/build-check/kids.db \
    SESSION_SECRET=docker-build-placeholder-never-a-real-secret \
    node node_modules/varlock/bin/cli.js run -- node dist/db/db-seed.mjs; \
    rm -rf /tmp/build-check /tmp/varlock-icon-cache

# An `ENV.` read from a file marked "use client" compiles, builds and starts
# fine, and only fails on the first request — where varlock takes the whole
# process down (exit 143, verified in #41). Without this the orchestrator sees
# a container that is up and serving nothing. The check plus a restart policy
# on the deploy side (`--restart unless-stopped`, or the equivalent field in
# Coolify) turn that into a blip instead of an outage for the four users.
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]

# `next start` refuses to serve a standalone build — the generated server is
# the entry point, and the `start` script in package.json spells the same
# command. It is wrapped in `varlock run` for two reasons, both verified
# running: on its own the generated server validates nothing, so a container
# missing a required item answers 200 as if it were fine; and it serves the
# value that was present at build time, so a password changed in the deploy
# panel would be silently ignored until someone rebuilt the image. `varlock
# run` resolves the schema at start, names what is missing and exits, and
# hands the resolved values to the server. The CLI is called by path because
# node_modules/.bin is not on PATH in this stage.
CMD ["node", "node_modules/varlock/bin/cli.js", "run", "--", "node", ".next/standalone/server.js"]
