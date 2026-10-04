import path from 'node:path';

import { expect, test } from 'vitest';
import { Edit, Language, Parser, Query, type Node } from '@willbooster/web-tree-sitter';

await Parser.init();
const language = await Language.load(path.join(import.meta.dirname, '../../tree-sitter-javascript.wasm'));

test('preserves statement boundaries before regex literals adjacent to newline-bearing comments', () => {
  const parser = new Parser();
  parser.setLanguage(language);
  const query = new Query(language, '(expression_statement (call_expression) @regex.statement)');
  try {
    for (const newline of ['\n', '\r', '\r\n', '\u2028', '\u2029']) {
      for (const trailing of ['', '/* second */', '// second\n']) {
        const comment = `/*${newline}comment*/${trailing}`;
        for (const source of [`let a${comment}/b/.test(x);`, `function f(){return${comment}/b/.test(x);}`]) {
          const tree = parser.parse(source)!;
          try {
            expect(tree.rootNode.hasError, source).toBe(false);
            expect(
              query.captures(tree.rootNode).map(({ node }) => node.text),
              source
            ).toEqual(['/b/.test(x)']);
            const returned = tree.rootNode.descendantsOfType('return_statement')[0];
            if (returned) {
              expect(
                returned.namedChildren.filter((node) => node.type !== 'comment'),
                source
              ).toEqual([]);
            } else {
              expect(tree.rootNode.namedChildren[0]?.type).toBe('lexical_declaration');
            }
          } finally {
            tree.delete();
          }
        }
      }
    }
    const tree = parser.parse('function f(){return/* same line *//b/.test(x);}')!;
    try {
      expect(tree.rootNode.hasError).toBe(false);
      expect(tree.rootNode.descendantsOfType('return_statement')[0]?.namedChildren.at(-1)?.text).toBe('/b/.test(x)');
      expect(query.captures(tree.rootNode)).toEqual([]);
    } finally {
      tree.delete();
    }
  } finally {
    query.delete();
    parser.delete();
  }
});

test('updates return and regex roles when comment newlines are inserted and removed', () => {
  const parser = new Parser();
  parser.setLanguage(language);
  const prefix = 'function f(){return';
  const suffix = '/b/.test(x);}';
  let comment = '/* same line */';
  let source = prefix + comment + suffix;
  let tree = parser.parse(source)!;
  try {
    for (const replacement of ['/*\ncomment*/', '/*\ncomment*//* second */', '/* unfinished', '/* same line */']) {
      const next = prefix + replacement + suffix;
      tree.edit(
        new Edit({
          startIndex: prefix.length,
          oldEndIndex: prefix.length + comment.length,
          newEndIndex: prefix.length + replacement.length,
          startPosition: position(source, prefix.length),
          oldEndPosition: position(source, prefix.length + comment.length),
          newEndPosition: position(next, prefix.length + replacement.length),
        })
      );
      const incremental = parser.parse(next, tree)!;
      const fresh = parser.parse(next)!;
      try {
        expect(snapshot(incremental.rootNode), next).toEqual(snapshot(fresh.rootNode));
      } finally {
        fresh.delete();
        tree.delete();
      }
      tree = incremental;
      source = next;
      comment = replacement;
    }
  } finally {
    tree.delete();
    parser.delete();
  }
});

function position(source: string, index: number): { row: number; column: number } {
  const preceding = source.slice(0, index);
  return { row: preceding.split('\n').length - 1, column: index - preceding.lastIndexOf('\n') - 1 };
}

function snapshot(node: Node): unknown {
  return {
    tree: node.toString(),
    start: node.startIndex,
    end: node.endIndex,
    missing: node.isMissing,
    children: node.children.map(snapshot),
  };
}
