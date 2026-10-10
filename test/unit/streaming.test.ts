import path from 'node:path';
import { Edit, Language, type Node, Parser } from '@willbooster/web-tree-sitter';
import { expect, test } from 'vitest';

await Parser.init();
const language = await Language.load(path.join(import.meta.dirname, '../../tree-sitter-javascript.wasm'));

test.each([1, 7, 64])('preserves token boundaries with %i-character input chunks', (size) => {
  const parser = new Parser().setLanguage(language);
  const text = 'café日本語'.repeat(128);
  let source = `#!/usr/bin/env node${' '.repeat(64)}\n//${text}\nconst single = '${text}';\nconst double = "${text}";\nconst view = <Item data-${'attribute'.repeat(32)}="value" />;\n//${text}`;
  const read = (offset: number): string => source.slice(offset, offset + size);
  const whole = parser.parse(source)!;
  const chunked = parser.parse(read)!;
  try {
    expect(whole.rootNode.hasError).toBe(false);
    expect(chunked.rootNode.toString()).toBe(whole.rootNode.toString());
    expect(boundaries(chunked.rootNode)).toEqual(boundaries(whole.rootNode));

    const start = source.indexOf(text, source.indexOf('const single')) + 13;
    const insertion = 'é日本';
    const prefix = source.slice(0, start).split('\n');
    const startPosition = { row: prefix.length - 1, column: prefix.at(-1)!.length };
    chunked.edit(
      new Edit({
        startIndex: start,
        oldEndIndex: start,
        newEndIndex: start + insertion.length,
        startPosition,
        oldEndPosition: startPosition,
        newEndPosition: { row: startPosition.row, column: startPosition.column + insertion.length },
      })
    );
    source = source.slice(0, start) + insertion + source.slice(start);
    const incremental = parser.parse(read, chunked)!;
    const fresh = parser.parse(source)!;
    try {
      expect(fresh.rootNode.hasError).toBe(false);
      expect(incremental.rootNode.toString()).toBe(fresh.rootNode.toString());
      expect(boundaries(incremental.rootNode)).toEqual(boundaries(fresh.rootNode));
    } finally {
      incremental.delete();
      fresh.delete();
    }
  } finally {
    whole.delete();
    chunked.delete();
    parser.delete();
  }
});

function boundaries(node: Node): unknown[] {
  return [
    node.type,
    node.startIndex,
    node.endIndex,
    node.startPosition,
    node.endPosition,
    node.isMissing,
    node.isExtra,
    node.children.map(boundaries),
  ];
}
