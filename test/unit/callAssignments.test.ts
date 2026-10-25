import fs from 'node:fs';

import { Edit, Language, type Node, Parser, type Point, Query, type Tree } from '@willbooster/web-tree-sitter';
import { expect, test } from 'vitest';

const Operators = ['=', '+=', '-=', '*=', '/=', '%=', '**=', '<<=', '>>=', '>>>=', '&=', '|=', '^='];
const Targets = [
  'foo()',
  'foo().bar()',
  'foo()[key]()',
  '(foo?.bar)()',
  '(foo?.())()',
  'new (foo?.bar)()()',
  'new A()()',
  'foo`tag`()',
  '(async()=>1)()',
  'obj[()=>{}]()',
  'import("x").then()',
];
const Following = 'const sentinel = 1;';

for (const goal of ['javascript', 'javascript_script']) {
  test(`parses classic call assignments and preserves callee supertype captures in ${goal}`, async () => {
    await Parser.init();
    const language = await Language.load(`tree-sitter-${goal}.wasm`);
    const parser = new Parser().setLanguage(language);
    const query = new Query(
      language,
      '(call_expression function: (expression) @expression) (call_expression function: (primary_expression) @primary)'
    );
    try {
      for (const target of Targets) {
        for (const operator of Operators) {
          const source = `${target} ${operator} value; ${Following}`;
          const tree = parser.parse(source)!;
          try {
            expect(tree.rootNode.hasError, source).toBe(false);
            const assignment = tree.rootNode.firstNamedChild!.firstNamedChild!;
            expect(assignment.type, source).toBe(
              operator === '=' ? 'assignment_expression' : 'augmented_assignment_expression'
            );
            expect(assignment.childForFieldName('left')?.text, source).toBe(target);
            expect(assignment.childForFieldName('right')?.text, source).toBe('value');
            checkCallees(tree, query, source);
            expect(tree.rootNode.lastNamedChild!.text, source).toBe(Following);
          } finally {
            tree.delete();
          }
        }
      }
    } finally {
      query.delete();
      parser.delete();
    }
  });

  test(`rejects invalid call targets and unparenthesized assignment operands in ${goal}`, async () => {
    await Parser.init();
    const parser = new Parser().setLanguage(await Language.load(`tree-sitter-${goal}.wasm`));
    try {
      for (const expression of [
        'foo?.bar() = 1',
        'foo?.() += 1',
        'foo?.bar().baz() = 1',
        'foo()?.bar() += 1',
        'new foo?.bar()() = 1',
        'foo`tag` = 1',
        'import("x") = 1',
        ...['&&=', '||=', '??='].map((operator) => `foo() ${operator} 1`),
        ...['!', '~', 'typeof ', 'void ', 'delete ', '+', '-', '1+', '1*'].map((prefix) => `${prefix}foo() = 1`),
        'async function f(){ await foo() = 1; }',
      ]) {
        const tree = parser.parse(`${expression}; ${Following}`)!;
        try {
          expect(tree.rootNode.hasError, expression).toBe(true);
          expect(tree.rootNode.lastNamedChild!.text, expression).toBe(Following);
          expect(tree.rootNode.lastNamedChild!.hasError, expression).toBe(false);
        } finally {
          tree.delete();
        }
      }
    } finally {
      parser.delete();
    }
  });

  test(`preserves grouping and all public query results through call assignment edits in ${goal}`, async () => {
    await Parser.init();
    const language = await Language.load(`tree-sitter-${goal}.wasm`);
    const parser = new Parser().setLanguage(language);
    const queries = ['highlights', 'highlights-jsx', 'highlights-params', 'locals', 'tags', 'injections'].map(
      (name) => new Query(language, fs.readFileSync(`queries/${name}.scm`, 'utf8'))
    );
    const expressions = [
      'foo().bar() += 1',
      'foo?.bar() += 1',
      '(foo?.bar)() += 1',
      'new (foo?.bar)()() = 1',
      '!(foo() = 1)',
      '1 + (foo() = 1)',
      'async function f(){ await (foo() = 1); }',
      '(foo() = 1)()',
      'foo() = bar() = 1',
      'foo().bar() += 1',
    ];
    let source = `${expressions[0]};\n${Following}`;
    let tree = parser.parse(source)!;
    const initial = snapshot(tree.rootNode);
    try {
      for (const expression of expressions) {
        const next = `${expression};\n${Following}`;
        tree = reparse(parser, tree, source, next);
        source = next;
        const fresh = parser.parse(source)!;
        try {
          expect(tree.rootNode.hasError, source).toBe(expression === 'foo?.bar() += 1');
          expect(snapshot(tree.rootNode), source).toEqual(snapshot(fresh.rootNode));
          for (const query of queries) {
            expect(
              query.captures(tree.rootNode).map(({ name, node }) => [name, snapshot(node)]),
              source
            ).toEqual(query.captures(fresh.rootNode).map(({ name, node }) => [name, snapshot(node)]));
          }
          expect(tree.rootNode.lastNamedChild!.text, source).toBe(Following);
          if (expression.startsWith('!')) {
            const unary = tree.rootNode.firstNamedChild!.firstNamedChild!;
            expect(unary.type).toBe('unary_expression');
            const argument = unary.childForFieldName('argument')!;
            expect(argument.type).toBe('parenthesized_expression');
            expect(argument.firstNamedChild!.type).toBe('assignment_expression');
          }
        } finally {
          fresh.delete();
        }
      }
      expect(snapshot(tree.rootNode)).toEqual(initial);
    } finally {
      tree.delete();
      for (const query of queries) query.delete();
      parser.delete();
    }
  });
}

function checkCallees(tree: Tree, query: Query, source: string): void {
  const captures = query.captures(tree.rootNode);
  for (const call of tree.rootNode.descendantsOfType('call_expression')) {
    const callee = call.childForFieldName('function')!;
    if (callee.type === 'import') continue;
    expect(
      captures.some(({ name, node }) => name === 'primary' && node.id === callee.id),
      source
    ).toBe(true);
    if (call.childForFieldName('arguments')?.type === 'arguments' && !call.childForFieldName('optional_chain')) {
      expect(
        captures.some(({ name, node }) => name === 'expression' && node.id === callee.id),
        source
      ).toBe(true);
    }
  }
}

function reparse(parser: Parser, tree: Tree, source: string, next: string): Tree {
  let start = 0;
  while (start < source.length && start < next.length && source[start] === next[start]) start++;
  let oldEnd = source.length;
  let newEnd = next.length;
  while (oldEnd > start && newEnd > start && source[oldEnd - 1] === next[newEnd - 1]) {
    oldEnd--;
    newEnd--;
  }
  tree.edit(
    new Edit({
      startIndex: start,
      oldEndIndex: oldEnd,
      newEndIndex: newEnd,
      startPosition: point(source, start),
      oldEndPosition: point(source, oldEnd),
      newEndPosition: point(next, newEnd),
    })
  );
  const nextTree = parser.parse(next, tree)!;
  tree.delete();
  return nextTree;
}

function point(source: string, index: number): Point {
  const prefix = source.slice(0, index).split('\n');
  return { row: prefix.length - 1, column: prefix.at(-1)!.length };
}

function snapshot(node: Node): unknown {
  return [
    node.type,
    node.isNamed,
    node.isMissing,
    node.isExtra,
    node.isError,
    node.hasError,
    node.startIndex,
    node.endIndex,
    node.startPosition,
    node.endPosition,
    node.children.map((child, index) => [node.fieldNameForChild(index), snapshot(child)]),
  ];
}
