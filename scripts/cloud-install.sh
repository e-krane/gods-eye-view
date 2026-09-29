#!/bin/bash
# scripts/cloud-install.sh
if [ "$CLAUDE_CODE_REMOTE" != "true" ]; then
  exit 0
fi
npm ci
exit 0
