import path from 'node:path';

import { Language, Parser } from '@willbooster/web-tree-sitter';
import { expect, test } from 'vitest';

await Parser.init();
const language = await Language.load(path.join(import.meta.dirname, '../../tree-sitter-javascript.wasm'));

test.each(['/*c*/', '//c\n'])('ends regex flags before comment %j', (comment) => {
  const parser = new Parser();
  parser.setLanguage(language);
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
          tree.rootNode.descendantsOfType('regex').map((node) => [node.text, node.startIndex, node.endIndex]),
          source
        ).toEqual([[regex, 0, regex.length]]);
      } finally {
        tree.delete();
      }
    }
  } finally {
    parser.delete();
  }
});

test('ends regex flags of any length before a comment', () => {
  const parser = new Parser();
  parser.setLanguage(language);
  try {
    for (const flags of ['', 'g', 'gi']) {
      const source = `/x/${flags}/*c*/instanceof value;`;
      const tree = parser.parse(source)!;
      try {
        expect(tree.rootNode.hasError, source).toBe(false);
        expect(tree.rootNode.descendantsOfType('regex')[0]?.text, source).toBe(`/x/${flags}`);
      } finally {
        tree.delete();
      }
    }
  } finally {
    parser.delete();
  }
});

test.each(['//c\n', '/*c\n*/'])('parses an infix operator or an identifier after a regex comment %j', (comment) => {
  const parser = new Parser().setLanguage(language);
  try {
    for (const operator of ['in', 'instanceof']) {
      const prefix = `/x/${comment}`;
      const original = `${prefix}${operator} value;`;
      for (const source of [original, `${prefix}i\n`]) {
        const tree = parser.parse(source)!;
        try {
          expect(tree.rootNode.hasError, source).toBe(false);
          expect(tree.rootNode.descendantsOfType('regex')[0]?.text, source).toBe('/x/');
          expect(
            tree.rootNode
              .descendantsOfType('binary_expression')
              .map((node) => node.childForFieldName('operator')?.text),
            source
          ).toEqual(source === original ? [operator] : []);
        } finally {
          tree.delete();
        }
      }
    }
  } finally {
    parser.delete();
  }
});
