# pickr API

Base URL `https://i.juan.is`. Every `/api/` request needs `Authorization: Bearer <key>`. Keys look like `pk_…`; ask Juan for one. Errors are JSON `{"error": "…"}` with a normal HTTP status. A file that is not yours is a 404.

## Upload

    curl -H "Authorization: Bearer $KEY" -F "file=@photo.jpg" https://i.juan.is/api/files

201 with the record, or 200 with `"existing": true` if you had uploaded the same bytes before:

    {"id":"7xKq2mN9pAb3","url":"https://i.juan.is/7xKq2mN9pAb3.jpg","kind":"image","mime":"image/jpeg","ext":"jpg",
     "bytes":123456,"width":4032,"height":3024,"duration":null,"original_name":"photo.jpg",
     "taken_at":"2026-05-03T10:11:12+02:00","created_at":"2026-10-28T12:00:00.000Z","deleted_at":null,"existing":false}

Any file type is accepted, up to 1 GB. The multipart field must be called `file`. Images and videos are stored with their metadata removed (GPS, camera, dates); the metadata is kept in the record and visible to you through `GET /api/files/:id`.

## Use the URL

    https://i.juan.is/ID.jpg              the original
    https://i.juan.is/ID.jpg?w=400        resized to 400 wide, aspect kept
    https://i.juan.is/ID.jpg?w=400&h=400&fit=cover      cropped square
    https://i.juan.is/ID.jpg?w=800&fm=webp&q=75          format and quality
    https://i.juan.is/ID.jpg?w=400&dpr=2                 retina: 800 wide
    https://i.juan.is/ID.mp4              streams
    https://i.juan.is/ID.mp4?t=3&w=400    a frame at 3 s, 400 wide
    https://i.juan.is/ID.pdf?dl=1         download with the original filename

Parameters: `w`, `h` (pixels), `fit` = `inside` (default) | `cover` | `fill`, `fm` = `jpg` | `png` | `webp` | `avif`, `q` = 1–100 (default 80), `dpr` = 1–3, `up=1` to allow enlarging, `t` = seconds (video). Unknown parameters are ignored. Output is capped at 4096 pixels on both sides, so `w` alone on a very tall image can come back narrower than asked. HEIC originals are served as they are, whatever the parameters.

Errors are JSON `{"error": "…"}` and are never cached. A `503 {"error": "busy"}` with `Retry-After` means too many renders are running at once: wait that many seconds and ask again. A `422` means the file cannot be rendered with those parameters. A query that changes nothing (an unknown parameter, or any parameter on a file that cannot be rendered) answers `302` to the plain URL. Too many API requests from one address answer `429`: slow down.

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
