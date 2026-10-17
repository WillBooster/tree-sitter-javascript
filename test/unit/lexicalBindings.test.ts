import path from 'node:path';

import { Language, Parser, Query } from '@willbooster/web-tree-sitter';
import { expect, test } from 'vitest';

await Parser.init();
const language = await Language.load(path.join(import.meta.dirname, '../../tree-sitter-javascript.wasm'));

test('rejects reserved direct lexical bindings in declarations and loop headers', () => {
  const parser = new Parser().setLanguage(language);
  try {
    for (const kind of ['let', 'const']) {
      for (const name of ['let', 'const', 'class', 'if', 'true', 'in']) {
        for (const source of [
          `${kind} ${name} = 1;`,
          `${kind} first = 1, ${name} = 2;`,
          `for (${kind} ${name} = 1; ; ) {}`,
          `for (${kind} ${name} in values) {}`,
          `for (${kind} ${name} of values) {}`,
        ]) {
          const tree = parser.parse(source)!;
          try {
            expect(tree.rootNode.hasError, source).toBe(true);
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

test('preserves contextual identifiers in values, var bindings, and lexical binding queries', () => {
  const parser = new Parser().setLanguage(language);
  const query = new Query(language, '(variable_declarator name: (identifier) @binding)');
  try {
    for (const source of [
      'var let = 1;',
      'let value = let;',
      'const value = let;',
      'let async = 1, using = 2, of = 3;',
      'for (let value = let; value; value--) {}',
      'for (var let in values) {}',
      'for (var let of values) {}',
      'for (let value of let) {}',
      'const {let: value} = source;',
    ]) {
      const tree = parser.parse(source)!;
      try {
        expect(tree.rootNode.hasError, source).toBe(false);
        if (
          source.startsWith('let value') ||
          source.startsWith('const value') ||
          source.startsWith('for (let value =')
        ) {
          expect(query.captures(tree.rootNode).map(({ node }) => node.text)).toEqual(['value']);
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
