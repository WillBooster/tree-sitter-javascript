import path from 'node:path';

import { Edit, Language, Parser, Query } from '@willbooster/web-tree-sitter';
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

test('reparses field boundaries and public captures when an arrow becomes async and back', () => {
  const parser = new Parser().setLanguage(language);
  const query = new Query(language, '(expression) @expression (primary_expression) @primary');
  let source = 'class C { x = () => await\nvalue; }';
  let tree = parser.parse(source)!;
  const start = source.indexOf('()');
  try {
    for (const async of [true, false, true, false]) {
      const inserted = async ? 'async ' : '';
      const deleted = async ? 0 : 6;
      tree.edit(
        new Edit({
          startIndex: start,
          oldEndIndex: start + deleted,
          newEndIndex: start + inserted.length,
          startPosition: { row: 0, column: start },
          oldEndPosition: { row: 0, column: start + deleted },
          newEndPosition: { row: 0, column: start + inserted.length },
        })
      );
      source = source.slice(0, start) + inserted + source.slice(start + deleted);
      const previous = tree;
      tree = parser.parse(source, previous)!;
      previous.delete();
      const fresh = parser.parse(source)!;
      try {
        expect(tree.rootNode.hasError, source).toBe(false);
        expect(tree.rootNode.toString(), source).toBe(fresh.rootNode.toString());
        expect(tree.rootNode.descendantsOfType('await_expression'), source).toHaveLength(async ? 1 : 0);
        expect(tree.rootNode.descendantsOfType('field_definition'), source).toHaveLength(async ? 1 : 2);
        expect(
          query.captures(tree.rootNode).filter(({ node }) => node.text === 'await'),
          source
        ).toHaveLength(async ? 0 : 2);
      } finally {
        fresh.delete();
      }
    }
  } finally {
    query.delete();
    tree.delete();
    parser.delete();
  }
});

test('restores the outer context after an initializer at the serialized context capacity', { timeout: 30_000 }, () => {
  const parser = new Parser().setLanguage(language);
  const nested = '(function(){'.repeat(8159) + 'await\nvalue;' + '})'.repeat(8159);
  let source = `class C { field = ${nested}; } const after = await outside;`;
  let tree = parser.parse(source)!;
  const start = source.lastIndexOf('outside');
  const column = start - source.lastIndexOf('\n', start) - 1;
  try {
    for (const name of ['changed', 'outside']) {
      tree.edit(
        new Edit({
          startIndex: start,
          oldEndIndex: start + 7,
          newEndIndex: start + 7,
          startPosition: { row: 1, column },
          oldEndPosition: { row: 1, column: column + 7 },
          newEndPosition: { row: 1, column: column + 7 },
        })
      );
      source = source.slice(0, start) + name + source.slice(start + 7);
      const previous = tree;
      tree = parser.parse(source, previous)!;
      previous.delete();
      const fresh = parser.parse(source)!;
      try {
        expect(tree.rootNode.hasError).toBe(false);
        expect(tree.rootNode.toString()).toBe(fresh.rootNode.toString());
        expect(tree.rootNode.descendantsOfType('function_expression')).toHaveLength(8159);
        expect(tree.rootNode.descendantsOfType('field_definition')).toHaveLength(1);
        expect(tree.rootNode.namedChildren.at(-1)!.type).toBe('lexical_declaration');
        expect(tree.rootNode.descendantsOfType('await_expression').map(({ text }) => text)).toEqual([`await ${name}`]);
      } finally {
        fresh.delete();
      }
    }
  } finally {
    tree.delete();
    parser.delete();
  }
});
