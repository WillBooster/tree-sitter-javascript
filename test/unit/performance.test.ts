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
  // `bun run build-wasm` compiles src/ without regenerating it, so src/parser.c must also be newer than grammar.js.
  expect(
    mtime('grammar.js') > mtime('src/parser.c'),
    'grammar.js changed after src/parser.c was generated; run `bun run build/ci`'
  ).toBe(false);
  expect(
    Math.max(mtime('src/parser.c'), mtime('src/scanner.c')) > mtime(WasmPath),
    'src/ changed after the Wasm build was built; run `bun run build/ci`'
  ).toBe(false);
});

// Consumers parse files being edited, so recovering from many errors must stay linear: 10 times as many lines must
// take about 10 times as long, where quadratic recovery takes about 100 times. The check compares CPU times of this test
// file's process (see `pool` in vitest.config.mts) instead of using a fixed limit, since CI runners differ several-fold
// in speed and run other test files in parallel, and it parses once before measuring, since compiling the Wasm module
// counts as CPU time. Its seven parses can exceed
// Vitest's default 5 s timeout on slow runners (7.3 s on macos-15-intel).
test('recovers from an error on each of 10,000 lines in linear time', { timeout: 60_000 }, () => {
  cpuTimeToParseErrorLines(10_000);
  const small = Math.min(...[1, 2, 3].map(() => cpuTimeToParseErrorLines(1000)));
  const large = Math.min(...[1, 2, 3].map(() => cpuTimeToParseErrorLines(10_000)));
  expect(large, `1,000 lines took ${small} ms and 10,000 lines ${large} ms`).toBeLessThan(small * 30);
});

function cpuTimeToParseErrorLines(lines: number): number {
  const start = process.cpuUsage();
  const tree = parser.parse('$ a\n'.repeat(lines));
  const { user, system } = process.cpuUsage(start);
  if (!tree) throw new Error('The parser returned no tree');
  const { hasError } = tree.rootNode;
  tree.delete();
  expect(hasError).toBe(true);
  return (user + system) / 1000;
}
