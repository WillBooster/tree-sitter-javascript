import { expect, test } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

import { Language, Parser } from '@willbooster/web-tree-sitter';

const Root = path.join(import.meta.dirname, '../..');
// The Wasm build is the one the package ships.
const WasmPath = path.join(Root, 'tree-sitter-javascript.wasm');
await Parser.init();
const parser = new Parser();
parser.setLanguage(await Language.load(WasmPath));

function mtime(file: string): number {
  return fs.statSync(path.resolve(Root, file)).mtimeMs;
}

// The tests load the Wasm build as it is, so a check against a stale one would pass after a source edit that
// brings the slowdown back.
test('uses a Wasm build built from the current parser', () => {
  expect(
    mtime('grammar.js') > mtime('src/parser.c'),
    'grammar.js changed after src/parser.c was generated; run `bun run build/ci`'
  ).toBe(false);
  expect(
    Math.max(mtime('src/parser.c'), mtime('src/scanner.c')) > mtime(WasmPath),
    'src/ changed after the Wasm build was built; run `bun run build/ci`'
  ).toBe(false);
});

// Consumers parse files being edited, so recovering from many errors must stay linear: ten times the lines take about
// ten times as long, against a hundred times for quadratic recovery. The check compares the two sizes instead of using
// a fixed limit, since CI runners differ several-fold in speed. The parses are timed in the CPU time of the thread that
// runs them: wall-clock time is inflated unevenly by the test files running alongside, and the process's CPU time also
// counts the engine's background threads, which compile the Wasm build and collect garbage during the parses. Warm-up
// parses, alternating the sizes, and keeping the fastest of five runs each filter out the remaining noise; 18 leaves a
// margin over the ratios of 10.0 to 10.9 measured locally and fails for growth faster than about n^1.25.
test('recovers from an error on each line in linear time', { timeout: 60_000 }, () => {
  const small = '$ a\n'.repeat(2000);
  const large = '$ a\n'.repeat(20_000);
  parseCpuTime(large);
  parseCpuTime(large);
  let smallFastest = Infinity;
  let largeFastest = Infinity;
  for (let run = 0; run < 5; run++) {
    smallFastest = Math.min(smallFastest, parseCpuTime(small));
    largeFastest = Math.min(largeFastest, parseCpuTime(large));
  }
  expect(
    largeFastest / smallFastest,
    `2,000 lines took ${smallFastest} µs and 20,000 lines ${largeFastest} µs`
  ).toBeLessThan(18);
});

function parseCpuTime(source: string): number {
  const start = process.threadCpuUsage();
  const tree = parser.parse(source);
  const { system, user } = process.threadCpuUsage(start);
  if (!tree) throw new Error('The parser returned no tree');
  const { hasError } = tree.rootNode;
  tree.delete();
  expect(hasError).toBe(true);
  return system + user;
}
