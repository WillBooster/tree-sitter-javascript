// @ts-check

const { grammar } = /** @type {typeof globalThis & import('@willbooster/web-tree-sitter/dsl').DSL} */ (globalThis);

// oxlint-disable-next-line unicorn/prefer-module -- The CLI loads grammar extensions as CommonJS.
module.exports = grammar(require('../../grammar.js'), { name: 'javascript_script', rules: {} });
