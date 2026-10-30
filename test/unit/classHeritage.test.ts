import { Language, type Node, Parser } from '@willbooster/web-tree-sitter';
import { expect, test } from 'vitest';

const prefix = 'class C extends ';
const suffix = ' {}\nconst sentinel = 1;';
const valid = [
  'B',
  '(B < 1)',
  '(B + D)',
  'f()',
  'new B()',
  'new B',
  'B.x',
  'B[x]',
  'B?.x',
  'B?.()',
  'B?.[x]',
  'tag`x`',
  '(a => a)',
  '(() => B)()',
  'null',
  'class {}',
  'function() {}',
  'async function() {}',
  'async function*() {}',
  'async /* comment */ function named() {}',
  'async function() {}.prototype',
  'async function() {}()',
  'B.yield',
  'B.await',
  '<Base/>',
  '(<Base/>)',
  '<Base/>.constructor',
  'f(<Base/>)',
  'new (<Base/>.constructor)()',
  'B /* boundary */ .x',
  'B\n?.x',
  'f /* boundary */ ()',
  'tag /* boundary */ `x`',
  'B /* boundary */ [x]',
];
const invalid = ['B < 1', 'B + D', 'B = D', 'B ? D : E', '!B', 'B++', 'a => a', 'async a => a', 'await B', 'a => {}()'];

for (const goal of ['javascript', 'javascript_script']) {
  test(`restricts class heritage to left-hand-side expressions in ${goal}`, async () => {
    await Parser.init();
    const language = await Language.load(`tree-sitter-${goal}.wasm`);
    const parser = new Parser().setLanguage(language);
    try {
      for (const expression of valid) {
        const tree = parser.parse(prefix + expression + suffix)!;
        try {
          expect(tree.rootNode.hasError, expression).toBe(false);
          expect(heritageRanges(tree.rootNode), expression).toEqual([
            [expression, prefix.length, prefix.length + expression.length],
          ]);
        } finally {
          tree.delete();
        }
      }
      for (const expression of invalid) {
        const tree = parser.parse(prefix + expression + suffix)!;
        try {
          expect(tree.rootNode.hasError, expression).toBe(true);
          expect(tree.rootNode.lastNamedChild?.text, expression).toBe('const sentinel = 1;');
          expect(tree.rootNode.lastNamedChild?.hasError, expression).toBe(false);
        } finally {
          tree.delete();
        }
      }
    } finally {
      parser.delete();
    }
  });
}

function heritageRanges(root: Node): unknown[] {
  return root
    .descendantsOfType('class_heritage')
    .flatMap((heritage) => heritage.namedChildren.filter((node) => node.type !== 'comment'))
    .map((node) => [node.text, node.startIndex, node.endIndex]);
}

test('preserves declarations following an unfinished comparison heritage and rejects EOF prefixes', async () => {
  await Parser.init();
  const parser = new Parser().setLanguage(await Language.load('tree-sitter-javascript.wasm'));
  const tail = '\nclass L {}\nexport function h() {}\nexport const k = 2;';
  try {
    for (const operator of ['<', ' <']) {
      const tree = parser.parse(prefix + 'B' + operator + tail)!;
      try {
        expect(tree.rootNode.namedChildren.slice(-3).map((node) => [node.text, node.hasError])).toEqual([
          ['class L {}', false],
          ['export function h() {}', false],
          ['export const k = 2;', false],
        ]);
      } finally {
        tree.delete();
      }
    }
    for (const incomplete of [
      'class',
      'class C',
      'class C extends',
      'class C extends B',
      'class C extends B<',
      'class C extends f(',
      'class C extends B?.',
      'class C extends <Base',
      'class C extends (B',
    ]) {
      const result = parser.parse(incomplete)!;
      try {
        expect(result.rootNode.hasError, incomplete).toBe(true);
      } finally {
        result.delete();
      }
    }
  } finally {
    parser.delete();
  }
});

for (const goal of ['javascript', 'javascript_script']) {
  test(`keeps generator yield reserved in heritage and permits property names in ${goal}`, async () => {
    await Parser.init();
    const parser = new Parser().setLanguage(await Language.load(`tree-sitter-${goal}.wasm`));
    try {
      for (const expression of ['yield', 'yield.x', 'yield()']) {
        const tree = parser.parse(`function* g() { class C extends ${expression} {} }`)!;
        try {
          expect(tree.rootNode.hasError, expression).toBe(true);
        } finally {
          tree.delete();
        }
      }
      for (const source of [
        'async function g() { class C extends await {} }',
        'async function g() { class C extends await.x {} }',
        'async function g() { class C extends await() {} }',
      ]) {
        const result = parser.parse(source)!;
        try {
          expect(result.rootNode.hasError, source).toBe(true);
        } finally {
          result.delete();
        }
      }
      for (const body of [
        '({yield: 1});',
        '({yield(){}});',
        '({get yield(){}});',
        '({async yield(){}});',
        '({*yield(){}});',
        'class K { yield(){} static yield = 1; }',
        'let {yield: a} = b;',
        '({await: 1}); class K { await(){} }',
      ]) {
        for (const source of [body, `function* g() { ${body} }`, `async function g() { ${body} }`]) {
          const tree = parser.parse(source)!;
          try {
            expect(tree.rootNode.hasError, source).toBe(false);
          } finally {
            tree.delete();
          }
        }
      }
      const control = parser.parse('function* g() { class C extends B.yield {} yield result; }')!;
      try {
        expect(control.rootNode.hasError).toBe(false);
      } finally {
        control.delete();
      }
      for (const separator of ['\n', '/*\n*/', '// comment\n']) {
        const tree = parser.parse(`class C extends async${separator}function() {} {}`)!;
        try {
          expect(tree.rootNode.hasError, separator).toBe(true);
        } finally {
          tree.delete();
        }
      }
    } finally {
      parser.delete();
    }
  });
}

test('preserves Script HTML comments between heritage continuations', async () => {
  await Parser.init();
  const parser = new Parser().setLanguage(await Language.load('tree-sitter-javascript_script.wasm'));
  try {
    for (const trivia of [
      ' <!-- comment\n',
      '\n--> comment\n',
      ' /* normal */ <!-- comment\n',
      '\n/* normal */ --> comment\n',
      ' /*\nnormal */ --> comment\n',
    ]) {
      const tree = parser.parse(`class C extends B${trivia}.x {}\nconst after = 1;`)!;
      try {
        expect(tree.rootNode.hasError, trivia).toBe(false);
        expect(tree.rootNode.descendantsOfType('member_expression')[0]?.text).toBe(`B${trivia}.x`);
        expect(tree.rootNode.descendantsOfType('html_comment')[0]?.text).toMatch(/^(<!--|-->)/);
        expect(tree.rootNode.lastNamedChild?.text).toBe('const after = 1;');
      } finally {
        tree.delete();
      }
    }
  } finally {
    parser.delete();
  }
});

test('preserves Script await identifiers and parenthesized keyword operands', async () => {
  await Parser.init();
  const parser = new Parser();
  try {
    parser.setLanguage(await Language.load('tree-sitter-javascript_script.wasm'));
    for (const source of [
      'class C extends await {}',
      'class C extends await() {}',
      'function f() { class C extends await {} }',
    ]) {
      const tree = parser.parse(source)!;
      try {
        expect(tree.rootNode.hasError, source).toBe(false);
      } finally {
        tree.delete();
      }
    }
    parser.setLanguage(await Language.load('tree-sitter-javascript.wasm'));
    const invalid = parser.parse('class C extends await {}')!;
    try {
      expect(invalid.rootNode.hasError).toBe(true);
    } finally {
      invalid.delete();
    }
    for (const source of [
      'async function g() { class C extends (await result) {} }',
      'function* g() { class C extends (yield result) {} }',
    ]) {
      const tree = parser.parse(source)!;
      try {
        expect(tree.rootNode.hasError, source).toBe(false);
      } finally {
        tree.delete();
      }
    }
  } finally {
    parser.delete();
  }
});
