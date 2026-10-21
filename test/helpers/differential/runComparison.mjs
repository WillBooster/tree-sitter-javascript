import assert from 'node:assert/strict';
import { Parser, Language } from '@willbooster/web-tree-sitter';
import { ProgramGenerator, render } from './programGenerator.mjs';
import { referenceSignature } from './referenceSignature.mjs';
import { treeSignature } from './treeSignature.mjs';

assert.ok(process.argv[2], 'Pass the generated grammar Wasm path');
await Parser.init();
const language = await Language.load(process.argv[2]);
const parser = new Parser().setLanguage(language);
const generator = new ProgramGenerator(7);
const generated = 200_000;
let accepted = 0;
try {
  for (let index = 0; index < generated; index++) {
    const source = render(generator.program());
    const reference = referenceSignature(source);
    if (!reference) continue;
    accepted++;
    const tree = parser.parse(source);
    try {
      assert.deepEqual(treeSignature(tree), reference, `Generated program ${index}, seed 7:\n${source}`);
    } finally {
      tree.delete();
    }
  }
  assert.ok(accepted > 0, 'The reference parsers accepted no generated inputs');
  console.log(JSON.stringify({ generated, accepted, seed: 7, mismatches: 0 }));
} finally {
  parser.delete();
}
