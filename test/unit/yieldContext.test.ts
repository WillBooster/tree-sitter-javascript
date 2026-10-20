import path from 'node:path';

import { Edit, Language, Parser, Query } from '@willbooster/web-tree-sitter';
import { expect, test } from 'vitest';

await Parser.init();
const language = await Language.load(path.join(import.meta.dirname, '../../tree-sitter-javascript.wasm'));

test('distinguishes contextual await and yield from regular expressions and division', () => {
  const parser = new Parser().setLanguage(language);
  const source = `async function foo() { await /REGEX/g; yield /DIVISION/g; }
function* bar() { await /DIVISION/g; yield /REGEX/g; }
async function* baz() { await /REGEX/g; yield /REGEX/g; }
function div3(await, yield, g) { return await/yield/g; }`;
  const query = new Query(language, '(expression) @expression (primary_expression) @primary');
  const tree = parser.parse(source)!;
  try {
    expect(tree.rootNode.hasError).toBe(false);
    expect(tree.rootNode.descendantsOfType('regex').map(({ text }) => text)).toEqual(
      Array.from({ length: 4 }, () => '/REGEX/g')
    );
    expect(tree.rootNode.descendantsOfType('binary_expression')).toHaveLength(6);
    expect(tree.rootNode.descendantsOfType('yield_expression').map(({ text }) => text)).toEqual([
      'yield /REGEX/g',
      'yield /REGEX/g',
    ]);
    const identifiers = tree.rootNode.descendantsOfType('identifier').filter(({ text }) => text === 'yield');
    expect(identifiers).toHaveLength(3);
    const captures = query.captures(tree.rootNode);
    for (const identifier of identifiers.filter(({ parent }) => parent?.type !== 'formal_parameters')) {
      expect(
        captures
          .filter(({ node }) => node.id === identifier.id)
          .map(({ name }) => name)
          .toSorted()
      ).toEqual(['expression', 'primary']);
    }
  } finally {
    tree.delete();
    query.delete();
    parser.delete();
  }
});

test('restores generator context after nested functions, arrows and methods', () => {
  const parser = new Parser().setLanguage(language);
  try {
    for (const inner of [
      'function inner(yield){ return yield / divisor / other; }',
      'const inner = function(yield){ return yield / divisor / other; };',
      'const inner = () => yield / divisor / other;',
      'const inner = async () => await yield(value);',
      'const inner = { method(){ return yield / divisor / other; } };',
      'new function(yield){ return yield / divisor / other; };',
    ]) {
      const source = `function* outer(){ ${inner} yield /outer/g; }`;
      const tree = parser.parse(source)!;
      try {
        expect(tree.rootNode.hasError, source).toBe(false);
        expect(
          tree.rootNode.descendantsOfType('yield_expression').map(({ text }) => text),
          source
        ).toEqual(['yield /outer/g']);
      } finally {
        tree.delete();
      }
    }
    for (const source of [
      'function* g(){ yield /value/g; }',
      'async function* g(){ yield /value/g; }',
      'const o = { *g(){ yield /value/g; } };',
      'const o = { async *g(){ yield /value/g; } };',
      'class C { *g(){ yield /value/g; } }',
      'class C { async *g(){ yield /value/g; } }',
    ]) {
      const tree = parser.parse(source)!;
      try {
        expect(tree.rootNode.hasError, source).toBe(false);
        expect(tree.rootNode.descendantsOfType('yield_expression')).toHaveLength(1);
      } finally {
        tree.delete();
      }
    }
  } finally {
    parser.delete();
  }
});

test('keeps yield identifier calls inside await operands across line breaks', () => {
  const parser = new Parser().setLanguage(language);
  try {
    for (const operand of ['yield(x)', 'yield\n(x)', 'yield[0]', 'yield`tag`', 'yield.foo']) {
      const source = `async function f(){ await\n${operand}; }`;
      const tree = parser.parse(source)!;
      try {
        expect(tree.rootNode.hasError, source).toBe(false);
        expect(
          tree.rootNode.descendantsOfType('await_expression').map(({ text }) => text),
          source
        ).toEqual([`await\n${operand}`]);
        expect(tree.rootNode.descendantsOfType('yield_expression'), source).toHaveLength(0);
      } finally {
        tree.delete();
      }
    }
    const source = 'function* f(){ await\nyield(x); }';
    const tree = parser.parse(source)!;
    try {
      expect(tree.rootNode.hasError).toBe(false);
      expect(tree.rootNode.descendantsOfType('await_expression')).toHaveLength(0);
      expect(tree.rootNode.descendantsOfType('yield_expression').map(({ text }) => text)).toEqual(['yield(x)']);
    } finally {
      tree.delete();
    }
  } finally {
    parser.delete();
  }
});

test('reparses yield roles after generator edits across mixed nested contexts', { timeout: 30_000 }, () => {
  const parser = new Parser().setLanguage(language);
  try {
    for (const depth of [1, 32, 4080]) {
      const prefix = Array.from(
        { length: depth - 1 },
        (_, index) => `${index % 2 ? 'async ' : ''}function${index % 3 ? '*' : ''} outer(){`
      ).join('');
      let source = `${prefix}function inner(){yield(value);}${'}'.repeat(depth - 1)}`;
      let tree = parser.parse(source)!;
      const start = prefix.length + 'function'.length;
      try {
        expect(tree.rootNode.hasError).toBe(false);
        expect(tree.rootNode.descendantsOfType('yield_expression')).toHaveLength(0);
        for (const generator of [true, false, true, false]) {
          const previous = source;
          source = previous.slice(0, start) + (generator ? '*' : '') + previous.slice(start + (generator ? 0 : 1));
          tree.edit(
            new Edit({
              startIndex: start,
              oldEndIndex: start + (generator ? 0 : 1),
              newEndIndex: start + (generator ? 1 : 0),
              startPosition: { row: 0, column: start },
              oldEndPosition: { row: 0, column: start + (generator ? 0 : 1) },
              newEndPosition: { row: 0, column: start + (generator ? 1 : 0) },
            })
          );
          const old = tree;
          tree = parser.parse(source, old)!;
          old.delete();
          const fresh = parser.parse(source)!;
          try {
            expect(tree.rootNode.hasError, source).toBe(false);
            expect(tree.rootNode.toString(), source).toBe(fresh.rootNode.toString());
            expect(
              tree.rootNode.descendantsOfType('yield_expression').map(({ text }) => text),
              source
            ).toEqual(generator ? ['yield(value)'] : []);
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
});
