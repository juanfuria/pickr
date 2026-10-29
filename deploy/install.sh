#!/usr/bin/env bash
# One-time setup of pickr on the VPS. Idempotent. Run as root. DNS for i.juan.is must already point here for certbot.
set -euo pipefail
REPO=https://github.com/juanfuria/pickr.git

apt-get update -q
apt-get install -y -q nodejs npm libimage-exiftool-perl ffmpeg sqlite3 libnginx-mod-http-cache-purge git

id pickr >/dev/null 2>&1 || useradd --system --home-dir /srv/pickr --shell /usr/sbin/nologin pickr
install -d -o pickr -g pickr -m 750 /srv/pickr /srv/pickr/files /srv/pickr/trash /srv/pickr/tmp
usermod -aG pickr www-data
install -d -o www-data -g www-data -m 700 /var/cache/nginx/pickr

if [ ! -d /opt/pickr/.git ]; then
  install -d -o pickr -g pickr /opt/pickr
  runuser -u pickr -- git clone "$REPO" /opt/pickr
fi
runuser -u pickr -- bash -c 'cd /opt/pickr && git pull --ff-only && npm ci --omit=dev'

cp /opt/pickr/deploy/nginx/pickr.conf /etc/nginx/conf.d/pickr.conf
cp /opt/pickr/deploy/nginx/purge.conf /etc/nginx/sites-available/pickr-purge.conf
[ -f /etc/nginx/sites-available/i.juan.is.conf ] || cp /opt/pickr/deploy/nginx/i.juan.is.conf /etc/nginx/sites-available/i.juan.is.conf
ln -sf /etc/nginx/sites-available/pickr-purge.conf /etc/nginx/sites-enabled/pickr-purge.conf
ln -sf /etc/nginx/sites-available/i.juan.is.conf /etc/nginx/sites-enabled/i.juan.is.conf
# Two lines, not `nginx -t && …`: set -e ignores a failure on the left of &&, so a bad config would not stop the script.
nginx -t
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
ADMIN='runuser -u pickr -- node --no-warnings=ExperimentalWarning /opt/pickr/bin/pickr-admin.js'
echo "pickr installed. Next, as root:"
echo "  $ADMIN account add juan"
echo "  $ADMIN key add juan laptop"
