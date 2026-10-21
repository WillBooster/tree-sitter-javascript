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
      ['new async function(){}', false],
      ['new async /* c */ function(){}', false],
      ['new async /* c\n */ function named(){}', false],
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
            let separator = newline;
            let source = `${construction}${separator}${decimal}; const sentinel = 1;`;
            let tree = parser.parse(source)!;
            try {
              for (const replacement of [newline, `// boundary${newline}`, ' ', newline]) {
                const next = `${construction}${replacement}${decimal}; const sentinel = 1;`;
                tree.edit(
                  new Edit({
                    startIndex: construction.length,
                    oldEndIndex: construction.length + separator.length,
                    newEndIndex: construction.length + replacement.length,
                    startPosition: pointAt(source, construction.length),
                    oldEndPosition: pointAt(source, construction.length + separator.length),
                    newEndPosition: pointAt(next, construction.length + replacement.length),
                  })
                );
                const previous = tree;
                tree = parser.parse(next, previous)!;
                previous.delete();
                source = next;
                separator = replacement;
                const fresh = parser.parse(source)!;
                try {
                  expect(tree.rootNode.hasError, source).toBe(replacement === ' ');
                  expect(snapshot(tree.rootNode), source).toEqual(snapshot(fresh.rootNode));
                  expect(captures(query, tree), source).toEqual(captures(query, fresh));
                  if (replacement !== ' ') {
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
                    expect(number.startIndex).toBe(construction.length + replacement.length);
                  }
                } finally {
                  fresh.delete();
                }
              }
            } finally {
              tree.delete();
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
