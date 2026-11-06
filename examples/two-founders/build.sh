#!/usr/bin/env bash
# Builds the two-founders demo: a fictional design agreement between Northlight Studio and
# Fleetwise, negotiated warmly on one call and then redrafted for six rounds by two agents.
#
#   bash examples/two-founders/build.sh [target-dir] [--with-verify]
#
# --with-verify adds a final commit with the saved results of a real `parley verify` run
# (verifications.json, from the model trial in docs/models.md), which also catches 7.2.
#
# Creates a fresh git repo (default: a temp dir) with one commit per step and Parley-*
# trailers saying who wrote each change. Then try:
#   parley audit --repo <target>      flags the synthetic terms
#   parley ui --repo <target>         opens the ledger
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
CLI="$ROOT/dist/cli.mjs"
[ -f "$CLI" ] || { echo "Build parley first: npm run build" >&2; exit 1; }
WITH_VERIFY=0
ARGS=()
for a in "$@"; do if [ "$a" = "--with-verify" ]; then WITH_VERIFY=1; else ARGS+=("$a"); fi; done
TARGET="${ARGS[0]:-$(mktemp -d)/two-founders}"
rm -rf "$TARGET"
mkdir -p "$TARGET"
cd "$TARGET"
git init -q -b main
git config commit.gpgsign false

commit() { # $1 who (ana|fleet|north), $2 date, $3 message file or text
  case "$1" in
    ana) n="Ana Ruiz"; e="ana@northlight.example" ;;
    fleet) n="fleetwise-counsel (agent)"; e="agent@fleetwise.example" ;;
    north) n="northlight-drafter (agent)"; e="agent@northlight.example" ;;
  esac
  git add -A
  if [ -f "$3" ]; then msg=(-F "$3"); else msg=(-m "$3"); fi
  GIT_AUTHOR_NAME="$n" GIT_AUTHOR_EMAIL="$e" GIT_COMMITTER_NAME="$n" GIT_COMMITTER_EMAIL="$e" \
    GIT_AUTHOR_DATE="$2" GIT_COMMITTER_DATE="$2" git commit -q "${msg[@]}"
}

node "$CLI" init --party "Northlight Studio=ana-ruiz:Ana Ruiz" --party "Fleetwise=marcus-okafor,priya-shah:Marcus Okafor,Priya Shah" > /dev/null
commit ana "2026-10-13T09:00:00Z" "chore: set up parley

Parley-Author: Ana Ruiz"

node "$CLI" ingest "$HERE/transcript.vtt" --meeting kickoff --date 2026-10-14 --title "Kickoff call, 2026-10-14" --yes > /dev/null
commit ana "2026-10-14T17:00:00Z" "records: kickoff call, 2026-10-14

Parley-Author: Ana Ruiz"

dates=("" "2026-10-14T21:00:00Z" "2026-10-15T10:00:00Z" "2026-10-15T16:00:00Z" "2026-10-16T09:30:00Z" "2026-10-16T18:00:00Z" "2026-10-17T11:00:00Z" "2026-10-17T19:00:00Z")
who=("" ana fleet north fleet north fleet north)
for v in 1 2 3 4 5 6 7; do
  if [ "$v" = 5 ]; then
    cp "$HERE/follow-up-notes.md" records/2026-10-16-follow-up-notes.md
    commit north "2026-10-16T17:30:00Z" "$HERE/follow-up-notes.msg"
  fi
  cp "$HERE/versions/v$v.md" agreements/design-services.md
  commit "${who[$v]}" "${dates[$v]}" "$HERE/versions/v$v.msg"
done
if [ "$WITH_VERIFY" = 1 ]; then
  mkdir -p .parley
  cp "$HERE/verifications.json" .parley/verifications.json
  commit ana "2026-10-18T09:00:00Z" "chore: parley verify results

Parley-Author: Ana Ruiz"
fi
echo "$TARGET"
