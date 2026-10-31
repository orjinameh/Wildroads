#!/usr/bin/env bash
# Checks the Otari gateway end to end WITHOUT any road data, so you can verify
# keys, budgets, the code-execution tool and the usage ledger before you have a trip.
#
#   OTARI_KEY=<virtual key from the Otari dashboard> OTARI_MODEL=openai:gpt-4o-mini \
#   OTARI_MASTER_KEY=<master key> bash scripts/otari-smoke.sh
#
# To see budget enforcement: create a key with a very small budget in the dashboard,
# then run this script with that key until Otari refuses the request. Note the HTTP
# status it returns; the app shows Otari's error text as it is.
set -uo pipefail

BASE="${OTARI_BASE_URL:-http://localhost:8000}"
KEY="${OTARI_KEY:?Set OTARI_KEY to a virtual key created in the Otari dashboard}"
MODEL="${OTARI_MODEL:?Set OTARI_MODEL, e.g. openai:gpt-4o-mini}"
MEMBER="${MEMBER:-smoke-test}"

echo "== 1. Chat completion through the gateway (tag member=$MEMBER)"
curl -sS -w "\nHTTP %{http_code}\n" "$BASE/api/v1/chat/completions" \
  -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" -d @- <<JSON
{"model":"$MODEL","messages":[{"role":"user","content":"Reply with the single word: ok"}],"metadata":{"app":"wildroads","member":"$MEMBER"}}
JSON

echo
echo "== 2. Code-execution tool (should answer 391)"
curl -sS -w "\nHTTP %{http_code}\n" "$BASE/api/v1/chat/completions" \
  -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" -d @- <<JSON
{"model":"$MODEL","messages":[{"role":"user","content":"Use the code execution tool to compute 17*23 and reply with only the number."}],"tools":[{"type":"otari_code_execution"}],"metadata":{"app":"wildroads","member":"$MEMBER"}}
JSON

if [ -n "${OTARI_MASTER_KEY:-}" ]; then
  echo
  echo "== 3. Usage grouped by member (what the Ledger page shows)"
  curl -sS -w "\nHTTP %{http_code}\n" "$BASE/api/v1/usage/summary?group_by_tag=member" \
    -H "Authorization: Bearer $OTARI_MASTER_KEY"
else
  echo
  echo "(Set OTARI_MASTER_KEY to also check the usage ledger.)"
fi
