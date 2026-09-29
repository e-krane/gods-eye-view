#!/usr/bin/env node

import {
  LAYER_STATE_TOKEN_RESERVATIONS,
  nextForkLayerStateToken,
  nextLayerStateToken,
} from '../src/data/layerState.js';

const args = process.argv.slice(2);
const fork = args.includes('--fork');
const layerId = String(args.find((arg) => !arg.startsWith('--')) || '').trim();

if (!/^[a-z0-9-]+$/.test(layerId)) {
  console.error('Usage: npm run layer-token:next -- <layer-id> [--fork]');
  process.exitCode = 1;
} else if (Object.hasOwn(LAYER_STATE_TOKEN_RESERVATIONS, layerId)) {
  console.error(
    `${layerId} already owns token ${LAYER_STATE_TOKEN_RESERVATIONS[layerId]}`,
  );
  process.exitCode = 1;
} else if (fork) {
  console.log(`${layerId}: ${nextForkLayerStateToken()}`);
  console.log('Fork range z0-zz, in order; upstream never allocates it.');
} else {
  console.log(`${layerId}: ${nextLayerStateToken()}`);
  console.log('Order: free digits 0-9, then two-character base-36 00-zz.');
  console.log('Re-run after rebasing onto the latest main before merge.');
}
