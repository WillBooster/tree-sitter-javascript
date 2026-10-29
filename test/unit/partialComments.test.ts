import path from 'node:path';

import { Language, Parser } from '@willbooster/web-tree-sitter';
import { expect, test } from 'vitest';

await Parser.init();
const language = await Language.load(path.join(import.meta.dirname, '../../tree-sitter-javascript.wasm'));

test('preserves completed expressions before an unterminated or closed trailing block comment', () => {
  const parser = new Parser();
  parser.setLanguage(language);
  try {
    for (const [expression, kind] of [
      ['await foo()', 'await_expression'],
      ['const v = await load()', 'await_expression'],
      ['count++', 'update_expression'],
      ['await count++', 'await_expression'],
      ['await await load()', 'await_expression'],
    ] as const) {
      for (const comment of [' /*', ' /*text', ' /*\ntext']) {
        const partial = expression + comment;
        const partialTree = parser.parse(partial)!;
        try {
          expect(partialTree.rootNode.hasError, partial).toBe(true);
          expect(
            partialTree.rootNode.descendantsOfType(kind).map((node) => node.text),
            partial
          ).toContain(expression.replace(/^const v = /, ''));
        } finally {
          partialTree.delete();
        }
        const completed = partial + ' */';
        const completedTree = parser.parse(completed)!;
        try {
          expect(completedTree.rootNode.hasError, completed).toBe(false);
          expect(
            completedTree.rootNode.descendantsOfType('comment').map((node) => node.text),
            completed
          ).toEqual([comment.trim() + ' */']);
        } finally {
          completedTree.delete();
        }
      }
    }
  } finally {
    parser.delete();
  }
});
