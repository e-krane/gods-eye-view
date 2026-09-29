#!/bin/bash
# scripts/cloud-install.sh
if [ "$CLAUDE_CODE_REMOTE" != "true" ]; then
  exit 0
fi
# package.json requires Node 24; the cloud image defaults to Node 22 outside nvm.
NVM_SH="${NVM_DIR:-$HOME/.nvm}/nvm.sh"
if [ -s "$NVM_SH" ]; then
  source "$NVM_SH"
  nvm use 24 >/dev/null
fi
npm ci
exit 0
