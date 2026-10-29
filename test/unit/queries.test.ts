import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { Language, Parser, Query } from '@willbooster/web-tree-sitter';
import { expect, test } from 'vitest';

import treeSitterJson from '../../tree-sitter.json';

const Root = path.join(import.meta.dirname, '../..');
const QueryKinds = ['highlights', 'injections', 'locals', 'tags'] as const;
const queryPaths = (kind: (typeof QueryKinds)[number]): string[] => [
  ...new Set(treeSitterJson.grammars.flatMap((grammar) => grammar[kind])),
];
await Parser.init();

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
for (const grammar of treeSitterJson.grammars) {
  test(`compiles the configured queries against ${grammar.name}`, async () => {
    const language = await Language.load(path.join(Root, `tree-sitter-${grammar.name}.wasm`));
    for (const kind of QueryKinds) {
      const files = [grammar[kind]].flat();
      const source = files.map((file) => fs.readFileSync(path.join(Root, file), 'utf8')).join('\n');
      const query = new Query(language, source);
      query.delete();
    }
  });
}

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
    '(using_declaration (variable_declarator name: (identifier) @binding)) (for_in_clause left: (identifier) @binding)'
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

test('rejects awaited resource bindings named only by operator keywords', async () => {
  const language = await Language.load(path.join(Root, 'tree-sitter-javascript.wasm'));
  const parser = new Parser();
  parser.setLanguage(language);
  try {
    for (const name of ['xs', 'i', 'install', 'in', 'inside', 'instanceof', 'instanceofX']) {
      const source = `async function f(){await using ${name}=getResource();}`;
      const tree = parser.parse(source)!;
      try {
        expect(tree.rootNode.hasError, source).toBe(['in', 'instanceof'].includes(name));
        if (!tree.rootNode.hasError) {
          expect(
            tree.rootNode.descendantsOfType('variable_declarator').map((node) => node.childForFieldName('name')!.text),
            source
          ).toEqual([name]);
          expect(tree.rootNode.descendantsOfType('await_expression'), source).toHaveLength(0);
        }
      } finally {
        tree.delete();
      }
    }
  } finally {
    parser.delete();
  }
});

test('requires initializers in ordinary and classic for resource declarations', async () => {
  const language = await Language.load(path.join(Root, 'tree-sitter-javascript.wasm'));
  const parser = new Parser();
  parser.setLanguage(language);
  try {
    for (const name of ['i', 'install', 'inside', 'instanceofX', 'resource']) {
      for (const initializer of ['', '=getResource()']) {
        for (const declaration of [
          `async function f(){await using ${name}${initializer};}`,
          `async function f(){for(await using ${name}${initializer}; keepGoing();){}}`,
          `function f(){using ${name}${initializer};}`,
          `function f(){for(using ${name}${initializer}; keepGoing();){}}`,
        ]) {
          const tree = parser.parse(declaration)!;
          try {
            expect(tree.rootNode.hasError, declaration).toBe(initializer === '');
            if (initializer) {
              expect(
                tree.rootNode.descendantsOfType('variable_declarator')[0]?.childForFieldName('value')?.text,
                declaration
              ).toBe('getResource()');
            }
          } finally {
            tree.delete();
          }
        }
      }
    }
  } finally {
    parser.delete();
  }
});

test('rejects resource bindings whose escaped names spell reserved words', async () => {
  const language = await Language.load(path.join(Root, 'tree-sitter-javascript.wasm'));
  const parser = new Parser();
  parser.setLanguage(language);
  const bindings = new Query(
    language,
    '(using_declaration (variable_declarator name: (identifier) @binding)) (for_in_clause left: (identifier) @binding)'
  );
  try {
    for (const kind of ['using', 'await using']) {
      for (const declaration of [
        `${kind} /* comment */ NAME=getResource();`,
        `for(${kind} /* comment */ NAME=getResource(); keepGoing();){}`,
        `for(${kind} /* comment */ NAME of items){}`,
        `${kind} first=getResource(),\nNAME=getResource();`,
      ]) {
        for (const name of [
          String.raw`i\u006eside`,
          String.raw`i\u006e`,
          String.raw`i\u006estanceof`,
          String.raw`\u0069n`,
          String.raw`i\u{6e}`,
          'enum',
          String.raw`\u0065num`,
          String.raw`\u{65}num`,
        ]) {
          const source = `async function f(){${declaration.replace('NAME', name)}}`;
          const tree = parser.parse(source)!;
          try {
            expect(tree.rootNode.hasError, source).toBe(name !== String.raw`i\u006eside`);
            if (!tree.rootNode.hasError) {
              expect(
                bindings.captures(tree.rootNode).map(({ node }) => node.text),
                source
              ).toEqual(declaration.includes('first=') ? ['first', name] : [name]);
            }
          } finally {
            tree.delete();
          }
        }
      }
    }
  } finally {
    bindings.delete();
    parser.delete();
  }
});

test('retains resource for-of fields while rejecting for-in', async () => {
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
        for (const operator of ['of', 'in']) {
          const source = `async function f(){for(${kind} ${name} ${operator} items){consume(${name});}}`;
          const tree = parser.parse(source)!;
          try {
            expect(tree.rootNode.hasError, source).toBe(operator === 'in');
            if (operator === 'of') {
              const loop = tree.rootNode.descendantsOfType('for_in_statement')[0]!;
              const header = loop.childForFieldName('header')!;
              expect(header.childForFieldName('left')?.text, source).toBe(name);
              expect(
                header.childrenForFieldName('kind').map((node) => node.text),
                source
              ).toEqual(kind.split(' '));
              expect(header.childForFieldName('operator')?.text, source).toBe('of');
              expect(header.childForFieldName('right')?.text, source).toBe('items');
              expect(loop.childForFieldName('body')?.text, source).toBe(`{consume(${name});}`);
            }
          } finally {
            tree.delete();
          }
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
    using // statement comment
    next;
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
      'identifier',
      'identifier',
    ]);
    expect(tree.rootNode.descendantsOfType('comment').map((node) => node.parent?.type)).toEqual([
      'ternary_expression',
      'binary_expression',
      'expression_statement',
    ]);
    expect(tree.rootNode.descendantsOfType('statement_block')).toHaveLength(2);
    for (const input of ['using', 'function f(){using}', 'function f(){{using}}', 'using // end', 'using /* end */']) {
      const bare = parser.parse(input)!;
      try {
        expect(bare.rootNode.hasError).toBe(false);
        expect(query.captures(bare.rootNode).map(({ node }) => [node.type, node.text])).toEqual([
          ['identifier', 'using'],
        ]);
        for (const comment of bare.rootNode.descendantsOfType('comment')) {
          expect(comment.parent?.type).toBe('expression_statement');
          expect(comment.parent?.startIndex).toBe(input.indexOf('using'));
          expect(comment.parent?.endIndex).toBe(comment.endIndex);
        }
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
