import path from 'node:path';
import { Edit, Language, Parser, Query } from '@willbooster/web-tree-sitter';
import { expect, test } from 'vitest';

import { testCommand } from './run.js';

await Parser.init();
const moduleLanguage = await Language.load(path.join(import.meta.dirname, '../../tree-sitter-javascript.wasm'));
const scriptLanguage = await Language.load(path.join(import.meta.dirname, '../../tree-sitter-javascript_script.wasm'));

test('selects Script and Module await roles without changing public expression captures', () => {
  const controls = [
    ['value', 'identifier'],
    ['class C {}', 'class_declaration'],
    ['function f(){}', 'function_declaration'],
    ['!value', 'unary_expression'],
    ['~value', 'unary_expression'],
    ['++value', 'update_expression'],
    ['(value)', 'call_expression'],
    ['[value]', 'subscript_expression'],
  ] as const;
  for (const [language, isScript] of [
    [moduleLanguage, false],
    [scriptLanguage, true],
  ] as const) {
    const parser = new Parser().setLanguage(language);
    const query = new Query(language, '(expression) @expression (primary_expression) @primary');
    try {
      for (const [operand, scriptType] of controls) {
        const source = `await\n${operand}`;
        const tree = parser.parse(source)!;
        try {
          expect(tree.rootNode.hasError, source).toBe(false);
          expect(tree.rootNode.descendantsOfType('await_expression'), source).toHaveLength(isScript ? 0 : 1);
          const continued = operand.startsWith('(') || operand.startsWith('[');
          expect(tree.rootNode.namedChildCount, source).toBe(isScript && !continued ? 2 : 1);
          if (isScript) {
            const identifiers = tree.rootNode.descendantsOfType('identifier').filter(({ text }) => text === 'await');
            expect(identifiers, source).toHaveLength(1);
            expect(
              query
                .captures(tree.rootNode)
                .filter(({ name, node }) => name === 'primary' && node.id === identifiers[0]!.id),
              source
            ).toHaveLength(1);
            const expression = tree.rootNode.namedChildren[0]!.namedChildren[0]!;
            expect(
              query
                .captures(tree.rootNode)
                .filter(({ name, node }) => name === 'expression' && node.id === expression.id),
              source
            ).toHaveLength(1);
            if (scriptType.endsWith('declaration')) {
              expect(tree.rootNode.namedChildren[1]!.type, source).toBe(scriptType);
            } else {
              expect(tree.rootNode.descendantsOfType(scriptType), source).not.toHaveLength(0);
            }
          }
        } finally {
          tree.delete();
        }
      }
    } finally {
      query.delete();
      parser.delete();
    }
  }
});

test('restores the Script goal after nested async bodies and incremental append and undo', () => {
  const parser = new Parser().setLanguage(scriptLanguage);
  const initial = 'await\nfirst; async function outer(){ await operand; function inner(){ await\nsecond; } }';
  let source = initial;
  let tree = parser.parse(source)!;
  const suffix = '\nawait\nlast; async function tail(){ await result; }\nawait(next);';
  try {
    for (const append of [true, false, true, false]) {
      const oldEnd = source.length;
      const next = append ? initial + suffix : initial;

      tree.edit(
        new Edit({
          startIndex: initial.length,
          oldEndIndex: oldEnd,
          newEndIndex: next.length,
          startPosition: point(initial),
          oldEndPosition: point(source),
          newEndPosition: point(next),
        })
      );
      source = next;
      const previous = tree;
      tree = parser.parse(source, previous)!;
      previous.delete();
      const fresh = parser.parse(source)!;
      try {
        expect(tree.rootNode.hasError, source).toBe(false);
        expect(tree.rootNode.toString(), source).toBe(fresh.rootNode.toString());
        expect(tree.rootNode.descendantsOfType('await_expression').map(({ text }) => text)).toEqual(
          append ? ['await operand', 'await result'] : ['await operand']
        );
        expect(tree.rootNode.descendantsOfType('identifier').filter(({ text }) => text === 'await')).toHaveLength(
          append ? 4 : 2
        );
      } finally {
        fresh.delete();
      }
    }
  } finally {
    tree.delete();
    parser.delete();
  }
});

test('keeps the full serialized function nesting capacity in the Script language', () => {
  const parser = new Parser().setLanguage(scriptLanguage);
  const depth = 8160;
  const tree = parser.parse('function f(){'.repeat(depth) + 'await\nvalue;' + '}'.repeat(depth))!;
  try {
    expect(tree.rootNode.hasError).toBe(false);
    expect(tree.rootNode.descendantsOfType('await_expression')).toHaveLength(0);
    expect(tree.rootNode.descendantsOfType('identifier').filter(({ text }) => text === 'await')).toHaveLength(1);
  } finally {
    tree.delete();
    parser.delete();
  }
});

function point(text: string): { row: number; column: number } {
  const lines = text.split('\n');
  return { row: lines.length - 1, column: lines.at(-1)!.length };
}

for (const wasm of [false, true]) {
  testCommand(
    `parses the Script corpus with the ${wasm ? 'Wasm' : 'native'} language`,
    ['script/tree-sitter', 'test', '--grammar-path', 'grammars/script', ...(wasm ? ['--wasm'] : [])],
    300_000,
    {
      check: (output) => {
        expect(output).toContain('Script await identifiers and nested async functions');
        expect(output).toMatch(/Total parses: [1-9]\d*;/);
        expect(output).toContain('failed parses: 0;');
      },
    }
  );
}

test('combines Script identifiers, generator computed names, and nested async initializers', () => {
  const parser = new Parser().setLanguage(scriptLanguage);
  const source = `yield / divisor / g;
function* outer(){
  class C {
    [yield /key/g] = async () => await value;
    field = await
    next;
  }
  yield /outer/g;
}
yield / other / g;`;
  const tree = parser.parse(source)!;
  try {
    expect(tree.rootNode.hasError).toBe(false);
    expect(tree.rootNode.descendantsOfType('yield_expression').map(({ text }) => text)).toEqual([
      'yield /key/g',
      'yield /outer/g',
    ]);
    expect(tree.rootNode.descendantsOfType('identifier').filter(({ text }) => text === 'yield')).toHaveLength(2);
    expect(tree.rootNode.descendantsOfType('binary_expression')).toHaveLength(4);
    expect(tree.rootNode.descendantsOfType('await_expression').map(({ text }) => text)).toEqual(['await value']);
    const fields = tree.rootNode.descendantsOfType('field_definition');
    expect(fields).toHaveLength(3);
    expect(fields[1]!.childForFieldName('value')?.text).toBe('await');
    expect(fields[2]!.childForFieldName('property')?.text).toBe('next');
  } finally {
    tree.delete();
    parser.delete();
  }
});
