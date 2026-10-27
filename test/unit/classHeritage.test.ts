import { Edit, Language, type Node, Parser, Query } from '@willbooster/web-tree-sitter';
import { expect, test } from 'vitest';

const prefix = 'class C extends ';
const suffix = ' {}\nconst sentinel = 1;';
const valid = [
  'B',
  '(B < 1)',
  'f()',
  'new B()',
  'new B',
  'B.x',
  'B[x]',
  'B?.x',
  'B?.()',
  'B?.[x]',
  'tag`x`',
  '(a => a)',
  '(() => B)()',
  'null',
  'class {}',
  'function() {}',
  '<Base/>',
  '(<Base/>)',
  '<Base/>.constructor',
  'f(<Base/>)',
  'new (<Base/>.constructor)()',
  'B /* boundary */ .x',
  'B\n?.x',
  'f /* boundary */ ()',
  'tag /* boundary */ `x`',
  'B /* boundary */ [x]',
];
const invalid = ['B < 1', 'B + D', 'B = D', 'B ? D : E', '!B', 'B++', 'a => a', 'async a => a', 'await B', 'a => {}()'];

for (const goal of ['javascript', 'javascript_script']) {
  test(`restricts class heritage to left-hand-side expressions in ${goal}`, async () => {
    await Parser.init();
    const language = await Language.load(`tree-sitter-${goal}.wasm`);
    const parser = new Parser().setLanguage(language);
    const query = new Query(
      language,
      '(class_heritage (expression) @expression) (class_heritage (primary_expression) @primary)'
    );
    try {
      for (const expression of valid) {
        const tree = parser.parse(prefix + expression + suffix)!;
        try {
          expect(tree.rootNode.hasError, expression).toBe(false);
          expect(captures(query, tree.rootNode), expression).toEqual([
            ['expression', expression, prefix.length, prefix.length + expression.length],
            ['primary', expression, prefix.length, prefix.length + expression.length],
          ]);
        } finally {
          tree.delete();
        }
      }
      for (const expression of invalid) {
        const tree = parser.parse(prefix + expression + suffix)!;
        try {
          expect(tree.rootNode.hasError, expression).toBe(true);
          expect(tree.rootNode.lastNamedChild?.text, expression).toBe('const sentinel = 1;');
          expect(tree.rootNode.lastNamedChild?.hasError, expression).toBe(false);
        } finally {
          tree.delete();
        }
      }
    } finally {
      query.delete();
      parser.delete();
    }
  });

  test(`preserves heritage ranges and queries across parenthesis edits in ${goal}`, async () => {
    await Parser.init();
    const language = await Language.load(`tree-sitter-${goal}.wasm`);
    const parser = new Parser().setLanguage(language);
    const query = new Query(
      language,
      '(class_heritage (expression) @expression) (class_heritage (primary_expression) @primary)'
    );
    let expression = 'B';
    let tree = parser.parse(prefix + expression + suffix)!;
    try {
      for (const next of ['B < 1', '(B < 1)', 'B + D', '(B + D)', 'a => a', '(a => a)', 'B?.x', 'B']) {
        tree.edit(
          new Edit({
            startIndex: prefix.length,
            oldEndIndex: prefix.length + expression.length,
            newEndIndex: prefix.length + next.length,
            startPosition: { row: 0, column: prefix.length },
            oldEndPosition: { row: 0, column: prefix.length + expression.length },
            newEndPosition: { row: 0, column: prefix.length + next.length },
          })
        );
        const edited = parser.parse(prefix + next + suffix, tree)!;
        const fresh = parser.parse(prefix + next + suffix)!;
        tree.delete();
        tree = edited;
        try {
          expect(tree.rootNode.toString(), next).toBe(fresh.rootNode.toString());
          expect(captures(query, tree.rootNode), next).toEqual(captures(query, fresh.rootNode));
          expect(tree.rootNode.hasError, next).toBe(invalid.includes(next));
          expect(tree.rootNode.lastNamedChild?.text, next).toBe('const sentinel = 1;');
        } finally {
          fresh.delete();
        }
        expression = next;
      }
    } finally {
      tree.delete();
      query.delete();
      parser.delete();
    }
  });
}

function captures(query: Query, node: Node): unknown[] {
  return query.captures(node).map(({ name, node }) => [name, node.text, node.startIndex, node.endIndex]);
}

test('preserves declarations following an unfinished comparison heritage across edits and EOF prefixes', async () => {
  await Parser.init();
  const parser = new Parser().setLanguage(await Language.load('tree-sitter-javascript.wasm'));
  const tail = '\nclass L {}\nexport function h() {}\nexport const k = 2;';
  let operator = '<';
  let tree = parser.parse(prefix + 'B' + operator + tail)!;
  const start = prefix.length + 1;
  try {
    for (const next of ['<', ' <', '<']) {
      tree.edit(
        new Edit({
          startIndex: start,
          oldEndIndex: start + operator.length,
          newEndIndex: start + next.length,
          startPosition: { row: 0, column: start },
          oldEndPosition: { row: 0, column: start + operator.length },
          newEndPosition: { row: 0, column: start + next.length },
        })
      );
      const changed = parser.parse(prefix + 'B' + next + tail, tree)!;
      const fresh = parser.parse(prefix + 'B' + next + tail)!;
      tree.delete();
      tree = changed;
      try {
        expect(tree.rootNode.toString()).toBe(fresh.rootNode.toString());
        expect(tree.rootNode.namedChildren.slice(-3).map((node) => [node.text, node.hasError])).toEqual([
          ['class L {}', false],
          ['export function h() {}', false],
          ['export const k = 2;', false],
        ]);
      } finally {
        fresh.delete();
      }
      operator = next;
    }
    for (const incomplete of [
      'class',
      'class C',
      'class C extends',
      'class C extends B',
      'class C extends B<',
      'class C extends f(',
      'class C extends B?.',
      'class C extends <Base',
      'class C extends (B',
    ]) {
      const result = parser.parse(incomplete)!;
      try {
        expect(result.rootNode.hasError, incomplete).toBe(true);
      } finally {
        result.delete();
      }
    }
  } finally {
    tree.delete();
    parser.delete();
  }
});
