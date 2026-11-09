#!/usr/bin/env bash
# Fails (exit 1) if a tracked file, or an exported n8n workflow, looks like it holds a secret.
#
#   - a 64+ character hex string (our HMAC secrets and encryption keys are `openssl rand -hex 32`);
#   - a Clerk secret key (sk_test_… / sk_live_…) or a Convex admin key assigned to its variable;
#   - a "password" JSON key with a non-empty value;
#   - an inline "data" block in an n8n export (credential exports carry their secrets there).
#
# Allowed on purpose: `sha256:<hex>` image digests, and `v1=<hex>` signature vectors in *.test.ts
# (computed from dummy secrets such as "k"). Output names the file, line and rule, never the value.
set -euo pipefail
cd "$(dirname "$0")/.."

files=()
while IFS= read -r f; do [ -f "$f" ] && files+=("$f"); done < <(
  { git ls-files; ls n8n/workflows/*.json 2>/dev/null || true; } | sort -u
)

failures=0
report() { printf 'check-no-secrets: %s: %s\n' "$1" "$2" >&2; failures=$((failures + 1)); }

# 1. Long hex strings, minus the allowed shapes.
while IFS=: read -r file line match; do
  case "$match" in
    sha256:*) continue ;;
    v1=*) [[ "$file" == *.test.ts ]] && continue ;;
  esac
  report "$file:$line" "64+ character hex string"
done < <(grep -HnIoE '(sha256:|v1=)?[0-9a-fA-F]{64,}' "${files[@]}" || true)

# 2. Key-shaped secrets. Only file:line is printed.
scan() { # scan <rule description> <extended regex> <files...>
  local rule=$1 regex=$2; shift 2
  while IFS=: read -r file line _; do report "$file:$line" "$rule"; done < <(grep -HnIE "$regex" "$@" || true)
}
scan "Clerk secret key" 'sk_(test|live)_[A-Za-z0-9]{8,}' "${files[@]}"
scan "Convex admin key value" 'CONVEX_SELF_HOSTED_ADMIN_KEY=[A-Za-z0-9|_-]{8,}' "${files[@]}"
scan "non-empty \"password\" key" '"password"[[:space:]]*:[[:space:]]*"[^"]+' "${files[@]}"

# 3. n8n exports must not carry inline data (credential secrets, pinned test data).
n8n_json=()
for f in "${files[@]}"; do [[ "$f" == n8n/*.json ]] && n8n_json+=("$f"); done
if [ ${#n8n_json[@]} -gt 0 ]; then
  scan "inline \"data\" block in an n8n export" '"data"[[:space:]]*:[[:space:]]*[{"]' "${n8n_json[@]}"
  scan "pinData in an n8n export" '"pinData"[[:space:]]*:[[:space:]]*\{[[:space:]]*"' "${n8n_json[@]}"
fi

if [ "$failures" -gt 0 ]; then
  echo "check-no-secrets: FAIL ($failures finding(s))" >&2
  exit 1
fi
echo "check-no-secrets: PASS (${#files[@]} files scanned)"
