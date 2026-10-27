/**
 * @file JavaScript grammar for tree-sitter
 * @author Max Brunsfeld <maxbrunsfeld@gmail.com>
 * @author Amaan Qureshi <amaanq12@gmail.com>
 * @license MIT
 */

// @ts-check

// The CLI injects the DSL before loading this CommonJS grammar.
const { grammar, alias, choice, field, optional, prec, repeat, repeat1, seq, sym, token, reserved } =
  /** @type {typeof globalThis & import('@willbooster/web-tree-sitter/dsl').DSL} */ (globalThis);

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
const CONTEXTUAL_KEYWORDS = ['async', 'await', 'let', 'of', 'using'];
const CLASSIC_ASSIGNMENT_OPERATORS = ['+=', '-=', '*=', '/=', '%=', '^=', '&=', '|=', '>>=', '>>>=', '<<=', '**='];

// oxlint-disable-next-line unicorn/prefer-module -- This package is CommonJS, so tree-sitter loads grammar.js as CommonJS.
module.exports = grammar({
  name: 'javascript',

  externals: () => [
    sym('_automatic_semicolon'),
    sym('_template_chars'),
    sym('_ternary_qmark'),
    sym('html_comment'),
    '||',
    // We use escape sequence and regex pattern to tell the scanner if we're currently inside a string or template string, in which case
    // it should NOT parse html comments.
    sym('escape_sequence'),
    sym('regex_pattern'),
    sym('jsx_text'),
    // Zero-width tokens after an arrow function's block body that a line break (or `}` or the end of input) follows:
    // such a function cannot be called, indexed, or used as an operand, so the statement ends there if it can. The
    // scanner inserts the automatic semicolon right after _arrow_function_block_end, or else emits
    // _arrow_function_block_continuation, since the arrow function may be, e.g., an argument.
    sym('_arrow_function_block_end'),
    sym('_arrow_function_block_continuation'),
    // Bindings emit a boundary to preserve reuse; the other flags only select a scanner line-break rule.
    // Keep those flags alternatives to what follows: leading optional flags duplicate parse states.
    sym('_line_break_ends_statement'),
    sym('_line_break_after_binding'),
    sym('_line_break_after_field'),
    sym('_line_break_after_modifier'),
    sym('_line_break_before_attributes'),
    // Emitted outside statement nodes to preserve their body ranges before trailing comments.
    sym('_statement_boundary'),
    // Await flags are optional exceptions: replacing a required operand with a flag makes its published child optional.
    // Never emitted: marks the direct await operand start for line-break and identifier lexing.
    sym('_line_break_after_await'),
    // Preserves operand and identifier-statement paths before a following brace or identifier-headed expression.
    sym('_await_identifier_line_break'),
    // Emitted zero-width boundaries retain canonical expression supertype paths for public queries.
    sym('_await_operand_end'),
    // Never emitted: a completed direct arrow cannot serve as an await operand.
    sym('_completed_arrow_function'),
    // Emitted identifier token at the direct await-operand start, preserving normal yield parsing elsewhere.
    sym('_await_yield_identifier'),
    // Emitted zero-width decision preserves direct operands and identifier statements before yield.
    sym('_await_yield_identifier_start'),
    sym('_await_yield_identifier_context'),
    // Emitted zero-width after a postfix update; carries the pending statement boundary across reuse.
    sym('_postfix_update_end'),
    sym('_await_keyword'),
    sym('_let'),
    sym('_single_statement_context'),
    sym('_resource_binding_start'),
    sym('_resource_binding_continuation'),
    sym('_plain_resource_for_of_context'),
    sym('_export_default'),
    sym('_export_default_declaration'),
    sym('_default_declaration_start'),
    sym('_regex_flags_start'),
    sym('_argumentless_new_end'),
    sym('_constructor_async_function_start'),
    sym('_sync_function_start'),
    sym('_async_function_start'),
    sym('_function_context_end'),
    sym('_arrow_context_end'),
    sym('_await_identifier'),
    sym('_generator_function_start'),
    sym('_async_generator_function_start'),
    sym('_yield_keyword'),
    sym('_yield_identifier'),
    sym('_function_signature_start'),
    sym('_async_function_signature_start'),
    sym('_call_arguments_context'),
    sym('_async_keyword'),
    sym('_line_break_before_from'),
  ],

  extras: ($) => [$.comment, sym('html_comment'), /[\s\p{Zs}\uFEFF\u2028\u2029\u2060\u200B]/u],

  reserved: {
    global: () => RESERVED_WORDS,
    lexical: ($) => [...RESERVED_WORDS, 'let', $._escaped_let],
    properties: () => [],
  },

  supertypes: ($) => [
    $.statement,
    $.declaration,
    $._decorated_export_declaration,
    $.expression,
    $._binary_operand,
    $._unary_operand,
    $.primary_expression,
    $.pattern,
    $._non_rest_pattern,
    $._rest_pattern,
    $._constructor,
    $._constructor_chain_base,
    $._assignment_call_callee,
    $._call_callee,
    $._assignment_call_primary,
    $._simple_target_expression,
    $._simple_target_primary,
    $._call_target_expression,
    $._call_target_primary,
  ],

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
    $._non_destructuring_lhs,
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
    ['member', 'template_call', 'new', 'call', $.expression, $._binary_operand, $._unary_operand],
    ['declaration', 'literal'],
    [$.primary_expression, $.statement_block, 'object'],
    // A `{` that may begin both a block and an object starts a statement or an arrow function's body, where ECMAScript
    // reads it as a block, so `{a: 1}` there is a labeled statement in a block.
    [$.labeled_statement, $._property_name],
    [$.meta_property, $.import],
    [$.import_statement, $.import],
    [$.export_statement, $.primary_expression],
    [$.lexical_declaration, $._primary_atom],
    [$.for_lexical_declaration, $._primary_atom],
  ],

  conflicts: ($) => [
    [$._primary_atom, $._simple_target_primary],
    [$._simple_target_primary, $._non_rest_pattern],
    [$._primary_atom, $._simple_target_primary, $._non_rest_pattern],
    [$._call_callee, $.call_expression],
    [$.for_in_clause, $._primary_atom],
    [$._primary_atom, $.rest_pattern],
    [$._primary_atom, $._non_rest_pattern],
    [$.arrow_function, $._primary_atom],
    [$._primary_atom, $.await_expression],
    [$.call_expression, $._constructor_import],
    [$.primary_expression, $._assignment_call_primary],
    [$._local_export_specifier, $._module_export_name],
    [$.primary_expression, $.rest_pattern],
    [$.primary_expression, $._non_rest_pattern],
    [$.primary_expression, $.for_in_clause],
    [$.array, $.array_pattern],
    [$.object, $.object_pattern],
    [$.assignment_expression, $._non_rest_pattern],
  ],

  word: ($) => $.identifier,

  rules: {
    program: ($) => seq(optional($.hash_bang_line), repeat($._statement)),

    _statement: ($) => prec.right(seq($.statement, optional(sym('_statement_boundary')))),

    _single_statement: ($) => seq(optional(sym('_single_statement_context')), $._statement),

    hash_bang_line: () => /#![^\n\r\u2028\u2029]*/,

    //
    // Export declarations
    //

    export_statement: ($) =>
      choice(
        field('declaration', alias($._decorated_export_declaration, $.declaration)),
        seq(
          'export',
          choice(
            seq(choice('*', $.namespace_export, $.export_clause), $._from_clause, $._module_statement_end),
            seq(alias($._local_export_clause, $.export_clause), optional(sym('_line_break_before_from')), $._semicolon)
          )
        ),
        seq(
          'export',
          choice(
            field('declaration', $.declaration),
            seq(alias(sym('_export_default_declaration'), 'default'), field('declaration', $.declaration)),
            seq(alias(sym('_export_default'), 'default'), field('value', $.expression), $._semicolon)
          )
        )
      ),

    _decorated_export_declaration: ($) => alias($._decorated_export_class, $.class_declaration),

    _decorated_export_class: ($) =>
      prec(
        'declaration',
        seq(
          repeat1(field('decorator', $.decorator)),
          'export',
          choice(
            seq('class', field('name', $.identifier)),
            seq('default', 'class', field('name', optional($.identifier)))
          ),
          optional($.class_heritage),
          field('body', $.class_body)
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
        alias(
          choice(...RESERVED_WORDS.map((word) => (NAMED_RESERVED_WORDS.has(word) ? sym(word) : word))),
          $.identifier
        )
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
      seq('import', choice(seq($.import_clause, $._from_clause), field('source', $.string)), $._module_statement_end),

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

    _module_statement_end: ($) =>
      choice(
        seq($.import_attribute, choice($._semicolon, sym('_line_break_ends_statement'))),
        seq(optional(sym('_line_break_before_attributes')), $._semicolon)
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

    _escaped_let: () =>
      token(
        /(?:\\u(?:006[cC]|\{0*6[cC]\}))(?:e|\\u(?:0065|\{0*65\}))(?:t|\\u(?:0074|\{0*74\}))|l(?:\\u(?:0065|\{0*65\}))(?:t|\\u(?:0074|\{0*74\}))|le(?:\\u(?:0074|\{0*74\}))/
      ),

    _let: () => token(prec(-1, /let/)),

    lexical_declaration: ($) =>
      seq(
        field('kind', choice('let', alias($._let, 'let'), 'const')),
        commaSep1(alias($._lexical_variable_declarator, $.variable_declarator)),
        $._semicolon
      ),

    using_declaration: ($) =>
      seq(
        field('kind', choice('using', seq(alias(sym('_await_keyword'), 'await'), 'using'))),
        sym('_resource_binding_start'),
        alias($._using_declarator, $.variable_declarator),
        repeat(seq(',', sym('_resource_binding_continuation'), alias($._using_declarator, $.variable_declarator))),
        $._semicolon
      ),

    _using_declarator: ($) =>
      seq(field('name', choice(reserved('lexical', $.identifier), alias('of', $.identifier))), $._initializer),

    variable_declarator: ($) =>
      seq(
        field('name', choice($.identifier, alias('of', $.identifier), $._destructuring_pattern)),
        choice($._initializer, sym('_line_break_after_binding'))
      ),

    _lexical_variable_declarator: ($) =>
      seq(
        field('name', choice(reserved('lexical', $.identifier), alias('of', $.identifier), $._destructuring_pattern)),
        choice($._initializer, sym('_line_break_after_binding'))
      ),

    _for_variable_declarator: ($) =>
      seq(
        field('name', choice($.identifier, alias('of', $.identifier), $._destructuring_pattern)),
        optional($._initializer)
      ),

    _for_lexical_variable_declarator: ($) =>
      seq(
        field('name', choice(reserved('lexical', $.identifier), alias('of', $.identifier), $._destructuring_pattern)),
        optional($._initializer)
      ),

    statement_block: ($) => prec.right(seq(token(prec(1, '{')), repeat($._statement), '}')),

    else_clause: ($) => seq('else', $._single_statement),

    if_statement: ($) =>
      prec.right(
        seq(
          'if',
          field('condition', $.parenthesized_expression),
          field('consequence', $._single_statement),
          optional(field('alternative', $.else_clause))
        )
      ),

    switch_statement: ($) => seq('switch', field('value', $.parenthesized_expression), field('body', $.switch_body)),

    for_statement: ($) => seq('for', field('header', $.for_clause), field('body', $._single_statement)),

    for_clause: ($) =>
      seq('(', $._for_initializer, $._for_condition, field('increment', optional($._expressions)), ')'),

    // Hidden alternatives avoid duplicating the remaining header states for every initializer form.
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
    for_lexical_declaration: ($) =>
      seq(
        field('kind', choice('let', 'const')),
        commaSep1(alias($._for_lexical_variable_declarator, $.variable_declarator)),
        ';'
      ),

    for_variable_declaration: ($) =>
      seq('var', commaSep1(alias($._for_variable_declarator, $.variable_declarator)), ';'),

    _for_using_declaration: ($) =>
      seq(
        field('kind', choice('using', seq(alias(sym('_await_keyword'), 'await'), 'using'))),
        sym('_resource_binding_start'),
        alias($._using_declarator, $.variable_declarator),
        repeat(seq(',', sym('_resource_binding_continuation'), alias($._using_declarator, $.variable_declarator))),
        ';'
      ),

    for_in_statement: ($) =>
      seq(
        'for',
        optional(alias(sym('_await_keyword'), 'await')),
        field('header', $.for_in_clause),
        field('body', $._single_statement)
      ),

    for_in_clause: ($) =>
      seq(
        '(',
        choice(
          seq(
            choice(
              field(
                'left',
                choice(
                  $._lhs_expression,
                  alias($._parenthesized_simple_target, $.parenthesized_expression),
                  alias($._parenthesized_call_target, $.parenthesized_expression)
                )
              ),
              seq(
                field('kind', 'var'),
                field('left', choice($.identifier, alias('of', $.identifier), $._destructuring_pattern)),
                optional($._initializer)
              ),
              prec.dynamic(
                1,
                seq(
                  field('kind', choice('let', 'const')),
                  field(
                    'left',
                    choice(reserved('lexical', $.identifier), alias('of', $.identifier), $._destructuring_pattern)
                  )
                )
              )
            ),
            field('operator', choice('in', 'of'))
          ),
          seq(
            choice(
              seq(
                field('kind', 'using'),
                choice(sym('_resource_binding_start'), sym('_plain_resource_for_of_context'))
              ),
              seq(field('kind', seq(alias(sym('_await_keyword'), 'await'), 'using')), sym('_resource_binding_start'))
            ),
            field('left', choice(reserved('lexical', $.identifier), alias('of', $.identifier))),
            field('operator', 'of')
          )
        ),
        field('right', $._expressions),
        ')'
      ),

    while_statement: ($) =>
      seq('while', field('condition', $.parenthesized_expression), field('body', $._single_statement)),

    do_statement: ($) =>
      prec.right(
        seq(
          'do',
          field('body', $._single_statement),
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

    with_statement: ($) => seq('with', field('object', $.parenthesized_expression), field('body', $._single_statement)),

    break_statement: ($) =>
      seq(
        'break',
        field('label', optional(alias($.identifier, sym('statement_identifier')))),
        choice($._semicolon, sym('_line_break_ends_statement'))
      ),

    continue_statement: ($) =>
      seq(
        'continue',
        field('label', optional(alias($.identifier, sym('statement_identifier')))),
        choice($._semicolon, sym('_line_break_ends_statement'))
      ),

    debugger_statement: ($) => seq('debugger', choice($._semicolon, sym('_line_break_ends_statement'))),

    return_statement: ($) =>
      seq('return', choice(seq(optional($._expressions), $._semicolon), sym('_line_break_ends_statement'))),

    throw_statement: ($) => seq('throw', $._expressions, $._semicolon),

    empty_statement: () => ';',

    labeled_statement: ($) =>
      seq(
        field(
          'label',
          aliasWithAsyncKeyword(choice($.identifier, $.undefined, $._reserved_identifier), sym('statement_identifier'))
        ),
        ':',
        field('body', $._single_statement)
      ),

    //
    // Statement components
    //

    switch_body: ($) => seq('{', repeat(choice($.switch_case, $.switch_default)), '}'),

    switch_case: ($) => seq('case', field('value', $._expressions), ':', field('body', repeat($._statement))),

    switch_default: ($) => seq('default', ':', field('body', repeat($._statement))),

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
        $.assignment_expression,
        $.augmented_assignment_expression,
        $.await_expression,
        $.unary_expression,
        $.binary_expression,
        $.ternary_expression,
        $.update_expression,
        $.yield_expression
      ),

    _binary_operand: ($) =>
      choice($.primary_expression, $.await_expression, $.unary_expression, $.update_expression, $.binary_expression),

    _unary_operand: ($) => choice($.primary_expression, $.await_expression, $.unary_expression, $.update_expression),

    primary_expression: ($) =>
      choice(
        $._primary_atom,
        $.subscript_expression,
        $.member_expression,
        $.call_expression,
        $.new_expression,
        alias($._argumentless_new_expression, $.new_expression),
        $.arrow_function
      ),

    yield_expression: ($) =>
      prec.right(
        seq(
          alias(sym('_yield_keyword'), 'yield'),
          choice(seq('*', $.expression), optional($.expression), sym('_line_break_ends_statement'))
        )
      ),

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
                aliasWithAsyncKeyword(
                  choice($.identifier, $._reserved_identifier),
                  sym('shorthand_property_identifier')
                )
              )
            )
          ),
          '}'
        )
      ),

    object_pattern: ($) => {
      const property = choice(
        $.pair_pattern,
        $.object_assignment_pattern,
        aliasWithAsyncKeyword(
          choice($.identifier, $._reserved_identifier),
          sym('shorthand_property_identifier_pattern')
        )
      );
      return prec(
        'object',
        seq('{', repeat(seq(optional(property), ',')), optional(choice(property, $.rest_pattern)), '}')
      );
    },

    assignment_pattern: ($) =>
      seq(field('left', alias($._non_rest_pattern, $.pattern)), '=', field('right', $.expression)),

    object_assignment_pattern: ($) =>
      seq(
        field(
          'left',
          choice(
            aliasWithAsyncKeyword(
              choice($._reserved_identifier, $.identifier),
              sym('shorthand_property_identifier_pattern')
            ),
            $._destructuring_pattern
          )
        ),
        '=',
        field('right', $.expression)
      ),

    array: ($) => seq('[', commaSep(optional(choice($.expression, $.spread_element))), ']'),

    array_pattern: ($) =>
      seq(
        '[',
        repeat(seq(optional(choice(alias($._non_rest_pattern, $.pattern), $.assignment_pattern)), ',')),
        optional(choice($.pattern, $.assignment_pattern)),
        ']'
      ),

    _jsx_element: ($) => choice($.jsx_element, $.jsx_self_closing_element),

    jsx_element: ($) =>
      seq(field('open_tag', $.jsx_opening_element), repeat($._jsx_child), field('close_tag', $.jsx_closing_element)),

    // An entity can be named, numeric (decimal), or numeric (hexadecimal). The
    // longest entity name is 29 characters long, and the HTML spec says that
    // no more will ever be added.
    html_character_reference: () => /&(#([xX][0-9a-fA-F]{1,6}|[0-9]{1,5})|[A-Za-z]{1,30});/,

    jsx_expression: ($) => seq('{', optional(choice($.expression, $.sequence_expression, $.spread_element)), '}'),

    _jsx_child: ($) => choice(sym('jsx_text'), $.html_character_reference, $._jsx_element, $.jsx_expression),

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
          field('property', alias(reserved('properties', $.identifier), sym('property_identifier')))
        )
      ),

    jsx_namespace_name: ($) => seq($._jsx_identifier, ':', $._jsx_identifier),

    _jsx_element_name: ($) =>
      choice($._jsx_identifier, alias($.nested_identifier, $.member_expression), $.jsx_namespace_name),

    jsx_closing_element: ($) => seq('</', optional(field('name', $._jsx_element_name)), '>'),

    jsx_self_closing_element: ($) =>
      seq('<', field('name', $._jsx_element_name), repeat(field('attribute', $._jsx_attribute)), '/>'),

    _jsx_attribute: ($) => choice($.jsx_attribute, $.jsx_expression),

    _jsx_attribute_name: ($) => choice(alias($._jsx_identifier, sym('property_identifier')), $.jsx_namespace_name),

    jsx_attribute: ($) => seq($._jsx_attribute_name, optional(seq('=', $._jsx_attribute_value))),

    _jsx_string: ($) =>
      choice(
        seq(
          '"',
          repeat(
            choice(
              alias($.unescaped_double_jsx_string_fragment, sym('string_fragment')),
              $.html_character_reference,
              alias($._jsx_string_ampersand, sym('string_fragment'))
            )
          ),
          '"'
        ),
        seq(
          "'",
          repeat(
            choice(
              alias($.unescaped_single_jsx_string_fragment, sym('string_fragment')),
              $.html_character_reference,
              alias($._jsx_string_ampersand, sym('string_fragment'))
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
          choice(
            seq(
              sym('_default_declaration_start'),
              repeat(field('decorator', $.decorator)),
              'class',
              field('name', optional($.identifier))
            ),
            seq(repeat(field('decorator', $.decorator)), 'class', field('name', $.identifier))
          ),
          optional($.class_heritage),
          field('body', $.class_body)
        )
      ),

    class_heritage: ($) => seq('extends', $.expression),

    function_expression: ($) =>
      prec(
        'literal',
        functionContext((async) =>
          seq(
            ...(async ? [alias(sym('_async_keyword'), 'async')] : []),
            'function',
            field('name', optional($.identifier)),
            functionScope(async, seq($._call_signature, field('body', $.statement_block)))
          )
        )
      ),

    function_declaration: ($) =>
      prec.right(
        'declaration',
        functionContext((async) =>
          seq(
            choice(
              seq(
                sym('_default_declaration_start'),
                ...(async ? [alias(sym('_async_keyword'), 'async')] : []),
                'function',
                field('name', optional($.identifier))
              ),
              seq(...(async ? [alias(sym('_async_keyword'), 'async')] : []), 'function', field('name', $.identifier))
            ),
            functionScope(async, seq($._call_signature, field('body', $.statement_block)))
          )
        )
      ),

    generator_function: ($) =>
      prec(
        'literal',
        functionContext((async) =>
          seq(
            ...(async ? [alias(sym('_async_keyword'), 'async')] : []),
            'function',
            '*',
            field('name', optional($.identifier)),
            functionScope(async, seq($._call_signature, field('body', $.statement_block)), 'generator_function')
          )
        )
      ),

    generator_function_declaration: ($) =>
      prec.right(
        'declaration',
        functionContext((async) =>
          seq(
            choice(
              seq(
                sym('_default_declaration_start'),
                ...(async ? [alias(sym('_async_keyword'), 'async')] : []),
                'function',
                '*',
                field('name', optional($.identifier))
              ),
              seq(
                ...(async ? [alias(sym('_async_keyword'), 'async')] : []),
                'function',
                '*',
                field('name', $.identifier)
              )
            ),
            functionScope(async, seq($._call_signature, field('body', $.statement_block)), 'generator_function')
          )
        )
      ),

    arrow_function: ($) =>
      prec.right(
        functionContext((async) =>
          seq(
            ...(async ? [alias(sym('_async_keyword'), 'async')] : []),
            choice(
              field(
                'parameter',
                choice(
                  aliasWithAsyncKeyword($._reserved_identifier, $.identifier),
                  alias($.undefined, $.identifier),
                  $.identifier
                )
              ),
              $._call_signature
            ),
            '=>',
            sym(async ? '_async_function_start' : '_sync_function_start'),
            choice(
              seq(field('body', $.expression), sym('_arrow_context_end')),
              seq(
                field('body', $.statement_block),
                optional(seq(sym('_arrow_function_block_end'), optional(sym('_arrow_function_block_continuation')))),
                sym('_function_context_end')
              )
            ),
            optional(sym('_completed_arrow_function'))
          )
        )
      ),

    _call_signature: ($) => field('parameters', $.formal_parameters),

    /** Ordinary, comma-permitted parameters. Overrides must exclude rest forms. */
    _formal_parameter: ($) => choice(alias($._non_rest_pattern, $.pattern), $.assignment_pattern),

    _call_callee: ($) => $.primary_expression,

    optional_chain: () => '?.',

    call_expression: ($) =>
      choice(
        prec(
          'call',
          seq(field('function', choice(alias($._call_callee, $.expression), $.import)), field('arguments', $.arguments))
        ),
        prec('template_call', seq(field('function', $.primary_expression), field('arguments', $.template_string))),
        prec(
          'member',
          seq(
            field('function', $.primary_expression),
            field('optional_chain', $.optional_chain),
            field('arguments', $.arguments)
          )
        )
      ),

    _primary_atom: ($) =>
      choice(
        $._jsx_element,
        $.parenthesized_expression,
        $._identifier,
        alias(sym('_await_yield_identifier'), $.identifier),
        aliasWithAsyncKeyword($._reserved_identifier, $.identifier),
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
        $.generator_function,
        $.class,
        $.meta_property
      ),

    _assignment_call: ($) =>
      prec(
        'call',
        seq(field('function', alias($._assignment_call_callee, $.expression)), field('arguments', $.arguments))
      ),

    _assignment_call_callee: ($) => alias($._assignment_call_primary, $.primary_expression),

    _assignment_call_primary: ($) =>
      choice(
        $._primary_atom,
        $.new_expression,
        alias($._argumentless_new_expression, $.new_expression),
        alias($._assignment_call, $.call_expression),
        alias($._assignment_member, $.member_expression),
        alias($._assignment_subscript, $.subscript_expression),
        alias($._assignment_tag, $.call_expression),
        alias($._constructor_import, $.call_expression)
      ),

    _assignment_member: ($) =>
      prec(
        'member',
        seq(
          field('object', alias($._assignment_call_callee, $.expression)),
          '.',
          field(
            'property',
            choice(
              $.private_property_identifier,
              reserved('properties', alias($.identifier, sym('property_identifier')))
            )
          )
        )
      ),

    _assignment_subscript: ($) =>
      prec.right(
        'member',
        seq(field('object', alias($._assignment_call_callee, $.expression)), '[', field('index', $._expressions), ']')
      ),

    _assignment_tag: ($) =>
      prec(
        'template_call',
        seq(
          field('function', alias($._assignment_call_primary, $.primary_expression)),
          field('arguments', $.template_string)
        )
      ),

    new_expression: ($) =>
      prec(
        'new',
        seq('new', field('constructor', alias($._constructor, $.primary_expression)), field('arguments', $.arguments))
      ),

    _constructor_function_expression: ($) =>
      prec(
        'literal',
        functionContext((async) =>
          seq(
            optional(sym('_constructor_async_function_start')),
            ...(async ? [alias(sym('_async_keyword'), 'async')] : []),
            'function',
            field('name', optional($.identifier)),
            functionScope(async, seq($._call_signature, field('body', $.statement_block)))
          )
        )
      ),

    _constructor_generator_function: ($) =>
      prec(
        'literal',
        functionContext((async) =>
          seq(
            optional(sym('_constructor_async_function_start')),
            ...(async ? [alias(sym('_async_keyword'), 'async')] : []),
            'function',
            '*',
            field('name', optional($.identifier)),
            functionScope(async, seq($._call_signature, field('body', $.statement_block)), 'generator_function')
          )
        )
      ),

    _constructor_atom: ($) =>
      choice(
        $._jsx_element,
        $.parenthesized_expression,
        $._identifier,
        alias(sym('_await_yield_identifier'), $.identifier),
        aliasWithAsyncKeyword($._reserved_identifier, $.identifier),
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
        alias($._constructor_function_expression, $.function_expression),
        alias($._constructor_generator_function, $.generator_function),
        $.class,
        $.meta_property
      ),

    _constructor: ($) =>
      choice(
        $._constructor_atom,
        $.new_expression,
        alias($._argumentless_new_expression, $.new_expression),
        alias($._constructor_member, $.member_expression),
        alias($._constructor_subscript, $.subscript_expression),
        alias($._constructor_tag, $.call_expression)
      ),

    _constructor_chain_base: ($) =>
      choice(alias($._constructor, $.primary_expression), alias($._constructor_import, $.call_expression)),

    _constructor_import: ($) => prec('call', seq(field('function', $.import), field('arguments', $.arguments))),

    _constructor_member: ($) =>
      prec(
        'member',
        seq(
          field('object', alias($._constructor_chain_base, $.primary_expression)),
          '.',
          field(
            'property',
            choice(
              $.private_property_identifier,
              reserved('properties', alias($.identifier, sym('property_identifier')))
            )
          )
        )
      ),

    _constructor_subscript: ($) =>
      prec.right(
        'member',
        seq(
          field('object', alias($._constructor_chain_base, $.primary_expression)),
          '[',
          field('index', $._expressions),
          ']'
        )
      ),

    _constructor_tag: ($) =>
      prec(
        'template_call',
        seq(
          field('function', alias($._constructor_chain_base, $.primary_expression)),
          field('arguments', $.template_string)
        )
      ),

    _argumentless_new_expression: ($) =>
      prec.right(
        'new',
        seq('new', field('constructor', alias($._constructor, $.primary_expression)), sym('_argumentless_new_end'))
      ),

    await_expression: ($) =>
      prec.dynamic(
        3,
        prec.right(
          'unary_void',
          seq(
            alias(sym('_await_keyword'), 'await'),
            // Independent optional prefixes duplicate parser states; the yield start/context pair stays one alternative.
            optional(
              choice(
                sym('_await_identifier_line_break'),
                seq(sym('_await_yield_identifier_start'), optional(sym('_await_yield_identifier_context'))),
                sym('_line_break_after_await')
              )
            ),
            alias($._unary_operand, $.expression),
            sym('_await_operand_end')
          )
        )
      ),

    member_expression: ($) =>
      prec(
        'member',
        seq(
          field('object', choice(alias($._call_callee, $.expression), $.import)),
          choice('.', field('optional_chain', $.optional_chain)),
          field(
            'property',
            choice(
              $.private_property_identifier,
              reserved('properties', alias($.identifier, sym('property_identifier')))
            )
          )
        )
      ),

    subscript_expression: ($) =>
      prec.right(
        'member',
        seq(
          field('object', alias($._call_callee, $.expression)),
          optional(field('optional_chain', $.optional_chain)),
          '[',
          field('index', $._expressions),
          ']'
        )
      ),

    _lhs_expression: ($) => choice($._non_destructuring_lhs, $._destructuring_pattern),

    _non_destructuring_lhs: ($) =>
      choice(
        $.member_expression,
        $.subscript_expression,
        $._identifier,
        aliasWithAsyncKeyword($._reserved_identifier, $.identifier)
      ),

    _simple_target_expression: ($) => alias($._simple_target_primary, $.primary_expression),

    _simple_target_primary: ($) =>
      choice(
        $._identifier,
        alias(sym('_await_yield_identifier'), $.identifier),
        aliasWithAsyncKeyword($._reserved_identifier, $.identifier),
        alias($._assignment_member, $.member_expression),
        alias($._assignment_subscript, $.subscript_expression),
        alias($._parenthesized_simple_target, $.parenthesized_expression)
      ),

    _parenthesized_simple_target: ($) => seq('(', alias($._simple_target_expression, $.expression), ')'),

    _call_target_expression: ($) => alias($._call_target_primary, $.primary_expression),

    _call_target_primary: ($) => $._classic_call_target,

    _parenthesized_call_target: ($) => seq('(', alias($._call_target_expression, $.expression), ')'),

    _classic_call_target: ($) =>
      choice(
        alias($._assignment_call, $.call_expression),
        alias($._parenthesized_call_target, $.parenthesized_expression)
      ),

    assignment_expression: ($) =>
      prec.right(
        'assign',
        seq(
          field(
            'left',
            choice(
              alias($._parenthesized_simple_target, $.parenthesized_expression),
              $._lhs_expression,
              $._classic_call_target
            )
          ),
          '=',
          field('right', $.expression)
        )
      ),

    _augmented_assignment_lhs: ($) =>
      choice(
        $.member_expression,
        $.subscript_expression,
        aliasWithAsyncKeyword($._reserved_identifier, $.identifier),
        $._identifier,
        alias($._parenthesized_simple_target, $.parenthesized_expression)
      ),

    augmented_assignment_expression: ($) =>
      prec.right(
        'assign',
        seq(
          choice(
            seq(
              field('left', $._augmented_assignment_lhs),
              field('operator', choice(...CLASSIC_ASSIGNMENT_OPERATORS, '&&=', '||=', '??='))
            ),
            seq(field('left', $._classic_call_target), field('operator', choice(...CLASSIC_ASSIGNMENT_OPERATORS)))
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
          field('condition', alias($._binary_operand, $.expression)),
          alias(sym('_ternary_qmark'), '?'),
          field('consequence', $.expression),
          ':',
          field('alternative', $.expression)
        )
      ),

    binary_expression: ($) =>
      choice(
        .../** @type {const} */ ([
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
        ]).map(([operator, precedence, associativity]) =>
          // oxlint-disable-next-line typescript/unbound-method -- prec.left and prec.right do not use `this`.
          (associativity === 'right' ? prec.right : prec.left)(
            precedence,
            seq(
              field(
                'left',
                operator === 'in'
                  ? choice(alias($._binary_operand, $.expression), $.private_property_identifier)
                  : alias($._binary_operand, $.expression)
              ),
              field('operator', operator),
              field('right', alias($._binary_operand, $.expression))
            )
          )
        )
      ),

    unary_expression: ($) =>
      prec.left(
        'unary_void',
        seq(
          field('operator', choice('!', '~', '-', '+', 'typeof', 'void', 'delete')),
          field('argument', alias($._unary_operand, $.expression))
        )
      ),

    update_expression: ($) =>
      prec.left(
        choice(
          seq(
            field('argument', alias($._unary_operand, $.expression)),
            field('operator', choice('++', '--')),
            sym('_postfix_update_end')
          ),
          seq(field('operator', choice('++', '--')), field('argument', alias($._unary_operand, $.expression)))
        )
      ),

    sequence_expression: ($) => prec.right(commaSep1($.expression)),

    //
    // Primitives
    //

    string: ($) =>
      choice(
        seq(
          '"',
          repeat(choice(alias($.unescaped_double_string_fragment, sym('string_fragment')), $.escape_sequence)),
          '"'
        ),
        seq(
          "'",
          repeat(choice(alias($.unescaped_single_string_fragment, sym('string_fragment')), $.escape_sequence)),
          "'"
        )
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
            alias(sym('_template_chars'), sym('string_fragment')),
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
        choice(
          seq(sym('_regex_flags_start'), token.immediate(prec(1, '/')), field('flags', $.regex_flags)),
          token.immediate(prec(1, '/'))
        )
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

    arguments: ($) =>
      seq(choice('(', sym('_call_arguments_context')), commaSep(optional(choice($.expression, $.spread_element))), ')'),

    decorator: ($) =>
      seq(
        '@',
        choice(
          $.identifier,
          alias($.decorator_member_expression, $.member_expression),
          alias($.decorator_call_expression, $.call_expression),
          $.parenthesized_expression
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
            choice(
              reserved('properties', alias($.identifier, sym('property_identifier'))),
              $.private_property_identifier
            )
          )
        )
      ),

    decorator_call_expression: ($) =>
      prec(
        'call',
        seq(
          field(
            'function',
            choice($.identifier, alias($.decorator_member_expression, $.member_expression), $.parenthesized_expression)
          ),
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
              seq(
                field('property', $._field_name),
                optional(choice($._field_initializer, sym('_line_break_after_field')))
              ),
              // A line break after `get` or `set` continues a getter or setter. Allowing both sentinels here tells
              // the scanner that a `*` on the next line cannot continue the member, unlike after `static`.
              seq(
                field('property', alias(choice('get', 'set'), sym('property_identifier'))),
                optional(
                  choice($._field_initializer, sym('_line_break_after_modifier'), sym('_line_break_after_field'))
                )
              )
            )
          ),
          // A line break after a leading `static` continues a static member; after `static static`, it ends the field.
          seq(
            field('property', alias('static', sym('property_identifier'))),
            optional(choice($._field_initializer, sym('_line_break_after_modifier')))
          ),
          seq(
            'static',
            field('property', alias('static', sym('property_identifier'))),
            optional(choice($._field_initializer, sym('_line_break_after_field')))
          )
        )
      ),

    _field_initializer: ($) =>
      seq('=', sym('_sync_function_start'), field('value', $.expression), sym('_arrow_context_end')),

    formal_parameters: ($) =>
      seq(
        '(',
        repeat(seq($._formal_parameter, ',')),
        optional(choice($._formal_parameter, alias($._rest_pattern, $.pattern))),
        ')'
      ),

    class_static_block: ($) => seq('static', field('body', alias($._class_member_body, $.statement_block))),

    /**
     * Canonical pattern supertype. Extend `_non_rest_pattern` for non-rest forms and
     * `rest_pattern` for rest syntax; overriding only `pattern` does not extend ordinary slots.
     */
    pattern: ($) => choice(alias($._non_rest_pattern, $.pattern), alias($._rest_pattern, $.pattern)),

    // Prefer expression forms over both pattern routes during ambiguous error recovery.
    _non_rest_pattern: ($) =>
      prec.dynamic(-1, choice($._lhs_expression, alias($._parenthesized_simple_target, $.parenthesized_expression))),

    _rest_pattern: ($) =>
      prec.dynamic(-1, choice($.rest_pattern, alias($._destructuring_rest_pattern, $.rest_pattern))),

    rest_pattern: ($) =>
      prec.right(
        seq('...', choice($._non_destructuring_lhs, alias($._parenthesized_simple_target, $.parenthesized_expression)))
      ),

    _destructuring_rest_pattern: ($) => prec.right(seq('...', $._destructuring_pattern)),

    method_definition: ($) =>
      functionContext((async) =>
        choice(
          ...[false, true].map((generator) =>
            seq(
              repeat(field('decorator', $.decorator)),
              optional('static'),
              ...(async ? [alias(sym('_async_keyword'), 'async')] : []),
              ...(generator ? ['*'] : [optional(choice('get', 'set'))]),
              field('name', $._property_name),
              choice(
                functionScope(
                  async,
                  seq(
                    field('parameters', $.formal_parameters),
                    field('body', alias($._class_member_body, $.statement_block))
                  ),
                  generator ? 'generator_function' : 'function_signature'
                ),
                ...(generator
                  ? []
                  : [
                      seq(
                        field('parameters', $.formal_parameters),
                        functionScope(async, field('body', alias($._class_member_body, $.statement_block)), 'function')
                      ),
                    ])
              )
            )
          )
        )
      ),

    // The body of a method or a static block, a rule of its own rather than statement_block: sharing it let tree-sitter
    // merge the state after the body's `}` with the one after a function expression's `}`, where `in`, `instanceof`,
    // and `extends` are keywords, so a class member with one of those names could not follow.
    _class_member_body: ($) => seq('{', repeat($._statement), '}'),

    pair: ($) => seq(field('key', $._property_name), ':', field('value', $.expression)),

    pair_pattern: ($) =>
      seq(
        field('key', $._property_name),
        ':',
        field('value', choice(alias($._non_rest_pattern, $.pattern), $.assignment_pattern))
      ),

    _field_name: ($) =>
      reserved(
        'properties',
        choice(
          aliasWithAsyncKeyword(
            choice(
              $.identifier,
              sym('_yield_identifier'),
              $._escaped_let,
              ...CONTEXTUAL_KEYWORDS.map((word) =>
                word === 'await' ? choice(sym('_await_keyword'), sym('_await_identifier')) : word
              )
            ),
            sym('property_identifier')
          ),
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
          aliasWithAsyncKeyword(choice($.identifier, $._reserved_identifier), sym('property_identifier')),
          $.private_property_identifier,
          $.string,
          $.number,
          $.computed_property_name
        )
      ),

    computed_property_name: ($) => seq('[', $.expression, ']'),

    _reserved_identifier: ($) =>
      choice(
        sym('_yield_identifier'),
        ...MEMBER_MODIFIERS,
        $._escaped_let,
        ...CONTEXTUAL_KEYWORDS.map((word) =>
          word === 'await' ? choice(sym('_await_keyword'), sym('_await_identifier')) : word
        )
      ),

    _semicolon: () =>
      choice(
        sym('_automatic_semicolon'),
        sym('_await_identifier_line_break'),
        sym('_await_yield_identifier_start'),
        ';'
      ),
  },
});

/**
 * @param {import('@willbooster/web-tree-sitter/dsl').RuleOrLiteral} rule
 * @param {import('@willbooster/web-tree-sitter/dsl').SymbolRule<string>} symbol
 */
function aliasWithAsyncKeyword(rule, symbol) {
  return choice(alias(rule, symbol), alias(sym('_async_keyword'), symbol));
}

/**
 * Creates a rule to match one or more of the rules separated by a comma
 *
 * @param {import('@willbooster/web-tree-sitter/dsl').RuleOrLiteral} rule
 *
 * @returns {import('@willbooster/web-tree-sitter/dsl').SeqRule}
 */
function commaSep1(rule) {
  return seq(rule, repeat(seq(',', rule)));
}

/**
 * Creates a rule to optionally match one or more of the rules separated by a comma
 *
 * @param {import('@willbooster/web-tree-sitter/dsl').RuleOrLiteral} rule
 *
 * @returns {import('@willbooster/web-tree-sitter/dsl').ChoiceRule}
 */
function commaSep(rule) {
  return optional(commaSep1(rule));
}

/** @param {(isAsync: boolean) => import('@willbooster/web-tree-sitter/dsl').RuleOrLiteral} makeRule */
function functionContext(makeRule) {
  return choice(makeRule(false), makeRule(true));
}
/**
 * @param {boolean} async
 * @param {import('@willbooster/web-tree-sitter/dsl').RuleOrLiteral} content
 * @param {'function_signature' | 'generator_function' | 'function'} [kind]
 */
function functionScope(async, content, kind = 'function_signature') {
  const name = kind === 'function' && !async ? 'sync_function' : `${async ? 'async_' : ''}${kind}`;
  return seq(sym(`_${name}_start`), content, sym('_function_context_end'));
}
