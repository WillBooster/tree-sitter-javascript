import { Language, Parser } from '@willbooster/web-tree-sitter';
import { expect, test } from 'vitest';

const Following = 'const sentinel = 1;';
const LineBreaks = ['\n', '\r', '\r\n', '\u2028', '\u2029', '/*\n*/', '// comment\n'];

test.each(['javascript', 'javascript_script'])('enforces async arrow parameter boundaries in %s', async (goal) => {
  await Parser.init();
  const language = await Language.load(`tree-sitter-${goal}.wasm`);
  const parser = new Parser().setLanguage(language);
  try {
    for (const parameter of ['value', '(value)', '({value})', 'of']) {
      const source = `consume(async /* same line */ ${parameter} => value);\n${Following}`;
      const tree = parser.parse(source)!;
      try {
        expect(tree.rootNode.hasError).toBe(false);
        const arrow = tree.rootNode.descendantsOfType('arrow_function')[0]!;
        expect(arrow.children.find((node) => node.type === 'async')!.text).toBe('async');
        expect(arrow.childForFieldName(parameter.startsWith('(') ? 'parameters' : 'parameter')!.text).toBe(parameter);
        expect(tree.rootNode.lastNamedChild!.text).toBe(Following);
      } finally {
        tree.delete();
      }
      for (const lineBreak of LineBreaks) {
        const broken = source.replace('/* same line */', lineBreak);
        const brokenTree = parser.parse(broken)!;
        try {
          expect(brokenTree.rootNode.hasError, broken).toBe(true);
          expect(brokenTree.rootNode.lastNamedChild!.text).toBe(Following);
          expect(brokenTree.rootNode.lastNamedChild!.hasError).toBe(false);
        } finally {
          brokenTree.delete();
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
    try {
      expect(controlTree.rootNode.hasError).toBe(false);
      expect(
        controlTree.rootNode
          .descendantsOfType('call_expression')
          .map((node) => node.childForFieldName('function'))
          .filter((node) => node?.type === 'identifier')
          .map((node) => node?.text)
      ).toEqual(['async']);
      const identifiers = controlTree.rootNode.descendantsOfType([
        'identifier',
        'property_identifier',
        'shorthand_property_identifier',
        'statement_identifier',
      ]);
      expect(identifiers.every((node) => node.endIndex > node.startIndex)).toBe(true);
      expect(controlTree.rootNode.descendantsOfType('shorthand_property_identifier').map((node) => node.text)).toEqual([
        'async',
      ]);
    } finally {
      controlTree.delete();
    }
  } finally {
    parser.delete();
  }
});

test.each(['javascript', 'javascript_script'])(
  'keeps of as an async arrow parameter in %s expression contexts',
  async (goal) => {
    await Parser.init();
    const language = await Language.load(`tree-sitter-${goal}.wasm`);
    const parser = new Parser().setLanguage(language);
    try {
      for (const [before, after] of [
        ['consume(', ');'],
        ['switch(value) { case ', ': break; }'],
        ['flag ? ', ' : fallback;'],
        ['do work(); while (', ');'],
        ['const arrow = ', ';'],
        ['const array = [', '];'],
      ]) {
        for (const gap of [' ', ' /* same line */ ']) {
          for (const parameter of ['of', 'ofValue']) {
            const source = `${before}async${gap}${parameter} => of${after}\n${Following}`;
            const start = source.indexOf('async') + 5 + gap.length;
            const tree = parser.parse(source)!;
            try {
              expect(tree.rootNode.hasError, source).toBe(false);
              const arrow = tree.rootNode.descendantsOfType('arrow_function')[0]!;
              expect(arrow.text).toBe(`async${gap}${parameter} => of`);
              expect(arrow.children.find((node) => node.type === 'async')!.text).toBe('async');
              const binding = arrow.childForFieldName('parameter')!;
              expect(binding.text).toBe(parameter);
              expect(binding.childCount).toBe(0);
              expect(binding.startIndex).toBe(start);
              expect(binding.endIndex).toBe(start + parameter.length);
              expect(tree.rootNode.descendantsOfType('arrow_function')).toHaveLength(1);
              expect(tree.rootNode.lastNamedChild!.text).toBe(Following);
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
