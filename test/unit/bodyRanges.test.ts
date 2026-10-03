import assert from 'node:assert/strict';
import path from 'node:path';

import { expect, test } from 'vitest';
import { Language, Parser, Query } from '@willbooster/web-tree-sitter';

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
  for (const comment of ['// trailing\n', '/* trailing */\n', '// trailing', '/* trailing */']) {
    test(`${prefix || 'standalone '}${kind} ends before ${comment.trim()}${comment.endsWith('\n') ? ' with newline' : ' at EOF'}`, () => {
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

test('statement boundaries preserve supertype queries', () => {
  const parser = new Parser();
  parser.setLanguage(language);
  const tree = parser.parse(`function f() {}
function* g() {}
class C {}
{}
export function h() {}
export default function* i() {}
export class D {}
export const z = 1;
var w = 2;
foo();
`);
  assert.ok(tree);
  const query = new Query(language, '(statement) @statement\n(declaration) @declaration');
  try {
    expect(tree.rootNode.hasError).toBe(false);
    const captures = query.captures(tree.rootNode);
    const statements = new Set(
      captures.filter((capture) => capture.name === 'statement').map((capture) => capture.node.id)
    );
    for (const node of tree.rootNode.namedChildren) expect(statements.has(node.id), node.type).toBe(true);
    const declarations = new Set(
      captures.filter((capture) => capture.name === 'declaration').map((capture) => capture.node.id)
    );
    for (const node of tree.rootNode.descendantsOfType([
      'function_declaration',
      'generator_function_declaration',
      'class_declaration',
      'lexical_declaration',
      'variable_declaration',
    ])) {
      expect(declarations.has(node.id), node.text).toBe(true);
    }
  } finally {
    query.delete();
    tree.delete();
    parser.delete();
  }
});
