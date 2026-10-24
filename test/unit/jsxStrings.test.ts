import fs from 'node:fs';
import path from 'node:path';

import { Edit, Language, type Node, Parser, Query, type Tree } from '@willbooster/web-tree-sitter';
import { expect, test } from 'vitest';

const Root = path.join(import.meta.dirname, '../..');
const Gaps = [' ', '  ', '\t', '\n', '\r\n', '\u00A0', '\u2028', '\u2029'];
const Entities = ['&amp;', '&#32;', '&#x20;'];
const QuerySources = [['highlights', 'highlights-jsx', 'highlights-params'], ['tags'], ['locals'], ['injections']].map(
  (files) => files.map((file) => fs.readFileSync(path.join(Root, `queries/${file}.scm`), 'utf8')).join('\n')
);

for (const goal of ['javascript', 'javascript_script']) {
  test(`preserves JSX attribute whitespace and entities through ${goal} edits`, async () => {
    await Parser.init();
    const language = await Language.load(path.join(Root, `tree-sitter-${goal}.wasm`));
    const parser = new Parser().setLanguage(language);
    const queries: Query[] = [];
    try {
      for (const source of QuerySources) queries.push(new Query(language, source));
      for (const quote of ['"', "'"]) {
        for (const gap of Gaps) {
          for (const entity of Entities) {
            const prefix = `const e=<X a=${quote}`;
            const suffix = `${entity}${quote}/>;\nconst following = 1;`;
            let source = prefix + gap + suffix;
            let tree: Tree | undefined;
            try {
              tree = parser.parse(source)!;
              checkFragments(tree, source, prefix.length, gap, entity);
              for (const nextGap of [gap + ' ', gap]) {
                const next = prefix + nextGap + suffix;
                tree.edit(
                  new Edit({
                    startIndex: prefix.length,
                    oldEndIndex: source.length - suffix.length,
                    newEndIndex: prefix.length + nextGap.length,
                    startPosition: point(prefix),
                    oldEndPosition: point(source.slice(0, -suffix.length)),
                    newEndPosition: point(prefix + nextGap),
                  })
                );
                const previous: Tree = tree;
                tree = parser.parse(next, previous)!;
                previous.delete();
                const fresh = parser.parse(next)!;
                try {
                  checkFragments(tree, next, prefix.length, nextGap, entity);
                  expect(snapshot(tree.rootNode), next).toEqual(snapshot(fresh.rootNode));
                  for (const query of queries) {
                    expect(captures(query, tree), next).toEqual(captures(query, fresh));
                  }
                } finally {
                  fresh.delete();
                }
                source = next;
              }
            } finally {
              tree?.delete();
            }
          }
        }
      }
    } finally {
      for (const query of queries) query.delete();
      parser.delete();
    }
  });
}

function checkFragments(tree: Tree, source: string, start: number, gap: string, entity: string): void {
  expect(tree.rootNode.hasError, source).toBe(false);
  const strings = tree.rootNode.descendantsOfType('string');
  expect(strings, source).toHaveLength(1);
  expect(
    strings[0]!.namedChildren.map((node) => [node.type, node.text, node.startIndex, node.endIndex]),
    source
  ).toEqual([
    ['string_fragment', gap, start, start + gap.length],
    ['html_character_reference', entity, start + gap.length, start + gap.length + entity.length],
  ]);
  expect(tree.rootNode.lastNamedChild?.text, source).toBe('const following = 1;');
}

function snapshot(node: Node): unknown[] {
  return [
    node.type,
    node.isNamed,
    node.isExtra,
    node.isMissing,
    node.hasError,
    node.startIndex,
    node.endIndex,
    node.startPosition,
    node.endPosition,
    node.children.map((child, index) => [node.fieldNameForChild(index), snapshot(child)]),
  ];
}

function captures(query: Query, tree: Tree): unknown[] {
  return query.captures(tree.rootNode).map(({ name, node }) => [name, node.text, snapshot(node)]);
}

function point(text: string): { row: number; column: number } {
  const lines = text.split('\n');
  return { row: lines.length - 1, column: lines.at(-1)!.length };
}
