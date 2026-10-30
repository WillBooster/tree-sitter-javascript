import path from 'node:path';

import { Language, Parser } from '@willbooster/web-tree-sitter';
import { expect, test } from 'vitest';

await Parser.init();
const root = path.join(import.meta.dirname, '../..');
const language = await Language.load(path.join(root, 'tree-sitter-javascript.wasm'));

test('preserves label fields when a label is named undefined', () => {
  const parser = new Parser();
  parser.setLanguage(language);
  try {
    for (const name of ['ordinaryx', 'undefined']) {
      const source = `function f(){${name}: for(let i=0;i<2;i++){if(i)break ${name};continue ${name};}return undefined;}`;
      const tree = parser.parse(source)!;
      try {
        expect(tree.rootNode.hasError, source).toBe(false);
        const labels = tree.rootNode
          .descendantsOfType(['labeled_statement', 'break_statement', 'continue_statement'])
          .map((statement) => statement.childForFieldName('label')!);
        expect(labels.map((node) => [node.text, node.type])).toEqual([
          [name, 'statement_identifier'],
          [name, 'statement_identifier'],
          [name, 'statement_identifier'],
        ]);
        for (const node of labels) {
          expect(source.slice(node.startIndex, node.endIndex)).toBe(name);
        }
        const expression = tree.rootNode.descendantsOfType('return_statement')[0]!;
        expect(expression.namedChildren.map((node) => [node.type, node.text])).toEqual([['undefined', 'undefined']]);
      } finally {
        tree.delete();
      }
    }
  } finally {
    parser.delete();
  }
});
