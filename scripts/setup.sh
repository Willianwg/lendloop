#!/usr/bin/env bash
# One-shot local setup. Safe to re-run: it only creates what is missing.
#
#   1. .env with random secrets (docker compose reads it)
#   2. docker compose up (Convex, n8n, Mailpit)
#   3. Convex admin key + URLs in .env.local
#   4. Convex deployment env vars (secrets, webhook URL, Clerk issuer)
#   5. push Convex functions
#   6. import n8n credentials and workflows
set -euo pipefail
cd "$(dirname "$0")/.."

say() { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
die() { printf '\033[1;31merror:\033[0m %s\n' "$*" >&2; exit 1; }

command -v docker >/dev/null || die "docker is required"
command -v openssl >/dev/null || die "openssl is required"

# Reads KEY from an env file without sourcing it (values may contain shell metacharacters).
env_get() { local file=$1 key=$2; [ -f "$file" ] && grep -E "^${key}=" "$file" | tail -1 | cut -d= -f2- | sed -e "s/^['\"]//" -e "s/['\"]$//" || true; }
env_set() { local file=$1 key=$2 value=$3; touch "$file"; chmod 600 "$file"
  if grep -qE "^${key}=" "$file"; then
    local tmp; tmp=$(mktemp); grep -vE "^${key}=" "$file" > "$tmp"; cat "$tmp" > "$file"; rm -f "$tmp"
  fi
  printf '%s=%s\n' "$key" "$value" >> "$file"; }

# 1. Secrets for docker compose -------------------------------------------------
say "Ensuring .env secrets"
for key in N8N_ENCRYPTION_KEY CONVEX_TO_N8N_SECRET N8N_TO_CONVEX_SECRET; do
  [ -n "$(env_get .env "$key")" ] || env_set .env "$key" "$(openssl rand -hex 32)"
done

CONVEX_PORT=$(env_get .env CONVEX_PORT); CONVEX_PORT=${CONVEX_PORT:-3210}

# 2. Containers -------------------------------------------------------------------
say "Starting containers"
docker compose up -d --wait

# 3. Convex CLI target -------------------------------------------------------------
if [ -z "$(env_get .env.local CONVEX_SELF_HOSTED_ADMIN_KEY)" ]; then
  say "Generating Convex admin key"
  admin_key=$(docker compose exec -T convex-backend ./generate_admin_key.sh | tail -1)
  env_set .env.local CONVEX_SELF_HOSTED_ADMIN_KEY "$admin_key"
fi
env_set .env.local CONVEX_SELF_HOSTED_URL "http://127.0.0.1:${CONVEX_PORT}"
env_set .env.local NEXT_PUBLIC_CONVEX_URL "http://127.0.0.1:${CONVEX_PORT}"

# 4. Convex deployment env --------------------------------------------------------
issuer=$(env_get .env.local CLERK_JWT_ISSUER_DOMAIN)
[ -n "$issuer" ] || die "set CLERK_JWT_ISSUER_DOMAIN in .env.local (see README → Clerk setup)"
say "Setting Convex deployment env"
npx convex env set CLERK_JWT_ISSUER_DOMAIN "$issuer" >/dev/null
npx convex env set CONVEX_TO_N8N_SECRET "$(env_get .env CONVEX_TO_N8N_SECRET)" >/dev/null
npx convex env set N8N_TO_CONVEX_SECRET "$(env_get .env N8N_TO_CONVEX_SECRET)" >/dev/null
npx convex env set N8N_LOAN_EVENTS_WEBHOOK_URL "http://n8n:5678/webhook/lendloop-loan-events" >/dev/null

# 5. Functions --------------------------------------------------------------------
say "Pushing Convex functions"
npx convex dev --once

# 6. n8n --------------------------------------------------------------------------
say "Importing n8n credentials and workflows"
scripts/n8n-import.sh

say "Done. Next: npm run dev → http://localhost:3000"
