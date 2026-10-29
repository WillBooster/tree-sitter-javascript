import path from 'node:path';

import { Language, Parser, Query } from '@willbooster/web-tree-sitter';
import { expect, test } from 'vitest';

await Parser.init();
const language = await Language.load(path.join(import.meta.dirname, '../../tree-sitter-javascript.wasm'));

test('preserves statement boundaries before regex literals adjacent to newline-bearing comments', () => {
  const parser = new Parser();
  parser.setLanguage(language);
  const query = new Query(language, '(expression_statement (call_expression) @regex.statement)');
  try {
    for (const newline of ['\n', '\r', '\r\n', '\u2028', '\u2029']) {
      for (const trailing of ['', '/* second */', '// second\n']) {
        const comment = `/*${newline}comment*/${trailing}`;
        for (const source of [`let a${comment}/b/.test(x);`, `function f(){return${comment}/b/.test(x);}`]) {
          const tree = parser.parse(source)!;
          try {
            expect(tree.rootNode.hasError, source).toBe(false);
            expect(
              query.captures(tree.rootNode).map(({ node }) => node.text),
              source
            ).toEqual(['/b/.test(x)']);
            const returned = tree.rootNode.descendantsOfType('return_statement')[0];
            if (returned) {
              expect(
                returned.namedChildren.filter((node) => node.type !== 'comment'),
                source
              ).toEqual([]);
            } else {
              expect(tree.rootNode.namedChildren[0]?.type).toBe('lexical_declaration');
            }
          } finally {
            tree.delete();
          }
        }
      }
    }
    const tree = parser.parse('function f(){return/* same line *//b/.test(x);}')!;
    try {
      expect(tree.rootNode.hasError).toBe(false);
      expect(tree.rootNode.descendantsOfType('return_statement')[0]?.namedChildren.at(-1)?.text).toBe('/b/.test(x)');
      expect(query.captures(tree.rootNode)).toEqual([]);
    } finally {
      tree.delete();
    }
  } finally {
    query.delete();
    parser.delete();
  }
});

test('assigns return and regex roles by whether the comment after return contains a newline', () => {
  const parser = new Parser();
  parser.setLanguage(language);
  const query = new Query(language, '(expression_statement (call_expression) @regex.statement)');
  try {
    for (const comment of ['/* same line */', '/*\ncomment*/', '/*\ncomment*//* second */', '/* unfinished']) {
      const source = `function f(){return${comment}/b/.test(x);}`;
      const tree = parser.parse(source)!;
      try {
        if (comment === '/* unfinished') {
          expect(tree.rootNode.hasError, source).toBe(true);
        } else {
          expect(tree.rootNode.hasError, source).toBe(false);
          const returned = tree.rootNode.descendantsOfType('return_statement')[0];
          expect(returned, source).toBeDefined();
          expect(
            returned!.namedChildren.filter((node) => node.type !== 'comment').map((node) => node.text),
            source
          ).toEqual(comment.includes('\n') ? [] : ['/b/.test(x)']);
          expect(
            query.captures(tree.rootNode).map(({ node }) => node.text),
            source
          ).toEqual(comment.includes('\n') ? ['/b/.test(x)'] : []);
        }
      } finally {
        tree.delete();
      }
    }
  } finally {
    query.delete();
    parser.delete();
  }
});

test('continues declarations after bindings followed by newline comments', () => {
  const parser = new Parser();
  parser.setLanguage(language);
  try {
    for (const newline of ['\n', '\r', '\r\n', '\u2028', '\u2029']) {
      for (const trailing of ['/* second */', '/* second *//* third */', '// second\n']) {
        for (const continuation of [',b=1;', '=1;']) {
          const source = `let a/*${newline}comment*/${trailing}${continuation}`;
          const tree = parser.parse(source)!;
          try {
            expect(tree.rootNode.hasError, source).toBe(false);
            expect(
              tree.rootNode.namedChildren.map((node) => node.type),
              source
            ).toEqual(['lexical_declaration']);
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

const RegexCommentLanguages = [
  ['javascript', language],
  [
    'javascript_script',
    await Language.load(path.join(import.meta.dirname, '../../tree-sitter-javascript_script.wasm')),
  ],
] as const;

for (const [goal, currentLanguage] of RegexCommentLanguages) {
  test.each([
    { lineEnding: 'LF', newline: '\n' },
    { lineEnding: 'CR', newline: '\r' },
    { lineEnding: 'CRLF', newline: '\r\n' },
    { lineEnding: 'LS', newline: '\u2028' },
    { lineEnding: 'PS', newline: '\u2029' },
  ])(`ends block arrows before regex statements following line comments in ${goal} with $lineEnding`, ({ newline }) => {
    const parser = new Parser().setLanguage(currentLanguage);
    const query = new Query(currentLanguage, '(regex) @regex (arrow_function) @arrow');
    try {
      for (const [enclosing, prefix] of [
        ['function', ''],
        ['function', 'const callback = '],
        ['async function', ''],
        ['async function', 'const callback = '],
        ['function*', ''],
        ['async function*', ''],
      ]) {
        for (const arrow of ['() => {}', '(value) => { x: value; }', 'async () => {}']) {
          const before = `${enclosing} outer(){ ${prefix}${arrow}`;
          const suffix = '/pattern/g.test(input); const following = 1; }';
          for (const comment of [`// first${newline}`, `// first${newline}/* second */`]) {
            const source = before + comment + suffix;
            const tree = parser.parse(source)!;
            try {
              expect(tree.rootNode.hasError, source).toBe(false);
              const parsedArrow = tree.rootNode.descendantsOfType('arrow_function')[0]!;
              expect(parsedArrow.text).toBe(arrow);
              expect(parsedArrow.childForFieldName('body')!.endIndex).toBe(before.length);
              expect(tree.rootNode.descendantsOfType('regex')).toHaveLength(1);
              const regex = tree.rootNode.descendantsOfType('regex')[0]!;
              expect(regex.text).toBe('/pattern/g');
              expect(regex.startIndex).toBe(before.length + comment.length);
              expect(tree.rootNode.descendantsOfType('binary_expression')).toEqual([]);
              expect(query.captures(tree.rootNode).map(({ name, node }) => [name, node.text])).toEqual([
                ['arrow', arrow],
                ['regex', '/pattern/g'],
              ]);
            } finally {
              tree.delete();
            }
          }
        }
      }
    } finally {
      query.delete();
      parser.delete();
    }
  });
}
