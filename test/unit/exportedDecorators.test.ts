import path from 'node:path';

import { Language, Parser, Query } from '@willbooster/web-tree-sitter';
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

test('attaches decorators to the class with and without an export', () => {
  const parser = new Parser().setLanguage(language);
  try {
    for (const exported of ['', 'export ', 'export default ']) {
      const source = `@dec ${exported}class Named {}`;
      const tree = parser.parse(source)!;
      try {
        expect(tree.rootNode.hasError, source).toBe(false);
        expect(tree.rootNode.descendantsOfType('decorator')[0]?.parent?.type).toBe('class_declaration');
      } finally {
        tree.delete();
      }
    }
  } finally {
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
