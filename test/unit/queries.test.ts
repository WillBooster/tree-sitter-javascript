import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { expect, test } from 'vitest';

import { Edit, Language, Parser, Query } from '@willbooster/web-tree-sitter';

import treeSitterJson from '../../tree-sitter.json';

const Root = path.join(import.meta.dirname, '../..');
const QueryKinds = ['highlights', 'injections', 'locals', 'tags'] as const;
const queryPaths = (kind: (typeof QueryKinds)[number]): string[] =>
  treeSitterJson.grammars.flatMap((grammar) => grammar[kind]);
await Parser.init();

// Tools that read tree-sitter.json use only the queries it lists, so a query file it misses goes unused.
test('lists every query file in tree-sitter.json', () => {
  const listed = QueryKinds.flatMap((kind) => queryPaths(kind)).toSorted();
  const files = fs
    .readdirSync(path.join(Root, 'queries'))
    .map((file) => `queries/${file}`)
    .toSorted();
  expect(listed).toEqual(files);
});

// Tools that read tree-sitter.json, such as the tree-sitter CLI, compile each kind of query from its files
// concatenated, so a node type that a grammar change removes must fail here rather than in them. performance.test.ts
// checks that the Wasm build is current.
test('compiles the queries that tree-sitter.json references', async () => {
  const language = await Language.load(path.join(Root, 'tree-sitter-javascript.wasm'));
  for (const kind of QueryKinds) {
    const source = queryPaths(kind)
      .map((file) => fs.readFileSync(path.join(Root, file), 'utf8'))
      .join('\n');
    expect(() => new Query(language, source), `${kind} queries`).not.toThrow();
  }
});

// On a fresh runner, cargo first installs the toolchain that rust-toolchain.toml pins. The commands run synchronously,
// so only their own timeout can stop them; the test's is longer so that theirs is reported.
const execOptions = { cwd: Root, encoding: 'utf8', timeout: 240_000 } as const;
const listPublishedFiles = {
  npm: (): string[] => {
    const [pack] = JSON.parse(
      execFileSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], execOptions)
    ) as [{ files: { path: string }[] }];
    return pack.files.map((file) => file.path);
  },
  crate: (): string[] => execFileSync('cargo', ['package', '--list', '--allow-dirty'], execOptions).split('\n'),
};
for (const [packageKind, listFiles] of Object.entries(listPublishedFiles)) {
  test(
    `publishes every query file that tree-sitter.json references in the ${packageKind} package`,
    { timeout: 300_000 },
    () => {
      const published = new Set(listFiles());
      expect(published).toContain('tree-sitter.json');
      for (const kind of QueryKinds) {
        for (const file of queryPaths(kind)) {
          expect(published, file).toContain(file);
        }
      }
    }
  );
}

// Identical printed trees can lose supertype membership when a filtered hidden rule replaces the public expression
// rules. Check captures through the shipped parser, including the contextual yield-identifier operand paths.
test('captures canonical expression supertypes in await operands and callees', async () => {
  const language = await Language.load(path.join(Root, 'tree-sitter-javascript.wasm'));
  const parser = new Parser();
  parser.setLanguage(language);
  const tree = parser.parse(`async function f() {
    await g(x);
    await yield(x);
    await yield.foo;
    await yield[index];
    await yield\`tag\`;
    await yield;
    await
    yield in values;
    await /* comment */ yield.foo;
    await
    /* comment */
    yield.foo;
    const h = async () => await g(x);
  }`)!;
  const operands = new Query(language, '(await_expression (expression) @operand)');
  const primaryOperands = new Query(language, '(await_expression (primary_expression) @operand)');
  const callees = new Query(language, '(call_expression function: (expression) @callee)');
  const primaryCallees = new Query(language, '(call_expression function: (primary_expression) @callee)');
  try {
    expect(tree.rootNode.hasError).toBe(false);
    expect(tree.rootNode.descendantsOfType('comment')).toHaveLength(2);
    const awaitNodes = tree.rootNode.descendantsOfType('await_expression');
    expect(awaitNodes.map((node) => node.namedChildren.find((child) => child.type !== 'comment')!.type)).toEqual([
      'call_expression',
      'call_expression',
      'member_expression',
      'subscript_expression',
      'call_expression',
      'identifier',
      'identifier',
      'member_expression',
      'member_expression',
      'call_expression',
    ]);
    expect(tree.rootNode.descendantsOfType('yield_expression')).toHaveLength(0);
    for (const query of [operands, primaryOperands]) {
      const captured = new Set(query.captures(tree.rootNode).map(({ node }) => node.id));
      for (const awaitNode of tree.rootNode.descendantsOfType('await_expression')) {
        const operand = awaitNode.namedChildren.find((node) => node.type !== 'comment')!;
        expect(captured, operand.text).toContain(operand.id);
      }
    }
    expect(callees.captures(tree.rootNode).map(({ node }) => node.text)).toEqual(['g', 'yield', 'g']);
    const capturedCallees = new Set(primaryCallees.captures(tree.rootNode).map(({ node }) => node.id));
    for (const call of tree.rootNode.descendantsOfType('call_expression')) {
      const callee = call.childForFieldName('function')!;
      expect(capturedCallees, callee.text).toContain(callee.id);
    }
  } finally {
    operands.delete();
    primaryOperands.delete();
    callees.delete();
    primaryCallees.delete();
    tree.delete();
    parser.delete();
  }
});

test('preserves comments and expression captures in ternary arrow bodies', async () => {
  const language = await Language.load(path.join(Root, 'tree-sitter-javascript.wasm'));
  const parser = new Parser();
  parser.setLanguage(language);
  const query = new Query(language, '(arrow_function body: (expression) @body)');
  try {
    for (const comment of ['/* comment */', '/*\ncomment */', '// comment\n']) {
      const source = `const f = x => a ${comment} ? b : c;`;
      const tree = parser.parse(source)!;
      try {
        expect(tree.rootNode.hasError, source).toBe(false);
        expect(tree.rootNode.descendantsOfType('comment').map((node) => node.text)).toEqual([comment.trim()]);
        const body = tree.rootNode.descendantsOfType('arrow_function')[0]!.childForFieldName('body')!;
        expect(body.type).toBe('ternary_expression');
        expect(body.text).toBe(`a ${comment} ? b : c`);
        expect(query.captures(tree.rootNode).map(({ node }) => node.id)).toContain(body.id);
      } finally {
        tree.delete();
      }
    }
  } finally {
    query.delete();
    parser.delete();
  }
});

test('retains canonical callees in recovered legacy call assignments', async () => {
  const language = await Language.load(path.join(Root, 'tree-sitter-javascript.wasm'));
  const parser = new Parser();
  parser.setLanguage(language);
  const queries = [
    new Query(language, '(call_expression function: (expression) @callee)'),
    new Query(language, '(call_expression function: (primary_expression) @callee)'),
  ];
  try {
    for (const [source, expectedCallees] of [
      ['foo().bar() = 1;', ['foo().bar', 'foo']],
      ['foo().bar() += 1;', ['foo().bar', 'foo']],
      ['new (foo?.bar)()() = 1;', ['new (foo?.bar)()']],
    ] as const) {
      const tree = parser.parse(source)!;
      try {
        const calls = tree.rootNode.descendantsOfType('call_expression');
        expect(
          calls.map((call) => call.childForFieldName('function')!.text),
          source
        ).toEqual(expectedCallees);
        for (const query of queries) {
          const captured = new Set(query.captures(tree.rootNode).map(({ node }) => node.id));
          for (const call of calls) {
            const callee = call.childForFieldName('function')!;
            expect(captured, `${source}: ${callee.text}`).toContain(callee.id);
          }
        }
      } finally {
        tree.delete();
      }
    }
  } finally {
    for (const query of queries) query.delete();
    parser.delete();
  }
});

test('preserves consuming await keyword ranges across operand lookahead', async () => {
  const language = await Language.load(path.join(Root, 'tree-sitter-javascript.wasm'));
  const parser = new Parser();
  parser.setLanguage(language);
  const query = new Query(language, '"await" @keyword');
  try {
    const sources = [
      ['async function f(){return /*before*/ await /*\n*/ let.foo;}', 1],
      ['async function f(){await await //after\nlet[0];}', 2],
      ['async function f(){for await(const x of xs){} await using resource=foo();}', 2],
      ['function f(){const await=1;return await;}', 0],
    ] as const;
    for (const [source, count] of sources) {
      const tree = parser.parse(source)!;
      try {
        expect(tree.rootNode.hasError, source).toBe(false);
        const keywords = query.captures(tree.rootNode);
        expect(keywords, source).toHaveLength(count);
        for (const { node } of keywords) {
          expect(node.text, source).toBe('await');
          expect(node.endIndex - node.startIndex, source).toBe(5);
        }
        for (const node of tree.rootNode.descendantsOfType('await_expression')) {
          expect(node.text, source).toMatch(/^await\b/);
        }
        expect(tree.rootNode.descendantsOfType('comment'), source).toHaveLength(
          source.match(/\/\*|\/\//g)?.length ?? 0
        );
      } finally {
        tree.delete();
      }
    }
  } finally {
    query.delete();
    parser.delete();
  }
});

test('parses awaited resource bindings with canonical expression queries', async () => {
  const language = await Language.load(path.join(Root, 'tree-sitter-javascript.wasm'));
  const parser = new Parser();
  parser.setLanguage(language);
  const bindings = new Query(
    language,
    '(using_declaration (variable_declarator name: (identifier) @binding)) (for_in_statement left: (identifier) @binding)'
  );
  const callees = new Query(language, '(call_expression function: (primary_expression) @callee)');
  const keywords = new Query(language, '"await" @keyword');
  try {
    for (const name of [
      'i',
      'install',
      'inside',
      'instanceofX',
      'i漢字',
      String.raw`i\u006Eside`,
      String.raw`\u0069`,
    ]) {
      for (const [body, expectedCallees] of [
        [`await using ${name}=getResource();`, ['getResource']],
        [`for(await using ${name} of items){consume(${name});}`, ['consume']],
        [
          `for(await using ${name}=getResource(); keepGoing();){consume(${name});}`,
          ['getResource', 'keepGoing', 'consume'],
        ],
      ] as const) {
        const source = `async function f(){${body}}`;
        const tree = parser.parse(source)!;
        try {
          expect(tree.rootNode.hasError, source).toBe(false);
          expect(
            bindings.captures(tree.rootNode).map(({ node }) => node.text),
            source
          ).toEqual([name]);
          expect(
            callees.captures(tree.rootNode).map(({ node }) => node.text),
            source
          ).toEqual(expectedCallees);
          expect(
            keywords.captures(tree.rootNode).map(({ node }) => node.text),
            source
          ).toEqual(['await']);
          expect(tree.rootNode.descendantsOfType('await_expression'), source).toHaveLength(0);
        } finally {
          tree.delete();
        }
      }
    }
  } finally {
    bindings.delete();
    callees.delete();
    keywords.delete();
    parser.delete();
  }
});

test('restores awaited resource bindings across identifier and operator edits', async () => {
  const language = await Language.load(path.join(Root, 'tree-sitter-javascript.wasm'));
  const parser = new Parser();
  parser.setLanguage(language);
  let name = 'xs';
  const prefix = 'async function f(){await using ';
  const sourceFor = (binding: string): string => `${prefix}${binding}=getResource();}`;
  let source = sourceFor(name);
  let tree = parser.parse(source)!;
  const bindingStart = source.indexOf(name);
  const original = tree.rootNode.toString();
  try {
    for (const nextName of ['i', 'install', 'in', 'inside', 'instanceof', 'instanceofX', 'xs']) {
      const nextSource = sourceFor(nextName);
      tree.edit(
        new Edit({
          startIndex: bindingStart,
          oldEndIndex: bindingStart + name.length,
          newEndIndex: bindingStart + nextName.length,
          startPosition: { row: 0, column: bindingStart },
          oldEndPosition: { row: 0, column: bindingStart + name.length },
          newEndPosition: { row: 0, column: bindingStart + nextName.length },
        })
      );
      const next = parser.parse(nextSource, tree)!;
      tree.delete();
      tree = next;
      const fresh = parser.parse(nextSource)!;
      try {
        expect(tree.rootNode.toString(), nextSource).toBe(fresh.rootNode.toString());
        expect(tree.rootNode.hasError, nextSource).toBe(['in', 'instanceof'].includes(nextName));
        if (!tree.rootNode.hasError) {
          expect(
            tree.rootNode.descendantsOfType('variable_declarator').map((node) => node.childForFieldName('name')!.text),
            nextSource
          ).toEqual([nextName]);
          expect(tree.rootNode.descendantsOfType('await_expression'), nextSource).toHaveLength(0);
        }
      } finally {
        fresh.delete();
      }
      name = nextName;
      source = nextSource;
    }
    expect(tree.rootNode.toString(), source).toBe(original);
  } finally {
    tree.delete();
    parser.delete();
  }
});

test('retains resource initializer errors while editing ordinary and classic for declarations', async () => {
  const language = await Language.load(path.join(Root, 'tree-sitter-javascript.wasm'));
  const parser = new Parser();
  parser.setLanguage(language);
  try {
    for (const name of ['i', 'install', 'inside', 'instanceofX', 'resource']) {
      for (const declaration of [
        `async function f(){await using ${name};}`,
        `async function f(){for(await using ${name}; keepGoing();){}}`,
        `function f(){using ${name};}`,
        `function f(){for(using ${name}; keepGoing();){}}`,
      ]) {
        let tree = parser.parse(declaration)!;
        expect(tree.rootNode.hasError, declaration).toBe(true);
        const index = declaration.indexOf('using ') + 'using '.length + name.length;
        let previous = declaration;
        try {
          for (const initializer of ['=getResource()', '']) {
            const end = previous.indexOf(';', index);
            const next = previous.slice(0, index) + initializer + previous.slice(end);
            tree.edit(
              new Edit({
                startIndex: index,
                oldEndIndex: end,
                newEndIndex: index + initializer.length,
                startPosition: { row: 0, column: index },
                oldEndPosition: { row: 0, column: end },
                newEndPosition: { row: 0, column: index + initializer.length },
              })
            );
            const incremental = parser.parse(next, tree)!;
            tree.delete();
            tree = incremental;
            const fresh = parser.parse(next)!;
            try {
              expect(incremental.rootNode.toString(), next).toBe(fresh.rootNode.toString());
              expect(incremental.rootNode.hasError, next).toBe(initializer === '');
              if (initializer) {
                expect(
                  incremental.rootNode.descendantsOfType('variable_declarator')[0]?.childForFieldName('value')?.text
                ).toBe('getResource()');
              }
            } finally {
              fresh.delete();
            }
            previous = next;
          }
        } finally {
          tree.delete();
        }
      }
    }
  } finally {
    parser.delete();
  }
});

test('retains resource binding errors across escaped-name edits', async () => {
  const language = await Language.load(path.join(Root, 'tree-sitter-javascript.wasm'));
  const parser = new Parser();
  parser.setLanguage(language);
  const bindings = new Query(
    language,
    '(using_declaration (variable_declarator name: (identifier) @binding)) (for_in_statement left: (identifier) @binding)'
  );
  try {
    for (const kind of ['using', 'await using']) {
      for (const declaration of [
        `${kind} /* comment */ NAME=getResource();`,
        `for(${kind} /* comment */ NAME=getResource(); keepGoing();){}`,
        `for(${kind} /* comment */ NAME of items){}`,
        `${kind} first=getResource(),\nNAME=getResource();`,
      ]) {
        let name = String.raw`i\u006eside`;
        const sourceFor = (binding: string): string => `async function f(){${declaration.replace('NAME', binding)}}`;
        let source = sourceFor(name);
        let tree = parser.parse(source)!;
        const start = source.indexOf(name);
        try {
          expect(tree.rootNode.hasError, source).toBe(false);
          const original = tree.rootNode.toString();
          for (const nextName of [
            String.raw`i\u006e`,
            String.raw`i\u006estanceof`,
            String.raw`\u0069n`,
            String.raw`i\u{6e}`,
            name,
          ]) {
            const nextSource = sourceFor(nextName);
            const startRow = source.slice(0, start).split('\n').length - 1;
            const startColumn = start - source.lastIndexOf('\n', start - 1) - 1;
            tree.edit(
              new Edit({
                startIndex: start,
                oldEndIndex: start + name.length,
                newEndIndex: start + nextName.length,
                startPosition: { row: startRow, column: startColumn },
                oldEndPosition: { row: startRow, column: startColumn + name.length },
                newEndPosition: { row: startRow, column: startColumn + nextName.length },
              })
            );
            const next = parser.parse(nextSource, tree)!;
            tree.delete();
            tree = next;
            const fresh = parser.parse(nextSource)!;
            try {
              expect(next.rootNode.toString(), nextSource).toBe(fresh.rootNode.toString());
              expect(next.rootNode.hasError, nextSource).toBe(nextName !== String.raw`i\u006eside`);
              if (!next.rootNode.hasError) {
                expect(
                  bindings.captures(next.rootNode).map(({ node }) => node.text),
                  nextSource
                ).toEqual(declaration.includes('first=') ? ['first', nextName] : [nextName]);
              }
            } finally {
              fresh.delete();
            }
            source = nextSource;
            name = nextName;
          }
          expect(tree.rootNode.toString(), source).toBe(original);
        } finally {
          tree.delete();
        }
      }
    }
  } finally {
    bindings.delete();
    parser.delete();
  }
});

test('retains resource for-of fields while rejecting for-in edits', async () => {
  const language = await Language.load(path.join(Root, 'tree-sitter-javascript.wasm'));
  const parser = new Parser();
  parser.setLanguage(language);
  try {
    for (const kind of ['using', 'await using']) {
      for (const name of [
        'i',
        'inside',
        'i漢字',
        String.raw`i\u006eside`,
        'xs',
        ...(kind === 'await using' ? ['of'] : []),
      ]) {
        let source = `async function f(){for(${kind} ${name} of items){consume(${name});}}`;
        let tree = parser.parse(source)!;
        const start = source.indexOf(' of ') + 1;
        const original = tree.rootNode.toString();
        try {
          for (const operator of ['of', 'in', 'of']) {
            const nextSource = source.slice(0, start) + operator + source.slice(start + 2);
            tree.edit(
              new Edit({
                startIndex: start,
                oldEndIndex: start + 2,
                newEndIndex: start + 2,
                startPosition: { row: 0, column: start },
                oldEndPosition: { row: 0, column: start + 2 },
                newEndPosition: { row: 0, column: start + 2 },
              })
            );
            const next = parser.parse(nextSource, tree)!;
            tree.delete();
            tree = next;
            const fresh = parser.parse(nextSource)!;
            try {
              expect(next.rootNode.toString(), nextSource).toBe(fresh.rootNode.toString());
              expect(next.rootNode.hasError, nextSource).toBe(operator === 'in');
              if (operator === 'of') {
                const loop = next.rootNode.descendantsOfType('for_in_statement')[0]!;
                expect(loop.childForFieldName('left')?.text, nextSource).toBe(name);
                expect(
                  loop.childrenForFieldName('kind').map((node) => node.text),
                  nextSource
                ).toEqual(kind.split(' '));
                expect(loop.childForFieldName('operator')?.text, nextSource).toBe('of');
                expect(loop.childForFieldName('right')?.text, nextSource).toBe('items');
                expect(loop.childForFieldName('body')?.text, nextSource).toBe(`{consume(${name});}`);
              }
            } finally {
              fresh.delete();
            }
            source = nextSource;
          }
          expect(tree.rootNode.toString(), source).toBe(original);
        } finally {
          tree.delete();
        }
      }
    }
    for (const source of [
      'async function f(){for(using of of items){}}',
      String.raw`async function f(){for(using \u006ff of items){}}`,
    ]) {
      const tree = parser.parse(source)!;
      try {
        expect(tree.rootNode.hasError, source).toBe(true);
      } finally {
        tree.delete();
      }
    }
  } finally {
    parser.delete();
  }
});

test('preserves ordinary using statement boundaries and expression captures', async () => {
  const language = await Language.load(path.join(Root, 'tree-sitter-javascript.wasm'));
  const parser = new Parser();
  parser.setLanguage(language);
  const query = new Query(language, '(expression_statement (expression) @value)');
  const source = `function f() {
    using ? a : b;
    using /*
    ternary */ ? a : b;
    using
    (a);
    using
    [a] = 1;
    using /*
    comment */ + 1;
    using
    instanceof X;
    using
    in x;
    using
    \`t\`;
    { using }
  }`;
  const tree = parser.parse(source)!;
  try {
    expect(tree.rootNode.hasError).toBe(false);
    expect(query.captures(tree.rootNode).map(({ node }) => node.type)).toEqual([
      'ternary_expression',
      'ternary_expression',
      'call_expression',
      'assignment_expression',
      'binary_expression',
      'binary_expression',
      'binary_expression',
      'call_expression',
      'identifier',
    ]);
    expect(tree.rootNode.descendantsOfType('comment')).toHaveLength(2);
    expect(tree.rootNode.descendantsOfType('statement_block')).toHaveLength(2);
    for (const input of ['using', 'function f(){using}', 'function f(){{using}}']) {
      const bare = parser.parse(input)!;
      try {
        expect(bare.rootNode.hasError).toBe(false);
        expect(query.captures(bare.rootNode).map(({ node }) => [node.type, node.text])).toEqual([
          ['identifier', 'using'],
        ]);
      } finally {
        bare.delete();
      }
    }
  } finally {
    tree.delete();
    query.delete();
    parser.delete();
  }
});
