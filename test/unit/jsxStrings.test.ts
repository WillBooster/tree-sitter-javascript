import path from 'node:path';

import { Language, Parser } from '@willbooster/web-tree-sitter';
import { expect, test } from 'vitest';

const Root = path.join(import.meta.dirname, '../..');
const Gaps = [' ', '  ', '\t', '\n', '\r\n', ' ', ' ', ' '];
const Entities = ['&amp;', '&#32;', '&#x20;'];

for (const goal of ['javascript', 'javascript_script']) {
  test(`preserves JSX attribute whitespace and entities in ${goal}`, async () => {
    await Parser.init();
    const language = await Language.load(path.join(Root, `tree-sitter-${goal}.wasm`));
    const parser = new Parser().setLanguage(language);
    try {
      for (const quote of ['"', "'"]) {
        for (const gap of Gaps.flatMap((gap) => [gap, gap + ' '])) {
          for (const entity of Entities) {
            const prefix = `const e=<X a=${quote}`;
            const source = `${prefix}${gap}${entity}${quote}/>;\nconst following = 1;`;
            const tree = parser.parse(source)!;
            try {
              expect(tree.rootNode.hasError, source).toBe(false);
              const strings = tree.rootNode.descendantsOfType('string');
              expect(strings, source).toHaveLength(1);
              const start = prefix.length;
              expect(
                strings[0]!.namedChildren.map((node) => [node.type, node.text, node.startIndex, node.endIndex]),
                source
              ).toEqual([
                ['string_fragment', gap, start, start + gap.length],
                ['html_character_reference', entity, start + gap.length, start + gap.length + entity.length],
              ]);
              expect(tree.rootNode.lastNamedChild?.text, source).toBe('const following = 1;');
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
}
