import fs from 'node:fs';
import { Edit, Language, Parser, Query, type Node } from '@willbooster/web-tree-sitter';
import { expect, test } from 'vitest';

const Following = 'const sentinel = 1;';
const LineBreaks = ['\n', '\r', '\r\n', '\u2028', '\u2029', '/*\n*/', '// comment\n'];

test.each(['javascript', 'javascript_script'])(
  'enforces async arrow parameter boundaries in %s through edits',
  async (goal) => {
    await Parser.init();
    const language = await Language.load(`tree-sitter-${goal}.wasm`);
    const parser = new Parser().setLanguage(language);
    const queries = ['highlights', 'highlights-jsx', 'highlights-params', 'locals', 'tags', 'injections'].map(
      (name) => new Query(language, fs.readFileSync(`queries/${name}.scm`, 'utf8'))
    );
    const captures = (node: Node): unknown =>
      queries.map((q) => q.captures(node).map((c) => [c.name, snapshot(c.node)]));
    try {
      for (const parameter of ['value', '(value)', '({value})']) {
        for (const lineBreak of LineBreaks) {
          let source = `consume(async /* same line */ ${parameter} => value);\n${Following}`;
          let tree = parser.parse(source)!;
          try {
            expect(tree.rootNode.hasError).toBe(false);
            const arrow = tree.rootNode.descendantsOfType('arrow_function')[0]!;
            expect(arrow.children.find((node) => node.type === 'async')!.text).toBe('async');
            expect(arrow.childForFieldName(parameter === 'value' ? 'parameter' : 'parameters')!.text).toBe(parameter);
            const start = source.indexOf('/* same line */');
            for (const [before, after, hasError] of [
              ['/* same line */', lineBreak, true],
              [lineBreak, '/* same line */', false],
            ] as const) {
              const next = source.slice(0, start) + after + source.slice(start + before.length);
              tree.edit(
                new Edit({
                  startIndex: start,
                  oldEndIndex: start + before.length,
                  newEndIndex: start + after.length,
                  startPosition: point(source, start),
                  oldEndPosition: point(source, start + before.length),
                  newEndPosition: point(next, start + after.length),
                })
              );
              const previous = tree;
              tree = parser.parse(next, previous)!;
              previous.delete();
              source = next;
              const fresh = parser.parse(source)!;
              try {
                expect(tree.rootNode.hasError, source).toBe(hasError);
                expect(tree.rootNode.lastNamedChild!.text).toBe(Following);
                expect(tree.rootNode.lastNamedChild!.hasError).toBe(false);
                expect(snapshot(tree.rootNode)).toEqual(snapshot(fresh.rootNode));
                expect(captures(tree.rootNode)).toEqual(captures(fresh.rootNode));
              } finally {
                fresh.delete();
              }
            }
          } finally {
            tree.delete();
          }
        }
      }
      for (const lineBreak of LineBreaks) {
        const source = `async${lineBreak}value => value;\n${Following}`;
        const tree = parser.parse(source)!;
        try {
          expect(tree.rootNode.hasError, source).toBe(false);
          expect(tree.rootNode.namedChildren.filter((node) => !node.isExtra).map((node) => node.type)).toEqual([
            'expression_statement',
            'expression_statement',
            'lexical_declaration',
          ]);
          expect(tree.rootNode.namedChild(0)!.namedChild(0)!.text).toBe('async');
          const arrow = tree.rootNode.descendantsOfType('arrow_function')[0]!;
          expect(arrow.text).toBe('value => value');
          expect(arrow.children.some((node) => node.type === 'async')).toBe(false);
        } finally {
          tree.delete();
        }
      }
      for (const gap of LineBreaks) {
        for (const [head, tail] of [
          ['consume(async', 'function named(){});'],
          ['consume(async', 'function* named(){});'],
          ['const object = {async', 'method(){}};'],
          ['const object = {async', '*method(){}};'],
        ]) {
          const source = `${head}${gap}${tail}\n${Following}`;
          const tree = parser.parse(source)!;
          try {
            expect(tree.rootNode.hasError, source).toBe(true);
            expect(tree.rootNode.lastNamedChild!.text).toBe(Following);
            expect(tree.rootNode.lastNamedChild!.hasError).toBe(false);
          } finally {
            tree.delete();
          }
        }
      }
      const control = `const called = async(input);
const shorthand = {async};
const {async: binding} = object;
const methods = {async run() { await input; }, async *generate() { yield input; }};
class C { async
run() {} }
async function fn() { await input; }
async function *generator() { yield await input; }
async: while (flag) { break async; }
`;
      const controlTree = parser.parse(control)!;
      const calls = new Query(language, '(call_expression function: (identifier) @function)');
      try {
        expect(controlTree.rootNode.hasError).toBe(false);
        expect(calls.captures(controlTree.rootNode).map(({ node }) => node.text)).toEqual(['async']);
        const identifiers = controlTree.rootNode.descendantsOfType([
          'identifier',
          'property_identifier',
          'shorthand_property_identifier',
          'statement_identifier',
        ]);
        expect(identifiers.every((node) => node.endIndex > node.startIndex)).toBe(true);
        expect(
          controlTree.rootNode.descendantsOfType('shorthand_property_identifier').map((node) => node.text)
        ).toEqual(['async']);
      } finally {
        calls.delete();
        controlTree.delete();
      }
    } finally {
      for (const query of queries) query.delete();
      parser.delete();
    }
  }
);

function point(source: string, index: number): { row: number; column: number } {
  const prefix = source.slice(0, index);
  return { row: prefix.split('\n').length - 1, column: prefix.length - prefix.lastIndexOf('\n') - 1 };
}

function snapshot(node: Node): unknown {
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
