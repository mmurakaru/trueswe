#!/bin/sh
set -eu
mkdir -p /logs/verifier
if node --check /app/add.mjs && node /tests/verify.mjs; then
  echo 1 > /logs/verifier/reward.txt
else
  echo 0 > /logs/verifier/reward.txt
fi
