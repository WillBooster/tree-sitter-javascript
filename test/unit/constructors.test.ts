import path from 'node:path';

import { Language, Parser, Query, type Tree } from '@willbooster/web-tree-sitter';
import { expect, test } from 'vitest';

const Root = path.join(import.meta.dirname, '../..');

test('rejects unparenthesized optional and arrow constructors while preserving canonical constructor queries', async () => {
  await Parser.init();
  const language = await Language.load(path.join(Root, 'tree-sitter-javascript.wasm'));
  const parser = new Parser().setLanguage(language);
  const query = new Query(language, '(new_expression constructor: (primary_expression) @constructor)');
  try {
    for (const source of ['new foo?.bar();', 'new () => 1;', 'new foo?.[key]();', 'new foo?.();']) {
      const tree = parser.parse(source)!;
      try {
        expect(tree.rootNode.hasError, source).toBe(true);
      } finally {
        tree.delete();
      }
    }
    for (const expression of [
      'new (foo?.bar)()',
      'new (() => 1)()',
      'new foo.bar()',
      'new foo[key]()',
      'new new A().b(2)',
      'new new A()(2)',
      'new new A',
      'new f`tag`',
      'new function(){}',
      'new async function(){}',
      'new async function named(){}()',
      'new async function*(){}.value',
      'new async /* c */ function(){}[0]',
      'new class{}',
      'new yield.C()',
      'new A?.1 : B',
      'new A /(B)',
      'new A /[B]',
      'new A /`tag`',
      'new A /.1',
    ]) {
      const source = `function f(){ return ${expression}; } const sentinel = 1;`;
      const tree = parser.parse(source)!;
      try {
        checkConstructors(tree, query, source);
        expect(tree.rootNode.descendantsOfType('yield_expression'), source).toHaveLength(0);
        const yieldNames = tree.rootNode.descendantsOfType('identifier').filter((node) => node.text === 'yield');
        expect(yieldNames, source).toHaveLength(expression.includes('yield') ? 1 : 0);
      } finally {
        tree.delete();
      }
    }
  } finally {
    query.delete();
    parser.delete();
  }
});

test('preserves constructor ownership and captures in a variable initializer', async () => {
  await Parser.init();
  const language = await Language.load(path.join(Root, 'tree-sitter-javascript.wasm'));
  const parser = new Parser().setLanguage(language);
  const query = new Query(language, '(new_expression constructor: (primary_expression) @constructor)');
  try {
    for (const [expression, hasError] of [
      ['new foo.bar()', false],
      ['new foo?.bar()', true],
      ['new (foo?.bar)()', false],
      ['new /* boundary */ (foo?.bar)()', false],
      ['new () => 1', true],
      ['new (() => 1)()', false],
      ['new new A().b(2)', false],
      ['new yield.C()', false],
      ['new A?.1 : B', false],
      ['new async function(){}', false],
      ['new async /* c */ function(){}', false],
      ['new async /* c\n */ function named(){}', false],
    ] as const) {
      const source = `const value = ${expression}; const sentinel = 1;`;
      const tree = parser.parse(source)!;
      try {
        expect(tree.rootNode.hasError, source).toBe(hasError);
        if (!hasError) checkConstructors(tree, query, source);
      } finally {
        tree.delete();
      }
    }
  } finally {
    query.delete();
    parser.delete();
  }
});

test.each(['javascript', 'javascript_script'])(
  'ends construction before a decimal statement after a line break in %s',
  async (goal) => {
    await Parser.init();
    const language = await Language.load(path.join(Root, `tree-sitter-${goal}.wasm`));
    const parser = new Parser().setLanguage(language);
    const query = new Query(
      language,
      '(new_expression constructor: (primary_expression) @constructor) (number) @number'
    );
    try {
      for (const newline of ['\n', '\r', '\r\n', '\u2028', '\u2029']) {
        for (const construction of ['new Ctor', 'new Namespace.Ctor', 'new Ctor()']) {
          for (const decimal of ['.5', '.5e+1', '.5_0']) {
            for (const separator of [newline, `// boundary${newline}`, ' ']) {
              const source = `${construction}${separator}${decimal}; const sentinel = 1;`;
              const tree = parser.parse(source)!;
              try {
                expect(tree.rootNode.hasError, source).toBe(separator === ' ');
                if (separator !== ' ') {
                  checkConstructors(tree, query, source);
                  const expressions = tree.rootNode.namedChildren.filter(
                    (node) => node.type === 'expression_statement'
                  );
                  expect(expressions).toHaveLength(2);
                  const parsedConstruction = expressions[0]!.namedChildren.find(
                    (node) => node.type === 'new_expression'
                  )!;
                  expect(parsedConstruction.text).toBe(construction);
                  expect(parsedConstruction.endIndex).toBe(construction.length);
                  const number = expressions[1]!.firstNamedChild!;
                  expect(number.type).toBe('number');
                  expect(number.text).toBe(decimal);
                  expect(number.startIndex).toBe(construction.length + separator.length);
                }
              } finally {
                tree.delete();
              }
            }
          }
        }
      }
    } finally {
      query.delete();
      parser.delete();
    }
  }
);

function checkConstructors(tree: Tree, query: Query, source: string): void {
  expect(tree.rootNode.hasError, source).toBe(false);
  const constructors = tree.rootNode.descendantsOfType('new_expression');
  expect(constructors.length, source).toBeGreaterThan(0);
  const captured = new Set(query.captures(tree.rootNode).map(({ node }) => node.id));
  for (const expression of constructors) {
    const constructor = expression.childForFieldName('constructor')!;
    expect(captured, `${source}: ${constructor.text}`).toContain(constructor.id);
  }
  const sentinel = tree.rootNode.descendantsOfType('variable_declarator').at(-1)!;
  expect(sentinel.childForFieldName('name')?.text, source).toBe('sentinel');
  expect(sentinel.parent?.type, source).toBe('lexical_declaration');
  expect(sentinel.parent?.parent?.type, source).toBe('program');
  expect(sentinel.text, source).toBe('sentinel = 1');
  expect(sentinel.startIndex, source).toBe(source.indexOf('sentinel'));
  expect(sentinel.endIndex, source).toBe(source.indexOf('sentinel') + 'sentinel = 1'.length);
}
