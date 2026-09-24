#!/bin/sh
#
# D40: first RUN of each stage, so no later RUN records a secret that Coolify's
# default inserted as an ARG. Unset, empty or the Dockerfile's own placeholder
# pass. Only the name is printed, never the value.

set -eu

status=0

check() {
  name="$1"
  shift
  value="$(printenv "$name" || true)"
  [ -z "$value" ] && return 0
  for allowed in "$@"; do
    [ "$value" = "$allowed" ] && return 0
  done
  echo "ERROR: ${name} is set in the image build environment." >&2
  status=1
}

check DATABASE_PATH /data/kids.db
check SESSION_SECRET docker-build-placeholder-never-a-real-secret

if [ "$status" -ne 0 ]; then
  echo "       Runtime secrets must not reach \`docker build\`: whatever a RUN sees" >&2
  echo "       is written into the image history. In Coolify, uncheck" >&2
  echo "       \"Available at Buildtime\" for these variables (docs/deploy.md)." >&2
fi

exit "$status"
