import path from 'node:path';

import { Edit, Language, Parser, Query } from '@willbooster/web-tree-sitter';
import { expect, test } from 'vitest';

await Parser.init();
const language = await Language.load(path.join(import.meta.dirname, '../../tree-sitter-javascript.wasm'));

const querySource = `
  (export_statement declaration: (declaration) @declaration)
  (declaration/class_declaration decorator: (decorator) @decorator)
`;

test('keeps decorators on exported classes with canonical declaration queries', () => {
  const parser = new Parser().setLanguage(language);
  const query = new Query(language, querySource);
  try {
    for (const decorators of ['@dec', '@one() @two.member', '@factory(() => class {})']) {
      for (const source of [
        `${decorators} export class Named extends Base {}`,
        `${decorators} export default class Named {}`,
        `${decorators} export default class {}`,
        `export ${decorators} class Named {}`,
        `export default ${decorators} class {}`,
        `${decorators}\n/* before export */ export\n/* before default */ default\nclass {}`,
      ]) {
        const tree = parser.parse(`${source}\n(next);`)!;
        try {
          expect(tree.rootNode.hasError, source).toBe(false);
          const exported = tree.rootNode.firstNamedChild!;
          const declaration = exported.childForFieldName('declaration')!;
          const captures = query.captures(tree.rootNode);
          expect(exported.type).toBe('export_statement');
          expect(declaration.type).toBe('class_declaration');
          expect(captures.filter(({ name }) => name === 'declaration').map(({ node }) => node.id)).toEqual([
            declaration.id,
          ]);
          const decorated = declaration.childrenForFieldName('decorator');
          expect(decorated.map((node) => node.text).join(' ')).toBe(decorators);
          expect(captures.filter(({ name }) => name === 'decorator').map(({ node }) => node.id)).toEqual(
            decorated.map((node) => node.id)
          );
          expect(exported.childrenForFieldName('decorator')).toEqual([]);
          expect(declaration.startIndex).toBe(source.indexOf('@'));
          expect(declaration.endIndex).toBe(source.length);
          expect(tree.rootNode.lastNamedChild?.text).toBe('(next);');
          expect(tree.rootNode.lastNamedChild?.type).toBe('expression_statement');
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

test('preserves decorator ownership when incrementally adding and removing exports', () => {
  const parser = new Parser().setLanguage(language);
  const query = new Query(language, querySource);
  const prefix = '@dec ';
  const ordinary = `${prefix}class Named {}`;
  try {
    for (const exported of ['export ', 'export default ']) {
      let tree = parser.parse(ordinary)!;
      try {
        for (const inserted of [true, false, true]) {
          tree.edit(
            new Edit({
              startIndex: prefix.length,
              oldEndIndex: prefix.length + (inserted ? 0 : exported.length),
              newEndIndex: prefix.length + (inserted ? exported.length : 0),
              startPosition: { row: 0, column: prefix.length },
              oldEndPosition: { row: 0, column: prefix.length + (inserted ? 0 : exported.length) },
              newEndPosition: { row: 0, column: prefix.length + (inserted ? exported.length : 0) },
            })
          );
          const source = prefix + (inserted ? exported : '') + 'class Named {}';
          const previous = tree;
          tree = parser.parse(source, previous)!;
          previous.delete();
          const fresh = parser.parse(source)!;
          try {
            expect(tree.rootNode.hasError, source).toBe(false);
            expect(tree.rootNode.toString()).toBe(fresh.rootNode.toString());
            expect(query.captures(tree.rootNode).map(({ name, node }) => [name, node.text])).toEqual(
              query.captures(fresh.rootNode).map(({ name, node }) => [name, node.text])
            );
            expect(tree.rootNode.descendantsOfType('decorator')[0]?.parent?.type).toBe('class_declaration');
          } finally {
            fresh.delete();
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
});

test('rejects decorators across both sides of export or on other exported declarations', () => {
  const parser = new Parser().setLanguage(language);
  try {
    for (const source of [
      '@before export @after class Named {}',
      '@before export default @after class {}',
      '@dec export function named() {}',
      '@dec export const value = 1;',
      '@dec export default value;',
      '@dec export class {}',
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
