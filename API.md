# pickr API

Base URL `https://i.juan.is`. Every `/api/` request needs `Authorization: Bearer <key>`. Keys look like `pk_…`; ask Juan for one. Errors are JSON `{"error": "…"}` with a normal HTTP status, except nginx's own refusals (413 too large, 429 too many requests, 502 or 504 when the service is down), which are plain HTML pages. A file that is not yours is a 404.

## Upload

    curl -H "Authorization: Bearer $KEY" -F "file=@photo.jpg" https://i.juan.is/api/files

201 with the record, or 200 with `"existing": true` if you had uploaded the same bytes before:

    {"id":"7xKq2mN9pAb3","url":"https://i.juan.is/7xKq2mN9pAb3.jpg","kind":"image","mime":"image/jpeg","ext":"jpg",
     "bytes":123456,"width":4032,"height":3024,"duration":null,"original_name":"photo.jpg",
     "taken_at":"2026-05-03T10:11:12+02:00","created_at":"2026-10-28T12:00:00.000Z","deleted_at":null,"existing":false}

Any file type is accepted, up to 1 GB. The multipart field must be called `file`. Images and videos are stored with their metadata removed (GPS, camera, dates); the metadata is kept in the record and visible to you through `GET /api/files/:id`. SVG, PDF, audio and every other file are stored exactly as uploaded, metadata included.

## Use the URL

    https://i.juan.is/ID.jpg              the original
    https://i.juan.is/ID.jpg?w=400        resized to 400 wide, aspect kept
    https://i.juan.is/ID.jpg?w=400&h=400&fit=cover      cropped square
    https://i.juan.is/ID.jpg?w=800&fm=webp&q=75          format and quality
    https://i.juan.is/ID.jpg?w=400&dpr=2                 retina: 800 wide
    https://i.juan.is/ID.jpg?lego=48&w=1200              48 lego bricks along the long side, 1200 wide
    https://i.juan.is/ID.png?rect=64,0,32,32             the 32×32 square at 64,0 cut out of the original, as is
    https://i.juan.is/ID.jpg?rect=400,200,1200,800&w=600  that cut, then resized to 600 wide
    https://i.juan.is/ID.jpg?ar=16:9&w=1200              cut to 16:9 around the middle, 1200 wide (h follows)
    https://i.juan.is/ID.jpg?ar=1:1&crop=top             the largest square, from the top, at its own size
    https://i.juan.is/ID.jpg?w=400&h=400&fit=cover&crop=attention   a square the picture's busiest part fills
    https://i.juan.is/ID.jpg?fp-x=0.3&fp-y=0.4&fp-z=2    zoomed in twice on the point at 30%, 40%
    https://i.juan.is/ID.mp4              streams
    https://i.juan.is/ID.mp4?t=3&w=400    a frame at 3 s, 400 wide
    https://i.juan.is/ID.pdf?dl=1         download with the original filename

Parameters: `w`, `h` (pixels), `fit` = `inside` (default) | `cover` | `fill`, `fm` = `jpg` | `png` | `webp` | `avif`, `q` = 1–100 (default 80), `dpr` = 1–3, `up=1` to allow enlarging, `lego` = 1–128 (the picture rebuilt from that many 1×1 lego bricks along its long side, 30 px a brick unless `w` or `h` asks for a size; a transparent picture keeps its transparency a brick at a time, a brick being there when most of what it covers is, except as JPEG, which gets white bricks; after [Legofy](https://github.com/JuanPotato/Legofy)), `rect` = `x,y,w,h` (a rectangle cut out of the original before anything else: pixels of the upright picture, origin top left, clamped to the picture's edges; every other parameter then acts on the cut, so `up=1` enlarges the cut and `lego` builds its bricks from it; a rectangle that starts outside the picture is a 422, a malformed one is ignored), `ar` = `W:H` (the shape of a window cut out of the picture, as large as fits; with one of `w` or `h` it derives the other, with both it shapes the cut and they size the output through `fit`, with neither the window comes at its own size), `crop` = `centre` | `top` | `bottom` | `left` | `right` | `top-left` | `top-right` | `bottom-left` | `bottom-right` | `entropy` | `attention` (where the window sits, or for the last two, which part of the picture sharp finds busiest or most eye-catching; words need a shape, from `ar` or from a `cover` resize to both sides, and the two strategies only ride a `cover` resize to both sides or an `ar`), `fp-x`, `fp-y` = 0–1 (the point the window is centred on, as fractions of the picture, or of the `rect` cut; missing ones are 0.5; a point beats a `crop` word), `fp-z` = 1–100 (zoom: the window shrinks by that factor around the point; alone it zooms into the middle), `t` = seconds (video). Animations are never enlarged, a `rect` cuts every frame, and `lego` turns one into a still of its first frame. A lego picture stops at 16 megapixels. Renders answer CORS (`Access-Control-Allow-Origin: *`), as originals do. An image render also says how big the upright original is, `X-Source-Size: WxH` (the frame's size, for a video poster); the playground at the root reads it to open any file, `https://i.juan.is/#f=ID.png&rect=…`. Unknown parameters are ignored. Output is capped at 4096 pixels on both sides (2560 for WebP, 1600 for AVIF), so `w` alone on a very tall image can come back narrower than asked. `dpr` accepts fractions such as 1.5. HEIC originals are served as they are, whatever the parameters.

Errors are JSON `{"error": "…"}` and are never cached. A `503 {"error": "busy"}` with `Retry-After` means too many renders are running at once: wait that many seconds and ask again. A `422` means the file cannot be rendered with those parameters. A query that changes nothing (an unknown parameter, or any parameter on a file that cannot be rendered) answers `302` to the plain URL. Too many API requests from one address answer `429`: slow down. A `507` means the server is short of disk space; try again later.

## Manage

    GET    /api/files?kind=image&since=2026-01-01&limit=100    your files, newest first; next page: before=<created_at>&before_id=<id> of the last row
    GET    /api/files/:id                                        one record, with "meta"
    PATCH  /api/files/:id        {"original_name": "better.jpg"}
    DELETE /api/files/:id                                        to trash (30 days)
    POST   /api/files/:id/restore
    GET    /api/keys
    POST   /api/keys             {"label": "phone"}             the new key is shown once
    DELETE /api/keys/:id
    GET    /api/me                                               {"account":"marta","files":12,"bytes":34567890}

## From the command line

    npm link             # once, inside the pickr repo
    pickr init https://i.juan.is pk_…
    pickr up photo.jpg   # prints the URL and copies it
    pickr ls             # pickr ls --json --kind video
    pickr rm ID / pickr restore ID / pickr keys / pickr me
