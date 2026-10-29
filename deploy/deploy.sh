#!/usr/bin/env bash
# Deploy the current main branch to the VPS and run the smoke test.
set -euo pipefail
HOST=${PICKR_HOST:-pixelatedrobots}
git -C "$(dirname "$0")/.." push origin main
ssh "$HOST" "runuser -u pickr -- bash -c 'cd /opt/pickr && git pull --ff-only && npm ci --omit=dev' && systemctl restart pickr && sleep 1 && systemctl is-active pickr"
bash "$(dirname "$0")/smoke.sh"
