import path from 'node:path';
import { expect } from 'vitest';
import { testCommand } from './run.js';

testCommand(
  'matches expression and statement structure accepted by Acorn, Babel and V8',
  [
    'node',
    '--experimental-vm-modules',
    'test/helpers/differential/runComparison.mjs',
    path.resolve(import.meta.dirname, '../../tree-sitter-javascript.wasm'),
  ],
  900_000,
  { check: (output) => expect(output).toMatch(/"generated":200000,"accepted":[1-9]\d*,"seed":7,"mismatches":0/) }
);
