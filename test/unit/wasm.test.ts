import { testCommand } from './run.js';

// The package ships a Wasm build, compiled with a different compiler and C library than the native one. The
// first run downloads the WASI SDK.
testCommand(
  'parses the corpus in test/corpus as expected with the Wasm build',
  ['bun', 'run', 'tree-sitter', 'test', '--wasm'],
  900_000
);
