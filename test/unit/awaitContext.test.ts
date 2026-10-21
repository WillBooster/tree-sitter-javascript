import path from 'node:path';
import { Edit, Language, Parser, Query, type Node } from '@willbooster/web-tree-sitter';
import { expect, test } from 'vitest';

await Parser.init();
const language = await Language.load(path.join(import.meta.dirname, '../../tree-sitter-javascript.wasm'));

const functionBodies = [
  ['function f(){ BODY }', 'async function f(){ BODY }'],
  ['const f = function(){ BODY };', 'const f = async function(){ BODY };'],
  ['function* f(){ BODY }', 'async function* f(){ BODY }'],
  ['const f = function*(){ BODY };', 'const f = async function*(){ BODY };'],
  ['const f = () => { BODY };', 'const f = async () => { BODY };'],
  ['const o = { f(){ BODY } };', 'const o = { async f(){ BODY } };'],
  ['class C { f(){ BODY } }', 'class C { async f(){ BODY } }'],
  ['new function(){ BODY };', 'new async function(){ BODY };'],
];

test('distinguishes await identifiers from operators in function bodies and public queries', () => {
  const parser = new Parser().setLanguage(language);
  const query = new Query(language, '(expression) @expression (primary_expression) @primary');
  try {
    for (const forms of functionBodies) {
      for (const [async, form] of forms.entries()) {
        const source = form.replace('BODY', 'await\nvalue;');
        const tree = parser.parse(source)!;
        try {
          expect(tree.rootNode.hasError, source).toBe(false);
          expect(tree.rootNode.descendantsOfType('await_expression'), source).toHaveLength(async);
          const captures = query.captures(tree.rootNode).filter(({ node }) => node.text === 'await');
          expect(captures.map(({ name }) => name).toSorted(), source).toEqual(async ? [] : ['expression', 'primary']);
          const body = tree.rootNode.descendantsOfType('statement_block')[0]!;
          expect(
            body.namedChildren.filter(({ type }) => type === 'expression_statement'),
            source
          ).toHaveLength(async ? 1 : 2);
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

test('keeps of as the operand of await in case values and expression contexts', () => {
  const parser = new Parser().setLanguage(language);
  try {
    for (const source of [
      'switch(value) { case await of >> of: break; }',
      'consume(await of);',
      'flag ? await of : fallback;',
      'async function f(){ switch(value) { case await of >> of: break; } }',
    ]) {
      const tree = parser.parse(source)!;
      try {
        expect(tree.rootNode.hasError, source).toBe(false);
        const awaited = tree.rootNode.descendantsOfType('await_expression')[0]!;
        expect(awaited.text).toBe('await of');
        expect(awaited.namedChild(0)!.type).toBe('identifier');
        expect(awaited.namedChild(0)!.text).toBe('of');
        expect(awaited.namedChild(0)!.childCount).toBe(0);
      } finally {
        tree.delete();
      }
    }
  } finally {
    parser.delete();
  }
});

test('restores outer await context after nested arrows, methods and constructors', () => {
  const parser = new Parser().setLanguage(language);
  try {
    for (const inner of [
      'function inner(){ await(value); }',
      'const f = () => await / divisor / other;',
      'const f = () => () => { await(value); };',
      'const o = { f(){ await(value); } };',
      'new function(){ await(value); };',
      'const f = condition ? () => {}\n : () => await(value);',
      'const o = { f: () => { await(value); }\n }.method();',
    ]) {
      const source = `async function outer(){ ${inner} await\nvalue; }`;
      const tree = parser.parse(source)!;
      try {
        expect(tree.rootNode.hasError, source).toBe(false);
        expect(
          tree.rootNode.descendantsOfType('await_expression').map(({ text }) => text),
          source
        ).toEqual(['await\nvalue']);
      } finally {
        tree.delete();
      }
    }
    for (const source of [
      'const f = async () => await\nvalue + next;',
      'function outer(){ const f = async () => await value; await(next); }',
      'function outer(){ const o = { async f(){ await value; } }; await(next); }',
    ]) {
      const tree = parser.parse(source)!;
      try {
        expect(tree.rootNode.hasError, source).toBe(false);
        expect(tree.rootNode.descendantsOfType('await_expression'), source).toHaveLength(1);
      } finally {
        tree.delete();
      }
    }
  } finally {
    parser.delete();
  }
});

test(
  'reparses function context when async is added and removed, including at serialization capacity',
  { timeout: 30_000 },
  () => {
    const parser = new Parser().setLanguage(language);
    try {
      for (const depth of [1, 32, 8160]) {
        const prefix = Array.from(
          { length: depth - 1 },
          (_, index) => `${index % 2 ? 'async ' : ''}function f(){`
        ).join('');
        let source = `${prefix}function f(){await(value);}${'}'.repeat(depth - 1)}`;
        let tree = parser.parse(source)!;
        try {
          expect(tree.rootNode.hasError).toBe(false);
          expect(tree.rootNode.descendantsOfType('await_expression')).toHaveLength(0);
          for (const async of [true, false, true, false]) {
            const deleted = async ? 0 : 6;
            const inserted = async ? 'async ' : '';
            tree.edit(
              new Edit({
                startIndex: prefix.length,
                oldEndIndex: prefix.length + deleted,
                newEndIndex: prefix.length + inserted.length,
                startPosition: { row: 0, column: prefix.length },
                oldEndPosition: { row: 0, column: prefix.length + deleted },
                newEndPosition: { row: 0, column: prefix.length + inserted.length },
              })
            );
            source = source.slice(0, prefix.length) + inserted + source.slice(prefix.length + deleted);
            const previous = tree;
            tree = parser.parse(source, previous)!;
            previous.delete();
            const fresh = parser.parse(source)!;
            try {
              expect(tree.rootNode.hasError).toBe(false);
              expect(fresh.rootNode.hasError).toBe(false);
              expect(tree.rootNode.descendantsOfType('await_expression').map(({ text }) => text)).toEqual(
                async ? ['await(value)'] : []
              );
              expect(tree.rootNode.descendantsOfType('await_expression').map(({ text }) => text)).toEqual(
                fresh.rootNode.descendantsOfType('await_expression').map(({ text }) => text)
              );
              expect(tree.rootNode.toString()).toBe(fresh.rootNode.toString());
            } finally {
              fresh.delete();
            }
          }
        } finally {
          tree.delete();
        }
      }
    } finally {
      parser.delete();
    }
  }
);

test('reports context overflow and incrementally repairs incomplete nested functions', () => {
  const parser = new Parser().setLanguage(language);
  try {
    const overflow = parser.parse(`${'function f(){'.repeat(8161)}await(value);${'}'.repeat(8161)}`)!;
    try {
      expect(overflow.rootNode.hasError).toBe(true);
    } finally {
      overflow.delete();
    }
    const source = 'async function outer(){ function inner(){await(value);} await';
    const tree = parser.parse(source)!;
    try {
      expect(tree.rootNode.hasError).toBe(true);
      const suffix = ' value;}';
      tree.edit(
        new Edit({
          startIndex: source.length,
          oldEndIndex: source.length,
          newEndIndex: source.length + suffix.length,
          startPosition: { row: 0, column: source.length },
          oldEndPosition: { row: 0, column: source.length },
          newEndPosition: { row: 0, column: source.length + suffix.length },
        })
      );
      const repaired = parser.parse(source + suffix, tree)!;
      const fresh = parser.parse(source + suffix)!;
      try {
        expect(repaired.rootNode.hasError).toBe(false);
        expect(repaired.rootNode.toString()).toBe(fresh.rootNode.toString());
        expect(repaired.rootNode.descendantsOfType('await_expression').map(({ text }) => text)).toEqual([
          'await value',
        ]);
      } finally {
        repaired.delete();
        fresh.delete();
      }
    } finally {
      tree.delete();
    }
  } finally {
    parser.delete();
  }
});

test.each(['javascript', 'javascript_script'])(
  'preserves await operands before contextual-word statement boundaries in %s',
  async (goal) => {
    const selectedLanguage = await Language.load(path.join(import.meta.dirname, `../../tree-sitter-${goal}.wasm`));
    const parser = new Parser().setLanguage(selectedLanguage);
    const query = new Query(
      selectedLanguage,
      '(await_expression (identifier) @operand) (expression) @reference (primary_expression) @primary'
    );
    try {
      for (const newline of ['\n', '\r', '\r\n', '\u2028', '\u2029']) {
        for (const [prefix, suffix, hasOperand] of [
          ['', '', goal === 'javascript'],
          ['function outer(){', '}', false],
          ['function* outer(){', '}', false],
          ['async function outer(){', '}', true],
        ] as const) {
          for (const [word, continuation] of [
            ['using', 'value;'],
            ['async', 'value => value;'],
          ] as const) {
            const before = prefix + 'await';
            const tail = `${word}${newline}${continuation}${suffix} const sentinel = 1;`;
            let separator = newline;
            let source = before + separator + tail;
            let tree = parser.parse(source)!;
            try {
              for (const replacement of [newline, `/* boundary */${newline}`, newline]) {
                const next = before + replacement + tail;
                tree.edit(
                  new Edit({
                    startIndex: before.length,
                    oldEndIndex: before.length + separator.length,
                    newEndIndex: before.length + replacement.length,
                    startPosition: boundaryPoint(source, before.length),
                    oldEndPosition: boundaryPoint(source, before.length + separator.length),
                    newEndPosition: boundaryPoint(next, before.length + replacement.length),
                  })
                );
                const previous = tree;
                tree = parser.parse(next, previous)!;
                previous.delete();
                source = next;
                separator = replacement;
                const fresh = parser.parse(source)!;
                try {
                  expect(tree.rootNode.hasError, source).toBe(false);
                  expect(boundaryMetadata(tree.rootNode), source).toEqual(boundaryMetadata(fresh.rootNode));
                  const awaits = tree.rootNode.descendantsOfType('await_expression');
                  expect(awaits, source).toHaveLength(hasOperand ? 1 : 0);
                  const captures = query.captures(tree.rootNode);
                  if (hasOperand) {
                    expect(awaits[0]!.text).toBe('await' + replacement + word);
                    expect(awaits[0]!.endIndex).toBe(before.length + replacement.length + word.length);
                    expect(captures.filter(({ name }) => name === 'operand').map(({ node }) => node.text)).toEqual([
                      word,
                    ]);
                  } else {
                    const names = captures.filter(({ node }) => node.text === 'await');
                    expect(names.map(({ name }) => name).toSorted()).toEqual(['primary', 'reference']);
                    expect(
                      names.every(({ node }) => node.childCount === 0 && node.endIndex - node.startIndex === 5)
                    ).toBe(true);
                  }
                  expect(tree.rootNode.lastNamedChild!.text).toBe('const sentinel = 1;');
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

function boundaryPoint(source: string, index: number): { row: number; column: number } {
  const preceding = source.slice(0, index).split('\n');
  return { row: preceding.length - 1, column: preceding.at(-1)!.length };
}

function boundaryMetadata(node: Node): unknown {
  return [
    node.type,
    node.isNamed,
    node.isExtra,
    node.isMissing,
    node.hasError,
    node.startIndex,
    node.endIndex,
    node.startPosition,
    node.endPosition,
    node.children.map((child, index) => [node.fieldNameForChild(index), boundaryMetadata(child)]),
  ];
}
