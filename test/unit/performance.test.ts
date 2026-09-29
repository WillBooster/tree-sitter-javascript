import { expect, test } from 'bun:test';
import fs from 'node:fs';
import path from 'node:path';

import { Language, Parser } from 'web-tree-sitter';

const Root = path.join(import.meta.dir, '../..');
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

// Consumers parse files being edited, so recovering from many errors must stay linear. Linear recovery
// takes about 0.2 s here.
test('recovers from an error on each of 10,000 lines in linear time', () => {
  const start = performance.now();
  const tree = parser.parse('$ a\n'.repeat(10_000));
  const elapsed = performance.now() - start;
  if (!tree) throw new Error('The parser returned no tree');
  const { hasError } = tree.rootNode;
  tree.delete();
  expect(hasError).toBe(true);
  expect(elapsed).toBeLessThan(3000);
});
