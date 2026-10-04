import path from 'node:path';
import { Edit, Language, Parser, Query } from '@willbooster/web-tree-sitter';
import { expect, test } from 'vitest';

await Parser.init();
const language = await Language.load(path.join(import.meta.dirname, '../../tree-sitter-javascript.wasm'));

test.each(['/*c*/', '//c\n'])('ends regex flags before comment %j', (comment) => {
  const parser = new Parser();
  parser.setLanguage(language);
  const query = new Query(language, '(regex) @regex (regex_flags) @flags');
  try {
    for (const regex of ['/[/]/', '/x/g', '/x/dgimsuy']) {
      const source = `${regex}${comment}instanceof value;`;
      const tree = parser.parse(source)!;
      try {
        expect(tree.rootNode.hasError, source).toBe(false);
        expect(
          tree.rootNode.descendantsOfType('comment').map((node) => node.text),
          source
        ).toEqual([comment.trimEnd()]);
        const node = tree.rootNode.descendantsOfType('regex')[0]!;
        expect(node.text, source).toBe(regex);
        expect(node.childForFieldName('flags')?.text, source).toBe(
          regex.slice(regex.lastIndexOf('/') + 1) || undefined
        );
        expect(
          tree.rootNode.descendantsOfType('binary_expression')[0]?.childForFieldName('operator')?.text,
          source
        ).toBe('instanceof');
        expect(
          query
            .captures(tree.rootNode)
            .filter(({ name }) => name === 'regex')
            .map(({ node }) => [node.text, node.startIndex, node.endIndex]),
          source
        ).toEqual([[regex, 0, regex.length]]);
      } finally {
        tree.delete();
      }
    }
  } finally {
    query.delete();
    parser.delete();
  }
});

test('restores regex boundaries after incremental flag edits', () => {
  const parser = new Parser();
  parser.setLanguage(language);
  let source = '/x/g/*c*/instanceof value;';
  let tree = parser.parse(source)!;
  try {
    for (const flags of ['', 'gi', '', 'g']) {
      const oldFlags = source.slice(3, source.indexOf('/*'));
      tree.edit(
        new Edit({
          startIndex: 3,
          oldEndIndex: 3 + oldFlags.length,
          newEndIndex: 3 + flags.length,
          startPosition: { row: 0, column: 3 },
          oldEndPosition: { row: 0, column: 3 + oldFlags.length },
          newEndPosition: { row: 0, column: 3 + flags.length },
        })
      );
      source = `/x/${flags}/*c*/instanceof value;`;
      const previous = tree;
      tree = parser.parse(source, previous)!;
      previous.delete();
      const fresh = parser.parse(source)!;
      try {
        expect(tree.rootNode.hasError, source).toBe(false);
        expect(tree.rootNode.toString(), source).toBe(fresh.rootNode.toString());
        expect(tree.rootNode.descendantsOfType('regex')[0]?.text, source).toBe(`/x/${flags}`);
      } finally {
        fresh.delete();
      }
    }
  } finally {
    tree.delete();
    parser.delete();
  }
});
