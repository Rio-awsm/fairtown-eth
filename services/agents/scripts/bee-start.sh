#!/bin/sh
# pnpm -F agents swarm:node. Starts the Fairtown Bee light node (config ~/.fairtown/bee.yaml, API on 127.0.0.1:1633 only).
# The keystore password comes from SWARM_BEE_PASSWORD in the repo .env and is passed only as an environment variable.
set -e
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
BEE="${BEE_BIN:-$HOME/.fairtown/bin/bee}"
[ -x "$BEE" ] || { echo "bee not found at $BEE (see arkiv/swarm.md, Install)"; exit 1; }
BEE_PASSWORD="$(grep '^SWARM_BEE_PASSWORD=' "$ROOT/.env" | cut -d= -f2-)" exec "$BEE" start --config "$HOME/.fairtown/bee.yaml"
