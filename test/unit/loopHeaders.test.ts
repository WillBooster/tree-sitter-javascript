import { Edit, Language, type Node, Parser, Query, type Tree } from '@willbooster/web-tree-sitter';
import { expect, test } from 'vitest';

test.each(['javascript', 'javascript_script'])('pairs loop-header delimiters through edits in %s', async (grammar) => {
  await Parser.init();
  const language = await Language.load(`tree-sitter-${grammar}.wasm`);
  const parser = new Parser().setLanguage(language);
  const brackets = new Query(language, '[(for_clause "(" @open ")" @close) (for_in_clause "(" @open ")" @close)]');
  try {
    for (const [prefix, header, type] of [
      ['for', '(let i = 0; i < limit; i++)', 'for_clause'],
      ['for', '(;;)', 'for_clause'],
      ['for', '(var key in object)', 'for_in_clause'],
      ['for', '(const [key, value] of entries)', 'for_in_clause'],
      ['for', '(using item of items)', 'for_in_clause'],
      ['for await', '(const item of stream)', 'for_in_clause'],
    ]) {
      let source = `async function visit() { ${prefix} ${header} { consume(item); } }`;
      let tree: Tree | undefined;
      try {
        tree = parser.parse(source)!;
        checkTree(tree, header!);
        const start = source.indexOf(header!) + 1;
        for (const [before, after] of [
          ['(', '(/* header */'],
          ['(/* header */', '('],
        ]) {
          const oldText = before!.slice(1);
          const newText = after!.slice(1);
          const next = source.slice(0, start) + newText + source.slice(start + oldText.length);
          tree.edit(
            new Edit({
              startIndex: start,
              oldEndIndex: start + oldText.length,
              newEndIndex: start + newText.length,
              startPosition: { row: 0, column: start },
              oldEndPosition: { row: 0, column: start + oldText.length },
              newEndPosition: { row: 0, column: start + newText.length },
            })
          );
          const old: Tree = tree;
          tree = parser.parse(next, old)!;
          old.delete();
          source = next;
          const fresh = parser.parse(source)!;
          try {
            checkTree(tree, header!.replace('(', after!));
            expect(snapshot(tree.rootNode)).toEqual(snapshot(fresh.rootNode));
          } finally {
            fresh.delete();
          }
        }
      } finally {
        tree?.delete();
      }

      function checkTree(current: Tree, expectedHeader: string): void {
        expect(current.rootNode.hasError, source).toBe(false);
        const matches = brackets.matches(current.rootNode);
        expect(matches).toHaveLength(1);
        const [open, close] = matches[0]!.captures.map(({ node }) => node);
        expect(open!.parent!.id).toBe(close!.parent!.id);
        const clause = open!.parent!;
        expect(clause.type).toBe(type);
        expect(clause.text).toBe(expectedHeader);
        expect(clause.startIndex).toBe(open!.startIndex);
        expect(clause.endIndex).toBe(close!.endIndex);
        expect(clause.parent!.childForFieldName('header')!.id).toBe(clause.id);
        expect(clause.parent!.childForFieldName('body')!.text).toBe('{ consume(item); }');
        if (type === 'for_clause') {
          expect(clause.childForFieldName('initializer')).not.toBeNull();
          expect(clause.childForFieldName('condition')).not.toBeNull();
        } else {
          expect(clause.childForFieldName('left')).not.toBeNull();
          expect(clause.childForFieldName('right')).not.toBeNull();
          expect(clause.childForFieldName('operator')!.text).toBe(header!.includes(' in ') ? 'in' : 'of');
        }
      }
    }
  } finally {
    brackets.delete();
    parser.delete();
  }
});

test.each(['javascript', 'javascript_script'])(
  'retains declaration fields for loop bindings named of in %s',
  async (goal) => {
    await Parser.init();
    const language = await Language.load(`tree-sitter-${goal}.wasm`);
    const parser = new Parser().setLanguage(language);
    const query = new Query(language, '(for_in_clause left: (identifier) @binding)');
    try {
      for (const kind of ['let', 'const', 'var']) {
        for (const iterable of ['[of]', '(of)', '+ of', 'of(of)', 'of + of', 'of']) {
          let binding = 'of';
          let source = `for (${kind} ${binding} of ${iterable}) { consume(of); }`;
          let tree = parser.parse(source)!;
          try {
            for (const replacement of ['of', 'ofValue', 'of']) {
              const start = source.indexOf(kind) + kind.length + 1;
              const next = source.slice(0, start) + replacement + source.slice(start + binding.length);
              tree.edit(
                new Edit({
                  startIndex: start,
                  oldEndIndex: start + binding.length,
                  newEndIndex: start + replacement.length,
                  startPosition: { row: 0, column: start },
                  oldEndPosition: { row: 0, column: start + binding.length },
                  newEndPosition: { row: 0, column: start + replacement.length },
                })
              );
              const previous = tree;
              tree = parser.parse(next, previous)!;
              previous.delete();
              source = next;
              binding = replacement;
              const fresh = parser.parse(source)!;
              try {
                expect(tree.rootNode.hasError, source).toBe(false);
                const header = tree.rootNode.descendantsOfType('for_in_clause')[0]!;
                expect(header.childForFieldName('kind')?.text, source).toBe(kind);
                expect(header.childForFieldName('left')?.text).toBe(binding);
                expect(header.childForFieldName('left')?.startIndex).toBe(start);
                expect(header.childForFieldName('operator')?.text).toBe('of');
                expect(header.childForFieldName('right')?.text).toBe(iterable);
                expect(query.captures(tree.rootNode).map(({ node }) => node.text)).toEqual([binding]);
                expect(snapshot(tree.rootNode)).toEqual(snapshot(fresh.rootNode));
              } finally {
                fresh.delete();
              }
            }
          } finally {
            tree.delete();
          }
        }
      }
    } finally {
      query.delete();
      parser.delete();
    }
  }
);

function snapshot(node: Node): unknown {
  return [
    node.type,
    node.isNamed,
    node.isMissing,
    node.hasError,
    node.startIndex,
    node.endIndex,
    node.startPosition,
    node.endPosition,
    node.children.map((child, index) => [node.fieldNameForChild(index), snapshot(child)]),
  ];
}
