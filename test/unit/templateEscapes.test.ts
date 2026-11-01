import path from 'node:path';

import { Language, Parser } from '@willbooster/web-tree-sitter';
import { expect, test } from 'vitest';

await Parser.init();

for (const goal of ['javascript', 'javascript_script']) {
  test(`restricts malformed template escapes to tagged templates in ${goal}`, async () => {
    const language = await Language.load(path.join(import.meta.dirname, `../../tree-sitter-${goal}.wasm`));
    const parser = new Parser().setLanguage(language);
    try {
      for (const escape of [String.raw`\x`, String.raw`\x4`, String.raw`\u`, String.raw`\u004`, String.raw`\u{zz}`]) {
        for (const tag of ['', 'tag', 'object.method', 'new tag`first`']) {
          for (const content of [escape, `${escape}\${value}tail`, `head\${value}${escape}`]) {
            const source = `const result = ${tag}\`${content}\`; const after = 1;`;
            const tree = parser.parse(source)!;
            try {
              expect(tree.rootNode.hasError, source).toBe(tag.length === 0);
              if (tag) {
                expect(tree.rootNode.lastNamedChild!.text, source).toBe('const after = 1;');
                const template = tree.rootNode.descendantsOfType('template_string').at(-1)!;
                expect(template.text, source).toBe(`\`${content}\``);
              }
            } finally {
              tree.delete();
            }
          }
        }
      }
      for (const source of ['const result = `\\x41\\u0041\\u{41}`;', 'const result = tag`outer ${`\\x`}`;']) {
        const tree = parser.parse(source)!;
        try {
          expect(tree.rootNode.hasError, source).toBe(source.includes('outer'));
        } finally {
          tree.delete();
        }
      }
    } finally {
      parser.delete();
    }
  });
}
