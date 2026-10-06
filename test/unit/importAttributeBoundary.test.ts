import { Edit, Language, Parser } from '@willbooster/web-tree-sitter';
import { expect, test } from 'vitest';

test('distinguishes import attributes from following with statements', async () => {
  await Parser.init();
  const parser = new Parser().setLanguage(await Language.load('tree-sitter-javascript.wasm'));
  try {
    for (const declaration of ['import { A }', 'import A', 'export { A }', 'export *', 'export * as ns']) {
      for (const trivia of [' ', '\n', ' /* c */ ', ' // c\n']) {
        const prefix = `${declaration} from "m"\n`;
        for (const [suffix, attribute] of [
          ['(x) { use(x); }', false],
          ['{ type: "json" };', true],
        ] as const) {
          const source = `${prefix}with${trivia}${suffix}\nconst after = 1;`;
          const tree = parser.parse(source)!;
          try {
            expect(tree.rootNode.hasError, source).toBe(false);
            const statements = tree.rootNode.namedChildren.filter((node) => node.type !== 'comment');
            expect(statements[0]?.descendantsOfType('import_attribute')).toHaveLength(attribute ? 1 : 0);
            expect(statements[attribute ? 1 : 2]?.text).toBe('const after = 1;');
            if (!attribute) expect(statements[1]?.type).toBe('with_statement');
            const index = prefix.length;
            const end = source.indexOf('\nconst after');
            const replacement = `with${trivia}${attribute ? '(x) { use(x); }' : '{ type: "json" };'}`;
            const updated = source.slice(0, index) + replacement + source.slice(end);
            tree.edit(
              new Edit({
                startIndex: index,
                oldEndIndex: end,
                newEndIndex: index + replacement.length,
                startPosition: position(source, index),
                oldEndPosition: position(source, end),
                newEndPosition: position(updated, index + replacement.length),
              })
            );
            const incremental = parser.parse(updated, tree)!;
            const fresh = parser.parse(updated)!;
            try {
              expect(incremental.rootNode.toString()).toBe(fresh.rootNode.toString());
              expect(incremental.rootNode.hasError).toBe(false);
              expect(incremental.rootNode.namedChildren[0]?.descendantsOfType('import_attribute')).toHaveLength(
                attribute ? 0 : 1
              );
            } finally {
              incremental.delete();
              fresh.delete();
            }
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

function position(source: string, index: number): { row: number; column: number } {
  const lines = source.slice(0, index).split('\n');
  return { row: lines.length - 1, column: lines.at(-1)!.length };
}
