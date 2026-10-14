#!/bin/sh
# SPDX-License-Identifier: GPL-3.0-only
# One-off offline verification; never starts a persistent service or publishes ports.
set -eu
image=${1:-tvbox-core:local}
exec docker run --rm --network none --read-only \
  --tmpfs /tmp:rw,exec,nosuid,nodev,size=256m \
  --cap-drop ALL --security-opt no-new-privileges \
  --pids-limit 256 --memory 2g "$image" doctor
