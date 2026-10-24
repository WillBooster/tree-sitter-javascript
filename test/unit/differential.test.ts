import path from 'node:path';

import { expect } from 'vitest';

import { testCommand } from './run.js';

testCommand(
  'matches Acorn/Babel structure with V8 validation for non-JSX inputs',
  [
    'node',
    '--experimental-vm-modules',
    'test/helpers/differential/runComparison.mjs',
    path.resolve(import.meta.dirname, '../../tree-sitter-javascript.wasm'),
  ],
  900_000,
  { check: (output) => expect(output).toMatch(/"generated":200000,"accepted":[1-9]\d*,"seed":7,"mismatches":0/) }
);
