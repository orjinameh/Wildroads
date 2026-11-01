#!/usr/bin/env bash
# Checks the hosted Otari platform end to end WITHOUT any road data: that your key works, which models
# it can call, a chat call, and the code-execution tool.
#
#   OTARI_BASE_URL=https://eu.api.otari.ai/api/v1 OTARI_KEY=<otk_... key> \
#   OTARI_MODEL=<model id or routing policy name> [OTARI_WRITER_MODEL=<id>] bash scripts/otari-smoke.sh
#
# To see budget enforcement: use a key with a very small budget and run it until Otari refuses.
# Otari answers with HTTP 403 and "code":"budget_exceeded".
set -uo pipefail

BASE="${OTARI_BASE_URL:?Set OTARI_BASE_URL, e.g. https://eu.api.otari.ai/api/v1}"
BASE="${BASE%/}"
KEY="${OTARI_KEY:?Set OTARI_KEY to an API key created in the Otari dashboard}"
MODEL="${OTARI_MODEL:?Set OTARI_MODEL to a model id from the Models tab or a routing policy name}"
CHAT="$BASE/chat/completions"

echo "== 0. Models this key can call"
curl -sS "$BASE/models" -H "Authorization: Bearer $KEY" | head -c 2500
echo

if [ -n "${OTARI_WRITER_MODEL:-}" ]; then
  echo "== 0b. Writer model ($OTARI_WRITER_MODEL)"
  curl -sS -w "\nHTTP %{http_code}\n" "$CHAT" -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
    -d "{\"model\":\"$OTARI_WRITER_MODEL\",\"messages\":[{\"role\":\"user\",\"content\":\"Reply with the single word: ok\"}]}"
  echo
fi

echo "== 1. Chat completion through the gateway"
curl -sS -w "\nHTTP %{http_code}\n" "$CHAT" \
  -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -d "{\"model\":\"$MODEL\",\"messages\":[{\"role\":\"user\",\"content\":\"Reply with the single word: ok\"}],\"metadata\":{\"app\":\"wildroads\",\"member\":\"smoke-test\"}}"

echo
echo "== 2. Code-execution tool (should answer 391)"
curl -sS -w "\nHTTP %{http_code}\n" "$CHAT" \
  -H "Authorization: Bearer $KEY" -H "Content-Type: application/json" \
  -d "{\"model\":\"$MODEL\",\"messages\":[{\"role\":\"user\",\"content\":\"Use the code execution tool to compute 17*23 and reply with only the number.\"}],\"tools\":[{\"type\":\"otari_code_execution\"}],\"metadata\":{\"app\":\"wildroads\",\"member\":\"smoke-test\"}}"

echo
echo "(Usage and spend are shown in the Usage tab and Spend & budgets of your otari.ai dashboard.)"
