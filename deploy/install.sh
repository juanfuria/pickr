#!/usr/bin/env bash
# One-time setup of pickr on the VPS. Idempotent. Run as root. DNS for i.juan.is must already point here for certbot.
set -euo pipefail
REPO=https://github.com/juanfuria/pickr.git
# npm's cache stays out of /srv/pickr, which is the data root and what the backup copies
NPM_CACHE=npm_config_cache=/opt/pickr/.npm

apt-get update -q
apt-get install -y -q nodejs npm libimage-exiftool-perl ffmpeg sqlite3 libnginx-mod-http-cache-purge git python3-certbot-nginx

id pickr >/dev/null 2>&1 || useradd --system --home-dir /srv/pickr --shell /usr/sbin/nologin pickr
# www-data (nginx) may traverse the root and read files/, and nothing else: not the database, not trash/, not tmp/
install -d -o pickr -g pickr -m 710 /srv/pickr
install -d -o pickr -g pickr -m 750 /srv/pickr/files
install -d -o pickr -g pickr -m 700 /srv/pickr/trash /srv/pickr/tmp
usermod -aG pickr www-data
install -d -o www-data -g www-data -m 700 /var/cache/nginx/pickr

if [ ! -d /opt/pickr/.git ]; then
  install -d -o pickr -g pickr /opt/pickr
  runuser -u pickr -- git clone "$REPO" /opt/pickr
fi
runuser -u pickr -- env "$NPM_CACHE" bash -c 'cd /opt/pickr && git pull --ff-only && npm ci --omit=dev'

# nginx: this box serves other sites, so a config that fails `nginx -t` must never stay installed. Keep what was
# there, install, test, and put everything back if the test fails.
NGINX_FILES=(/etc/nginx/conf.d/pickr.conf /etc/nginx/sites-available/pickr-purge.conf /etc/nginx/sites-available/i.juan.is.conf
             /etc/nginx/sites-enabled/pickr-purge.conf /etc/nginx/sites-enabled/i.juan.is.conf)
BACKUP=$(mktemp -d)
for f in "${NGINX_FILES[@]}"; do
  if [ -e "$f" ] || [ -L "$f" ]; then cp -P "$f" "$BACKUP/$(echo "$f" | tr / _)"; fi
done
rollback() {
  for f in "${NGINX_FILES[@]}"; do
    b="$BACKUP/$(echo "$f" | tr / _)"
    rm -f "$f"
    if [ -e "$b" ] || [ -L "$b" ]; then cp -P "$b" "$f"; fi
  done
}

cp /opt/pickr/deploy/nginx/pickr.conf /etc/nginx/conf.d/pickr.conf
cp /opt/pickr/deploy/nginx/purge.conf /etc/nginx/sites-available/pickr-purge.conf
# The vhost is copied once: certbot edits it, so later changes are merged by hand.
if [ -f /etc/nginx/sites-available/i.juan.is.conf ]; then
  echo "note: /etc/nginx/sites-available/i.juan.is.conf exists and is left as is; merge changes from deploy/nginx/i.juan.is.conf by hand"
else
  cp /opt/pickr/deploy/nginx/i.juan.is.conf /etc/nginx/sites-available/i.juan.is.conf
fi
ln -sf /etc/nginx/sites-available/pickr-purge.conf /etc/nginx/sites-enabled/pickr-purge.conf
ln -sf /etc/nginx/sites-available/i.juan.is.conf /etc/nginx/sites-enabled/i.juan.is.conf
if ! nginx -t; then
  rollback
  echo "nginx -t failed: pickr's nginx files were put back as they were; the running nginx was not touched" >&2
  exit 1
fi
rm -rf "$BACKUP"
# restart, not reload: a freshly installed dynamic module (cache purge) is only picked up by a new master process
systemctl restart nginx

cp /opt/pickr/deploy/systemd/pickr.service /etc/systemd/system/pickr.service
cp /opt/pickr/deploy/cron/pickr /etc/cron.d/pickr
systemctl daemon-reload
systemctl enable pickr
# restart, not enable --now: on a re-run the service must pick up the code pulled above and a changed unit
systemctl restart pickr
sleep 1
systemctl --no-pager --lines=5 status pickr

if ! grep -q 'listen 443' /etc/nginx/sites-available/i.juan.is.conf; then
  certbot --nginx -d i.juan.is --non-interactive --agree-tos --register-unsafely-without-email --redirect
fi
ADMIN='runuser -u pickr -- node --disable-warning=ExperimentalWarning /opt/pickr/bin/pickr-admin.js'
echo "pickr installed. Next, as root:"
echo "  $ADMIN account add juan"
echo "  $ADMIN key add juan laptop"
