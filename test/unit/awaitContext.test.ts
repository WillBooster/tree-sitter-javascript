import path from 'node:path';

import { Language, Parser } from '@willbooster/web-tree-sitter';
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

test('distinguishes await identifiers from operators in function bodies', () => {
  const parser = new Parser().setLanguage(language);
  try {
    for (const forms of functionBodies) {
      for (const [async, form] of forms.entries()) {
        const source = form.replace('BODY', 'await\nvalue;');
        const tree = parser.parse(source)!;
        try {
          expect(tree.rootNode.hasError, source).toBe(false);
          expect(tree.rootNode.descendantsOfType('await_expression'), source).toHaveLength(async);
          expect(
            tree.rootNode.descendantsOfType('identifier').filter((node) => node.text === 'await'),
            source
          ).toHaveLength(async ? 0 : 1);
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
  'assigns the function context by the innermost function, including at serialization capacity',
  { timeout: 30_000 },
  () => {
    const parser = new Parser().setLanguage(language);
    try {
      for (const depth of [1, 32, 8160]) {
        const prefix = Array.from(
          { length: depth - 1 },
          (_, index) => `${index % 2 ? 'async ' : ''}function f(){`
        ).join('');
        for (const async of [false, true]) {
          const tree = parser.parse(
            `${prefix}${async ? 'async ' : ''}function f(){await(value);}${'}'.repeat(depth - 1)}`
          )!;
          try {
            expect(tree.rootNode.hasError).toBe(false);
            expect(tree.rootNode.descendantsOfType('await_expression').map(({ text }) => text)).toEqual(
              async ? ['await(value)'] : []
            );
          } finally {
            tree.delete();
          }
        }
      }
    } finally {
      parser.delete();
    }
  }
);

test('reports context overflow and parses incomplete and completed nested functions', () => {
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
    } finally {
      tree.delete();
    }
    const completed = parser.parse(`${source} value;}`)!;
    try {
      expect(completed.rootNode.hasError).toBe(false);
      expect(completed.rootNode.descendantsOfType('await_expression').map(({ text }) => text)).toEqual(['await value']);
    } finally {
      completed.delete();
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
            for (const separator of [newline, `/* boundary */${newline}`]) {
              const source = `${before}${separator}${word}${newline}${continuation}${suffix} const sentinel = 1;`;
              const tree = parser.parse(source)!;
              try {
                expect(tree.rootNode.hasError, source).toBe(false);
                const awaits = tree.rootNode.descendantsOfType('await_expression');
                expect(awaits, source).toHaveLength(hasOperand ? 1 : 0);
                if (hasOperand) {
                  expect(awaits[0]!.text).toBe('await' + separator + word);
                  expect(awaits[0]!.endIndex).toBe(before.length + separator.length + word.length);
                  expect(
                    awaits[0]!.namedChildren.filter((node) => node.type === 'identifier').map((node) => node.text)
                  ).toEqual([word]);
                } else {
                  const names = tree.rootNode.descendantsOfType('identifier').filter((node) => node.text === 'await');
                  expect(names).toHaveLength(1);
                  expect(names[0]!.childCount === 0 && names[0]!.endIndex - names[0]!.startIndex === 5).toBe(true);
                }
                expect(tree.rootNode.lastNamedChild!.text).toBe('const sentinel = 1;');
              } finally {
                tree.delete();
              }
            }
          }
        }
      }
    } finally {
      parser.delete();
    }
  }
);
