#!/bin/bash
DIR="$(cd "$(dirname "$0")" && pwd)"
node "$DIR/check-cli.js" --agent-id "$1"
