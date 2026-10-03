import assert from 'node:assert/strict';
import path from 'node:path';

import { expect, test } from 'vitest';
import { Language, Parser } from '@willbooster/web-tree-sitter';

await Parser.init();
const language = await Language.load(path.join(import.meta.dirname, '../../tree-sitter-javascript.wasm'));

for (const [kind, expression, prefix] of [
  ['function_expression', 'function() {}', 'x = '],
  ['generator_function', 'function*() {}', 'x = '],
  ['arrow_function', '() => {}', 'x = '],
  ['function_declaration', 'function f() {}', ''],
  ['generator_function_declaration', 'function* f() {}', ''],
  ['class_declaration', 'class C {}', ''],
  ['class', 'class {}', 'x = '],
  ['function_declaration', 'function f() {}', 'export '],
  ['generator_function_declaration', 'function* f() {}', 'export default '],
  ['class_declaration', 'class C {}', 'export default '],
] as const) {
  for (const comment of ['// trailing\n', '/* trailing */\n']) {
    test(`${kind} ends before ${comment.trim()}`, () => {
      const parser = new Parser();
      parser.setLanguage(language);
      const tree = parser.parse(`${prefix}${expression}${comment}`);
      assert.ok(tree);
      try {
        expect(tree.rootNode.hasError).toBe(false);
        const [node] = tree.rootNode.descendantsOfType(kind);
        expect(node?.text).toBe(expression);
        const body = node?.childForFieldName('body');
        expect(body?.text).toBe('{}');
        expect(body?.endIndex).toBe(prefix.length + expression.length);
        expect(body?.descendantsOfType('comment')).toEqual([]);
        expect(tree.rootNode.descendantsOfType('comment').map((node) => node.text)).toEqual([comment.trim()]);
      } finally {
        tree.delete();
        parser.delete();
      }
    });
  }
}
