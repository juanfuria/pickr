#!/usr/bin/env bash
# Generates every test fixture. Needs: node + sharp (npm install), exiftool, ffmpeg, and sips (macOS) for the HEIC.
set -euo pipefail
cd "$(dirname "$0")"

node make-images.js

exiftool -overwrite_original -q \
  -GPSLatitude=40.4168 -GPSLatitudeRef=N -GPSLongitude=3.7038 -GPSLongitudeRef=W \
  '-Orientation#=6' '-DateTimeOriginal=2024:05:03 10:11:12' '-OffsetTimeOriginal=+02:00' \
  -Make=TestCam -Model=T1 -Artist='Fixture Person' photo.jpg

if command -v sips >/dev/null; then
  sips -s format heic photo.jpg --out photo.heic >/dev/null
  exiftool -overwrite_original -q -GPSLatitude=40.4168 -GPSLatitudeRef=N -GPSLongitude=3.7038 -GPSLongitudeRef=W \
    '-DateTimeOriginal=2024:05:03 10:11:12' -Make=TestCam photo.heic
fi

ffmpeg -y -v error -f lavfi -i testsrc=size=120x90:rate=5 -t 1 animated.gif

ffmpeg -y -v error -f lavfi -i testsrc=size=320x240:rate=10 -f lavfi -i sine=frequency=440 -t 2 \
  -c:v libx264 -pix_fmt yuv420p -c:a aac -shortest \
  -metadata title='Fixture video' -metadata location='+40.4168-003.7038/' -metadata creation_time=2024-05-03T10:11:12Z \
  clip.mp4

ffmpeg -y -v error -f lavfi -i color=c=red:s=16x16 -frames:v 1 bitmap.bmp

head -c 2000 photo.jpg > corrupt.jpg
: > empty.bin

cat > scripted.svg <<'SVG'
<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64">
  <rect width="64" height="64" fill="#5a2"/>
  <script>alert('x')</script>
</svg>
SVG

cat > doc.pdf <<'PDF'
%PDF-1.1
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj
3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj
trailer<</Root 1 0 R>>
PDF

ls -l
