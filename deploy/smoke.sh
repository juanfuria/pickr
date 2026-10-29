#!/usr/bin/env bash
# End to end against the live host: upload, original, variants, cache hit, poster, delete, purge, 404.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
CFG="${PICKR_CONFIG:-$HOME/.config/pickr/config.json}"
URL="${PICKR_URL:-$(python3 -c "import json;print(json.load(open('$CFG'))['url'])")}"
KEY="${PICKR_KEY:-$(python3 -c "import json;print(json.load(open('$CFG'))['key'])")}"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
fail() { echo "SMOKE FAIL: $*" >&2; exit 1; }
hdr() { grep -i "^$1:" "$2" | tr -d '\r' | awk '{print $2}'; }

echo "upload"
curl -sS -f -H "Authorization: Bearer $KEY" -F "file=@$HERE/../test/fixtures/photo.jpg" "$URL/api/files" > "$TMP/up.json" || fail "upload"
ID=$(python3 -c "import json;print(json.load(open('$TMP/up.json'))['id'])")
EXT=$(python3 -c "import json;print(json.load(open('$TMP/up.json'))['ext'])")
echo "  $ID.$EXT"

echo "original"
curl -sS -D "$TMP/h1" -o "$TMP/orig.jpg" "$URL/$ID.$EXT" || fail "original"
grep -q '200' "$TMP/h1" || fail "original status"
[ "$(hdr content-type "$TMP/h1")" = "image/jpeg" ] || fail "original mime"
exiftool -s -s -s -GPSLatitude "$TMP/orig.jpg" | grep -q . && fail "GPS survived on the original" || true

echo "variant, twice"
curl -sS -D "$TMP/h2" -o "$TMP/v1.jpg" "$URL/$ID.$EXT?w=100" || fail "variant"
curl -sS -D "$TMP/h3" -o "$TMP/v2.jpg" "$URL/$ID.$EXT?w=100" || fail "variant 2"
[ "$(hdr x-cache-status "$TMP/h3")" = "HIT" ] || fail "second fetch was not a cache HIT: $(hdr x-cache-status "$TMP/h3")"
grep -qi 'cache-control: public, max-age=31536000, immutable' "$TMP/h2" || fail "cache-control"
python3 -c "import struct,sys; d=open('$TMP/v1.jpg','rb').read(); sys.exit(0 if d[:2]==b'\xff\xd8' else 1)" || fail "variant is not a jpeg"

echo "webp and legacy redirect"
curl -sS -D "$TMP/h4" -o /dev/null "$URL/$ID.$EXT?w=50&fm=webp" || fail "webp"
[ "$(hdr content-type "$TMP/h4")" = "image/webp" ] || fail "webp mime"
curl -sS -o /dev/null -w '%{http_code} %{redirect_url}\n' "$URL/t/${ID}_400.$EXT" | grep -q "301 $URL/$ID.$EXT?w=400" || fail "legacy /t/ redirect"

echo "video poster"
curl -sS -f -H "Authorization: Bearer $KEY" -F "file=@$HERE/../test/fixtures/clip.mp4" "$URL/api/files" > "$TMP/vid.json" || fail "video upload"
VID=$(python3 -c "import json;print(json.load(open('$TMP/vid.json'))['id'])")
curl -sS -D "$TMP/h5" -o /dev/null "$URL/$VID.mp4?t=1&w=64" || fail "poster"
[ "$(hdr content-type "$TMP/h5")" = "image/jpeg" ] || fail "poster mime"
curl -sS -r 0-99 -D "$TMP/h6" -o /dev/null "$URL/$VID.mp4" || fail "range"
grep -q '206' "$TMP/h6" || fail "range request not honoured"

echo "delete, purge, 404"
curl -sS -f -X DELETE -H "Authorization: Bearer $KEY" "$URL/api/files/$ID" || fail "delete"
curl -sS -f -X DELETE -H "Authorization: Bearer $KEY" "$URL/api/files/$VID" || fail "delete video"
code=$(curl -sS -o /dev/null -w '%{http_code}' "$URL/$ID.$EXT?w=100")
[ "$code" = "404" ] || fail "variant still served after delete (purge failed): $code"
code=$(curl -sS -o /dev/null -w '%{http_code}' "$URL/$ID.$EXT")
[ "$code" = "404" ] || fail "original still served after delete: $code"

echo "SMOKE OK"
