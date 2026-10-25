import fs from 'node:fs';

import { Edit, Language, type Node, Parser, type Point, Query, type Tree } from '@willbooster/web-tree-sitter';
import { expect, test } from 'vitest';

const Operators = ['=', '+=', '-=', '*=', '/=', '%=', '**=', '<<=', '>>=', '>>>=', '&=', '|=', '^='];
const Targets = [
  'foo()',
  '(foo())',
  '((foo()))',
  '((foo?.())())',
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
        ...['(a+b)', '((a+b))', '(a,b)', '(a=1)', '({a})', '([a])', '(foo?.())', '((foo?.bar))'].map(
          (target) => `${target} = 1`
        ),
        ...['&&=', '||=', '??='].flatMap((operator) => [`(foo()) ${operator} 1`, `((foo())) ${operator} 1`]),
        '[...(a,b)] = value',
        '({ a: (a+b) } = value)',
        '[(foo())] = value',
        '[(a+b) = 1] = value',
        'a.b++[0]',
        'a.b--[0]',
        'a.b++(0)',
        'a[0]++[0]',
        'a()++[0]',
        '(a)++[0]',
        '(a)--[0]',
        '(a)++ ++b',
        '(a)++ `t`',
        'a?.b++[0]',
        'x = (a)++[0]',
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

  test(`preserves simple grouped targets across assignment consumers in ${goal}`, async () => {
    await Parser.init();
    const language = await Language.load(`tree-sitter-${goal}.wasm`);
    const parser = new Parser().setLanguage(language);
    const query = new Query(language, '(parenthesized_expression [(expression) (sequence_expression)] @inner)');
    try {
      for (const statement of [
        ...['=', '+=', '&&=', '||=', '??='].flatMap((operator) => [
          `((a)) ${operator} value;`,
          `((foo?.()).x) ${operator} value;`,
          `((a,b).x) ${operator} value;`,
        ]),
        '[(a)] = value;',
        '[(a) = 1] = value;',
        '[...(a)] = value;',
        '({ a: ((b)) = 1 } = value);',
        'for (((a)) in value) {}',
        'for (((foo())) of value) {}',
        '((a))++;',
        '++((foo()));',
      ]) {
        const source = `${statement} ${Following}`;
        const tree = parser.parse(source)!;
        try {
          expect(tree.rootNode.hasError, source).toBe(false);
          expect(tree.rootNode.lastNamedChild!.text, source).toBe(Following);
          const captures = query.captures(tree.rootNode);
          for (const group of tree.rootNode.descendantsOfType('parenthesized_expression')) {
            const inner = group.firstNamedChild!;
            expect(
              captures.filter(({ node }) => node.id === inner.id),
              source
            ).toHaveLength(1);
          }
        } finally {
          tree.delete();
        }
      }
      for (const [source, expected] of [
        [
          '((a)) = value;',
          [
            [0, 5],
            [1, 4],
          ],
        ],
        [
          '++((foo()));',
          [
            [2, 11],
            [3, 10],
          ],
        ],
        [
          '((foo?.()).x) += value;',
          [
            [0, 13],
            [1, 10],
          ],
        ],
        [
          '[(a), ...((b))] = value;',
          [
            [1, 4],
            [9, 14],
            [10, 13],
          ],
        ],
        [
          'for (((a)) of value) {}',
          [
            [5, 10],
            [6, 9],
          ],
        ],
        [
          '\n  ((a)) = value;',
          [
            [3, 8],
            [4, 7],
          ],
        ],
      ] as const) {
        const tree = parser.parse(source)!;
        try {
          expect(tree.rootNode.hasError, source).toBe(false);
          expect(
            tree.rootNode.descendantsOfType('parenthesized_expression').map((node) => [node.startIndex, node.endIndex]),
            source
          ).toEqual(expected);
        } finally {
          tree.delete();
        }
      }
      for (const source of ['for ((a+b) in value) {}', 'for ((foo?.()) of value) {}']) {
        const tree = parser.parse(source)!;
        try {
          expect(tree.rootNode.hasError, source).toBe(true);
        } finally {
          tree.delete();
        }
      }
    } finally {
      query.delete();
      parser.delete();
    }
  });

  test(`keeps await context when classifying loop call targets in ${goal}`, async () => {
    await Parser.init();
    const language = await Language.load(`tree-sitter-${goal}.wasm`);
    const parser = new Parser().setLanguage(language);
    try {
      const sources = [
        'function f(){ for ((await(a)) of b); }',
        'async function f(){ for (await(a) of b); }',
        'async function f(){ for (await(a) in b); }',
        'function f(){ for ((await(a)) of b); }',
      ];
      if (goal === 'javascript') sources.splice(1, 0, 'for (await(a) of b);');
      if (goal === 'javascript_script') sources.push('for ((await(a)) of b);');
      let source = sources[0]!;
      let tree = parser.parse(source)!;
      try {
        for (const next of sources) {
          tree = reparse(parser, tree, source, next);
          source = next;
          const fresh = parser.parse(source)!;
          try {
            const valid = source.includes('((await(a))');
            expect(tree.rootNode.hasError, source).toBe(!valid);
            expect(snapshot(tree.rootNode), source).toEqual(snapshot(fresh.rootNode));
            if (valid) {
              const call = tree.rootNode.descendantsOfType('call_expression')[0]!;
              expect(call.childForFieldName('function')?.text, source).toBe('await');
              expect(tree.rootNode.descendantsOfType('await_expression'), source).toHaveLength(0);
            }
          } finally {
            fresh.delete();
          }
        }
      } finally {
        tree.delete();
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
      '((foo())) += 1',
      '(foo()) &&= 1',
      '(a+b) = 1',
      '((a)) ||= 1',
      '[(a)] = value',
      'for ((foo()) of value) {}',
      '((a))++',
      'a !== (get)++\n\nx=>1',
      '(a)\n++b',
      '(a)+ +b',
      'a.b++[0]',
      '(a)++ ++b',
      '(a)++ `t`',
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
          expect(tree.rootNode.hasError, source).toBe(
            ['foo?.bar() += 1', '(foo()) &&= 1', '(a+b) = 1', 'a.b++[0]', '(a)++ ++b', '(a)++ `t`'].includes(expression)
          );
          expect(snapshot(tree.rootNode), source).toEqual(snapshot(fresh.rootNode));
          for (const query of queries) {
            expect(
              query.captures(tree.rootNode).map(({ name, node }) => [name, snapshot(node)]),
              source
            ).toEqual(query.captures(fresh.rootNode).map(({ name, node }) => [name, snapshot(node)]));
          }
          expect(tree.rootNode.lastNamedChild!.text, source).toBe(Following);
          if (expression.includes('(get)++')) {
            expect(tree.rootNode.namedChildren, source).toHaveLength(3);
            const binary = tree.rootNode.firstNamedChild!.firstNamedChild!;
            expect(binary.childForFieldName('right')?.type, source).toBe('update_expression');
            expect(binary.childForFieldName('right')?.childForFieldName('operator')?.text, source).toBe('++');
          }
          if (expression === '(a)\n++b') {
            expect(tree.rootNode.namedChildren, source).toHaveLength(3);
            const update = tree.rootNode.namedChildren[1]!.firstNamedChild!;
            expect(update.type, source).toBe('update_expression');
            expect(update.childForFieldName('argument')?.text, source).toBe('b');
          }
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
