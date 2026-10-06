import path from 'node:path';

import { expect, test } from 'vitest';

import { Edit, Language, Parser, Query, type Node, type Point, type Tree } from '@willbooster/web-tree-sitter';

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

test('restores constructor ownership and captures across optional-chain, parentheses and trivia edits', async () => {
  await Parser.init();
  const language = await Language.load(path.join(Root, 'tree-sitter-javascript.wasm'));
  const parser = new Parser().setLanguage(language);
  const query = new Query(language, '(new_expression constructor: (primary_expression) @constructor)');
  const original = 'const value = new foo.bar(); const sentinel = 1;';
  let source = original;
  let tree = parser.parse(source)!;
  const initial = snapshot(tree.rootNode);
  try {
    for (const [expression, hasError] of [
      ['new foo?.bar()', true],
      ['new (foo?.bar)()', false],
      ['new /* boundary */ (foo?.bar)()', false],
      ['new () => 1', true],
      ['new (() => 1)()', false],
      ['new new A().b(2)', false],
      ['new yield.C()', false],
      ['new A?.1 : B', false],
      ['new foo.bar()', false],
    ] as const) {
      const nextSource = `const value = ${expression}; const sentinel = 1;`;
      let start = 0;
      while (start < source.length && start < nextSource.length && source[start] === nextSource[start]) start++;
      let oldEnd = source.length;
      let newEnd = nextSource.length;
      while (oldEnd > start && newEnd > start && source[oldEnd - 1] === nextSource[newEnd - 1]) {
        oldEnd--;
        newEnd--;
      }
      tree.edit(
        new Edit({
          startIndex: start,
          oldEndIndex: oldEnd,
          newEndIndex: newEnd,
          startPosition: pointAt(source, start),
          oldEndPosition: pointAt(source, oldEnd),
          newEndPosition: pointAt(nextSource, newEnd),
        })
      );
      const old = tree;
      let fresh: Tree | undefined;
      try {
        tree = parser.parse(nextSource, old)!;
        fresh = parser.parse(nextSource)!;
        expect(tree.rootNode.hasError, nextSource).toBe(hasError);
        expect(snapshot(tree.rootNode), nextSource).toEqual(snapshot(fresh.rootNode));
        expect(captures(query, tree), nextSource).toEqual(captures(query, fresh));
        if (!hasError) {
          checkConstructors(tree, query, nextSource);
          expect(tree.rootNode.descendantsOfType('variable_declarator').at(-1)?.childForFieldName('name')?.text).toBe(
            'sentinel'
          );
        }
      } finally {
        fresh?.delete();
        old.delete();
      }
      source = nextSource;
    }
    expect(source).toBe(original);
    expect(snapshot(tree.rootNode)).toEqual(initial);
  } finally {
    query.delete();
    tree.delete();
    parser.delete();
  }
});

function checkConstructors(tree: Tree, query: Query, source: string): void {
  expect(tree.rootNode.hasError, source).toBe(false);
  const constructors = tree.rootNode.descendantsOfType('new_expression');
  expect(constructors.length, source).toBeGreaterThan(0);
  const captured = new Set(query.captures(tree.rootNode).map(({ node }) => node.id));
  for (const expression of constructors) {
    const constructor = expression.childForFieldName('constructor')!;
    expect(captured, `${source}: ${constructor.text}`).toContain(constructor.id);
  }
}

function pointAt(source: string, index: number): Point {
  const preceding = source.slice(0, index).split('\n');
  return { row: preceding.length - 1, column: preceding.at(-1)!.length };
}

function captures(query: Query, tree: Tree): unknown {
  return query.captures(tree.rootNode).map(({ name, node }) => ({ name, node: snapshot(node) }));
}

function snapshot(node: Node): unknown {
  return {
    type: node.type,
    named: node.isNamed,
    missing: node.isMissing,
    extra: node.isExtra,
    error: node.isError,
    hasError: node.hasError,
    start: node.startIndex,
    end: node.endIndex,
    startPoint: node.startPosition,
    endPoint: node.endPosition,
    children: node.children.map((child, index) => ({ field: node.fieldNameForChild(index), node: snapshot(child) })),
  };
}
