import path from 'node:path';

import { Language, Parser } from '@willbooster/web-tree-sitter';
import { expect, test } from 'vitest';

await Parser.init();
const language = await Language.load(path.join(import.meta.dirname, '../../tree-sitter-javascript.wasm'));

test('uses an await identifier in instance-field initializers and restores the surrounding async context', () => {
  const parser = new Parser().setLanguage(language);
  try {
    for (const name of ['field', '[key]', '#field', 'get', 'set', 'static']) {
      for (const wrap of [(body: string) => body, (body: string) => `async function outer(){${body} await outside;}`]) {
        const source = wrap(`class C { ${name} = await\nnext; }`);
        const tree = parser.parse(source)!;
        try {
          expect(tree.rootNode.hasError, source).toBe(false);
          const classBody = tree.rootNode.descendantsOfType('class_body')[0]!;
          const fields = classBody.namedChildren;
          expect(
            fields.map(({ type }) => type),
            source
          ).toEqual(['field_definition', 'field_definition']);
          expect(fields[0]!.childForFieldName('value')?.type, source).toBe('identifier');
          expect(fields[0]!.childForFieldName('value')?.text, source).toBe('await');
          expect(fields[1]!.childForFieldName('property')?.text, source).toBe('next');
          expect(
            tree.rootNode.descendantsOfType('await_expression').map(({ text }) => text),
            source
          ).toEqual(source.startsWith('async') ? ['await outside'] : []);
        } finally {
          tree.delete();
        }
      }
    }
  } finally {
    parser.delete();
  }
});

test('uses the computed-name and nested-function contexts independently of the field initializer', () => {
  const source =
    'async function outer(){ class C { [await key] = async () => await\nvalue; next = await\nlast; } await outside; }';
  const parser = new Parser().setLanguage(language);
  const tree = parser.parse(source)!;
  try {
    expect(tree.rootNode.hasError).toBe(false);
    expect(tree.rootNode.descendantsOfType('await_expression').map(({ text }) => text)).toEqual([
      'await key',
      'await\nvalue',
      'await outside',
    ]);
    const fields = tree.rootNode.descendantsOfType('class_body')[0]!.namedChildren;
    expect(fields).toHaveLength(3);
    expect(fields[0]!.childForFieldName('value')?.type).toBe('arrow_function');
    expect(fields[1]!.childForFieldName('value')?.text).toBe('await');
    expect(fields[2]!.childForFieldName('property')?.text).toBe('last');
  } finally {
    tree.delete();
    parser.delete();
  }
});

test('separates field boundaries and await identifiers by whether an arrow is async', () => {
  const parser = new Parser().setLanguage(language);
  try {
    for (const async of [false, true]) {
      const source = `class C { x = ${async ? 'async ' : ''}() => await\nvalue; }`;
      const tree = parser.parse(source)!;
      try {
        expect(tree.rootNode.hasError, source).toBe(false);
        expect(tree.rootNode.descendantsOfType('await_expression'), source).toHaveLength(async ? 1 : 0);
        expect(tree.rootNode.descendantsOfType('field_definition'), source).toHaveLength(async ? 1 : 2);
        expect(
          tree.rootNode.descendantsOfType('identifier').filter((node) => node.text === 'await'),
          source
        ).toHaveLength(async ? 0 : 1);
      } finally {
        tree.delete();
      }
    }
  } finally {
    parser.delete();
  }
});

test('restores the outer context after an initializer at the serialized context capacity', { timeout: 30_000 }, () => {
  const parser = new Parser().setLanguage(language);
  const nested = '(function(){'.repeat(8159) + 'await\nvalue;' + '})'.repeat(8159);
  const tree = parser.parse(`class C { field = ${nested}; } const after = await outside;`)!;
  try {
    expect(tree.rootNode.hasError).toBe(false);
    expect(tree.rootNode.descendantsOfType('function_expression')).toHaveLength(8159);
    expect(tree.rootNode.descendantsOfType('field_definition')).toHaveLength(1);
    expect(tree.rootNode.namedChildren.at(-1)!.type).toBe('lexical_declaration');
    expect(tree.rootNode.descendantsOfType('await_expression').map(({ text }) => text)).toEqual(['await outside']);
  } finally {
    tree.delete();
    parser.delete();
  }
});
