import path from 'node:path';

import { Language, Parser, Query } from '@willbooster/web-tree-sitter';
import { expect, test } from 'vitest';

await Parser.init();
const language = await Language.load(path.join(import.meta.dirname, '../../tree-sitter-javascript.wasm'));

test('retains default declaration queries and independent following statements', () => {
  const parser = new Parser();
  parser.setLanguage(language);
  const query = new Query(language, '(export_statement declaration: (declaration) @declaration)');
  try {
    for (const declaration of [
      'function() {}',
      'function named() {}',
      'function*() {}',
      'async function() {}',
      'async /* comment */ function*() {}',
      'class {}',
      '@dec class {}',
      '@factory(() => class {}) class {}',
      'class extends Base {}',
    ]) {
      for (const following of ['(x);', '[x];', '`tag`;']) {
        const tree = parser.parse(`export default /* before */ ${declaration} /* after */\n${following}`)!;
        try {
          expect(tree.rootNode.hasError).toBe(false);
          expect(query.captures(tree.rootNode).map(({ node }) => node.text)).toEqual([declaration]);
          expect(tree.rootNode.lastNamedChild?.text).toBe(following);
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

test('parses declarations with and without a default export prefix', () => {
  const parser = new Parser();
  parser.setLanguage(language);
  try {
    for (const declaration of [
      'function named() {}',
      'function* named() {}',
      'class Named {}',
      'function() {}',
      'function*() {}',
      'class {}',
    ]) {
      for (const prefix of ['', 'export default ']) {
        const tree = parser.parse(`${prefix}${declaration}\n(x);`)!;
        try {
          expect(tree.rootNode.hasError).toBe(false);
        } finally {
          tree.delete();
        }
      }
    }
  } finally {
    parser.delete();
  }
});

test('preserves default keyword ranges and comment extras around declarations', () => {
  const parser = new Parser();
  parser.setLanguage(language);
  const query = new Query(language, '"default" @keyword (export_statement declaration: (declaration) @declaration)');
  try {
    for (const before of ['', '/* before */ ', '<!-- before\n', '--> before\n']) {
      for (const after of ['', '/* after */ ', '<!-- after\n', '--> after\n']) {
        for (const value of ['1;', 'function() {}\n(x);', 'class {}\n[x];']) {
          const source = `export ${before}default ${after}${value}`;
          const tree = parser.parse(source)!;
          try {
            expect(tree.rootNode.hasError, source).toBe(false);
            const captures = query.captures(tree.rootNode);
            expect(
              captures
                .filter(({ name }) => name === 'keyword')
                .map(({ node }) => [node.text, node.startIndex, node.endIndex])
            ).toEqual([['default', source.indexOf('default'), source.indexOf('default') + 7]]);
            expect(captures.filter(({ name }) => name === 'declaration')).toHaveLength(value === '1;' ? 0 : 1);
            expect(tree.rootNode.lastNamedChild?.text).toBe(
              value === '1;' ? source : value.endsWith('(x);') ? '(x);' : '[x];'
            );
          } finally {
            tree.delete();
          }
        }
      }
    }
    const tree = parser.parse('export default <!-- c --> function() {}\n(x);')!;
    try {
      expect(tree.rootNode.hasError).toBe(false);
      expect(tree.rootNode.descendantsOfType('html_comment').map((node) => node.text)).toEqual([
        '<!-- c --> function() {}',
      ]);
      expect(tree.rootNode.descendantsOfType('function_declaration')).toHaveLength(0);
      expect(tree.rootNode.firstNamedChild?.childForFieldName('value')?.type).toBe('parenthesized_expression');
    } finally {
      tree.delete();
    }
  } finally {
    query.delete();
    parser.delete();
  }
});

test('rejects variable and resource declarations as default exports', () => {
  const parser = new Parser().setLanguage(language);
  try {
    for (const declaration of [
      'let value = 42;',
      'const value = 42;',
      'var value = 42;',
      'using value = resource;',
      'await using value = resource;',
    ]) {
      for (const trivia of [' ', ' /* comment */ ', '\n']) {
        const tree = parser.parse(`export default${trivia}${declaration}`)!;
        try {
          expect(tree.rootNode.hasError, declaration).toBe(true);
        } finally {
          tree.delete();
        }
      }
    }
    for (const source of [
      'export let value = 42;',
      'export const value = 42;',
      'export var value = 42;',
      'export default using;',
      'export default using = resource;',
      'export default await resource;',
      'export default async () => 42;',
      'export default (class {});',
    ]) {
      const tree = parser.parse(source)!;
      try {
        expect(tree.rootNode.hasError, source).toBe(false);
        expect(tree.rootNode.namedChildCount).toBe(1);
        expect(tree.rootNode.firstNamedChild?.type).toBe('export_statement');
      } finally {
        tree.delete();
      }
    }
  } finally {
    parser.delete();
  }
});
