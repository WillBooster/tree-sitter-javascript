import fs from 'node:fs';
import path from 'node:path';

import { Edit, Language, Parser, Query, type Node, type Tree } from '@willbooster/web-tree-sitter';
import { expect, test } from 'vitest';

await Parser.init();
const root = path.join(import.meta.dirname, '../..');
const language = await Language.load(path.join(root, 'tree-sitter-javascript.wasm'));

test('preserves label fields, highlights and full trees when a label is renamed to undefined', () => {
  const parser = new Parser();
  parser.setLanguage(language);
  let labels: Query | undefined;
  let highlights: Query | undefined;
  let tree: Tree | undefined;
  try {
    labels = new Query(
      language,
      '(labeled_statement label: (statement_identifier) @definition) (break_statement label: (statement_identifier) @jump) (continue_statement label: (statement_identifier) @jump)'
    );
    highlights = new Query(language, fs.readFileSync(path.join(root, 'queries/highlights.scm'), 'utf8'));
    let source =
      'function f(){ordinaryx: for(let i=0;i<2;i++){if(i)break ordinaryx;continue ordinaryx;}return undefined;}';
    tree = parser.parse(source)!;
    const indices = labels
      .captures(tree.rootNode)
      .map(({ node }) => node.startIndex)
      .toReversed();
    for (const name of ['undefined', 'ordinaryx', 'undefined']) {
      for (const index of indices) {
        tree.edit(
          new Edit({
            startIndex: index,
            oldEndIndex: index + 9,
            newEndIndex: index + 9,
            startPosition: { row: 0, column: index },
            oldEndPosition: { row: 0, column: index + 9 },
            newEndPosition: { row: 0, column: index + 9 },
          })
        );
        source = source.slice(0, index) + name + source.slice(index + 9);
      }
      const previous: Tree = tree;
      tree = parser.parse(source, previous)!;
      previous.delete();
      const fresh = parser.parse(source)!;
      try {
        expect(tree.rootNode.hasError, source).toBe(false);
        expect(snapshot(tree.rootNode)).toEqual(snapshot(fresh.rootNode));
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
        expect(
          highlights.captures(tree.rootNode).map(({ name, node }) => [name, node.type, node.startIndex, node.endIndex])
        ).toEqual(
          highlights.captures(fresh.rootNode).map(({ name, node }) => [name, node.type, node.startIndex, node.endIndex])
        );
      } finally {
        fresh.delete();
      }
    }
  } finally {
    tree?.delete();
    labels?.delete();
    highlights?.delete();
    parser.delete();
  }
});

function snapshot(node: Node): unknown {
  return {
    type: node.type,
    named: node.isNamed,
    extra: node.isExtra,
    missing: node.isMissing,
    error: node.hasError,
    start: node.startIndex,
    end: node.endIndex,
    startPosition: node.startPosition,
    endPosition: node.endPosition,
    children: node.children.map((child, index) => [node.fieldNameForChild(index), snapshot(child)]),
  };
}
