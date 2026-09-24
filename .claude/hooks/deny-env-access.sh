#!/usr/bin/env bash
# PreToolUse hook for Bash.
#
# Exit code 2 stops the tool call before permission rules are evaluated, which
# is why this file exists at all: the permission matcher is literal, and these
# three classes of command need logic, not a prefix.
#
#   1. .env access. A Bash deny rule without a trailing "*" is an exact match,
#      so "Bash(head .env)" never covered "head -n 5 .env", which fell through
#      to the "Bash(head:*)" allow rule. Same hole for grep, sed, awk, cp, tee,
#      python3 and node.
#   2. varlock printing resolved values. Denying "pnpm exec varlock reveal*"
#      and "npx varlock reveal*" left "pnpm dlx varlock reveal" open through
#      "Bash(pnpm:*)". The target is the secret, not the spelling of the
#      invocation, so match the varlock subcommand wherever it appears.
#   3. git push from a checkout that is on main. No literal pattern can see the
#      current branch, so "git push origin HEAD" on main slipped past the deny
#      rules aimed at the string "main".
set -uo pipefail

payload=$(cat)

# Fail closed on every path that leaves us without a command to inspect. jq
# missing, jq erroring on a malformed payload, or a payload that parses but
# carries no command: in all three the raw payload is scanned instead, so a
# reference to a .env still trips the rules below. Extracting nothing and
# allowing the call would turn a parse error into a way through.
cmd=""
cwd=""
if command -v jq >/dev/null 2>&1; then
  if cmd=$(printf '%s' "$payload" | jq -er '.tool_input.command // ""' 2>/dev/null); then
    cwd=$(printf '%s' "$payload" | jq -r '.cwd // ""' 2>/dev/null) || cwd=""
  else
    cmd=""
  fi
fi
raw_scan=0
if [ -z "$cmd" ] && [ -n "$payload" ]; then
  cmd=$payload
  cwd=""
  raw_scan=1
fi
[ -n "$cwd" ] || cwd=$PWD

# Say what was blocked and which rule blocked it, so the next reader
# understands the boundary instead of looking for a way around it.
block() {
  printf 'BLOCKED: %s\n\n%s\n' "$1" "$2" >&2
  exit 2
}

secrets_rule='Regra: CLAUDE.md, Convencoes > Segredos (D23) -- ".env e ignorado pelo
git e preenchido a mao pelo dono do repo. Nunca leia, copie ou imprima o conteudo
dele. Para trabalhar, use valores de teste proprios."

O que fazer: .env.schema e versionado, declara os nomes e o formato das variaveis,
e continua legivel. Para rodar, use valores de teste seus num .env que voce nao le.'

# --- 1. any .env file other than .env.schema -----------------------------------
#
# Two rules, in this order.
#
# UNRESOLVABLE FIRST. If the reference carries anything the shell expands and we
# do not — `~`, `$VAR`, a backtick, a brace, a glob — we cannot know which file
# the command actually touches, so we refuse. Failing closed here is the whole
# point: an earlier version of this hook resolved `~/.env` as the absolute path
# `/.env`, found nothing there, and let a read of the owner's real file through.
#
# THEN EXISTENCE. For a plain, literal path: a `.env` that EXISTS may be the
# owner's, so reading it leaks and overwriting or deleting it destroys passwords
# typed by hand. A `.env` that does not exist has nothing to leak and nothing to
# lose — the only thing a command can do to it is create it, which is what CI
# itself does before `pnpm build` (see .github/workflows/ci.yml).
#
# The existence rule also enforces D23 more strongly than an instruction could:
# the moment an agent writes its throwaway .env, the file exists, so the agent
# can no longer read it. "Use test values you do not read" becomes a fact.
# When the payload could not be parsed there is no reliable path to resolve and
# no cwd to resolve it against — JSON punctuation also breaks word matching. So
# the raw scan does not try: any mention of a .env other than the schema is
# refused outright. A parse error must never become a way through.
if [ "$raw_scan" = 1 ]; then
  stripped=$(printf '%s' "$payload" | sed 's/\.env\.schema//g')
  case "$stripped" in
    *.env*)
      block "o payload nao pode ser interpretado e menciona um .env." "$secrets_rule"
      ;;
  esac
fi

# Word-splitting without pathname expansion. Unquoted, `../*/.env` would be
# globbed against the *hook's* working directory, quietly resolving to a real
# sibling path and consuming the `*` that should have made it unresolvable.
set -f
for word in $cmd; do
  # Quotes come off BEFORE classifying, not after. `for word in $cmd` splits a
  # data string; it does not re-parse shell, so a quote that surrounds a path is
  # still a literal character in the token. Classifying first meant `cat '.env'`
  # ended in a quote, matched none of the patterns, and was skipped before any
  # rule could see it — a regression against the grep this loop replaced.
  bare=$(printf '%s' "$word" | tr -d "\"'")

  case "$bare" in
    *.env|*.env.*|*.env[A-Za-z0-9_-]*) ;;
    *) continue ;;
  esac

  case "$bare" in
    *.env.schema|*.env.schema=*) continue ;;
  esac

  case "$bare" in
    *'~'*|*'$'*|*'`'*|*'{'*|*'}'*|*'*'*|*'?'*|*'['*)
      block "este comando referencia um .env por um caminho que o shell expande ('${word}'), e o hook nao consegue resolver qual arquivo e." "$secrets_rule"
      ;;
  esac

  target=$bare
  case "$target" in /*) ;; *) target="$cwd/$target" ;; esac

  if [ -e "$target" ]; then
    set +f
    block "este comando referencia '${bare}', que existe em disco." "$secrets_rule"
  fi
done
set +f

# --- 2. varlock printing resolved values ---------------------------------------
# reveal, load, printenv and flatten all emit resolved values. run only does so
# when it is asked to dump instead of to launch the app.
dump=$(printf '%s' "$cmd" | grep -oE 'varlock[[:space:]]+(reveal|load|printenv|flatten)' || true)
if [ -z "$dump" ] && printf '%s' "$cmd" | grep -qE 'varlock[[:space:]]+run\b'; then
  dump=$(printf '%s' "$cmd" | grep -oE 'varlock[[:space:]]+run\b.*(--format|--json|printenv|[[:space:]]env([[:space:]]|$))' || true)
fi
if [ -n "$dump" ]; then
  block "este comando faz o varlock imprimir valores resolvidos ('$(printf '%s' "$dump" | tr -s '[:space:]' ' ')')." \
    "Valores resolvidos sao o conteudo do .env. Le-los pelo varlock e ler o .env,
seja qual for a invocacao -- direta, pnpm exec, pnpm dlx ou npx.

$secrets_rule"
fi

# --- 3. git push on main, or aimed at main -------------------------------------
branches_rule='Regra: CLAUDE.md, Convencoes > Branches -- "uma por issue, PR para
main. Nunca push direto na main."

Processo deste projeto: worker abre PR, tres rounds de revisao, e o coordenador
revisa e mergeia. Push na main pula tudo isso.

O que fazer: crie a branch da issue, empurre ela, e abra um PR.'

if printf '%s' "$cmd" | grep -qE '\bgit[[:space:]]+(-C[[:space:]]+[^[:space:]]+[[:space:]]+)?push\b'; then
  # "git -C <path> push" pushes <path>, not the session's directory.
  repo=$(printf '%s' "$cmd" | sed -nE 's/.*git[[:space:]]+-C[[:space:]]+([^[:space:]]+).*/\1/p' | head -1)
  [ -n "$repo" ] || repo=$cwd
  case "$repo" in /*) ;; *) repo="$cwd/$repo" ;; esac
  current=$(git -C "$repo" rev-parse --abbrev-ref HEAD 2>/dev/null || true)
  if [ "$current" = "main" ]; then
    block "git push com o checkout na branch 'main' (${repo})." "$branches_rule"
  fi
  if printf '%s' "$cmd" | grep -qE '(^|[[:space:]:])main([[:space:]:]|$)'; then
    block "git push apontando para 'main'." "$branches_rule"
  fi
fi

exit 0
