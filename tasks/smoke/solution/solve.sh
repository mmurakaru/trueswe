#!/bin/sh
set -eu
printf 'export function add(left, right) { return left + right; }\n' > /app/add.mjs
