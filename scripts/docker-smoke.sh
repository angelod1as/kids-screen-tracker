#!/usr/bin/env bash
#
# Runs a built image the way a deploy does (#43, #44, #30, D40): assumptions
# about the build output fail at `docker run`, never at `docker build`.
#
# #104 ships db-demo.mjs in the image too, so it runs here and --clear must
# leave the seed exactly as it was.
#
# Usage:
#
#   docker build --tag kids-screen-tracker:ci .
#   ./scripts/docker-smoke.sh kids-screen-tracker:ci
#
# Builds nothing but the one build the D40 guard must refuse. Only throwaway
# values, never a secret (D23). SMOKE_PREFIX and SMOKE_PORT make it safe to run
# on a laptop that already has other containers up.

set -euo pipefail

image="${1:-kids-screen-tracker:ci}"
prefix="${SMOKE_PREFIX:-kst-smoke}"
port="${SMOKE_PORT:-31337}"

app="${prefix}-app"
app_restarted="${prefix}-app-restarted"
missing_var="${prefix}-missing-var"
restorer="${prefix}-restorer"
volume="${prefix}-data"
buildtime_tag="${prefix}-buildtime-secret"
buildtime_dir="$(mktemp -d)"
repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Throwaway, and named so that a grep of the image can prove they are absent.
smoke_secret="smoke-not-a-real-secret-do-not-use-anywhere"

# Fed to `next build` by the Dockerfile; found in the image, it means #60's
# strip stopped working and a real build would ship its values.
build_placeholder="docker-build-placeholder"

total=14
step=0

section() {
  step=$((step + 1))
  printf '\n[%d/%d] %s\n' "$step" "$total" "$1"
}

ok() {
  printf '       ok — %s\n' "$1"
}

fail() {
  printf '       FAIL — %s\n' "$1" >&2
  exit 1
}

# Removes only what this script created, by name: never prune, never a pattern.
# `--volumes` catches the anonymous /data volume of the unmounted container.
cleanup() {
  docker rm --force --volumes "$app" "$app_restarted" "$missing_var" \
    "$restorer" >/dev/null 2>&1 || true
  docker volume rm "$volume" >/dev/null 2>&1 || true
  docker image rm --force "$buildtime_tag" >/dev/null 2>&1 || true
  rm -rf "$buildtime_dir"
}

trap cleanup EXIT
# Also up front: reusing a dead run's volume proves nothing about an empty one.
cleanup

# DATABASE_PATH is deliberately not passed: the image's default must work.
start_container() {
  docker run --detach --name "$1" \
    --publish "127.0.0.1:${port}:3000" \
    --volume "${volume}:/data" \
    --env "SESSION_SECRET=${smoke_secret}" \
    "$image" >/dev/null
}

# Reads .State.Health, not curl: a container can serve 200 with a broken
# HEALTHCHECK, and an orchestrator would then never restart it.
wait_for_health() {
  local container="$1" deadline=$((SECONDS + 180)) status
  while :; do
    status="$(docker inspect --format '{{.State.Health.Status}}' "$container")"
    case "$status" in
      healthy) return 0 ;;
      unhealthy)
        docker logs "$container" 2>&1 | tail -40
        fail "$container reported unhealthy"
        ;;
    esac
    if [ "$SECONDS" -ge "$deadline" ]; then
      docker logs "$container" 2>&1 | tail -40
      fail "$container never reached healthy (last status: ${status})"
    fi
    sleep 2
  done
}

# Spelled exactly as docs/deploy.md spells it (#44), so the doc is tested.
db_cli() {
  local container="$1" script="$2"
  shift 2
  docker exec "$container" \
    node node_modules/varlock/bin/cli.js run -- node "dist/db/${script}" "$@"
}

# SQL from stdin, the way docs/deploy.md tells the owner to write `users` (D45).
db_sql() {
  docker exec -i "$1" node -e '
    const Database = require("/app/node_modules/better-sqlite3");
    new Database(process.env.DATABASE_PATH).exec(require("node:fs").readFileSync(0, "utf8"));
  '
}

# Through the image's own better-sqlite3, so it also proves the native binding
# loads in the runtime stage.
db_summary() {
  docker exec "$1" node -e '
    const Database = require("/app/node_modules/better-sqlite3");
    const db = new Database(process.env.DATABASE_PATH);
    const count = (table) =>
      db.prepare("select count(*) as c from " + table).get().c;
    process.stdout.write(
      "migrations=" + count("__drizzle_migrations") +
      " users=" + count("users") +
      " categories=" + count("categories") +
      " activities=" + count("activities") +
      " user_version=" + db.pragma("user_version", { simple: true }) + "\n",
    );
  '
}

# Read from the journal, not pinned, so adding a migration breaks nothing here.
committed_migrations="$(
  cd "$(dirname "${BASH_SOURCE[0]}")/.." &&
    node -e 'process.stdout.write(String(require("./drizzle/meta/_journal.json").entries.length))'
)"

printf 'image:  %s\n' "$image"
printf 'prefix: %s\n' "$prefix"

section "the image exists and reports its size"
if ! docker image inspect "$image" >/dev/null 2>&1; then
  fail "no such image: ${image} — build it first"
fi
# Labelled: `.Size` is compressed on containerd and uncompressed on overlay2,
# about 3x apart, so two engines' numbers are not a regression.
image_bytes="$(docker image inspect "$image" --format '{{.Size}}')"
ok "$(printf 'docker image inspect on this engine: %s bytes (%s MB)' "$image_bytes" \
  "$(LC_ALL=C awk -v b="$image_bytes" 'BEGIN { printf "%.1f", b / 1000000 }')")"
fs_kib="$(docker run --rm --entrypoint sh "$image" -c 'du -sk -x / 2>/dev/null | cut -f1')"
ok "$(LC_ALL=C awk -v k="$fs_kib" \
  'BEGIN { printf "uncompressed filesystem in the image: %d bytes (%.1f MB)", k * 1024, k * 1024 / 1000000 }')"

section "the container refuses to start with a required item missing"
# Why the CMD is wrapped in `varlock run`: otherwise a value removed from the
# deploy panel goes unnoticed. SESSION_SECRET is the one left out.
docker run --detach --name "$missing_var" \
  "$image" >/dev/null
deadline=$((SECONDS + 60))
while [ "$(docker inspect --format '{{.State.Running}}' "$missing_var")" = true ]; do
  if [ "$SECONDS" -ge "$deadline" ]; then
    fail "container started and kept running without SESSION_SECRET"
  fi
  sleep 1
done
missing_exit="$(docker inspect --format '{{.State.ExitCode}}' "$missing_var")"
[ "$missing_exit" != 0 ] || fail "container exited 0 without SESSION_SECRET"
# Trap: `docker logs | grep -q` fails under pipefail once grep exits early and
# the log is too big to buffer. Capture first, match after.
missing_logs="$(docker logs "$missing_var" 2>&1)"
case "$missing_logs" in
  *SESSION_SECRET*) ;;
  *)
    printf '%s\n' "$missing_logs"
    fail "the failure did not name SESSION_SECRET"
    ;;
esac
ok "exited ${missing_exit} and named SESSION_SECRET"
docker rm --force --volumes "$missing_var" >/dev/null

section "it starts on an empty volume, becomes healthy and serves the app"
docker volume create "$volume" >/dev/null
start_container "$app"
wait_for_health "$app"
ok "HEALTHCHECK reached healthy"
# `/` redirects by role (#12, #14). Not `--location`: it would report 200 for
# a redirect to the wrong screen.
http_code="$(curl --silent --show-error --output /dev/null \
  --write-out '%{http_code}' "http://127.0.0.1:${port}/")"
[ "$http_code" = 307 ] || fail "GET / answered ${http_code}, expected a redirect"
location="$(curl --silent --show-error --output /dev/null \
  --write-out '%{redirect_url}' "http://127.0.0.1:${port}/")"
case "$location" in
  */entrar) ;;
  *) fail "GET / redirected to [${location}], expected /entrar" ;;
esac
login_code="$(curl --silent --show-error --output /dev/null \
  --write-out '%{http_code}' "http://127.0.0.1:${port}/entrar")"
[ "$login_code" = 200 ] || fail "GET /entrar answered ${login_code}"
ok "GET / answered 307 to ${location}, and GET /entrar answered 200"

section "the volume is empty until a migration runs"
# So the next step proves creating the schema from zero.
db_files="$(docker exec "$app" sh -c 'ls -A /data' | tr '\n' ' ')"
[ -z "${db_files// /}" ] || fail "/data was not empty: ${db_files}"
ok "/data is empty"

section "migrate creates the schema from zero"
db_cli "$app" db-migrate.mjs
summary="$(db_summary "$app")"
expected="migrations=${committed_migrations} users=0 categories=0 activities=0 user_version=0"
[ "$summary" = "$expected" ] || fail "expected [${expected}], got [${summary}]"
ok "$summary"

section "seed writes the initial data, and both halves are idempotent"
db_cli "$app" db-seed.mjs
summary="$(db_summary "$app")"
expected="migrations=${committed_migrations} users=0 categories=7 activities=32 user_version=0"
[ "$summary" = "$expected" ] || fail "expected [${expected}], got [${summary}]"
ok "$summary"
# Idempotent, so the pair is safe on every deploy.
db_cli "$app" db-migrate.mjs
second_seed="$(db_cli "$app" db-seed.mjs)"
printf '%s\n' "$second_seed"
case "$second_seed" in
  *"inserted 0 categories, 0 activities"*) ;;
  *) fail "a second seed did not report an empty insert" ;;
esac
summary="$(db_summary "$app")"
[ "$summary" = "$expected" ] || fail "a second run changed the data: ${summary}"
ok "a second migrate and seed inserted nothing"

section "people are written by hand, with SQL"
db_sql "$app" <<'SQL'
INSERT INTO users (username, display_name, role) VALUES
  ('admin1', 'Admin1', 'admin'), ('admin2', 'Admin2', 'admin'),
  ('kid1', 'Kid1', 'kid'), ('kid2', 'Kid2', 'kid');
SQL
summary="$(db_summary "$app")"
expected="migrations=${committed_migrations} users=4 categories=7 activities=32 user_version=0"
[ "$summary" = "$expected" ] || fail "expected [${expected}], got [${summary}]"
ok "$summary"

section "db-demo writes demo rows, and --clear returns to the seeded state"
demo_out="$(db_cli "$app" db-demo.mjs)"
printf '%s\n' "$demo_out"
case "$demo_out" in
  *"Demo rows now in the database: 0 logs"*) fail "db-demo wrote no rows" ;;
  *"Demo rows now in the database: "*) ;;
  *) fail "db-demo did not report its rows" ;;
esac
clear_out="$(db_cli "$app" db-demo.mjs --clear)"
printf '%s\n' "$clear_out"
case "$clear_out" in
  *"Demo rows now in the database: 0 logs and 0 ledger rows."*) ;;
  *) fail "db-demo --clear left demo rows behind" ;;
esac
summary="$(db_summary "$app")"
[ "$summary" = "$expected" ] || fail "db-demo --clear changed the seed: ${summary}"
ok "demo written and cleared, seed intact"

section "the data survives the container being replaced"
# A redeploy replaces the container. The marker tells a persisted volume apart
# from a seed that ran twice.
docker exec "$app" node -e '
  const Database = require("/app/node_modules/better-sqlite3");
  new Database(process.env.DATABASE_PATH).pragma("user_version = 4242");
' >/dev/null
docker stop "$app" >/dev/null
docker rm "$app" >/dev/null
start_container "$app_restarted"
wait_for_health "$app_restarted"
summary="$(db_summary "$app_restarted")"
expected="migrations=${committed_migrations} users=4 categories=7 activities=32 user_version=4242"
[ "$summary" = "$expected" ] || fail "expected [${expected}], got [${summary}]"
ok "$summary"

section "a new migration applies to a volume that already holds rows"
# #44: stages a throwaway migration in the container to prove the migrator
# applies only what is missing and leaves existing rows alone.
docker exec "$app_restarted" node -e '
  const fs = require("node:fs");
  const tag = "9999_smoke_probe";
  const journalPath = "/app/drizzle/meta/_journal.json";
  const journal = JSON.parse(fs.readFileSync(journalPath, "utf8"));
  fs.writeFileSync(
    "/app/drizzle/" + tag + ".sql",
    "CREATE TABLE `smoke_probe` (`id` integer PRIMARY KEY NOT NULL);\n",
  );
  journal.entries.push({
    idx: journal.entries.length,
    version: "6",
    when: Date.now(),
    tag,
    breakpoints: true,
  });
  fs.writeFileSync(journalPath, JSON.stringify(journal, null, 2));
' >/dev/null
db_cli "$app_restarted" db-migrate.mjs
summary="$(db_summary "$app_restarted")"
expected="migrations=$((committed_migrations + 1)) users=4 categories=7 activities=32 user_version=4242"
[ "$summary" = "$expected" ] || fail "expected [${expected}], got [${summary}]"
docker exec "$app_restarted" node -e '
  const Database = require("/app/node_modules/better-sqlite3");
  const db = new Database(process.env.DATABASE_PATH);
  const found = db
    .prepare("select count(*) as c from sqlite_master where type = ? and name = ?")
    .get("table", "smoke_probe").c;
  if (found !== 1) {
    throw new Error("the new migration did not create its table");
  }
' >/dev/null
ok "${summary}, and smoke_probe was created"

section "restoring over the same volume discards an uncheckpointed write, and the app can write again"
# Follows docs/deploy.md's restore exactly (#30). Trap: `docker exec` on the
# stopped app fails, and `docker cp` keeps the host uid, so the `node` user gets
# SQLITE_READONLY. Hence the throwaway `--user node` container.
backup_in_container="/data/smoke-backup.db"
db_cli "$app_restarted" db-backup.mjs "$backup_in_container"
backup_host_dir="$(mktemp -d)"
docker cp "${app_restarted}:${backup_in_container}" "${backup_host_dir}/backup.db" >/dev/null
docker exec "$app_restarted" rm -f "$backup_in_container"
before_restore="$(db_summary "$app_restarted")"

# Uncheckpointed (connection left open): a restore that kept the old -wal/-shm
# would bring it back.
docker exec "$app_restarted" node -e '
  const Database = require("/app/node_modules/better-sqlite3");
  new Database(process.env.DATABASE_PATH).pragma("user_version = 13131313");
' >/dev/null
after_uncheckpointed_write="$(db_summary "$app_restarted")"
[ "$after_uncheckpointed_write" != "$before_restore" ] ||
  fail "the post-backup write changed nothing, so this step would prove nothing"

docker stop "$app_restarted" >/dev/null

docker run --rm --name "$restorer" --user node \
  --volume "${volume}:/data" \
  --volume "${backup_host_dir}/backup.db:/restore.db:ro" \
  "$image" \
  sh -c 'rm -f /data/kids.db-wal /data/kids.db-shm && cp /restore.db /data/kids.db'
rm -rf "$backup_host_dir"

docker start "$app_restarted" >/dev/null
wait_for_health "$app_restarted"
after_restore="$(db_summary "$app_restarted")"
[ "$after_restore" = "$before_restore" ] ||
  fail "restore produced [${after_restore}], expected the backed-up [${before_restore}] — not the discarded write [${after_uncheckpointed_write}]"
ok "restore discarded the uncheckpointed write and matched the backup: ${after_restore}"

# Reading is not writing: a read-only restored file passes the count above.
docker exec "$app_restarted" node -e '
  const Database = require("/app/node_modules/better-sqlite3");
  const db = new Database(process.env.DATABASE_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("user_version = 424242");
  db.close();
' >/dev/null
after_write="$(docker exec "$app_restarted" node -e '
  const Database = require("/app/node_modules/better-sqlite3");
  process.stdout.write(
    String(new Database(process.env.DATABASE_PATH).pragma("user_version", { simple: true })),
  );
')"
[ "$after_write" = "424242" ] ||
  fail "a write after the restore did not take: user_version=${after_write}"
ok "the restored database accepts writes as the node user (user_version=${after_write})"

section "the image carries no toolchain and no real values"
# Inside the image, so the claims are about the artefact, not the repository.
docker run --rm --entrypoint sh "$image" -c '
  set -eu

  installed="$(ls -1 /app/node_modules | sort | tr "\n" " ")"
  if [ "$installed" != "better-sqlite3 varlock " ]; then
    echo "FAIL — /app/node_modules holds: ${installed}" >&2
    exit 1
  fi
  echo "       ok — /app/node_modules holds only better-sqlite3 and varlock"

  for unwanted in tsx esbuild drizzle-kit typescript vitest pnpm; do
    # Captured rather than piped into `grep -q`. Not because of pipefail — the
    # shell inside this container does not set it — but because a pipe hides
    # find failing: an unreadable directory, a path that moved, and grep sees
    # nothing, returns 1, and the guard reports OK for the wrong reason. Under
    # `set -e` an unsuccessful find takes the whole check down instead.
    found="$(find /app -maxdepth 6 -name "$unwanted")"
    if [ -n "$found" ]; then
      echo "FAIL — ${unwanted} reached the runtime image: ${found}" >&2
      exit 1
    fi
    if command -v "$unwanted" >/dev/null 2>&1; then
      echo "FAIL — ${unwanted} is on PATH in the runtime image" >&2
      exit 1
    fi
  done
  echo "       ok — no tsx, esbuild, drizzle-kit, typescript, vitest or pnpm"

  # #60: `next build` used to leave the resolved environment graph in .next in
  # clear text, and .next ships inside the image. `pnpm build` strips it now.
  # The Dockerfile still builds with placeholders; this asserts that not even
  # those reached the image.
  found="$(grep -rl "'"$build_placeholder"'" /app/.next || true)"
  if [ -n "$found" ]; then
    echo "FAIL — the build-time environment is inside .next: ${found}" >&2
    exit 1
  fi
  echo "       ok — the build-time environment is not inside .next"
'
# The whole filesystem, not only .next.
leaked="$(docker run --rm --entrypoint sh "$image" -c \
  "grep -rl 'smoke-not-a-real' /app 2>/dev/null || true")"
[ -z "$leaked" ] || fail "the smoke values are inside the image: ${leaked}"
ok "none of this run's values appear in the image"

section "the image config records no runtime secret"
# D40: every RUN records its build args in the image config, readable with
# `docker history --no-trunc`. Only names are printed.
image_config="$(
  docker history --no-trunc --format '{{.CreatedBy}}' "$image"
  docker image inspect "$image"
)"
allowed_assignment="DATABASE_PATH=(/data/kids\.db|/tmp/build-check/kids\.db)"
allowed_assignment+="|SESSION_SECRET=${build_placeholder}-never-a-real-secret"
unexpected="$(
  printf '%s\n' "$image_config" |
    { grep -oE '(DATABASE_PATH|SESSION_SECRET)=[^ "]*' || true; } |
    { grep -vxE "$allowed_assignment" || true; } |
    sed -E 's/=.*//' | sort -u | tr '\n' ' '
)"
[ -z "$unexpected" ] ||
  fail "the image config assigns a value the Dockerfile does not write to: ${unexpected}"
if printf '%s\n' "$image_config" | grep -q 'smoke-not-a-real'; then
  fail "the smoke values are in the image config"
fi
ok "docker history and docker image inspect hold only the Dockerfile's own values"

section "the build refuses to run with a secret in its environment"
# D40: mimics Coolify's default of inserting `ARG NAME=value` after every FROM,
# and expects the guard to stop the build at its first RUN.
mkdir -p "$buildtime_dir"
awk -v secret="$smoke_secret" '
  { print }
  /^FROM / {
    print "ARG DATABASE_PATH=/data/smoke-not-a-real-path.db"
    print "ARG SESSION_SECRET=" secret
  }
' "${repo_root}/Dockerfile" >"${buildtime_dir}/Dockerfile"
if docker build --progress=plain --file "${buildtime_dir}/Dockerfile" \
  --tag "$buildtime_tag" "$repo_root" >"${buildtime_dir}/build.log" 2>&1; then
  fail "the image built with runtime secrets inserted as ARGs"
fi
for name in DATABASE_PATH SESSION_SECRET; do
  grep -q "ERROR: ${name} is set in the image build environment" \
    "${buildtime_dir}/build.log" ||
    fail "the build failed, but the guard did not name ${name}"
done
if grep -q 'smoke-not-a-real' "${buildtime_dir}/build.log"; then
  fail "the refused build printed a value"
fi
if docker image inspect "$buildtime_tag" >/dev/null 2>&1; then
  fail "the refused build still left an image tagged ${buildtime_tag}"
fi
ok "the guard refused the build, named both items, printed no value and left no image"

printf '\nall %d checks passed for %s\n' "$total" "$image"
