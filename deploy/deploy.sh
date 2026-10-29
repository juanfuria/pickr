#!/usr/bin/env bash
# Deploy the current main branch to the VPS and run the smoke test.
set -euo pipefail
HOST=${PICKR_HOST:-pixelatedrobots}
REPO="$(cd "$(dirname "$0")/.." && pwd)"
git -C "$REPO" fetch -q origin
# This ships code only. nginx, systemd and cron files need install.sh on the box, and the vhost a hand merge.
if ! git -C "$REPO" diff --quiet origin/main...main -- deploy/nginx deploy/systemd deploy/cron; then
  echo "note: this deploy changes deploy/nginx, deploy/systemd or deploy/cron; run deploy/install.sh on the box too" >&2
fi
git -C "$REPO" push origin main
if ! ssh "$HOST" "runuser -u pickr -- env npm_config_cache=/opt/pickr/.npm bash -c 'cd /opt/pickr && git pull --ff-only && npm ci --omit=dev'"; then
  echo "DEPLOY FAILED before the restart: node_modules on the box may be half-installed. The running service was left alone; do not restart it, run the deploy again." >&2
  exit 1
fi
ssh "$HOST" "systemctl restart pickr && sleep 1 && systemctl is-active pickr"
bash "$REPO/deploy/smoke.sh"
