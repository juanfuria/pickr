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
    deploy/smoke.sh         # from the Mac, end to end against the live host

The vhost is copied once, because certbot edits it; later changes to `deploy/nginx/i.juan.is.conf` are
merged into the live file by hand. HSTS is already in it (browsers ignore it over plain http). nginx drops
inherited `add_header` lines in any block that sets its own, so a new location that adds headers repeats
the HSTS line; `test/home.test.js` checks.

On the pixelatedrobots box the live vhost also has `include snippets/shellbeach.conf;`, the box-wide 404 page; it lives with the box's own config, not here.

The home page at `/` is `public/`: a playground for the URL grammar on one image, served by nginx straight
from the checkout. The image is `data-file` on `<main>` in `public/index.html`.

See `API.md` for the API.
