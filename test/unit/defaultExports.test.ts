import path from 'node:path';

import { Edit, Language, Parser, Query } from '@willbooster/web-tree-sitter';
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

test('preserves default declaration context through incremental prefix edits', () => {
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
      const prefix = 'export default ';
      const ordinary = `${declaration}\n(x);`;
      let tree = parser.parse(ordinary)!;
      for (const inserted of [true, false, true]) {
        tree.edit(
          new Edit({
            startIndex: 0,
            oldEndIndex: inserted ? 0 : prefix.length,
            newEndIndex: inserted ? prefix.length : 0,
            startPosition: { row: 0, column: 0 },
            oldEndPosition: { row: 0, column: inserted ? 0 : prefix.length },
            newEndPosition: { row: 0, column: inserted ? prefix.length : 0 },
          })
        );
        const source = (inserted ? prefix : '') + ordinary;
        const previous = tree;
        tree = parser.parse(source, previous)!;
        previous.delete();
        const fresh = parser.parse(source)!;
        try {
          expect(tree.rootNode.hasError).toBe(false);
          expect(tree.rootNode.toString()).toBe(fresh.rootNode.toString());
          expect(tree.rootNode.namedChildren.map((node) => [node.type, node.startIndex, node.endIndex])).toEqual(
            fresh.rootNode.namedChildren.map((node) => [node.type, node.startIndex, node.endIndex])
          );
        } finally {
          fresh.delete();
        }
      }
      tree.delete();
    }
  } finally {
    parser.delete();
  }
});
