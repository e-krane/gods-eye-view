import test from 'node:test';
import assert from 'node:assert/strict';

import {
  LAYER_STATE_TOKEN_RESERVATIONS,
  isForkLayerStateToken,
  nextForkLayerStateToken,
  nextLayerStateToken,
  validateLayerStateAllocations,
} from './layerState.js';

const upstreamBase = Object.fromEntries(
  Object.entries(LAYER_STATE_TOKEN_RESERVATIONS).filter(
    ([, token]) => !isForkLayerStateToken(token),
  ),
);

test('fork range is the two-character z namespace only', () => {
  assert.equal(isForkLayerStateToken('z0'), true);
  assert.equal(isForkLayerStateToken('zz'), true);
  assert.equal(isForkLayerStateToken('z'), false);
  assert.equal(isForkLayerStateToken('y0'), false);
  assert.equal(isForkLayerStateToken('0'), false);
  assert.equal(isForkLayerStateToken('zZ'), false);
});

test('fork allocation takes z0-zz in order and never an upstream token', () => {
  assert.equal(nextForkLayerStateToken(upstreamBase), 'z0');
  assert.equal(
    nextForkLayerStateToken({ ...upstreamBase, a: 'z0', b: 'z1' }),
    'z2',
  );
  assert.equal(nextLayerStateToken({ ...upstreamBase, a: 'z0' }), '0');
  const full = Object.fromEntries(
    [...'0123456789abcdefghijklmnopqrstuvwxyz'].map((c) => [`f-${c}`, `z${c}`]),
  );
  assert.throws(() => nextForkLayerStateToken(full), /range exhausted/);
});

test('fork and upstream allocations validate independently', () => {
  // A fork layer does not consume upstream's next free token.
  assert.equal(
    validateLayerStateAllocations(upstreamBase, {
      ...upstreamBase,
      forkLayer: 'z0',
    }),
    true,
  );
  // Upstream layers merged in later still take upstream's sequence.
  const forkBase = { ...upstreamBase, forkLayer: 'z0' };
  assert.equal(
    validateLayerStateAllocations(forkBase, {
      ...forkBase,
      upstreamLayer: nextLayerStateToken(upstreamBase),
      nextFork: 'z1',
    }),
    true,
  );
  assert.throws(
    () =>
      validateLayerStateAllocations(forkBase, {
        ...forkBase,
        skipped: 'z2',
      }),
    /next free token z1/,
  );
  assert.throws(
    () =>
      validateLayerStateAllocations(forkBase, {
        ...forkBase,
        reused: 'z0',
      }),
    /next free token z1/,
  );
});
