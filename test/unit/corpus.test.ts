import { testCommand } from './run.js';

testCommand('parses the corpus in test/corpus as expected', ['script/tree-sitter', 'test'], 300_000);

testCommand(
  'compiles both scanners as C11',
  [
    'cc',
    '-std=c11',
    '-pedantic-errors',
    '-Wno-strict-prototypes',
    '-Isrc',
    '-fsyntax-only',
    'src/scanner.c',
    'grammars/script/src/scanner.c',
  ],
  60_000
);
