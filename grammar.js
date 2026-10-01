/**
 * @file JavaScript grammar for tree-sitter
 * @author Max Brunsfeld <maxbrunsfeld@gmail.com>
 * @author Amaan Qureshi <amaanq12@gmail.com>
 * @license MIT
 */

/// <reference types="tree-sitter-cli/dsl" />
// @ts-check

// https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Lexical_grammar#reserved_words
const RESERVED_WORDS = [
  'break',
  'case',
  'catch',
  'class',
  'const',
  'continue',
  'debugger',
  'default',
  'delete',
  'do',
  'else',
  'export',
  'extends',
  'false',
  'finally',
  'for',
  'function',
  'if',
  'import',
  'in',
  'instanceof',
  'new',
  'null',
  'return',
  'super',
  'switch',
  'this',
  'throw',
  'true',
  'try',
  'typeof',
  'var',
  'void',
  'while',
  'with',
];
const NAMED_RESERVED_WORDS = new Set(['this', 'super', 'true', 'false', 'null']);

// Words that are keywords only in some positions and identifiers elsewhere.
const MEMBER_MODIFIERS = ['get', 'set', 'static'];
const CONTEXTUAL_KEYWORDS = ['async', 'await', 'export', 'let', 'using'];

// oxlint-disable-next-line unicorn/prefer-module -- This package is CommonJS, so tree-sitter loads grammar.js as CommonJS.
module.exports = grammar({
  name: 'javascript',

  externals: ($) => [
    $._automatic_semicolon,
    $._template_chars,
    $._ternary_qmark,
    $.html_comment,
    '||',
    // We use escape sequence and regex pattern to tell the scanner if we're currently inside a string or template string, in which case
    // it should NOT parse html comments.
    $.escape_sequence,
    $.regex_pattern,
    $.jsx_text,
    // Zero-width tokens after an arrow function's block body that a line break (or `}` or the end of input) follows:
    // such a function cannot be called, indexed, or used as an operand, so the statement ends there if it can. The
    // scanner inserts the automatic semicolon right after _arrow_function_block_end, or else emits
    // _arrow_function_block_continuation, since the arrow function may be, e.g., an argument.
    $._arrow_function_block_end,
    $._arrow_function_block_continuation,
    // Sentinels that the scanner never emits: the grammar allows each only where a line break has a fixed meaning, so
    // the scanner can tell from the valid symbols how to treat one there (see LineBreakRule in src/scanner.c). Each is an
    // alternative to what follows its position rather than an optional token before it, since an optional token would
    // duplicate the parse states after it.
    $._line_break_ends_statement,
    $._line_break_after_binding,
    $._line_break_after_field,
    $._line_break_after_modifier,
  ],

  extras: ($) => [$.comment, $.html_comment, /[\s\p{Zs}\uFEFF\u2028\u2029\u2060\u200B]/u],

  reserved: {
    global: () => RESERVED_WORDS,
    properties: () => [],
  },

  supertypes: ($) => [$.statement, $.declaration, $.expression, $.primary_expression, $.pattern],

  inline: ($) => [
    $._call_signature,
    $._formal_parameter,
    $._expressions,
    $._semicolon,
    $._identifier,
    $._reserved_identifier,
    $._jsx_attribute,
    $._jsx_element_name,
    $._jsx_child,
    $._jsx_element,
    $._jsx_attribute_name,
    $._jsx_attribute_value,
    $._jsx_identifier,
    $._lhs_expression,
  ],

  precedences: ($) => [
    [
      'member',
      'template_call',
      'call',
      $.update_expression,
      'unary_void',
      'binary_exp',
      'binary_times',
      'binary_plus',
      'binary_shift',
      'binary_compare',
      'binary_relation',
      'binary_equality',
      'bitwise_and',
      'bitwise_xor',
      'bitwise_or',
      'logical_and',
      'logical_or',
      'ternary',
      $.sequence_expression,
      $.arrow_function,
    ],
    ['assign', $.primary_expression],
    ['member', 'template_call', 'new', 'call', $.expression],
    ['declaration', 'literal'],
    [$.primary_expression, $.statement_block, 'object'],
    [$.meta_property, $.import],
    [$.import_statement, $.import],
    [$.export_statement, $.primary_expression],
    [$.lexical_declaration, $.primary_expression],
    [$.for_lexical_declaration, $.primary_expression],
  ],

  conflicts: ($) => [
    [$._local_export_specifier, $._module_export_name],
    [$.primary_expression, $._property_name],
    [$.primary_expression, $.await_expression],
    [$.primary_expression, $.await_expression, $._property_name],
    [$.primary_expression, $.arrow_function],
    [$.primary_expression, $.arrow_function, $._property_name],
    [$.primary_expression, $.method_definition],
    [$.primary_expression, $.rest_pattern],
    [$.primary_expression, $.pattern],
    [$.primary_expression, $._for_header],
    [$.array, $.array_pattern],
    [$.object, $.object_pattern],
    [$.assignment_expression, $.pattern],
    [$.assignment_expression, $.object_assignment_pattern],
    [$.labeled_statement, $._property_name],
    [$.computed_property_name, $.array],
    [$.binary_expression, $._initializer],
  ],

  word: ($) => $.identifier,

  rules: {
    program: ($) => seq(optional($.hash_bang_line), repeat($.statement)),

    hash_bang_line: () => /#![^\n\r\u2028\u2029]*/,

    //
    // Export declarations
    //

    export_statement: ($) =>
      choice(
        seq(
          'export',
          choice(
            seq('*', $._from_clause),
            seq($.namespace_export, $._from_clause),
            seq($.export_clause, $._from_clause),
            alias($._local_export_clause, $.export_clause)
          ),
          $._semicolon
        ),
        seq(
          repeat(field('decorator', $.decorator)),
          'export',
          choice(
            field('declaration', $.declaration),
            seq('default', choice(field('declaration', $.declaration), seq(field('value', $.expression), $._semicolon)))
          )
        )
      ),

    namespace_export: ($) => seq('*', 'as', $._module_export_name),

    export_clause: ($) => seq('{', commaSep($.export_specifier), optional(','), '}'),

    export_specifier: ($) =>
      seq(field('name', $._module_export_name), optional(seq('as', field('alias', $._module_export_name)))),

    // Without a `from` clause, each name refers to a local binding, which cannot be a reserved word.
    _local_export_clause: ($) =>
      seq('{', commaSep(alias($._local_export_specifier, $.export_specifier)), optional(','), '}'),

    _local_export_specifier: ($) =>
      seq(field('name', choice($.identifier, $.string)), optional(seq('as', field('alias', $._module_export_name)))),

    // Reserved words are listed as keywords rather than allowed through the property word set, because the word set
    // would also apply to the local bindings that share these positions until `as` or `from` (e.g. `import { if }`).
    _module_export_name: ($) =>
      choice(
        $.identifier,
        $.string,
        // `this`, `super`, `true`, `false`, and `null` are named rules, and a bare string would make them non-terminals.
        alias(choice(...RESERVED_WORDS.map((word) => (NAMED_RESERVED_WORDS.has(word) ? $[word] : word))), $.identifier)
      ),

    declaration: ($) =>
      choice(
        $.function_declaration,
        $.generator_function_declaration,
        $.class_declaration,
        $.lexical_declaration,
        $.variable_declaration,
        $.using_declaration
      ),

    //
    // Import declarations
    //

    import: () => token('import'),

    import_statement: ($) =>
      seq(
        'import',
        choice(seq($.import_clause, $._from_clause), field('source', $.string)),
        optional($.import_attribute),
        $._semicolon
      ),

    import_clause: ($) =>
      choice(
        $.namespace_import,
        $.named_imports,
        seq($.identifier, optional(seq(',', choice($.namespace_import, $.named_imports))))
      ),

    _from_clause: ($) => seq('from', field('source', $.string)),

    namespace_import: ($) => seq('*', 'as', $.identifier),

    named_imports: ($) => seq('{', commaSep($.import_specifier), optional(','), '}'),

    import_specifier: ($) =>
      choice(
        field('name', $.identifier),
        seq(field('name', $._module_export_name), 'as', field('alias', $.identifier))
      ),

    import_attribute: ($) => seq('with', $.object),

    //
    // Statements
    //

    statement: ($) =>
      choice(
        $.export_statement,
        $.import_statement,
        $.debugger_statement,
        $.expression_statement,
        $.declaration,
        $.statement_block,

        $.if_statement,
        $.switch_statement,
        $.for_statement,
        $.for_in_statement,
        $.while_statement,
        $.do_statement,
        $.try_statement,
        $.with_statement,

        $.break_statement,
        $.continue_statement,
        $.return_statement,
        $.throw_statement,
        $.empty_statement,
        $.labeled_statement
      ),

    expression_statement: ($) => seq($._expressions, $._semicolon),

    variable_declaration: ($) => seq('var', commaSep1($.variable_declarator), $._semicolon),

    lexical_declaration: ($) =>
      seq(field('kind', choice('let', 'const')), commaSep1($.variable_declarator), $._semicolon),

    using_declaration: ($) =>
      seq(
        field('kind', choice('using', seq('await', 'using'))),
        commaSep1(alias($._using_declarator, $.variable_declarator)),
        $._semicolon
      ),

    _using_declarator: ($) =>
      seq(field('name', choice($.identifier, alias('of', $.identifier))), optional($._initializer)),

    variable_declarator: ($) =>
      seq(
        field('name', choice($.identifier, alias('of', $.identifier), $._destructuring_pattern)),
        optional(choice($._initializer, $._line_break_after_binding))
      ),

    statement_block: ($) => prec.right(seq('{', repeat($.statement), '}', optional($._automatic_semicolon))),

    else_clause: ($) => seq('else', $.statement),

    if_statement: ($) =>
      prec.right(
        seq(
          'if',
          field('condition', $.parenthesized_expression),
          field('consequence', $.statement),
          optional(field('alternative', $.else_clause))
        )
      ),

    switch_statement: ($) => seq('switch', field('value', $.parenthesized_expression), field('body', $.switch_body)),

    for_statement: ($) =>
      seq(
        'for',
        '(',
        $._for_initializer,
        $._for_condition,
        field('increment', optional($._expressions)),
        ')',
        field('body', $.statement)
      ),

    // Extracted into rules because tree-sitter expands a `choice` written inline in the `seq` above into one production
    // per alternative, each repeating the parse states of the rest of the header (about 30 KB of Wasm). They are hidden
    // so that `initializer` and `condition` stay fields of `for_statement` and no node type is added.
    _for_initializer: ($) =>
      choice(
        field(
          'initializer',
          choice(
            alias($.for_lexical_declaration, $.lexical_declaration),
            alias($.for_variable_declaration, $.variable_declaration),
            alias($._for_using_declaration, $.using_declaration)
          )
        ),
        seq(field('initializer', $._expressions), ';'),
        field('initializer', $.empty_statement)
      ),

    _for_condition: ($) => field('condition', choice(seq($._expressions, ';'), $.empty_statement)),

    // ECMAScript inserts no semicolon inside a for header, so these declarations end only with `;`. Accepting an
    // automatic semicolon there made `for (let x\n of y)` ambiguous until `of`, and an incremental reparse could
    // reuse a declaration built when that ambiguity was resolved differently.
    for_lexical_declaration: ($) => seq(field('kind', choice('let', 'const')), commaSep1($.variable_declarator), ';'),

    for_variable_declaration: ($) => seq('var', commaSep1($.variable_declarator), ';'),

    _for_using_declaration: ($) =>
      seq(
        field('kind', choice('using', seq('await', 'using'))),
        commaSep1(alias($._using_declarator, $.variable_declarator)),
        ';'
      ),

    for_in_statement: ($) => seq('for', optional('await'), $._for_header, field('body', $.statement)),

    _for_header: ($) =>
      seq(
        '(',
        choice(
          field('left', choice($._lhs_expression, $.parenthesized_expression)),
          seq(
            field('kind', 'var'),
            field('left', choice($.identifier, alias('of', $.identifier), $._destructuring_pattern)),
            optional($._initializer)
          ),
          seq(
            field('kind', choice('let', 'const')),
            field('left', choice($.identifier, alias('of', $.identifier), $._destructuring_pattern))
          ),
          seq(
            field('kind', choice('using', seq('await', 'using'))),
            field('left', choice($.identifier, alias('of', $.identifier)))
          )
        ),
        field('operator', choice('in', 'of')),
        field('right', $._expressions),
        ')'
      ),

    while_statement: ($) => seq('while', field('condition', $.parenthesized_expression), field('body', $.statement)),

    do_statement: ($) =>
      prec.right(
        seq(
          'do',
          field('body', $.statement),
          'while',
          field('condition', $.parenthesized_expression),
          optional($._semicolon)
        )
      ),

    try_statement: ($) =>
      seq(
        'try',
        field('body', $.statement_block),
        optional(field('handler', $.catch_clause)),
        optional(field('finalizer', $.finally_clause))
      ),

    with_statement: ($) => seq('with', field('object', $.parenthesized_expression), field('body', $.statement)),

    break_statement: ($) =>
      seq(
        'break',
        field('label', optional(alias($.identifier, $.statement_identifier))),
        choice($._semicolon, $._line_break_ends_statement)
      ),

    continue_statement: ($) =>
      seq(
        'continue',
        field('label', optional(alias($.identifier, $.statement_identifier))),
        choice($._semicolon, $._line_break_ends_statement)
      ),

    debugger_statement: ($) => seq('debugger', choice($._semicolon, $._line_break_ends_statement)),

    return_statement: ($) =>
      seq('return', choice(seq(optional($._expressions), $._semicolon), $._line_break_ends_statement)),

    throw_statement: ($) => seq('throw', $._expressions, $._semicolon),

    empty_statement: () => ';',

    labeled_statement: ($) =>
      prec.dynamic(
        -1,
        seq(
          field('label', alias(choice($.identifier, $._reserved_identifier), $.statement_identifier)),
          ':',
          field('body', $.statement)
        )
      ),

    //
    // Statement components
    //

    switch_body: ($) => seq('{', repeat(choice($.switch_case, $.switch_default)), '}'),

    switch_case: ($) => seq('case', field('value', $._expressions), ':', field('body', repeat($.statement))),

    switch_default: ($) => seq('default', ':', field('body', repeat($.statement))),

    catch_clause: ($) =>
      seq(
        'catch',
        optional(seq('(', field('parameter', choice($.identifier, $._destructuring_pattern)), ')')),
        field('body', $.statement_block)
      ),

    finally_clause: ($) => seq('finally', field('body', $.statement_block)),

    parenthesized_expression: ($) => seq('(', $._expressions, ')'),

    //
    // Expressions
    //
    _expressions: ($) => choice($.expression, $.sequence_expression),

    expression: ($) =>
      choice(
        $.primary_expression,
        $._jsx_element,
        $.assignment_expression,
        $.augmented_assignment_expression,
        $.await_expression,
        $.unary_expression,
        $.binary_expression,
        $.ternary_expression,
        $.update_expression,
        $.new_expression,
        $.yield_expression
      ),

    primary_expression: ($) =>
      choice(
        $.subscript_expression,
        $.member_expression,
        $.parenthesized_expression,
        $._identifier,
        alias($._reserved_identifier, $.identifier),
        $.this,
        $.super,
        $.number,
        $.string,
        $.template_string,
        $.regex,
        $.true,
        $.false,
        $.null,
        $.object,
        $.array,
        $.function_expression,
        $.arrow_function,
        $.generator_function,
        $.class,
        $.meta_property,
        $.call_expression
      ),

    yield_expression: ($) =>
      prec.right(seq('yield', choice(seq('*', $.expression), optional($.expression), $._line_break_ends_statement))),

    object: ($) =>
      prec(
        'object',
        seq(
          '{',
          commaSep(
            optional(
              choice(
                $.pair,
                $.spread_element,
                $.method_definition,
                alias(choice($.identifier, $._reserved_identifier), $.shorthand_property_identifier)
              )
            )
          ),
          '}'
        )
      ),

    object_pattern: ($) =>
      prec(
        'object',
        seq(
          '{',
          commaSep(
            optional(
              choice(
                $.pair_pattern,
                $.rest_pattern,
                $.object_assignment_pattern,
                alias(choice($.identifier, $._reserved_identifier), $.shorthand_property_identifier_pattern)
              )
            )
          ),
          '}'
        )
      ),

    assignment_pattern: ($) => seq(field('left', $.pattern), '=', field('right', $.expression)),

    object_assignment_pattern: ($) =>
      seq(
        field(
          'left',
          choice(
            alias(choice($._reserved_identifier, $.identifier), $.shorthand_property_identifier_pattern),
            $._destructuring_pattern
          )
        ),
        '=',
        field('right', $.expression)
      ),

    array: ($) => seq('[', commaSep(optional(choice($.expression, $.spread_element))), ']'),

    array_pattern: ($) => seq('[', commaSep(optional(choice($.pattern, $.assignment_pattern))), ']'),

    _jsx_element: ($) => choice($.jsx_element, $.jsx_self_closing_element),

    jsx_element: ($) =>
      seq(field('open_tag', $.jsx_opening_element), repeat($._jsx_child), field('close_tag', $.jsx_closing_element)),

    // An entity can be named, numeric (decimal), or numeric (hexadecimal). The
    // longest entity name is 29 characters long, and the HTML spec says that
    // no more will ever be added.
    html_character_reference: () => /&(#([xX][0-9a-fA-F]{1,6}|[0-9]{1,5})|[A-Za-z]{1,30});/,

    jsx_expression: ($) => seq('{', optional(choice($.expression, $.sequence_expression, $.spread_element)), '}'),

    _jsx_child: ($) => choice($.jsx_text, $.html_character_reference, $._jsx_element, $.jsx_expression),

    jsx_opening_element: ($) =>
      prec.dynamic(
        -1,
        seq('<', optional(seq(field('name', $._jsx_element_name), repeat(field('attribute', $._jsx_attribute)))), '>')
      ),

    jsx_identifier: () => /[a-zA-Z_$][a-zA-Z\d_$]*-[a-zA-Z\d_$-]*/,

    _jsx_identifier: ($) => choice(alias($.jsx_identifier, $.identifier), reserved('properties', $.identifier)),

    nested_identifier: ($) =>
      prec(
        'member',
        seq(
          field(
            'object',
            choice(reserved('properties', $.identifier), alias($.nested_identifier, $.member_expression))
          ),
          '.',
          field('property', alias(reserved('properties', $.identifier), $.property_identifier))
        )
      ),

    jsx_namespace_name: ($) => seq($._jsx_identifier, ':', $._jsx_identifier),

    _jsx_element_name: ($) =>
      choice($._jsx_identifier, alias($.nested_identifier, $.member_expression), $.jsx_namespace_name),

    jsx_closing_element: ($) => seq('</', optional(field('name', $._jsx_element_name)), '>'),

    jsx_self_closing_element: ($) =>
      seq('<', field('name', $._jsx_element_name), repeat(field('attribute', $._jsx_attribute)), '/>'),

    _jsx_attribute: ($) => choice($.jsx_attribute, $.jsx_expression),

    _jsx_attribute_name: ($) => choice(alias($._jsx_identifier, $.property_identifier), $.jsx_namespace_name),

    jsx_attribute: ($) => seq($._jsx_attribute_name, optional(seq('=', $._jsx_attribute_value))),

    _jsx_string: ($) =>
      choice(
        seq(
          '"',
          repeat(
            choice(
              alias($.unescaped_double_jsx_string_fragment, $.string_fragment),
              $.html_character_reference,
              alias($._jsx_string_ampersand, $.string_fragment)
            )
          ),
          '"'
        ),
        seq(
          "'",
          repeat(
            choice(
              alias($.unescaped_single_jsx_string_fragment, $.string_fragment),
              $.html_character_reference,
              alias($._jsx_string_ampersand, $.string_fragment)
            )
          ),
          "'"
        )
      ),

    // Workaround to https://github.com/tree-sitter/tree-sitter/issues/1156
    // We give names to the token() constructs containing a regexp
    // so as to obtain a node in the CST.
    //
    unescaped_double_jsx_string_fragment: () => token.immediate(prec(1, /([^"&]|&[^#A-Za-z"&])+/)),

    // same here
    unescaped_single_jsx_string_fragment: () => token.immediate(prec(1, /([^'&]|&[^#A-Za-z'&])+/)),

    // An `&` that does not start a complete html_character_reference is a literal character, as in HTML. The lexer
    // prefers the longer html_character_reference when one follows.
    _jsx_string_ampersand: () => token.immediate(/&/),

    _jsx_attribute_value: ($) => choice(alias($._jsx_string, $.string), $.jsx_expression, $._jsx_element),

    class: ($) =>
      prec(
        'literal',
        seq(
          repeat(field('decorator', $.decorator)),
          'class',
          field('name', optional($.identifier)),
          optional($.class_heritage),
          field('body', $.class_body)
        )
      ),

    class_declaration: ($) =>
      prec(
        'declaration',
        seq(
          repeat(field('decorator', $.decorator)),
          'class',
          field('name', $.identifier),
          optional($.class_heritage),
          field('body', $.class_body),
          optional($._automatic_semicolon)
        )
      ),

    class_heritage: ($) => seq('extends', $.expression),

    function_expression: ($) =>
      prec(
        'literal',
        seq(
          optional('async'),
          'function',
          field('name', optional($.identifier)),
          $._call_signature,
          field('body', $.statement_block)
        )
      ),

    function_declaration: ($) =>
      prec.right(
        'declaration',
        seq(
          optional('async'),
          'function',
          field('name', $.identifier),
          $._call_signature,
          field('body', $.statement_block),
          optional($._automatic_semicolon)
        )
      ),

    generator_function: ($) =>
      prec(
        'literal',
        seq(
          optional('async'),
          'function',
          '*',
          field('name', optional($.identifier)),
          $._call_signature,
          field('body', $.statement_block)
        )
      ),

    generator_function_declaration: ($) =>
      prec.right(
        'declaration',
        seq(
          optional('async'),
          'function',
          '*',
          field('name', $.identifier),
          $._call_signature,
          field('body', $.statement_block),
          optional($._automatic_semicolon)
        )
      ),

    arrow_function: ($) =>
      seq(
        optional('async'),
        choice(
          field('parameter', choice(alias($._reserved_identifier, $.identifier), $.identifier)),
          $._call_signature
        ),
        '=>',
        choice(
          field('body', $.expression),
          seq(
            field('body', $.statement_block),
            optional(seq($._arrow_function_block_end, optional($._arrow_function_block_continuation)))
          )
        )
      ),

    // Override
    _call_signature: ($) => field('parameters', $.formal_parameters),
    _formal_parameter: ($) => choice($.pattern, $.assignment_pattern),

    optional_chain: () => '?.',

    call_expression: ($) =>
      choice(
        prec('call', seq(field('function', choice($.expression, $.import)), field('arguments', $.arguments))),
        prec(
          'template_call',
          seq(field('function', choice($.primary_expression, $.new_expression)), field('arguments', $.template_string))
        ),
        prec(
          'member',
          seq(
            field('function', $.primary_expression),
            field('optional_chain', $.optional_chain),
            field('arguments', $.arguments)
          )
        )
      ),

    new_expression: ($) =>
      prec.right(
        'new',
        seq(
          'new',
          field('constructor', choice($.primary_expression, $.new_expression)),
          field('arguments', optional(prec.dynamic(1, $.arguments)))
        )
      ),

    await_expression: ($) => prec.dynamic(2, prec('unary_void', seq('await', $.expression))),

    member_expression: ($) =>
      prec(
        'member',
        seq(
          field('object', choice($.expression, $.primary_expression, $.import)),
          choice('.', field('optional_chain', $.optional_chain)),
          field(
            'property',
            choice($.private_property_identifier, reserved('properties', alias($.identifier, $.property_identifier)))
          )
        )
      ),

    subscript_expression: ($) =>
      prec.right(
        'member',
        seq(
          field('object', choice($.expression, $.primary_expression)),
          optional(field('optional_chain', $.optional_chain)),
          '[',
          field('index', $._expressions),
          ']'
        )
      ),

    _lhs_expression: ($) =>
      choice(
        $.member_expression,
        $.subscript_expression,
        $._identifier,
        alias($._reserved_identifier, $.identifier),
        $._destructuring_pattern
      ),

    assignment_expression: ($) =>
      prec.right(
        'assign',
        seq(field('left', choice($.parenthesized_expression, $._lhs_expression)), '=', field('right', $.expression))
      ),

    _augmented_assignment_lhs: ($) =>
      choice(
        $.member_expression,
        $.subscript_expression,
        alias($._reserved_identifier, $.identifier),
        $.identifier,
        $.parenthesized_expression
      ),

    augmented_assignment_expression: ($) =>
      prec.right(
        'assign',
        seq(
          field('left', $._augmented_assignment_lhs),
          field(
            'operator',
            choice('+=', '-=', '*=', '/=', '%=', '^=', '&=', '|=', '>>=', '>>>=', '<<=', '**=', '&&=', '||=', '??=')
          ),
          field('right', $.expression)
        )
      ),

    _initializer: ($) => seq('=', field('value', $.expression)),

    _destructuring_pattern: ($) => choice($.object_pattern, $.array_pattern),

    spread_element: ($) => seq('...', $.expression),

    ternary_expression: ($) =>
      prec.right(
        'ternary',
        seq(
          field('condition', $.expression),
          alias($._ternary_qmark, '?'),
          field('consequence', $.expression),
          ':',
          field('alternative', $.expression)
        )
      ),

    binary_expression: ($) =>
      choice(
        ...[
          ['&&', 'logical_and'],
          ['||', 'logical_or'],
          ['>>', 'binary_shift'],
          ['>>>', 'binary_shift'],
          ['<<', 'binary_shift'],
          ['&', 'bitwise_and'],
          ['^', 'bitwise_xor'],
          ['|', 'bitwise_or'],
          ['+', 'binary_plus'],
          ['-', 'binary_plus'],
          ['*', 'binary_times'],
          ['/', 'binary_times'],
          ['%', 'binary_times'],
          ['**', 'binary_exp', 'right'],
          ['<', 'binary_relation'],
          ['<=', 'binary_relation'],
          ['==', 'binary_equality'],
          ['===', 'binary_equality'],
          ['!=', 'binary_equality'],
          ['!==', 'binary_equality'],
          ['>=', 'binary_relation'],
          ['>', 'binary_relation'],
          ['??', 'ternary'],
          ['instanceof', 'binary_relation'],
          ['in', 'binary_relation'],
        ].map(([operator, precedence, associativity]) =>
          // oxlint-disable-next-line typescript/unbound-method -- prec.left and prec.right do not use `this`.
          (associativity === 'right' ? prec.right : prec.left)(
            precedence,
            seq(
              field('left', operator === 'in' ? choice($.expression, $.private_property_identifier) : $.expression),
              field('operator', operator),
              field('right', $.expression)
            )
          )
        )
      ),

    unary_expression: ($) =>
      prec.left(
        'unary_void',
        seq(field('operator', choice('!', '~', '-', '+', 'typeof', 'void', 'delete')), field('argument', $.expression))
      ),

    update_expression: ($) =>
      prec.left(
        choice(
          seq(field('argument', $.expression), field('operator', choice('++', '--'))),
          seq(field('operator', choice('++', '--')), field('argument', $.expression))
        )
      ),

    sequence_expression: ($) => prec.right(commaSep1($.expression)),

    //
    // Primitives
    //

    string: ($) =>
      choice(
        seq('"', repeat(choice(alias($.unescaped_double_string_fragment, $.string_fragment), $.escape_sequence)), '"'),
        seq("'", repeat(choice(alias($.unescaped_single_string_fragment, $.string_fragment), $.escape_sequence)), "'")
      ),

    // Workaround to https://github.com/tree-sitter/tree-sitter/issues/1156
    // We give names to the token() constructs containing a regexp
    // so as to obtain a node in the CST.
    //
    unescaped_double_string_fragment: () => token.immediate(prec(1, /[^"\\\r\n]+/)),

    // same here
    unescaped_single_string_fragment: () => token.immediate(prec(1, /[^'\\\r\n]+/)),

    escape_sequence: () =>
      token.immediate(
        seq('\\', choice(/[^xu0-7]/, /[0-7]{1,3}/, /x[0-9a-fA-F]{2}/, /u[0-9a-fA-F]{4}/, /u\{[0-9a-fA-F]+\}/, /\r\n/))
      ),

    // http://stackoverflow.com/questions/13014947/regex-to-match-a-c-style-multiline-comment/36328890#36328890
    comment: () => token(choice(seq('//', /[^\r\n\u2028\u2029]*/), seq('/*', /[^*]*\*+([^/*][^*]*\*+)*/, '/'))),

    template_string: ($) =>
      seq(
        '`',
        repeat(
          choice(
            alias($._template_chars, $.string_fragment),
            $.escape_sequence,
            alias($._invalid_template_escape, $.escape_sequence),
            $.template_substitution
          )
        ),
        '`'
      ),

    // Tagged templates allow `\x` and `\u` without the hex digits an escape_sequence needs (the cooked string is
    // undefined). The lexer prefers the longer escape_sequence when the digits follow. Untagged templates reject these
    // escapes, but the lexer cannot tell the two apart.
    _invalid_template_escape: () => token.immediate(seq('\\', /[xu]/)),

    template_substitution: ($) => seq('${', $._expressions, '}'),

    regex: ($) =>
      seq(
        '/',
        field('pattern', $.regex_pattern),
        token.immediate(prec(1, '/')),
        optional(field('flags', $.regex_flags))
      ),

    regex_pattern: () =>
      token.immediate(
        prec(
          -1,
          repeat1(
            choice(
              seq(
                '[',
                repeat(
                  choice(
                    seq('\\', /[^\n\r\u2028\u2029]/), // escaped character
                    /[^\]\\\n\r\u2028\u2029]/ // any character besides ']', '\', or a line terminator
                  )
                ),
                ']'
              ), // square-bracket-delimited character class
              seq('\\', /[^\n\r\u2028\u2029]/), // escaped character
              // oxlint-disable-next-line no-useless-escape -- tree-sitter's regex parser rejects an unescaped `[` in a character class.
              /[^/\\\[\n\r\u2028\u2029]/ // any character besides '[', '\', '/', or a line terminator
            )
          )
        )
      ),

    regex_flags: () => token.immediate(/[a-z]+/),

    number: () => {
      const hexLiteral = seq(choice('0x', '0X'), /[\da-fA-F](_?[\da-fA-F])*/);

      const decimalDigits = /\d(_?\d)*/;
      const signedInteger = seq(optional(choice('-', '+')), decimalDigits);
      const exponentPart = seq(choice('e', 'E'), signedInteger);

      const binaryLiteral = seq(choice('0b', '0B'), /[0-1](_?[0-1])*/);

      const octalLiteral = seq(choice('0o', '0O'), /[0-7](_?[0-7])*/);

      const bigintLiteral = seq(choice(hexLiteral, binaryLiteral, octalLiteral, decimalDigits), 'n');

      const decimalIntegerLiteral = choice(
        '0',
        seq(optional('0'), /[1-9]/, optional(seq(optional('_'), decimalDigits)))
      );

      const decimalLiteral = choice(
        seq(decimalIntegerLiteral, '.', optional(decimalDigits), optional(exponentPart)),
        seq('.', decimalDigits, optional(exponentPart)),
        seq(decimalIntegerLiteral, exponentPart),
        decimalDigits
      );

      return token(choice(hexLiteral, decimalLiteral, binaryLiteral, octalLiteral, bigintLiteral));
    },

    // 'undefined' is syntactically a regular identifier in JavaScript.
    // However, its main use is as the read-only global variable whose
    // value is [undefined], for which there's no literal representation
    // unlike 'null'. We gave it its own rule so it's easy to
    // highlight in text editors and other applications.
    _identifier: ($) => choice($.undefined, $.identifier),

    identifier: () => {
      const alpha =
        // oxlint-disable-next-line no-control-regex, no-useless-escape -- Identifiers exclude control characters, and tree-sitter's regex parser rejects an unescaped `[` in a character class.
        /[^\u0000-\u001F\s\p{Zs}0-9:;`"'@#.,|^&<=>+\-*/\\%?!~()\[\]{}\uFEFF\u2060\u200B\u2028\u2029]|\\u[0-9a-fA-F]{4}|\\u\{[0-9a-fA-F]+\}/u;

      const alphanumeric =
        // oxlint-disable-next-line no-control-regex, no-useless-escape -- Identifiers exclude control characters, and tree-sitter's regex parser rejects an unescaped `[` in a character class.
        /[^\u0000-\u001F\s\p{Zs}:;`"'@#.,|^&<=>+\-*/\\%?!~()\[\]{}\uFEFF\u2060\u200B\u2028\u2029]|\\u[0-9a-fA-F]{4}|\\u\{[0-9a-fA-F]+\}/u;
      return token(seq(alpha, repeat(alphanumeric)));
    },

    private_property_identifier: () => {
      const alpha =
        // oxlint-disable-next-line no-control-regex, no-useless-escape -- Identifiers exclude control characters, and tree-sitter's regex parser rejects an unescaped `[` in a character class.
        /[^\u0000-\u001F\s\p{Zs}0-9:;`"'@#.,|^&<=>+\-*/\\%?!~()\[\]{}\uFEFF\u2060\u200B\u2028\u2029]|\\u[0-9a-fA-F]{4}|\\u\{[0-9a-fA-F]+\}/u;

      const alphanumeric =
        // oxlint-disable-next-line no-control-regex, no-useless-escape -- Identifiers exclude control characters, and tree-sitter's regex parser rejects an unescaped `[` in a character class.
        /[^\u0000-\u001F\s\p{Zs}:;`"'@#.,|^&<=>+\-*/\\%?!~()\[\]{}\uFEFF\u2060\u200B\u2028\u2029]|\\u[0-9a-fA-F]{4}|\\u\{[0-9a-fA-F]+\}/u;
      return token(seq('#', alpha, repeat(alphanumeric)));
    },

    meta_property: () => choice(seq('new', '.', 'target'), seq('import', '.', 'meta')),

    this: () => 'this',
    super: () => 'super',
    true: () => 'true',
    false: () => 'false',
    null: () => 'null',
    undefined: () => 'undefined',

    //
    // Expression components
    //

    arguments: ($) => seq('(', commaSep(optional(choice($.expression, $.spread_element))), ')'),

    decorator: ($) =>
      seq(
        '@',
        choice(
          $.identifier,
          alias($.decorator_member_expression, $.member_expression),
          alias($.decorator_call_expression, $.call_expression),
          alias($.decorator_parenthesized_expression, $.parenthesized_expression)
        )
      ),

    decorator_member_expression: ($) =>
      prec(
        'member',
        seq(
          field('object', choice($.identifier, alias($.decorator_member_expression, $.member_expression))),
          '.',
          field(
            'property',
            choice(reserved('properties', alias($.identifier, $.property_identifier)), $.private_property_identifier)
          )
        )
      ),

    decorator_parenthesized_expression: ($) => seq('(', $._expressions, ')'),

    decorator_call_expression: ($) =>
      prec(
        'call',
        seq(
          field('function', choice($.identifier, alias($.decorator_member_expression, $.member_expression))),
          field('arguments', $.arguments)
        )
      ),

    class_body: ($) =>
      seq(
        '{',
        repeat(
          choice(
            seq(field('member', $.method_definition), optional(';')),
            seq(field('member', $.field_definition), $._semicolon),
            field('member', $.class_static_block),
            ';'
          )
        ),
        '}'
      ),

    field_definition: ($) =>
      seq(
        repeat(field('decorator', $.decorator)),
        choice(
          seq(
            optional('static'),
            choice(
              seq(field('property', $._field_name), optional(choice($._initializer, $._line_break_after_field))),
              // A line break after `get` or `set` continues a getter or setter. Allowing both sentinels here tells
              // the scanner that a `*` on the next line cannot continue the member, unlike after `static`.
              seq(
                field('property', alias(choice('get', 'set'), $.property_identifier)),
                optional(choice($._initializer, $._line_break_after_modifier, $._line_break_after_field))
              )
            )
          ),
          // A line break after a leading `static` continues a static member; after `static static`, it ends the field.
          seq(
            field('property', alias('static', $.property_identifier)),
            optional(choice($._initializer, $._line_break_after_modifier))
          ),
          seq(
            'static',
            field('property', alias('static', $.property_identifier)),
            optional(choice($._initializer, $._line_break_after_field))
          )
        )
      ),

    formal_parameters: ($) => seq('(', optional(seq(commaSep1($._formal_parameter), optional(','))), ')'),

    class_static_block: ($) => seq('static', field('body', alias($._class_member_body, $.statement_block))),

    // This negative dynamic precedence ensures that during error recovery,
    // unfinished constructs are generally treated as literal expressions,
    // not patterns.
    pattern: ($) => prec.dynamic(-1, choice($._lhs_expression, $.rest_pattern)),

    rest_pattern: ($) => prec.right(seq('...', $._lhs_expression)),

    method_definition: ($) =>
      seq(
        repeat(field('decorator', $.decorator)),
        optional('static'),
        optional('async'),
        optional(choice('get', 'set', '*')),
        field('name', $._property_name),
        field('parameters', $.formal_parameters),
        field('body', alias($._class_member_body, $.statement_block))
      ),

    // The body of a method or a static block, a rule of its own rather than statement_block: sharing it let tree-sitter
    // merge the state after the body's `}` with the one after a function expression's `}`, where `in`, `instanceof`,
    // and `extends` are keywords, so a class member with one of those names could not follow.
    _class_member_body: ($) => seq('{', repeat($.statement), '}'),

    pair: ($) => seq(field('key', $._property_name), ':', field('value', $.expression)),

    pair_pattern: ($) =>
      seq(field('key', $._property_name), ':', field('value', choice($.pattern, $.assignment_pattern))),

    _field_name: ($) =>
      reserved(
        'properties',
        choice(
          alias(choice($.identifier, ...CONTEXTUAL_KEYWORDS), $.property_identifier),
          $.private_property_identifier,
          $.string,
          $.number,
          $.computed_property_name
        )
      ),

    _property_name: ($) =>
      reserved(
        'properties',
        choice(
          alias(choice($.identifier, $._reserved_identifier), $.property_identifier),
          $.private_property_identifier,
          $.string,
          $.number,
          $.computed_property_name
        )
      ),

    computed_property_name: ($) => seq('[', $.expression, ']'),

    _reserved_identifier: () => choice(...MEMBER_MODIFIERS, ...CONTEXTUAL_KEYWORDS),

    _semicolon: ($) => choice($._automatic_semicolon, ';'),
  },
});

/**
 * Creates a rule to match one or more of the rules separated by a comma
 *
 * @param {Rule} rule
 *
 * @returns {SeqRule}
 */
function commaSep1(rule) {
  return seq(rule, repeat(seq(',', rule)));
}

/**
 * Creates a rule to optionally match one or more of the rules separated by a comma
 *
 * @param {Rule} rule
 *
 * @returns {ChoiceRule}
 */
function commaSep(rule) {
  return optional(commaSep1(rule));
}
