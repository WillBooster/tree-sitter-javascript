import path from 'node:path';

import { expect, test } from 'vitest';
import { Edit, Language, Parser } from '@willbooster/web-tree-sitter';

await Parser.init();
const language = await Language.load(path.join(import.meta.dirname, '../../tree-sitter-javascript.wasm'));

test('preserves completed expressions while a trailing block comment is edited', () => {
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
        const completed = partial + ' */';
        const lines = partial.split('\n');
        const position = { row: lines.length - 1, column: lines.at(-1)!.length };
        const closedPosition = { row: position.row, column: position.column + 3 };
        let tree = parser.parse(partial)!;
        try {
          expect(tree.rootNode.hasError, partial).toBe(true);
          expect(
            tree.rootNode.descendantsOfType(kind).map((node) => node.text),
            partial
          ).toContain(expression.replace(/^const v = /, ''));
          const originalTree = tree.rootNode.toString();
          tree.edit(
            new Edit({
              startIndex: partial.length,
              oldEndIndex: partial.length,
              newEndIndex: completed.length,
              startPosition: position,
              oldEndPosition: position,
              newEndPosition: closedPosition,
            })
          );
          const next = parser.parse(completed, tree)!;
          tree.delete();
          tree = next;
          const fresh = parser.parse(completed)!;
          try {
            expect(tree.rootNode.hasError, completed).toBe(false);
            expect(
              tree.rootNode.descendantsOfType('comment').map((node) => node.text),
              completed
            ).toEqual([comment.trim() + ' */']);
            expect(tree.rootNode.toString(), completed).toBe(fresh.rootNode.toString());
          } finally {
            fresh.delete();
          }
          tree.edit(
            new Edit({
              startIndex: partial.length,
              oldEndIndex: completed.length,
              newEndIndex: partial.length,
              startPosition: position,
              oldEndPosition: closedPosition,
              newEndPosition: position,
            })
          );
          const restored = parser.parse(partial, tree)!;
          tree.delete();
          tree = restored;
          expect(tree.rootNode.hasError, partial).toBe(true);
          expect(tree.rootNode.toString(), partial).toBe(originalTree);
        } finally {
          tree.delete();
        }
      }
    }
  } finally {
    parser.delete();
  }
});
