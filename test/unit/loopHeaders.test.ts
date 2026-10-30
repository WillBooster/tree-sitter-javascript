import { Language, Parser, type Tree } from '@willbooster/web-tree-sitter';
import { expect, test } from 'vitest';

test.each(['javascript', 'javascript_script'])('pairs loop-header delimiters in %s', async (grammar) => {
  await Parser.init();
  const language = await Language.load(`tree-sitter-${grammar}.wasm`);
  const parser = new Parser().setLanguage(language);
  try {
    for (const [prefix, header, type] of [
      ['for', '(let i = 0; i < limit; i++)', 'for_clause'],
      ['for', '(;;)', 'for_clause'],
      ['for', '(var key in object)', 'for_in_clause'],
      ['for', '(const [key, value] of entries)', 'for_in_clause'],
      ['for', '(using item of items)', 'for_in_clause'],
      ['for await', '(const item of stream)', 'for_in_clause'],
    ]) {
      for (const opening of ['(', '(/* header */']) {
        const current = header!.replace('(', opening);
        const source = `async function visit() { ${prefix} ${current} { consume(item); } }`;
        const tree = parser.parse(source)!;
        try {
          checkTree(tree, source, current);
        } finally {
          tree.delete();
        }
      }

      function checkTree(current: Tree, source: string, expectedHeader: string): void {
        expect(current.rootNode.hasError, source).toBe(false);
        const clauses = current.rootNode.descendantsOfType(['for_clause', 'for_in_clause']);
        expect(clauses).toHaveLength(1);
        const clause = clauses[0]!;
        expect(clause.type).toBe(type);
        const opens = clause.children.filter((node) => node.type === '(');
        const closes = clause.children.filter((node) => node.type === ')');
        expect(opens).toHaveLength(1);
        expect(closes).toHaveLength(1);
        const [open, close] = [opens[0], closes[0]];
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
    parser.delete();
  }
});

test.each(['javascript', 'javascript_script'])(
  'retains declaration fields for loop bindings named of in %s',
  async (goal) => {
    await Parser.init();
    const language = await Language.load(`tree-sitter-${goal}.wasm`);
    const parser = new Parser().setLanguage(language);
    try {
      for (const kind of ['let', 'const', 'var']) {
        for (const iterable of ['[of]', '(of)', '+ of', 'of(of)', 'of + of', 'of']) {
          for (const binding of ['of', 'ofValue']) {
            const source = `for (${kind} ${binding} of ${iterable}) { consume(of); }`;
            const tree = parser.parse(source)!;
            try {
              expect(tree.rootNode.hasError, source).toBe(false);
              const header = tree.rootNode.descendantsOfType('for_in_clause')[0]!;
              expect(header.childForFieldName('kind')?.text, source).toBe(kind);
              expect(header.childForFieldName('left')?.text).toBe(binding);
              expect(header.childForFieldName('left')?.startIndex).toBe(source.indexOf(kind) + kind.length + 1);
              expect(header.childForFieldName('operator')?.text).toBe('of');
              expect(header.childForFieldName('right')?.text).toBe(iterable);
              expect(header.childForFieldName('left')?.type).toBe('identifier');
            } finally {
              tree.delete();
            }
          }
        }
      }
    } finally {
      parser.delete();
    }
  }
);
