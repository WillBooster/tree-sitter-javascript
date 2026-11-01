import path from 'node:path';

import { Language, Parser } from '@willbooster/web-tree-sitter';
import { expect, test } from 'vitest';

await Parser.init();

for (const goal of ['javascript', 'javascript_script']) {
  test(`restricts malformed template escapes to tagged templates in ${goal}`, async () => {
    const language = await Language.load(path.join(import.meta.dirname, `../../tree-sitter-${goal}.wasm`));
    const parser = new Parser().setLanguage(language);
    try {
      for (const escape of [
        String.raw`\x`,
        String.raw`\x4`,
        String.raw`\u`,
        String.raw`\u004`,
        String.raw`\u{zz}`,
        ...Array.from({ length: 9 }, (_, i) => `\\${i + 1}`),
        ...Array.from({ length: 10 }, (_, i) => `\\0${i}`),
        String.raw`\377`,
        String.raw`\u{110000}`,
        String.raw`\u{FFFFFFFF}`,
        String.raw`\u{00000110000}`,
        String.raw`\\\1`,
      ]) {
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
      for (const escape of [
        String.raw`\0`,
        String.raw`\0a`,
        String.raw`\x00`,
        String.raw`\xFF`,
        String.raw`\u0000`,
        String.raw`\uD800`,
        String.raw`\uDFFF`,
        String.raw`\uFFFF`,
        String.raw`\u{0}`,
        String.raw`\u{D800}`,
        String.raw`\u{10FFFF}`,
        `\\u{${'0'.repeat(256)}10FFFF}`,
        String.raw`\\1`,
        String.raw`\\u{110000}`,
        '\\\n',
        '\\\r',
        '\\\r\n',
        '\\\u2028',
        '\\\u2029',
        '\\' + '\0',
      ]) {
        const source = `const result = \`${escape}\`;`;
        const tree = parser.parse(source)!;
        try {
          expect(tree.rootNode.hasError, source).toBe(false);
          expect(tree.rootNode.descendantsOfType('template_string')[0]!.text, source).toBe(`\`${escape}\``);
          expect(tree.rootNode.descendantsOfType('escape_sequence'), source).toHaveLength(1);
        } finally {
          tree.delete();
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
