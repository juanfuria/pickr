# pickr

An imgix-style file host for `i.juan.is`: originals served by nginx, images resized on demand and cached, video streamed, files served as themselves. Uploads through an API with per-account keys. Spec and decisions live in the pixelatedrobots folder (`docs/superpowers/specs/2026-10-28-pickr-design.md`).

## Run locally

    npm install
    npm run fixtures        # once; needs exiftool, ffmpeg, sips (macOS)
    npm test
    PICKR_ROOT=/tmp/pickr-dev node --disable-warning=ExperimentalWarning server/index.js

## Deploy

    deploy/install.sh       # once, on the box, as root
    deploy/deploy.sh        # from the Mac, every time

See `API.md` for the API.
