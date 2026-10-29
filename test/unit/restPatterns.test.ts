import { Language, Parser, Query } from '@willbooster/web-tree-sitter';
import { expect, test } from 'vitest';

const Following = 'const sentinel = 1;';
const PatternQuery =
  '(array_pattern (pattern) @element) (formal_parameters (pattern) @parameter) ' +
  '(object_pattern (rest_pattern) @rest) (parenthesized_expression (expression) @expression) ' +
  '(parenthesized_expression (primary_expression) @primary)';

for (const goal of ['javascript', 'javascript_script']) {
  test(`rejects nested destructuring targets for object rest in ${goal}`, async () => {
    await Parser.init();
    const parser = new Parser();
    try {
      parser.setLanguage(await Language.load(`tree-sitter-${goal}.wasm`));
      for (const target of [
        '[]',
        '{}',
        '[rest]',
        '{rest}',
        '{key: rest}',
        '[...rest]',
        '{...rest}',
        '([])',
        '({})',
        '([rest])',
        '({rest})',
        '(([rest]))',
      ]) {
        for (const statement of [
          `({...${target}} = values);`,
          `({first, ...${target}} = values);`,
          `const {...${target}} = values;`,
          `let {first, ...${target}} = values;`,
          `var {...${target}} = values;`,
          `function f({...${target}}) {}`,
          `const f = ({...${target}}) => {};`,
          `async function f({...${target}}) {}`,
          `function* f({...${target}}) {}`,
          `function f(...[{...${target}}]) {}`,
          `for ({...${target}} of values) {}`,
          `for (const {...${target}} of values) {}`,
          `for (var {...${target}} in values) {}`,
          `try {} catch ({...${target}}) {}`,
          `({outer: {... /* rest */ ${target}}} = values);`,
        ]) {
          const tree = parser.parse(`${statement}\n${Following}`)!;
          try {
            expect(tree.rootNode.hasError, statement).toBe(true);
            expect(tree.rootNode.lastNamedChild!.text, statement).toBe(Following);
            expect(tree.rootNode.lastNamedChild!.hasError, statement).toBe(false);
          } finally {
            tree.delete();
          }
        }
      }
    } finally {
      parser.delete();
    }
  });

  test(`preserves distinct object and array rest targets in ${goal}`, async () => {
    await Parser.init();
    const language = await Language.load(`tree-sitter-${goal}.wasm`);
    const parser = new Parser().setLanguage(language);
    const query = new Query(language, '(rest_pattern (_) @target) @rest');
    try {
      for (const [source, expected] of [
        [
          '({...target.member} = values);',
          [
            ['rest', '...target.member', 2, 18],
            ['target', 'target.member', 5, 18],
          ],
        ],
        [
          '({...((target[key]))} = values);',
          [
            ['rest', '...((target[key]))', 2, 20],
            ['target', '((target[key]))', 5, 20],
          ],
        ],
        [
          'function f(...[first,,...rest]) {}',
          [
            ['rest', '...[first,,...rest]', 11, 30],
            ['target', '[first,,...rest]', 14, 30],
            ['rest', '...rest', 22, 29],
            ['target', 'rest', 25, 29],
          ],
        ],
      ] as const) {
        const tree = parser.parse(source)!;
        try {
          expect(tree.rootNode.hasError, source).toBe(false);
          expect(
            query.captures(tree.rootNode).map(({ name, node }) => [name, node.text, node.startIndex, node.endIndex]),
            source
          ).toEqual(expected);
        } finally {
          tree.delete();
        }
      }
      for (const statement of [
        '({...rest} = values);',
        'const {first, ...rest} = values;',
        'function f({first, ...rest}) {}',
        'for ({...rest} of values) {}',
        'function f(...[{first, ...rest}]) {}',
      ]) {
        const initial = `const before = 0;\n${statement}\n${Following}`;
        expectStatements(parser, [
          [initial, false],
          [initial.replace('...rest', '...[rest]'), true],
          [initial.replace('...rest', '...{rest}'), true],
          [initial.replace('...rest', '... /* rest */ rest'), false],
        ]);
      }
    } finally {
      query.delete();
      parser.delete();
    }
  });

  test(`rejects rest syntax as an object-pattern property value in ${goal}`, async () => {
    await Parser.init();
    const parser = new Parser().setLanguage(await Language.load(`tree-sitter-${goal}.wasm`));
    try {
      for (const statement of [
        '({a: ...b} = values);',
        '({a: ...b, c} = values);',
        '({a: ...b,} = values);',
        '({a: ...b = other} = values);',
        'const {a: ...b} = values;',
        'let {a: ...b, c} = values;',
        'var {a: ...b,} = values;',
        'function f({a: ...b}) {}',
        'const f = ({a: ...b}) => {};',
        'async function f({a: ...b}) {}',
        'function* f({a: ...b}) {}',
        'for ({a: ...b} of values) {}',
        'for (const {a: ...b} of values) {}',
        'for (var {a: ...b} in values) {}',
        '({[key]: /* comment */ ...b} = values);',
        '({outer: {a: ...b}} = values);',
        'function f(...[{a: ...b}]) {}',
      ]) {
        const tree = parser.parse(`${statement}\n${Following}`)!;
        try {
          expect(tree.rootNode.hasError, statement).toBe(true);
          expect(tree.rootNode.lastNamedChild!.text, statement).toBe(Following);
          expect(tree.rootNode.lastNamedChild!.hasError, statement).toBe(false);
        } finally {
          tree.delete();
        }
      }
    } finally {
      parser.delete();
    }
  });

  test(`preserves object-pattern value captures in ${goal}`, async () => {
    await Parser.init();
    const language = await Language.load(`tree-sitter-${goal}.wasm`);
    const parser = new Parser().setLanguage(language);
    const query = new Query(language, '(pair_pattern key: (_) @key value: (pattern) @value)');
    try {
      for (const [statement, expected] of [
        [
          '({a: b} = values);',
          [
            ['key', 'a', 2, 3],
            ['value', 'b', 5, 6],
          ],
        ],
        [
          '({a: [b,,...rest], ...other} = values);',
          [
            ['key', 'a', 2, 3],
            ['value', '[b,,...rest]', 5, 17],
          ],
        ],
        [
          '({a: ((target.member))} = values);',
          [
            ['key', 'a', 2, 3],
            ['value', '((target.member))', 5, 22],
          ],
        ],
      ] as const) {
        const tree = parser.parse(statement)!;
        try {
          expect(tree.rootNode.hasError, statement).toBe(false);
          expect(
            query.captures(tree.rootNode).map(({ name, node }) => [name, node.text, node.startIndex, node.endIndex]),
            statement
          ).toEqual(expected);
        } finally {
          tree.delete();
        }
      }
      for (const statement of [
        '({a: target} = values);',
        'const {a: target = other} = values;',
        'function f({a: target}) {}',
        'for ({a: target} of values) {}',
        '({outer: {a: target}, ...rest} = values);',
      ]) {
        const initial = `const before = 0;\n${statement}\n${Following}`;
        const offset = initial.indexOf('target');
        expectStatements(parser, [
          [initial, false],
          [initial.slice(0, offset) + '...' + initial.slice(offset), true],
          [initial.slice(0, offset) + '/* value */ ' + initial.slice(offset), false],
        ]);
      }
    } finally {
      query.delete();
      parser.delete();
    }
  });

  test(`requires rest elements and parameters to end their lists in ${goal}`, async () => {
    await Parser.init();
    const parser = new Parser().setLanguage(await Language.load(`tree-sitter-${goal}.wasm`));
    try {
      for (const tail of [',', ', next', ',,', ', ...next', ' /* comment */ , next', '= values', '= values, next']) {
        for (const statement of [
          `[first, ...rest${tail}] = values;`,
          `const [first, ...rest${tail}] = values;`,
          `function f([first, ...rest${tail}]) {}`,
          `for ([first, ...rest${tail}] of values) {}`,
          `for (var [first, ...rest${tail}] in values) {}`,
          `({first, ...rest${tail}} = values);`,
          `let {first, ...rest${tail}} = values;`,
          `const f = ({first, ...rest${tail}}) => {};`,
          `function f(first, ...rest${tail}) {}`,
          `const f = (first, ...rest${tail}) => {};`,
          `async function f(first, ...rest${tail}) {}`,
          `function* f(first, ...rest${tail}) {}`,
          `for ([...[first, ...rest${tail}]] of values) {}`,
        ]) {
          const tree = parser.parse(`${statement}\n${Following}`)!;
          try {
            expect(tree.rootNode.hasError, statement).toBe(true);
            expect(tree.rootNode.lastNamedChild!.text, statement).toBe(Following);
            expect(tree.rootNode.lastNamedChild!.hasError, statement).toBe(false);
          } finally {
            tree.delete();
          }
        }
      }
    } finally {
      parser.delete();
    }
  });

  test(`preserves holes, nested patterns, defaults, and public supertype captures in ${goal}`, async () => {
    await Parser.init();
    const language = await Language.load(`tree-sitter-${goal}.wasm`);
    const parser = new Parser().setLanguage(language);
    const query = new Query(language, PatternQuery);
    try {
      for (const statement of [
        '[] = values;',
        '[,,,] = values;',
        '[a = 1,,...rest] = values;',
        'const [a = 1,,...[b,...rest]] = values;',
        '({a: [b = 1,,...rest], ...other} = values);',
        'const {a: [b = 1,,...rest], ...other} = values;',
        'function f(a = 1, [b,,...rest], {c, ...other}, ...args) {}',
        'function f(a = 1, [b,,...rest], {c, ...other},) {}',
        'async function f([a,,...rest], ...args) { await value; }',
        'function* f([a,,...rest], ...args) { yield value; }',
        'function f([name,,...rest],) {}',
        'for (const [a,,...rest] of values) {}',
        'for ({a, ...rest} in values) {}',
        '[a /* before */, /* hole */ , ...rest /* end */] = values;',
        '({a, ...rest /* end */} = values);',
        'function f(a /* before */, ...rest /* end */) {}',
        'const array = [...rest, next,];',
        'const object = {...rest, next,};',
        'f(...rest, next,);',
        '[a,] = values;',
        '({a,} = values);',
        'function f(a,) {}',
        'function f(...[first = 1,,...rest]) {}',
        'function f(...{first = 1, ...rest}) {}',
      ]) {
        const tree = parser.parse(`${statement}\n${Following}`)!;
        try {
          expect(tree.rootNode.hasError, statement).toBe(false);
          expect(tree.rootNode.lastNamedChild!.text, statement).toBe(Following);
        } finally {
          tree.delete();
        }
      }
      for (const [source, expected] of [
        [
          '[a,,...b] = value;',
          [
            ['element', 'a', 1, 2],
            ['element', '...b', 4, 8],
          ],
        ],
        [
          '[(a), ...((b))] = value;',
          [
            ['element', '(a)', 1, 4],
            ['expression', 'a', 2, 3],
            ['primary', 'a', 2, 3],
            ['element', '...((b))', 6, 14],
            ['expression', '(b)', 10, 13],
            ['primary', '(b)', 10, 13],
            ['expression', 'b', 11, 12],
            ['primary', 'b', 11, 12],
          ],
        ],
        ['function f(a = 1, ...b) {}', [['parameter', '...b', 18, 22]]],
        [
          '({a = 1, ...b} = value);',
          [
            ['expression', '{a = 1, ...b} = value', 1, 22],
            ['rest', '...b', 9, 13],
          ],
        ],
        [
          'let [a,,...[b,...c]] = value;',
          [
            ['element', 'a', 5, 6],
            ['element', '...[b,...c]', 8, 19],
            ['element', 'b', 12, 13],
            ['element', '...c', 14, 18],
          ],
        ],
      ] as const) {
        const tree = parser.parse(source)!;
        try {
          expect(tree.rootNode.hasError, source).toBe(false);
          expect(
            query.captures(tree.rootNode).map(({ name, node }) => [name, node.text, node.startIndex, node.endIndex]),
            source
          ).toEqual(expected);
        } finally {
          tree.delete();
        }
      }
    } finally {
      query.delete();
      parser.delete();
    }
  });

  test(`requires rest elements to end their lists between declarations in ${goal}`, async () => {
    await Parser.init();
    const parser = new Parser().setLanguage(await Language.load(`tree-sitter-${goal}.wasm`));
    try {
      for (const statement of [
        'const [a,,...rest] = values;',
        'const {a, ...rest} = values;',
        'function f(a = 1, ...rest) {}',
        'const f = ([a, ...rest]) => {};',
        'for ([...[a, ...rest]] of values) {}',
      ]) {
        const initial = `const before = 0;\n${statement}\n${Following}`;
        const offset = initial.indexOf('...rest') + '...rest'.length;
        expectStatements(parser, [
          [initial, false],
          [initial.slice(0, offset) + ',' + initial.slice(offset), true],
          [initial.slice(0, offset) + ', next' + initial.slice(offset), true],
          [initial.slice(0, offset) + ' /* end */' + initial.slice(offset), false],
        ]);
      }
    } finally {
      parser.delete();
    }
  });
}

function expectStatements(parser: Parser, sources: readonly (readonly [string, boolean])[]): void {
  for (const [source, hasError] of sources) {
    const tree = parser.parse(source)!;
    try {
      expect(tree.rootNode.hasError, source).toBe(hasError);
      expect(tree.rootNode.lastNamedChild!.text, source).toBe(Following);
      expect(tree.rootNode.lastNamedChild!.hasError, source).toBe(false);
    } finally {
      tree.delete();
    }
  }
}
