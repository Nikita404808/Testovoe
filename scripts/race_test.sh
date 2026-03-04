#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:3000}"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

dispatcher_cookie="$TMP_DIR/dispatcher.cookie"
master_a_cookie="$TMP_DIR/master_a.cookie"
master_b_cookie="$TMP_DIR/master_b.cookie"
response_a="$TMP_DIR/response_a.json"
response_b="$TMP_DIR/response_b.json"

create_payload='{"clientName":"Race Client","phone":"+7 911 000-00-00","address":"Race Street, 1","problemText":"Проверка гонки take"}'
create_response=$(curl -sS -X POST "$BASE_URL/api/requests" -H 'Content-Type: application/json' -d "$create_payload")
request_id=$(echo "$create_response" | sed -n 's/.*"id":\([0-9]\+\).*/\1/p')

if [[ -z "$request_id" ]]; then
  echo "Не удалось создать заявку. Ответ: $create_response"
  exit 1
fi

curl -sS -c "$dispatcher_cookie" -X POST "$BASE_URL/api/login" -H 'Content-Type: application/json' -d '{"name":"dispatcher","password":"dispatcher123"}' >/dev/null
curl -sS -b "$dispatcher_cookie" -X POST "$BASE_URL/api/dispatcher/requests/$request_id/assign" -H 'Content-Type: application/json' -d '{"masterId":2}' >/dev/null

curl -sS -c "$master_a_cookie" -X POST "$BASE_URL/api/login" -H 'Content-Type: application/json' -d '{"name":"master_ivan","password":"master123"}' >/dev/null
curl -sS -c "$master_b_cookie" -X POST "$BASE_URL/api/login" -H 'Content-Type: application/json' -d '{"name":"master_ivan","password":"master123"}' >/dev/null

(
  code_a=$(curl -sS -o "$response_a" -w "%{http_code}" -X POST -b "$master_a_cookie" "$BASE_URL/api/master/requests/$request_id/take")
  echo "$code_a" > "$TMP_DIR/code_a.txt"
) &
pid_a=$!

(
  code_b=$(curl -sS -o "$response_b" -w "%{http_code}" -X POST -b "$master_b_cookie" "$BASE_URL/api/master/requests/$request_id/take")
  echo "$code_b" > "$TMP_DIR/code_b.txt"
) &
pid_b=$!

wait "$pid_a" "$pid_b"

code_a=$(cat "$TMP_DIR/code_a.txt")
code_b=$(cat "$TMP_DIR/code_b.txt")

echo "Request ID: $request_id"
echo "Response A: HTTP $code_a, body: $(cat "$response_a")"
echo "Response B: HTTP $code_b, body: $(cat "$response_b")"

if [[ ("$code_a" == "200" && "$code_b" == "409") || ("$code_a" == "409" && "$code_b" == "200") ]]; then
  echo "OK: гонка обработана корректно (один успех, второй конфликт)."
else
  echo "FAIL: ожидались коды 200 и 409."
  exit 1
fi
