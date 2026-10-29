import path from 'node:path';

import { Language, Parser } from '@willbooster/web-tree-sitter';
import { expect, test } from 'vitest';

test('preserves import attributes and requires explicit separation before with statements', async () => {
  await Parser.init();
  const parser = new Parser().setLanguage(
    await Language.load(path.join(import.meta.dirname, '../../tree-sitter-javascript.wasm'))
  );
  try {
    for (const declaration of ['import { A }', 'import A', 'export { A }', 'export *', 'export * as ns']) {
      for (const trivia of [' ', '\n', ' /* c */ ', ' // c\n', ' <!-- c\n', ' --> c\n', ' /* a */ <!-- b\n // c\n']) {
        const prefix = `${declaration} from "m"`;
        const ambiguous = parser.parse(`${prefix}\nwith${trivia}(x) { use(x); }\nconst after = 1;`)!;
        try {
          expect(ambiguous.rootNode.hasError).toBe(true);
        } finally {
          ambiguous.delete();
        }
        for (const [suffix, attribute] of [
          ['(x) { use(x); }', false],
          ['{ type: "json" };', true],
        ] as const) {
          const source = `${prefix}${attribute ? '' : ';'}\nwith${trivia}${suffix}\nconst after = 1;`;
          const tree = parser.parse(source)!;
          try {
            expect(tree.rootNode.hasError, source).toBe(false);
            const statements = tree.rootNode.namedChildren.filter(
              (node) => node.type !== 'comment' && node.type !== 'html_comment'
            );
            expect(statements[0]?.descendantsOfType('import_attribute')).toHaveLength(attribute ? 1 : 0);
            expect(statements[attribute ? 1 : 2]?.text).toBe('const after = 1;');
            if (!attribute) expect(statements[1]?.type).toBe('with_statement');
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

test('ends module declarations before following expression statements across comment and ordinary line breaks', async () => {
  await Parser.init();
  const parser = new Parser().setLanguage(
    await Language.load(path.join(import.meta.dirname, '../../tree-sitter-javascript.wasm'))
  );
  try {
    for (const declaration of [
      'export { a }',
      'export { a as b }',
      'export {}',
      'import x from "y" with { type: "json" }',
      'import "y" with {}',
      'export { a } from "y" with { type: "json" }',
      'export * from "y" with {}',
      'export * as ns from "y" with {}',
    ]) {
      for (const suffix of ['(z);', '[z];', '`tag`;', 'foo();', '+z;', '-z;', '++z;', '!z;', '~z;']) {
        const invalid = parser.parse(`const a = 1; ${declaration} ${suffix}`)!;
        try {
          expect(invalid.rootNode.hasError, `${declaration} ${suffix}`).toBe(true);
        } finally {
          invalid.delete();
        }
        for (const separator of ['\n', '//c\n', '/*c\n*/', '\r', '\r\n', '\u2028', '\u2029']) {
          checkModuleBoundary(parser, declaration, separator, suffix);
        }
      }
    }
    for (const separator of ['\n', '//c\n', '/*c\n*/', '\r', '\r\n', '\u2028', '\u2029']) {
      const source = `const a = 1; export {a}${separator}from "y"; import "y"${separator}from(z);`;
      const tree = parser.parse(source)!;
      try {
        expect(tree.rootNode.hasError, source).toBe(false);
        expect(tree.rootNode.descendantsOfType('export_statement')[0]?.childForFieldName('source')?.text).toBe('"y"');
        expect(tree.rootNode.lastNamedChild!.text, source).toBe('from(z);');
        expect(tree.rootNode.lastNamedChild!.firstNamedChild!.type, source).toBe('call_expression');
      } finally {
        tree.delete();
      }
    }
  } finally {
    parser.delete();
  }
});

test('keeps trailing module comments outside declarations', async () => {
  await Parser.init();
  const parser = new Parser().setLanguage(
    await Language.load(path.join(import.meta.dirname, '../../tree-sitter-javascript.wasm'))
  );
  try {
    for (const declaration of [
      'import x from "y" with { type: "json" }',
      'import "y" with {}',
      'export { a } from "y" with {}',
      'export * from "y" with {}',
      'export * as ns from "y" with {}',
    ]) {
      for (const separator of [' // note\n', ' /* note\n*/', '\n']) {
        for (const suffix of ['foo();', '(z);', '[z];', '`tag`;']) {
          for (const leading of ['', ';']) {
            const source = `${leading}const a = 1;\n${declaration}${separator}${suffix}`;
            const tree = parser.parse(source)!;
            try {
              expect(tree.rootNode.hasError, source).toBe(false);
              const statementType = declaration.startsWith('import') ? 'import_statement' : 'export_statement';
              expect(tree.rootNode.descendantsOfType(statementType)[0]!.text, source).toBe(declaration);
              for (const comment of tree.rootNode.descendantsOfType('comment')) {
                expect(comment.parent?.type, source).toBe('program');
              }
            } finally {
              tree.delete();
            }
          }
        }
      }
    }
  } finally {
    parser.delete();
  }
});

function checkModuleBoundary(parser: Parser, declaration: string, separator: string, suffix: string): void {
  const prefix = `const a = 1; ${declaration}`;
  for (const semicolon of ['', ';']) {
    const source = `${prefix}${semicolon}${separator}${suffix}`;
    const tree = parser.parse(source)!;
    try {
      expect(tree.rootNode.hasError, source).toBe(false);
      const statements = tree.rootNode.namedChildren.filter((node) => node.type !== 'comment');
      expect(
        statements.map((node) => node.type),
        source
      ).toEqual([
        'lexical_declaration',
        declaration.startsWith('import') ? 'import_statement' : 'export_statement',
        'expression_statement',
      ]);
      expect(statements[2]!.text, source).toBe(suffix);
      expect(statements[1]!.endIndex, source).toBe(prefix.length + semicolon.length);
      for (const comment of tree.rootNode.descendantsOfType('comment')) {
        expect(comment.parent?.type, source).toBe('program');
      }
    } finally {
      tree.delete();
    }
  }
}
