import fs from 'node:fs';
import path from 'node:path';

import { Language, Parser, Query } from '@willbooster/web-tree-sitter';
import { expect, test } from 'vitest';

await Parser.init();
const root = path.join(import.meta.dirname, '../..');
const language = await Language.load(path.join(root, 'tree-sitter-javascript.wasm'));

test('preserves label fields and highlights when a label is named undefined', () => {
  const parser = new Parser();
  parser.setLanguage(language);
  const labels = new Query(
    language,
    '(labeled_statement label: (statement_identifier) @definition) (break_statement label: (statement_identifier) @jump) (continue_statement label: (statement_identifier) @jump)'
  );
  const highlights = new Query(language, fs.readFileSync(path.join(root, 'queries/highlights.scm'), 'utf8'));
  try {
    for (const name of ['ordinaryx', 'undefined']) {
      const source = `function f(){${name}: for(let i=0;i<2;i++){if(i)break ${name};continue ${name};}return undefined;}`;
      const tree = parser.parse(source)!;
      try {
        expect(tree.rootNode.hasError, source).toBe(false);
        const captures = labels.captures(tree.rootNode);
        expect(captures.map(({ name: capture, node }) => [capture, node.text, node.type])).toEqual([
          ['definition', name, 'statement_identifier'],
          ['jump', name, 'statement_identifier'],
          ['jump', name, 'statement_identifier'],
        ]);
        for (const { node } of captures) {
          expect(node.parent?.childForFieldName('label')?.id).toBe(node.id);
          expect(source.slice(node.startIndex, node.endIndex)).toBe(name);
        }
        const expression = tree.rootNode.descendantsOfType('return_statement')[0]!;
        expect(expression.namedChildren.map((node) => [node.type, node.text])).toEqual([['undefined', 'undefined']]);
        expect(
          highlights
            .captures(tree.rootNode)
            .filter(({ node }) => node.id === expression.firstNamedChild?.id)
            .map(({ name }) => name)
        ).toEqual(['constant.builtin']);
        expect(highlights.captures(tree.rootNode).filter(({ node }) => node.type === 'statement_identifier')).toEqual(
          []
        );
      } finally {
        tree.delete();
      }
    }
  } finally {
    labels.delete();
    highlights.delete();
    parser.delete();
  }
});
