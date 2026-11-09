#!/usr/bin/env bash
# Imports the LendLoop SMTP credential and workflows into the running n8n container, then
# publishes (activates) all three workflows. Safe to re-run: fixed ids overwrite.
#
#   1. credential "Mailpit SMTP" (host mailpit:1025, no auth, no TLS). It is generated here
#      and piped into a temp file inside the container, so it never touches the repo.
#   2. n8n/workflows/*.json, which compose mounts read-only at /workflows.
#   3. publish all three, then restart n8n so it registers the webhook and schedule (CLI
#      changes to the database take effect at startup). n8n 2.x only runs an error workflow
#      that is published, so the error handler is published too.
set -euo pipefail
cd "$(dirname "$0")/.."

say() { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
die() { printf '\033[1;31merror:\033[0m %s\n' "$*" >&2; exit 1; }
n8n() { docker compose exec -T n8n n8n "$@"; }

# n8n answers /healthz/readiness once its database migrations are done. Importing before that would
# race the first boot on a fresh volume.
N8N_PORT=${N8N_PORT:-$(grep -E '^N8N_PORT=' .env 2>/dev/null | cut -d= -f2 || true)}
wait_for_n8n() {
  for _ in $(seq 1 90); do
    curl -fsS "http://127.0.0.1:${N8N_PORT:-5678}/healthz/readiness" >/dev/null 2>&1 && return 0
    sleep 1
  done
  die "n8n did not become healthy on port ${N8N_PORT:-5678}"
}

PUBLISH=(LendLoopNotify01 LendLoopOverdue01 LendLoopErrors01)

say "Waiting for n8n"
wait_for_n8n

say "Importing the Mailpit SMTP credential"
# Mailpit needs no password; the empty user/password are what n8n stores for "no auth".
docker compose exec -T n8n sh -c '
  set -e
  tmp=$(mktemp -d)
  trap "rm -rf \"$tmp\"" EXIT
  cat > "$tmp/credentials.json"
  n8n import:credentials --input="$tmp/credentials.json"
' <<'JSON'
[{
  "id": "LendLoopSmtp001",
  "name": "Mailpit SMTP",
  "type": "smtp",
  "data": { "user": "", "password": "", "host": "mailpit", "port": 1025, "secure": false, "disableStartTls": true }
}]
JSON

say "Importing workflows from n8n/workflows"
n8n import:workflow --separate --input=/workflows

say "Publishing ${PUBLISH[*]}"
published=true
for id in "${PUBLISH[@]}"; do
  n8n publish:workflow --id="$id" || published=false
done

if [ "$published" = true ]; then
  say "Restarting n8n so it picks up the published workflows"
  docker compose restart n8n >/dev/null
  wait_for_n8n
  n8n list:workflow --active=true
else
  cat >&2 <<'EOF'
Could not publish from the CLI. Publish by hand:
  1. open n8n (http://localhost:5678) and create the owner account if asked;
  2. open "LendLoop · Loan event notification" and click Publish;
  3. do the same for "LendLoop · Overdue reminders" and "LendLoop · Error handler"
     (n8n only runs a published error workflow).
EOF
  exit 1
fi
