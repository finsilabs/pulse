#!/bin/sh
set -eu
npm run build
npm test
node scripts/read-only-guard.mjs
