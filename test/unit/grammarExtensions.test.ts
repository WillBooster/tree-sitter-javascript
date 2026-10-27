import { testCommand } from './run.js';

testCommand(
  'preserves derived array/formal rest overrides and object-rest syntax/target hooks',
  ['node', 'test/helpers/grammarExtensions.mjs'],
  120_000,
  {
    check: (output) => {
      process.stdout.write(output);
    },
  }
);
