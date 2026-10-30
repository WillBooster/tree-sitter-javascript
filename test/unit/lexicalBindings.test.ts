import path from 'node:path';

import { Language, Parser } from '@willbooster/web-tree-sitter';
import { expect, test } from 'vitest';

await Parser.init();
const language = await Language.load(path.join(import.meta.dirname, '../../tree-sitter-javascript.wasm'));

test('rejects reserved direct lexical bindings in declarations and loop headers', () => {
  const parser = new Parser().setLanguage(language);
  try {
    for (const kind of ['let', 'const', 'using', 'await using']) {
      for (const name of [
        'let',
        String.raw`\u006cet`,
        String.raw`l\u0065t`,
        String.raw`le\u0074`,
        String.raw`\u{6C}e\u{00074}`,
        'const',
        'class',
        'if',
        'true',
        'in',
      ]) {
        for (const source of [
          `${kind} ${name} = 1;`,
          `${kind} first = 1, ${name} = 2;`,
          `for (${kind} ${name} = 1; ; ) {}`,
          ...(kind === 'let' || kind === 'const' ? [`for (${kind} ${name} in values) {}`] : []),
          `for (${kind} ${name} of values) {}`,
        ]) {
          const tree = parser.parse(source)!;
          try {
            expect(tree.rootNode.hasError, source).toBe(true);
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

test('preserves contextual identifiers in values, var bindings, and lexical bindings', () => {
  const parser = new Parser().setLanguage(language);
  try {
    for (const source of [
      'var let = 1;',
      String.raw`var \u006cet = 1;`,
      String.raw`const \u006cetters = 1;`,
      String.raw`let value = \u006cet;`,
      'let;',
      String.raw`class C { \u006cet = 1; static l\u0065t = 2; le\u0074; }`,
      String.raw`class C { \u006cet() {} }`,
      String.raw`object.\u006cet; ({\u006cet: 1});`,
      'let value = let;',
      'const value = let;',
      'let async = 1, using = 2, of = 3;',
      'for (let value = let; value; value--) {}',
      'for (var let in values) {}',
      'for (var let of values) {}',
      'for (let value of let) {}',
      'const {let: value} = source;',
      'using value = let;',
      String.raw`using value = \u006cet;`,
      'async function f(){ await using value = let; }',
      'for (using value of let) {}',
      'async function f(){ for (await using value of let) {} }',
    ]) {
      const tree = parser.parse(source)!;
      try {
        expect(tree.rootNode.hasError, source).toBe(false);
        if (
          source.startsWith('let value') ||
          source.startsWith('const value') ||
          source.startsWith('for (let value =')
        ) {
          expect(
            tree.rootNode
              .descendantsOfType('variable_declarator')
              .map((node) => node.childForFieldName('name'))
              .filter((node) => node?.type === 'identifier')
              .map((node) => node?.text)
          ).toEqual(['value']);
        }
      } finally {
        tree.delete();
      }
    }
  } finally {
    parser.delete();
  }
});

test.each(['javascript', 'javascript_script'])(
  'ends uninitialized declarations before a following line in %s',
  async (goal) => {
    const parser = new Parser().setLanguage(await Language.load(`tree-sitter-${goal}.wasm`));
    try {
      for (const declaration of ['var e', 'let e', 'var e = 1, f', 'let e = 1, f']) {
        for (const newline of ['\n', '\r']) {
          for (const prefix of ['', 'function outer(){']) {
            for (const ending of ['', ';', ' = value']) {
              checkDeclaration(
                parser,
                `${prefix}${declaration}${ending} // comment${newline}(value);${prefix ? '}' : ''}`
              );
            }
          }
        }
      }
    } finally {
      parser.delete();
    }
  }
);

function checkDeclaration(parser: Parser, source: string): void {
  const tree = parser.parse(source)!;
  try {
    expect(tree.rootNode.hasError, source).toBe(false);
    const initialized = source.includes(' = value');
    const last = tree.rootNode.descendantsOfType('variable_declarator').at(-1)!;
    expect(last.childForFieldName('value')?.type, source).toBe(initialized ? 'call_expression' : undefined);
    if (!initialized) {
      expect(tree.rootNode.descendantsOfType('comment')[0]!.parent!.type, source).toBe(
        source.startsWith('function') ? 'statement_block' : 'program'
      );
    }
  } finally {
    tree.delete();
  }
}
