// code-gauge-allow-file fileNcss 992 -- Scanner context dispatch stays together; splitting unrelated state transitions would only relocate complexity.
#include "function_context.h"
#include "literal.h"
#include "tree_sitter/alloc.h"
#include "tree_sitter/parser.h"

#include <stddef.h>

enum TokenType {
    AUTOMATIC_SEMICOLON,
    TEMPLATE_CHARS,
    TERNARY_QMARK,
    HTML_COMMENT,
    LOGICAL_OR,
    ESCAPE_SEQUENCE,
    REGEX_PATTERN,
    JSX_TEXT,
    ARROW_FUNCTION_BLOCK_END,
    ARROW_FUNCTION_BLOCK_CONTINUATION,
    LINE_BREAK_ENDS_STATEMENT,
    LINE_BREAK_AFTER_BINDING,
    LINE_BREAK_AFTER_FIELD,
    LINE_BREAK_AFTER_MODIFIER,
    LINE_BREAK_BEFORE_ATTRIBUTES,
    STATEMENT_BOUNDARY,
    LINE_BREAK_AFTER_AWAIT,
    AWAIT_IDENTIFIER_LINE_BREAK,
    AWAIT_OPERAND_END,
    COMPLETED_ARROW_FUNCTION,
    AWAIT_YIELD_IDENTIFIER,
    AWAIT_YIELD_IDENTIFIER_START,
    AWAIT_YIELD_IDENTIFIER_CONTEXT,
    POSTFIX_UPDATE_END,
    AWAIT_KEYWORD,
    LET,
    SINGLE_STATEMENT_CONTEXT,
    RESOURCE_BINDING_START,
    RESOURCE_BINDING_CONTINUATION,
    PLAIN_RESOURCE_FOR_OF_CONTEXT,
    EXPORT_DEFAULT,
    EXPORT_DEFAULT_DECLARATION,
    DEFAULT_DECLARATION_START,
    REGEX_FLAGS_START,
    ARGUMENTLESS_NEW_END,
    CONSTRUCTOR_ASYNC_FUNCTION_START,
    SYNC_FUNCTION_START,
    ASYNC_FUNCTION_START,
    FUNCTION_CONTEXT_END,
    ARROW_CONTEXT_END,
    AWAIT_IDENTIFIER,
    GENERATOR_FUNCTION_START,
    ASYNC_GENERATOR_FUNCTION_START,
    YIELD_KEYWORD,
    YIELD_IDENTIFIER,
    FUNCTION_SIGNATURE_START,
    ASYNC_FUNCTION_SIGNATURE_START,
    CALL_ARGUMENTS_CONTEXT,
    ASYNC_KEYWORD,
    LINE_BREAK_BEFORE_FROM,
    CLASS_HERITAGE_END,
    CLASS_HERITAGE_YIELD_IDENTIFIER,
    CLASS_HERITAGE_AWAIT_IDENTIFIER,
    TEMPLATE_ESCAPE_SEQUENCE,
    DECLARATION_FUNCTION_KEYWORD,
    DECLARATION_CLASS_KEYWORD,
};

static bool scan_let(TSLexer *lexer);
static bool scan_declaration_keyword(TSLexer *lexer, const bool *valid_symbols);
static bool scan_class_heritage_end(TSLexer *lexer, bool allow_html_comment);
static bool is_statement_keyword(const char *word, unsigned length);
static bool is_reserved_word(const char *name, unsigned length);
static bool is_reserved_statement_keyword(const char *word, unsigned length);
static bool is_non_statement_reserved_word(const char *word, unsigned length);
static bool scan_html_comment_line(TSLexer *lexer);
static bool scan_expression_trivia(TSLexer *lexer, bool *saw_newline, bool *scanned_comment, bool skip_contents);

typedef struct {
    // Set where a block arrow, postfix update, or uninitialized binding ends its statement at a line break, and
    // cleared by the token that consumes that statement end. Nested await end tokens must not clear it before the
    // enclosing statement consumes it.
    bool automatic_semicolon_pending;
    bool default_declaration_pending;
    FunctionContext functions;
} Scanner;

static bool scan_export_default(Scanner *scanner, TSLexer *lexer);
static bool starts_default_declaration(TSLexer *lexer);
static bool scan_binding_end(Scanner *scanner, TSLexer *lexer);
static bool scan_keyword_trivia(TSLexer *lexer, bool allow_line_breaks, bool at_line_start);
static bool scan_slash_comment(TSLexer *lexer, bool *saw_newline, bool skip_contents, bool require_closed);
static bool scan_async_start(TSLexer *lexer, const bool *valid_symbols);
static bool await_is_identifier(const Scanner *scanner);

void *tree_sitter_javascript_external_scanner_create() { return ts_calloc(1, sizeof(Scanner)); }

void tree_sitter_javascript_external_scanner_destroy(void *payload) { ts_free(payload); }

unsigned tree_sitter_javascript_external_scanner_serialize(void *payload, char *buffer) {
    Scanner *scanner = (Scanner *)payload;
    unsigned function_bytes = function_context_serialize(&scanner->functions, buffer + 2);
    if (!function_bytes && !scanner->automatic_semicolon_pending && !scanner->default_declaration_pending) {
        return 0;
    }
    buffer[0] = (char)scanner->automatic_semicolon_pending;
    buffer[1] = (char)scanner->default_declaration_pending;
    return 2 + function_bytes;
}

void tree_sitter_javascript_external_scanner_deserialize(void *payload, const char *buffer, unsigned length) {
    Scanner *scanner = (Scanner *)payload;
    scanner->automatic_semicolon_pending = length > 0 && buffer[0];
    scanner->default_declaration_pending = length > 1 && buffer[1];
    function_context_deserialize(&scanner->functions, length >= 2 ? buffer + 2 : buffer, length >= 2 ? length - 2 : 0);
}

static inline void advance(TSLexer *lexer) { lexer->advance(lexer, false); }

static inline void skip(TSLexer *lexer) { lexer->advance(lexer, true); }

static inline bool is_line_terminator(int32_t c) {
    if ((uint32_t)c < 0x80) return c == '\n' || c == '\r';
    return c == 0x2028 || c == 0x2029;
}

// The characters of the whitespace class in the grammar's extras (which includes the line terminators). iswspace
// depends on the C library and locale and differs from that class.
static inline bool is_whitespace(int32_t c) {
    if ((uint32_t)c < 0x80) return c == ' ' || (uint32_t)(c - '\t') <= '\r' - '\t';
    switch (c) {
        case 0xA0:
        case 0x1680:
        case 0x200B:
        case 0x2028:
        case 0x2029:
        case 0x202F:
        case 0x205F:
        case 0x2060:
        case 0x3000:
        case 0xFEFF:
            return true;
        default:
            return c >= 0x2000 && c <= 0x200A;
    }
}

// Counts the characters the grammar's identifiers may continue with (a backslash starts a `\u` escape), with every
// character from U+007F on other than whitespace, which suffices to tell `in` and `instanceof` from the identifiers they
// start.
static inline bool is_identifier_part(int32_t c) {
    if ((uint32_t)c < 0x7F) {
        return is_ascii_letter(c) || is_ascii_digit(c) || c == '_' || c == '$' || c == '\\';
    }
    return c >= 0x7F && !is_whitespace(c);
}

static bool bytes_equal(const char *a, const char *b, unsigned length) {
    for (unsigned i = 0; i < length; i++) {
        if (a[i] != b[i]) return false;
    }
    return true;
}

static inline bool word_equals(const char *word, unsigned length, const char *target, unsigned target_length) {
    return length == target_length && bytes_equal(word, target, target_length);
}

#define WORD_EQ(word, length, literal) word_equals((word), (length), (literal), sizeof(literal) - 1)

static inline bool is_in_or_instanceof(const char *word, unsigned length) {
    return WORD_EQ(word, length, "in") || WORD_EQ(word, length, "instanceof");
}

static bool scan_word(TSLexer *lexer, const char *word) {
    for (; *word; word++) {
        if (lexer->lookahead != *word) {
            return false;
        }
        skip(lexer);
    }
    return !is_identifier_part(lexer->lookahead);
}

typedef enum {
    REJECT,     // Semicolon is illegal, ie a syntax error occurred
    NO_NEWLINE, // Unclear if semicolon will be legal, continue
    ACCEPT,     // Semicolon is legal, assuming a comment was encountered
    // Retain a line break when probing comments has already advanced past it.
    ACCEPT_AFTER_COMMENT_LINE_BREAK,
    ACCEPT_AFTER_COMMENT_LINE_BREAK_BEFORE_SLASH,
} WhitespaceResult;

static bool scan_block_comment(TSLexer *lexer, bool *saw_newline, bool skip_contents);

// code-gauge-allow functionCognitiveComplexity 25 -- Trivia comment and newline decisions share the same lexer cursor and consumption mode.
static WhitespaceResult scan_whitespace_and_comments(TSLexer *lexer, bool *scanned_content, bool consume, bool skip_contents) {
    bool saw_comment_newline = false;
    for (;;) {
        while (is_whitespace(lexer->lookahead)) {
            lexer->advance(lexer, skip_contents);
        }
        if (lexer->lookahead != '/') return ACCEPT;
        lexer->advance(lexer, skip_contents);
        if (lexer->lookahead == '/') {
            lexer->advance(lexer, skip_contents);
            while (!lexer_eof(lexer) && !is_line_terminator(lexer->lookahead)) {
                lexer->advance(lexer, skip_contents);
            }
            saw_comment_newline |= is_line_terminator(lexer->lookahead);
            *scanned_content = true;
            continue;
        }
        if (lexer->lookahead != '*') {
            return !consume && saw_comment_newline ? ACCEPT_AFTER_COMMENT_LINE_BREAK_BEFORE_SLASH : REJECT;
        }
        lexer->advance(lexer, skip_contents);
        if (!scan_block_comment(lexer, &saw_comment_newline, skip_contents)) return ACCEPT;
        *scanned_content = true;
        if (!consume && lexer->lookahead != '/') {
            return saw_comment_newline ? ACCEPT_AFTER_COMMENT_LINE_BREAK : NO_NEWLINE;
        }
    }
}

static bool scan_block_comment(TSLexer *lexer, bool *saw_newline, bool skip_contents) {
    while (!lexer_eof(lexer)) {
        if (lexer->lookahead != '*') {
            *saw_newline |= is_line_terminator(lexer->lookahead);
            lexer->advance(lexer, skip_contents);
            continue;
        }
        lexer->advance(lexer, skip_contents);
        if (lexer->lookahead == '/') {
            lexer->advance(lexer, skip_contents);
            return true;
        }
    }
    return false;
}

// Called after an arrow function's block body and a line break: such a function cannot be continued by a member
// access, call, or operator, so the statement ends unless a `,` continues the list, a `;` ends it explicitly, or a `?`
// continues an enclosing conditional expression (`a ? b : () => {}` then `? c : d`, which V8 accepts).
static bool ends_statement_after_block_arrow(TSLexer *lexer, bool *scanned_content) {
    // REJECT means a `/` that starts no comment, i.e. a regex.
    if (scan_whitespace_and_comments(lexer, scanned_content, true, true) == REJECT) {
        return true;
    }
    return lexer->lookahead != ',' && lexer->lookahead != ';' && lexer->lookahead != '?';
}

// What a line break after the preceding token means, told by the sentinel external tokens that the grammar allows
// only at these positions; the scanner never emits them.
typedef enum {
    // Decided by the characters that follow.
    LINE_BREAK_BY_NEXT_TOKEN,
    // After `return`, `yield`, `break`, `continue`, or `debugger`, which nothing on the next line can continue.
    LINE_BREAK_ENDS,
    // After a class field name without an initializer: only `=` (an initializer) or `(` (a method) continues it.
    LINE_BREAK_AFTER_FIELD_NAME,
    // After `static` at the start of a class member: a line break continues the member unless a `}`, a `@` (decorators
    // precede modifiers), or the end of input follows, which leaves a field named `static`.
    LINE_BREAK_AFTER_MODIFIER_WORD,
    // After `get` or `set` at the start of a class member: as after `static`, except that a `*` also ends the field,
    // since an accessor cannot be a generator.
    LINE_BREAK_AFTER_ACCESSOR_WORD,
    // After the source of an import or re-export: only the `with` of its attributes continues it.
    LINE_BREAK_BEFORE_IMPORT_ATTRIBUTES,
    LINE_BREAK_BEFORE_FROM_CLAUSE,
    LINE_BREAK_AFTER_AWAIT_KEYWORD,
    LINE_BREAK_AWAIT_OPERAND,
} LineBreakRule;

static bool scan_after_line_break(TSLexer *lexer, bool after_block_arrow, LineBreakRule rule, bool *scanned_content, bool before_slash);
static bool scan_line_break_rule(TSLexer *lexer, LineBreakRule rule, bool before_slash, bool *scanned_content);
static bool scan_line_break_after_await(TSLexer *lexer, bool before_slash, bool *scanned_content);
static bool starts_await_operand_punctuation(int32_t c);
static bool scan_await_line_break_identifier(TSLexer *lexer, bool *scanned_content);
static bool is_async_arrow_start(TSLexer *lexer, bool *scanned_content);
static bool ends_statement_at_next_token(TSLexer *lexer);
static bool is_line_continuation_token(int32_t c);
static unsigned scan_identifier(TSLexer *lexer, char *word, unsigned capacity, bool skip_contents);
static void skip_identifier_escape(TSLexer *lexer, bool skip_contents);
static bool follows_yield_operand(TSLexer *lexer);
static bool scan_infix_word(TSLexer *lexer, bool skip_characters);
static bool scan_resource_binding(TSLexer *lexer, bool plain_for_of, bool *infix_operator);

// code-gauge-allow functionNcss 41 -- Semicolon eligibility depends on the same consumed-comment and token-boundary state across these cases.
static bool scan_automatic_semicolon(TSLexer *lexer, bool after_block_arrow,
                                     LineBreakRule rule, bool *scanned_content, const bool *resource_symbols) {
    lexer->result_symbol = AUTOMATIC_SEMICOLON;
    lexer->mark_end(lexer);
    bool line_break_in_comment = false;
    bool resource_line_break = false;

    for (;;) {
        if (lexer->eof(lexer)) {
            return true;
        }

        if (lexer->lookahead == '/') {
            WhitespaceResult result = scan_whitespace_and_comments(lexer, scanned_content, false, true);
            if (result == REJECT) {
                return false;
            }
            if (result == ACCEPT_AFTER_COMMENT_LINE_BREAK_BEFORE_SLASH) {
                return scan_after_line_break(lexer, after_block_arrow, rule, scanned_content, true);
            }

            if (after_block_arrow && lexer->eof(lexer)) {
                return true;
            }

            if (result == NO_NEWLINE && rule == LINE_BREAK_AFTER_AWAIT_KEYWORD) {
                return false;
            }
            if (result == ACCEPT || result == ACCEPT_AFTER_COMMENT_LINE_BREAK) {
                resource_line_break = true;
                if (after_block_arrow || rule != LINE_BREAK_BY_NEXT_TOKEN) {
                    return scan_after_line_break(lexer, after_block_arrow, rule, scanned_content, false);
                }
                line_break_in_comment = result == ACCEPT_AFTER_COMMENT_LINE_BREAK;
            }
        }

        if (lexer->lookahead == '}') {
            return true;
        }

        if (lexer->is_at_included_range_start(lexer)) {
            return true;
        }

        if (is_line_terminator(lexer->lookahead)) {
            break;
        }

        if (!is_whitespace(lexer->lookahead)) {
            if (resource_symbols && !resource_line_break && is_identifier_part(lexer->lookahead) &&
                !is_ascii_digit(lexer->lookahead)) {
                bool infix_operator = false;
                *scanned_content = true;
                if (scan_resource_binding(lexer, resource_symbols[PLAIN_RESOURCE_FOR_OF_CONTEXT], &infix_operator)) {
                    lexer->result_symbol = RESOURCE_BINDING_START;
                    return true;
                }
                return false;
            }
            // Otherwise tree-sitter consumes the comments and calls the scanner again after them.
            return line_break_in_comment && scan_after_line_break(lexer, false, rule, scanned_content, false);
        }

        skip(lexer);
    }

    skip(lexer);
    return scan_after_line_break(lexer, after_block_arrow, rule, scanned_content, false);
}

static bool scan_after_line_break(TSLexer *lexer, bool after_block_arrow, LineBreakRule rule,
                                  bool *scanned_content, bool before_slash) {
    if (after_block_arrow) {
        return before_slash || ends_statement_after_block_arrow(lexer, scanned_content);
    }
    // REJECT means a `/` that starts no comment.
    before_slash = before_slash || scan_whitespace_and_comments(lexer, scanned_content, true, true) == REJECT;
    // A `;` at the start of the next line ends the statement itself.
    if (!before_slash && lexer->lookahead == ';') return false;
    return rule == LINE_BREAK_BY_NEXT_TOKEN
        ? !before_slash && ends_statement_at_next_token(lexer)
        : scan_line_break_rule(lexer, rule, before_slash, scanned_content);
}

static bool scan_line_break_rule(TSLexer *lexer, LineBreakRule rule, bool before_slash, bool *scanned_content) {
    switch (rule) {
        case LINE_BREAK_AWAIT_OPERAND:
            return false;
        case LINE_BREAK_AFTER_AWAIT_KEYWORD:
            return scan_line_break_after_await(lexer, before_slash, scanned_content);
        case LINE_BREAK_ENDS:
            // A token that can start a statement starts the next one; any other token is left to the rules below,
            // which keep a bare `yield` continued by an enclosing `,` or `:`, and `yield` as a script's identifier
            // continued by an operator.
            return before_slash || lexer->lookahead == '`' || lexer->lookahead == '[' || lexer->lookahead == '(' ||
                   lexer->lookahead == '+' || lexer->lookahead == '-' || lexer->lookahead == '<' ||
                   ends_statement_at_next_token(lexer);
        case LINE_BREAK_AFTER_FIELD_NAME:
            return before_slash || (lexer->lookahead != '=' && lexer->lookahead != '(');
        case LINE_BREAK_AFTER_MODIFIER_WORD:
            return !before_slash && (lexer->lookahead == '}' || lexer->lookahead == '@' || lexer_eof(lexer));
        case LINE_BREAK_BEFORE_FROM_CLAUSE:
        case LINE_BREAK_BEFORE_IMPORT_ATTRIBUTES:
            return before_slash || !scan_word(lexer, rule == LINE_BREAK_BEFORE_FROM_CLAUSE ? "from" : "with");
        case LINE_BREAK_AFTER_ACCESSOR_WORD:
            return !before_slash && (lexer->lookahead == '}' || lexer->lookahead == '@' || lexer->lookahead == '*' ||
                                     lexer_eof(lexer));
        default:
            return !before_slash && ends_statement_at_next_token(lexer);
    }
}

static bool scan_line_break_after_await(TSLexer *lexer, bool before_slash, bool *scanned_content) {
    if (!before_slash && lexer->lookahead == '{') {
        lexer->result_symbol = AWAIT_IDENTIFIER_LINE_BREAK;
        return true;
    }
    if (before_slash) return false;
    if (is_identifier_part(lexer->lookahead) && !is_ascii_digit(lexer->lookahead)) {
        return scan_await_line_break_identifier(lexer, scanned_content);
    }
    if (starts_await_operand_punctuation(lexer->lookahead) || is_ascii_digit(lexer->lookahead)) {
        return false;
    }
    return ends_statement_at_next_token(lexer);
}

static bool starts_await_operand_punctuation(int32_t c) {
    return c == '.' || c == '[' || c == '(' || c == '`' || c == '\'' || c == '"' ||
           c == '/' || c == '+' || c == '-' || c == '!' || c == '~' || c == '<';
}

static bool scan_await_line_break_identifier(TSLexer *lexer, bool *scanned_content) {
    *scanned_content = true;
    char word[16];
    unsigned len = scan_identifier(lexer, word, sizeof(word), true);
    if (WORD_EQ(word, len, "yield")) {
        if (!follows_yield_operand(lexer)) lexer->result_symbol = AWAIT_YIELD_IDENTIFIER_START;
        return true;
    }
    if (scan_whitespace_and_comments(lexer, scanned_content, true, true) != REJECT && lexer->lookahead == ':') {
        return true;
    }
    if (WORD_EQ(word, len, "async") && is_async_arrow_start(lexer, scanned_content)) {
        lexer->result_symbol = AWAIT_IDENTIFIER_LINE_BREAK;
        return true;
    }
    if (lexer->lookahead == '=') {
        skip(lexer);
        return lexer->lookahead != '=';
    }
    if (!len) {
        lexer->result_symbol = AWAIT_IDENTIFIER_LINE_BREAK;
        return true;
    }
    if (WORD_EQ(word, len, "import")) {
        return lexer->lookahead != '(' && lexer->lookahead != '.';
    }
    if ((WORD_EQ(word, len, "using") || WORD_EQ(word, len, "let")) &&
        is_identifier_part(lexer->lookahead) && !is_ascii_digit(lexer->lookahead)) {
        char binding[16];
        unsigned binding_len = scan_identifier(lexer, binding, sizeof(binding), true);
        return !is_in_or_instanceof(binding, binding_len);
    }
    if (!is_statement_keyword(word, len)) {
        lexer->result_symbol = AWAIT_IDENTIFIER_LINE_BREAK;
    }
    return true;
}

static bool is_async_arrow_start(TSLexer *lexer, bool *scanned_content) {
    if (is_identifier_part(lexer->lookahead)) {
        scan_identifier(lexer, NULL, 0, true);
        scan_whitespace_and_comments(lexer, scanned_content, true, true);
    }
    return lexer->lookahead == '(';
}

static bool ends_statement_at_next_token(TSLexer *lexer) {
    if (is_line_continuation_token(lexer->lookahead)) return false;
    switch (lexer->lookahead) {
        // Insert a semicolon before decimal literals but not otherwise.
        case '.':
            skip(lexer);
            return is_ascii_digit(lexer->lookahead);
        // Insert a semicolon before `--` and `++`, but not before binary `+` or `-`.
        case '+':
        case '-': {
            int32_t sign = lexer->lookahead;
            skip(lexer);
            return lexer->lookahead == sign;
        }
        // Don't insert a semicolon before `!=`, but do insert one before a unary `!`.
        case '!':
            skip(lexer);
            return lexer->lookahead != '=';
        case 'i':
            return !scan_infix_word(lexer, true);
        default:
            return true;
    }
}

static bool is_line_continuation_token(int32_t c) {
    return c == '`' || c == ',' || c == ':' || c == ';' || c == '*' || c == '%' || c == '>' || c == '<' ||
           c == '=' || c == '[' || c == '(' || c == '?' || c == '^' || c == '|' || c == '&' || c == '/';
}

typedef enum {
    YIELD_TRIVIA_OPERAND,
    YIELD_TRIVIA_NEWLINE,
    YIELD_TRIVIA_REGEX,
} YieldTriviaResult;

static YieldTriviaResult scan_yield_trivia(TSLexer *lexer) {
    for (;;) {
        while (is_whitespace(lexer->lookahead)) {
            if (is_line_terminator(lexer->lookahead)) return YIELD_TRIVIA_NEWLINE;
            skip(lexer);
        }
        if (lexer->lookahead != '/') return YIELD_TRIVIA_OPERAND;
        skip(lexer);
        if (lexer->lookahead == '/') return YIELD_TRIVIA_NEWLINE;
        if (lexer->lookahead != '*') return YIELD_TRIVIA_REGEX;
        skip(lexer);
        bool saw_newline = false;
        if (!scan_block_comment(lexer, &saw_newline, true) || saw_newline) return YIELD_TRIVIA_NEWLINE;
    }
}

static bool follows_yield_operand(TSLexer *lexer) {
    YieldTriviaResult trivia = scan_yield_trivia(lexer);
    if (trivia != YIELD_TRIVIA_OPERAND) return trivia == YIELD_TRIVIA_REGEX;
    if (is_identifier_part(lexer->lookahead)) {
        char word[16];
        unsigned len = scan_identifier(lexer, word, sizeof(word), true);
        return !is_in_or_instanceof(word, len);
    }
    if (lexer->lookahead == '.') {
        skip(lexer);
        return is_ascii_digit(lexer->lookahead);
    }
    if (lexer->lookahead == '+' || lexer->lookahead == '-') {
        int32_t sign = lexer->lookahead;
        skip(lexer);
        if (lexer->lookahead != sign) return false;
        skip(lexer);
        bool scanned_content = false;
        scan_whitespace_and_comments(lexer, &scanned_content, true, true);
        return !lexer_eof(lexer) && lexer->lookahead != ';' && lexer->lookahead != '}' && lexer->lookahead != ')' &&
               lexer->lookahead != ']' && lexer->lookahead != ',' && lexer->lookahead != ':';
    }
    return lexer->lookahead == '*' || lexer->lookahead == ':' || lexer->lookahead == '(' ||
           lexer->lookahead == '[' || lexer->lookahead == '{' || lexer->lookahead == '`' ||
           lexer->lookahead == '\'' || lexer->lookahead == '"' || lexer->lookahead == '!' || lexer->lookahead == '~';
}

static unsigned scan_identifier(TSLexer *lexer, char *word, unsigned capacity, bool skip_contents) {
    unsigned length = 0;
    bool ascii_word = true;
    while (is_identifier_part(lexer->lookahead)) {
        if (lexer->lookahead == '\\') {
            ascii_word = false;
            skip_identifier_escape(lexer, skip_contents);
            continue;
        }
        if (lexer->lookahead > 0x7F || length >= capacity) {
            ascii_word = false;
        } else {
            word[length++] = (char)lexer->lookahead;
        }
        lexer->advance(lexer, skip_contents);
    }
    return ascii_word ? length : 0;
}

static void skip_identifier_escape(TSLexer *lexer, bool skip_contents) {
    lexer->advance(lexer, skip_contents);
    if (lexer->lookahead != 'u') return;
    lexer->advance(lexer, skip_contents);
    if (lexer->lookahead != '{') return;
    lexer->advance(lexer, skip_contents);
    while (hex_digit_value(lexer->lookahead) >= 0) {
        lexer->advance(lexer, skip_contents);
    }
    if (lexer->lookahead == '}') {
        lexer->advance(lexer, skip_contents);
    }
}

static bool scan_ternary_qmark(TSLexer *lexer) {
    for (;;) {
        if (!is_whitespace(lexer->lookahead)) {
            break;
        }
        skip(lexer);
    }

    if (lexer->lookahead == '?') {
        advance(lexer);

        if (lexer->lookahead == '?') {
            return false;
        }

        lexer->mark_end(lexer);
        lexer->result_symbol = TERNARY_QMARK;

        if (lexer->lookahead == '.') {
            advance(lexer);
            if (is_ascii_digit(lexer->lookahead)) {
                return true;
            }
            return false;
        }
        return true;
    }
    return false;
}

static bool scan_html_comment(TSLexer *lexer) {
    while (is_whitespace(lexer->lookahead)) {
        skip(lexer);
    }
    if ((lexer->lookahead != '<' && lexer->lookahead != '-') || !scan_html_comment_line(lexer)) {
        return false;
    }
    lexer->result_symbol = HTML_COMMENT;
    lexer->mark_end(lexer);
    return true;
}

static bool scan_html_comment_line(TSLexer *lexer) {
    const char *opening = lexer->lookahead == '<' ? "<!--" : "-->";
    for (; *opening; opening++) {
        if (lexer->lookahead != *opening) return false;
        advance(lexer);
    }
    while (!lexer_eof(lexer) && !is_line_terminator(lexer->lookahead)) {
        advance(lexer);
    }
    return true;
}

static bool scan_infix_word(TSLexer *lexer, bool skip_characters) {
    char word[16];
    unsigned len = scan_identifier(lexer, word, sizeof(word), skip_characters);
    return is_in_or_instanceof(word, len);
}

// code-gauge-allow functionCognitiveComplexity 30 -- Expression-boundary cases share mutable newline and semicolon-pending state.
// code-gauge-allow functionNcss 60 -- Token-boundary decisions retain scanner state and consumed-input order within a single lookahead pass.
// code-gauge-allow duplicateLines 29 -- Operator cases share syntax across probes but intentionally make different statement-boundary decisions.
static bool scan_expression_end(Scanner *scanner, TSLexer *lexer, bool after_postfix, const bool *valid_symbols) {
    lexer->mark_end(lexer);
    lexer->result_symbol = after_postfix ? POSTFIX_UPDATE_END : AWAIT_OPERAND_END;
    bool saw_newline = false;
    if (!scan_expression_trivia(lexer, &saw_newline, NULL, true)) return valid_symbols[AWAIT_OPERAND_END] || after_postfix;
    if (valid_symbols[RESOURCE_BINDING_START] || valid_symbols[RESOURCE_BINDING_CONTINUATION] ||
        valid_symbols[PLAIN_RESOURCE_FOR_OF_CONTEXT]) {
        bool first_binding = valid_symbols[RESOURCE_BINDING_START] || valid_symbols[PLAIN_RESOURCE_FOR_OF_CONTEXT];
        if (!(saw_newline && first_binding) && is_identifier_part(lexer->lookahead) && !is_ascii_digit(lexer->lookahead)) {
            bool infix_operator = false;
            if (scan_resource_binding(lexer, valid_symbols[PLAIN_RESOURCE_FOR_OF_CONTEXT], &infix_operator)) {
                lexer->result_symbol = valid_symbols[RESOURCE_BINDING_START] ? RESOURCE_BINDING_START : RESOURCE_BINDING_CONTINUATION;
                return true;
            }
            return infix_operator && valid_symbols[AWAIT_OPERAND_END];
        }
        if (!valid_symbols[AWAIT_OPERAND_END]) {
            return false;
        }
    }
    if (after_postfix && lexer->lookahead != '(' && lexer->lookahead != '[' && lexer->lookahead != '`') {
        if (lexer->lookahead == '.') {
            skip(lexer);
            return saw_newline && is_ascii_digit(lexer->lookahead);
        }
        return true;
    }
    switch (lexer->lookahead) {
        case '(':
        case '[':
        case '`': {
            bool statement_end = after_postfix && saw_newline;
            scanner->automatic_semicolon_pending |= statement_end;
            return statement_end;
        }
        case '?':
            skip(lexer);
            return lexer->lookahead != '.';
        case 'i':
            return scan_infix_word(lexer, true) || saw_newline;
        case '!':
        case '=':
        case '*':
        case '%':
        case '<':
        case '>':
        case '^':
        case '|':
        case '&':
            return true;
        case '.':
            skip(lexer);
            return is_ascii_digit(lexer->lookahead);
        case '+':
        case '-': {
            int32_t sign = lexer->lookahead;
            skip(lexer);
            return lexer->lookahead != sign || saw_newline;
        }
        case ';':
        case ',':
        case ':':
        case ')':
        case ']':
        case '}':
            return true;
        default:
            return lexer->eof(lexer) || saw_newline;
    }
}

static bool scan_identifier_unicode_escape(TSLexer *lexer, uint32_t *code_point);
static bool check_resource_binding_word(TSLexer *lexer, const char *word, unsigned word_len, bool plain_for_of);

static bool scan_resource_binding(TSLexer *lexer, bool plain_for_of, bool *infix_operator) {
    char word[16];
    unsigned length = 0;
    bool ascii_word = true;
    bool escaped = false;
    while (is_identifier_part(lexer->lookahead)) {
        uint32_t character = (uint32_t)lexer->lookahead;
        if (character == '\\') {
            escaped = true;
            if (!scan_identifier_unicode_escape(lexer, &character)) return false;
        } else {
            advance(lexer);
        }
        if (character > 0x7F || length >= sizeof(word)) ascii_word = false;
        else word[length++] = (char)character;
    }
    unsigned word_len = ascii_word ? length : 0;
    *infix_operator = !escaped && is_in_or_instanceof(word, word_len);
    return check_resource_binding_word(lexer, word, word_len, plain_for_of);
}

static bool check_resource_binding_word(TSLexer *lexer, const char *word, unsigned word_len, bool plain_for_of) {
    if (plain_for_of && WORD_EQ(word, word_len, "of")) {
        bool scanned_content = false;
        return scan_whitespace_and_comments(lexer, &scanned_content, true, false) != REJECT && lexer->lookahead == '=';
    }
    return !word_len || (!WORD_EQ(word, word_len, "enum") && !is_reserved_word(word, word_len));
}

static bool scan_identifier_unicode_escape(TSLexer *lexer, uint32_t *code_point) {
    advance(lexer);
    if (lexer->lookahead != 'u') return false;
    advance(lexer);
    bool braced = lexer->lookahead == '{';
    if (braced) advance(lexer);
    uint32_t value = 0;
    unsigned digits = 0;
    int digit;
    while ((digit = hex_digit_value(lexer->lookahead)) >= 0 && (braced || digits < 4)) {
        value = value > 0x7F ? 0x80 : value * 16 + (unsigned)digit;
        advance(lexer);
        digits++;
    }
    if (braced) {
        if (digits == 0 || lexer->lookahead != '}') return false;
        advance(lexer);
    } else if (digits != 4) {
        return false;
    }
    *code_point = value;
    return true;
}

#ifndef JAVASCRIPT_SCRIPT_GOAL
#define JAVASCRIPT_SCRIPT_GOAL false
#endif

static bool scan_yield(Scanner *scanner, TSLexer *lexer, const bool *valid_symbols, bool await_operand) {
    bool scanned_content = false;
    if (scan_whitespace_and_comments(lexer, &scanned_content, true, true) == REJECT || scanned_content) return false;
    for (const char *word = "yield"; *word; word++) {
        if (lexer->lookahead != *word) return false;
        advance(lexer);
    }
    if (is_identifier_part(lexer->lookahead)) return false;
    bool identifier = (scanner->functions.depth || JAVASCRIPT_SCRIPT_GOAL) && !function_context_generator(&scanner->functions);
    TSSymbol identifier_symbol = valid_symbols[CLASS_HERITAGE_YIELD_IDENTIFIER] ? CLASS_HERITAGE_YIELD_IDENTIFIER : YIELD_IDENTIFIER;
    TSSymbol symbol = await_operand ? AWAIT_YIELD_IDENTIFIER : identifier ? identifier_symbol : YIELD_KEYWORD;
    bool forbidden_identifier = symbol == YIELD_KEYWORD && valid_symbols[CLASS_HERITAGE_YIELD_IDENTIFIER];
    if (!valid_symbols[symbol] && !forbidden_identifier) return false;
    lexer->mark_end(lexer);
    lexer->result_symbol = symbol;
    return true;
}

static bool scan_await_or_async(Scanner *scanner, TSLexer *lexer, const bool *valid_symbols) {
    lexer->mark_end(lexer);
    char keyword[16];
    unsigned len = scan_identifier(lexer, keyword, sizeof(keyword), false);
    if (WORD_EQ(keyword, len, "async")) return scan_async_start(lexer, valid_symbols);
    if (!WORD_EQ(keyword, len, "await")) return false;
    bool identifier = await_is_identifier(scanner);
    TSSymbol identifier_symbol = valid_symbols[CLASS_HERITAGE_AWAIT_IDENTIFIER] ? CLASS_HERITAGE_AWAIT_IDENTIFIER : AWAIT_IDENTIFIER;
    TSSymbol symbol = identifier ? identifier_symbol : AWAIT_KEYWORD;
    bool forbidden_identifier = !identifier && valid_symbols[CLASS_HERITAGE_AWAIT_IDENTIFIER];
    if (!valid_symbols[symbol] && !forbidden_identifier) return false;
    lexer->mark_end(lexer);
    lexer->result_symbol = symbol;
    return true;
}

static bool await_is_identifier(const Scanner *scanner) {
    return scanner->functions.depth ? !function_context_async(&scanner->functions) : JAVASCRIPT_SCRIPT_GOAL;
}

static bool scan_async_start(TSLexer *lexer, const bool *valid_symbols) {
    bool constructor = valid_symbols[CONSTRUCTOR_ASYNC_FUNCTION_START];
    if (!constructor) lexer->mark_end(lexer);
    lexer->result_symbol = constructor ? CONSTRUCTOR_ASYNC_FUNCTION_START : ASYNC_KEYWORD;
    if (!scan_keyword_trivia(lexer, false, true)) return false;
    if (!constructor) return valid_symbols[ASYNC_KEYWORD];
    char keyword[16];
    unsigned len = scan_identifier(lexer, keyword, sizeof(keyword), false);
    return WORD_EQ(keyword, len, "function");
}

static bool scan_contextual_keyword(Scanner *scanner, TSLexer *lexer, const bool *valid_symbols) {
    if ((valid_symbols[DECLARATION_FUNCTION_KEYWORD] || valid_symbols[DECLARATION_CLASS_KEYWORD]) &&
        !(valid_symbols[TEMPLATE_CHARS] && valid_symbols[AUTOMATIC_SEMICOLON]) &&
        (lexer->lookahead == 'f' || lexer->lookahead == 'c')) {
        return scan_declaration_keyword(lexer, valid_symbols);
    }
    if ((valid_symbols[AWAIT_KEYWORD] || valid_symbols[AWAIT_IDENTIFIER] || valid_symbols[CLASS_HERITAGE_AWAIT_IDENTIFIER] || valid_symbols[CONSTRUCTOR_ASYNC_FUNCTION_START] || valid_symbols[ASYNC_KEYWORD]) && lexer->lookahead == 'a') {
        return scan_await_or_async(scanner, lexer, valid_symbols);
    }
    if ((valid_symbols[YIELD_KEYWORD] || valid_symbols[YIELD_IDENTIFIER] || valid_symbols[CLASS_HERITAGE_YIELD_IDENTIFIER]) && lexer->lookahead == 'y') {
        return scan_yield(scanner, lexer, valid_symbols, false);
    }
    if (valid_symbols[LET] && !valid_symbols[SINGLE_STATEMENT_CONTEXT] && lexer->lookahead == 'l') {
        lexer->result_symbol = LET;
        return scan_let(lexer);
    }
    return false;
}

static bool scan_declaration_keyword(TSLexer *lexer, const bool *valid_symbols) {
    char word[16];
    unsigned len = scan_identifier(lexer, word, sizeof(word), false);
    if (WORD_EQ(word, len, "function")) lexer->result_symbol = DECLARATION_FUNCTION_KEYWORD;
    else if (WORD_EQ(word, len, "class")) lexer->result_symbol = DECLARATION_CLASS_KEYWORD;
    else return false;
    lexer->mark_end(lexer);
    return valid_symbols[lexer->result_symbol];
}

// code-gauge-allow functionNcss 43 -- Arrow boundaries share newline state and the ternary-permission output from one trivia scan.
static bool scan_arrow_context_end(TSLexer *lexer, bool *can_scan_ternary) {
    lexer->mark_end(lexer);
    bool saw_newline = false;
    bool scanned_comment = false;
    if (!scan_expression_trivia(lexer, &saw_newline, &scanned_comment, true)) return false;
    *can_scan_ternary = !scanned_comment && lexer->lookahead == '?';
    switch (lexer->lookahead) {
        case '(': case '[': case '`': case '?': case '=': case '*': case '%':
        case '<': case '>': case '^': case '|': case '&': return false;
        case '!': advance(lexer); return lexer->lookahead != '=';
        case '.': advance(lexer); return saw_newline && is_ascii_digit(lexer->lookahead);
        case '+': case '-': {
            int32_t sign = lexer->lookahead;
            advance(lexer);
            return saw_newline && lexer->lookahead == sign;
        }
        case 'i':
            return !scan_infix_word(lexer, false);
        case ';': case ',': case ':': case ')': case ']': case '}': return true;
        default: return lexer->eof(lexer) || saw_newline;
    }
}

static bool scan_expression_trivia(TSLexer *lexer, bool *saw_newline, bool *scanned_comment, bool skip_contents) {
    for (;;) {
        while (is_whitespace(lexer->lookahead)) {
            *saw_newline |= is_line_terminator(lexer->lookahead);
            lexer->advance(lexer, skip_contents);
        }
        if (lexer->lookahead != '/') return true;
        if (scanned_comment) *scanned_comment = true;
        if (!scan_slash_comment(lexer, saw_newline, skip_contents, false)) return false;
    }
}

static bool scan_slash_comment(TSLexer *lexer, bool *saw_newline, bool skip_contents, bool require_closed) {
    lexer->advance(lexer, skip_contents);
    if (lexer->lookahead == '/') {
        while (!lexer_eof(lexer) && !is_line_terminator(lexer->lookahead)) {
            lexer->advance(lexer, skip_contents);
        }
        return true;
    }
    if (lexer->lookahead != '*') return false;
    lexer->advance(lexer, skip_contents);
    return scan_block_comment(lexer, saw_newline, skip_contents) || !require_closed;
}

static bool scan_function_start(Scanner *scanner, TSLexer *lexer, const bool *valid_symbols) {
    bool generator = valid_symbols[GENERATOR_FUNCTION_START] || valid_symbols[ASYNC_GENERATOR_FUNCTION_START];
    bool signature = valid_symbols[FUNCTION_SIGNATURE_START] || valid_symbols[ASYNC_FUNCTION_SIGNATURE_START];
    bool body = valid_symbols[SYNC_FUNCTION_START] || valid_symbols[ASYNC_FUNCTION_START];
    bool opener = lexer->lookahead == '(' || (generator && lexer->lookahead == '{');
    if (!body && (!(opener && (generator || signature)) || valid_symbols[CALL_ARGUMENTS_CONTEXT])) return false;
    bool async = valid_symbols[ASYNC_FUNCTION_START] || valid_symbols[ASYNC_GENERATOR_FUNCTION_START] || valid_symbols[ASYNC_FUNCTION_SIGNATURE_START];
    if (!function_context_enter(&scanner->functions, async, generator)) return false;
    lexer->mark_end(lexer);
    static const TSSymbol symbols[][2] = {
        {SYNC_FUNCTION_START, ASYNC_FUNCTION_START},
        {FUNCTION_SIGNATURE_START, ASYNC_FUNCTION_SIGNATURE_START},
        {GENERATOR_FUNCTION_START, ASYNC_GENERATOR_FUNCTION_START},
    };
    lexer->result_symbol = symbols[generator ? 2 : signature ? 1 : 0][async];
    return true;
}

static bool scan_function_context(Scanner *scanner, TSLexer *lexer, const bool *valid_symbols) {
    if (scan_function_start(scanner, lexer, valid_symbols)) return true;
    if (valid_symbols[FUNCTION_CONTEXT_END]) {
        lexer->mark_end(lexer);
        if (scanner->automatic_semicolon_pending && valid_symbols[ARROW_FUNCTION_BLOCK_CONTINUATION]) {
            bool saw_newline = false;
            scan_expression_trivia(lexer, &saw_newline, NULL, true);
            if (lexer->lookahead == ':' || lexer->lookahead == '}' || lexer->lookahead == ')' || lexer->lookahead == ']') {
                scanner->automatic_semicolon_pending = false;
                lexer->result_symbol = ARROW_FUNCTION_BLOCK_CONTINUATION;
                return true;
            }
        }
        if (valid_symbols[ARROW_FUNCTION_BLOCK_END]) {
            bool scanned_content = false;
            if (scan_automatic_semicolon(lexer, true, LINE_BREAK_BY_NEXT_TOKEN, &scanned_content, NULL)) {
                scanner->automatic_semicolon_pending = true;
                lexer->result_symbol = ARROW_FUNCTION_BLOCK_END;
                return true;
            }
        }
        function_context_leave(&scanner->functions);
        lexer->result_symbol = FUNCTION_CONTEXT_END;
        return true;
    }
    return false;
}

bool tree_sitter_javascript_external_scanner_scan(void *payload, TSLexer *lexer, const bool *valid_symbols) {
    Scanner *scanner = (Scanner *)payload;

    if (!(valid_symbols[TEMPLATE_CHARS] && valid_symbols[AUTOMATIC_SEMICOLON])) {
        if (scan_function_context(scanner, lexer, valid_symbols)) return true;
        if (valid_symbols[ARROW_CONTEXT_END] &&
            !(valid_symbols[LINE_BREAK_AFTER_AWAIT] && scanner->functions.depth && function_context_async(&scanner->functions))) {
            lexer->mark_end(lexer);
            bool can_scan_ternary = false;
            if (!scanner->automatic_semicolon_pending && !scan_arrow_context_end(lexer, &can_scan_ternary)) {
                return valid_symbols[TERNARY_QMARK] && can_scan_ternary && scan_ternary_qmark(lexer);
            }
            function_context_leave(&scanner->functions);
            lexer->result_symbol = ARROW_CONTEXT_END;
            return true;
        }
    }

    if (valid_symbols[CLASS_HERITAGE_END] && !(valid_symbols[TEMPLATE_CHARS] && valid_symbols[AUTOMATIC_SEMICOLON])) {
        return scan_class_heritage_end(lexer, valid_symbols[HTML_COMMENT]);
    }

    if (valid_symbols[LINE_BREAK_AFTER_BINDING] &&
        !(valid_symbols[TEMPLATE_CHARS] && valid_symbols[AUTOMATIC_SEMICOLON])) {
        return scan_binding_end(scanner, lexer);
    }

    if (valid_symbols[REGEX_FLAGS_START] && !valid_symbols[AUTOMATIC_SEMICOLON]) {
        if (lexer->lookahead != '/') return false;
        lexer->mark_end(lexer);
        advance(lexer);
        if (lexer->lookahead < 'a' || lexer->lookahead > 'z') return false;
        lexer->result_symbol = REGEX_FLAGS_START;
        return true;
    }

    if (valid_symbols[ARGUMENTLESS_NEW_END] && !(valid_symbols[TEMPLATE_CHARS] && valid_symbols[AUTOMATIC_SEMICOLON])) {
        lexer->mark_end(lexer);
        lexer->result_symbol = ARGUMENTLESS_NEW_END;
        bool scanned_content = false;
        if (scan_whitespace_and_comments(lexer, &scanned_content, true, false) == REJECT) return true;
        if (lexer->lookahead == '(' || lexer->lookahead == '[' || lexer->lookahead == '`') return false;
        if (lexer->lookahead == '.') {
            advance(lexer);
            return is_ascii_digit(lexer->lookahead);
        }
        if (lexer->lookahead == '?') {
            advance(lexer);
            if (lexer->lookahead == '.') {
                advance(lexer);
                return is_ascii_digit(lexer->lookahead);
            }
        }
        return true;
    }

    if (valid_symbols[TEMPLATE_CHARS]) {
        if (valid_symbols[AUTOMATIC_SEMICOLON]) {
            return false;
        }
        if (valid_symbols[TEMPLATE_ESCAPE_SEQUENCE] && lexer->lookahead == '\\') {
            return scan_template_escape(lexer, TEMPLATE_ESCAPE_SEQUENCE);
        }
        return scan_template_chars(lexer, TEMPLATE_CHARS);
    }

    if (valid_symbols[EXPORT_DEFAULT] ||
        (valid_symbols[DEFAULT_DECLARATION_START] && scanner->default_declaration_pending)) {
        while (is_whitespace(lexer->lookahead)) skip(lexer);
        if (valid_symbols[EXPORT_DEFAULT] && lexer->lookahead == 'd') {
            return scan_export_default(scanner, lexer);
        }
        if (valid_symbols[DEFAULT_DECLARATION_START] && scanner->default_declaration_pending &&
            (lexer->lookahead == '@' || lexer->lookahead == 'a' || lexer->lookahead == 'c' || lexer->lookahead == 'f')) {
            lexer->mark_end(lexer);
            lexer->result_symbol = DEFAULT_DECLARATION_START;
            scanner->default_declaration_pending = false;
            return true;
        }
    }

    if (valid_symbols[POSTFIX_UPDATE_END]) {
        return scan_expression_end(scanner, lexer, true, valid_symbols);
    }

    if (scanner->automatic_semicolon_pending && valid_symbols[AWAIT_OPERAND_END] &&
        !valid_symbols[COMPLETED_ARROW_FUNCTION] && !valid_symbols[LINE_BREAK_AFTER_AWAIT]) {
        lexer->mark_end(lexer);
        lexer->result_symbol = AWAIT_OPERAND_END;
        return true;
    }

    if (scanner->automatic_semicolon_pending && valid_symbols[AUTOMATIC_SEMICOLON]) {
        scanner->automatic_semicolon_pending = false;
        lexer->result_symbol = AUTOMATIC_SEMICOLON;
        lexer->mark_end(lexer);
        return true;
    }

    if (valid_symbols[JSX_TEXT] && scan_jsx_text(lexer, JSX_TEXT)) {
        return true;
    }

    if (valid_symbols[AWAIT_YIELD_IDENTIFIER_CONTEXT] && valid_symbols[AWAIT_YIELD_IDENTIFIER]) {
        return scan_yield(scanner, lexer, valid_symbols, true);
    }

    if (!valid_symbols[AWAIT_OPERAND_END] &&
        (valid_symbols[RESOURCE_BINDING_START] || valid_symbols[PLAIN_RESOURCE_FOR_OF_CONTEXT])) {
        bool scanned_content = false;
        bool ret = scan_automatic_semicolon(lexer, false, LINE_BREAK_BY_NEXT_TOKEN,
                                            &scanned_content, valid_symbols);
        if (ret && lexer->result_symbol == AUTOMATIC_SEMICOLON) {
            if (!valid_symbols[AUTOMATIC_SEMICOLON]) {
                return false;
            }
            if (valid_symbols[STATEMENT_BOUNDARY]) {
                lexer->result_symbol = STATEMENT_BOUNDARY;
            }
        }
        if (!ret && !scanned_content && valid_symbols[TERNARY_QMARK] && lexer->lookahead == '?') {
            return scan_ternary_qmark(lexer);
        }
        return ret;
    }

    if ((valid_symbols[AWAIT_OPERAND_END] && !valid_symbols[LINE_BREAK_AFTER_AWAIT]) ||
        valid_symbols[RESOURCE_BINDING_START] || valid_symbols[RESOURCE_BINDING_CONTINUATION] ||
        valid_symbols[PLAIN_RESOURCE_FOR_OF_CONTEXT]) {
        if (valid_symbols[COMPLETED_ARROW_FUNCTION]) {
            return false;
        }
        return scan_expression_end(scanner, lexer, false, valid_symbols);
    }

    if (valid_symbols[AUTOMATIC_SEMICOLON]) {
        bool scanned_content = false;
        LineBreakRule rule = LINE_BREAK_BY_NEXT_TOKEN;
        if (valid_symbols[LINE_BREAK_AFTER_AWAIT]) {
            rule = await_is_identifier(scanner) ? LINE_BREAK_AFTER_AWAIT_KEYWORD : LINE_BREAK_AWAIT_OPERAND;
        } else if (valid_symbols[LINE_BREAK_ENDS_STATEMENT]) {
            rule = LINE_BREAK_ENDS;
        } else if (valid_symbols[LINE_BREAK_AFTER_MODIFIER]) {
            rule = valid_symbols[LINE_BREAK_AFTER_FIELD] ? LINE_BREAK_AFTER_ACCESSOR_WORD : LINE_BREAK_AFTER_MODIFIER_WORD;
        } else if (valid_symbols[LINE_BREAK_AFTER_FIELD]) {
            rule = LINE_BREAK_AFTER_FIELD_NAME;
        } else if (valid_symbols[LINE_BREAK_BEFORE_ATTRIBUTES]) {
            rule = LINE_BREAK_BEFORE_IMPORT_ATTRIBUTES;
        } else if (valid_symbols[LINE_BREAK_BEFORE_FROM]) {
            rule = LINE_BREAK_BEFORE_FROM_CLAUSE;
        }
        bool ret = scan_automatic_semicolon(lexer, false, rule, &scanned_content, NULL);
        if (ret && valid_symbols[STATEMENT_BOUNDARY] && lexer->result_symbol == AUTOMATIC_SEMICOLON) {
            lexer->result_symbol = STATEMENT_BOUNDARY;
        }
        if (!ret && !scanned_content && valid_symbols[TERNARY_QMARK] && lexer->lookahead == '?') {
            return scan_ternary_qmark(lexer);
        }
        if (!ret && !scanned_content && valid_symbols[AWAIT_YIELD_IDENTIFIER] && valid_symbols[LINE_BREAK_AFTER_AWAIT] && lexer->lookahead == 'y') {
            return scan_yield(scanner, lexer, valid_symbols, true);
        }
        if (!ret && !scanned_content && (lexer->lookahead == '(' || lexer->lookahead == '{') && scan_function_context(scanner, lexer, valid_symbols)) return true;
        if (!ret && !scanned_content) return scan_contextual_keyword(scanner, lexer, valid_symbols);
        return ret;
    }

    if (valid_symbols[AWAIT_YIELD_IDENTIFIER] && valid_symbols[LINE_BREAK_AFTER_AWAIT]) {
        while (is_whitespace(lexer->lookahead)) {
            skip(lexer);
        }
        if (lexer->lookahead == 'y') {
            return scan_yield(scanner, lexer, valid_symbols, true);
        }
    }

    while (is_whitespace(lexer->lookahead)) {
        skip(lexer);
    }
    if ((lexer->lookahead == '(' || lexer->lookahead == '{') && scan_function_context(scanner, lexer, valid_symbols)) return true;
    if (valid_symbols[TERNARY_QMARK] && lexer->lookahead == '?') {
        return scan_ternary_qmark(lexer);
    }

    if (valid_symbols[HTML_COMMENT] && !valid_symbols[LOGICAL_OR] && !valid_symbols[ESCAPE_SEQUENCE] &&
        !valid_symbols[REGEX_PATTERN] && (lexer->lookahead == '<' || lexer->lookahead == '-')) {
        return scan_html_comment(lexer);
    }
    return scan_contextual_keyword(scanner, lexer, valid_symbols);
}

static bool scan_binding_end(Scanner *scanner, TSLexer *lexer) {
    lexer->mark_end(lexer);
    bool saw_newline = false;
    bool trivia = scan_expression_trivia(lexer, &saw_newline, NULL, false);
    if (trivia && lexer->lookahead == '=') return false;
    bool separator = trivia && (lexer->lookahead == ',' || lexer->lookahead == ';');
    scanner->automatic_semicolon_pending |= !separator &&
        (saw_newline || lexer->eof(lexer) || lexer->lookahead == '}' || lexer->is_at_included_range_start(lexer));
    lexer->result_symbol = LINE_BREAK_AFTER_BINDING;
    return true;
}

static bool scan_let(TSLexer *lexer) {
    for (const char *word = "let"; *word; word++) {
        if (lexer->lookahead != *word) return false;
        advance(lexer);
    }
    if (is_identifier_part(lexer->lookahead)) return false;
    lexer->mark_end(lexer);
    if (!scan_keyword_trivia(lexer, true, false)) return false;
    if (lexer->lookahead == '[' || lexer->lookahead == '{') return true;
    if (!is_identifier_part(lexer->lookahead) || is_ascii_digit(lexer->lookahead)) return false;
    char name[12];
    unsigned length = 0;
    while (is_identifier_part(lexer->lookahead)) {
        if (length == sizeof(name)) return true;
        name[length++] = lexer->lookahead < 0x80 ? (char)lexer->lookahead : '?';
        advance(lexer);
    }
    return !is_reserved_word(name, length);
}

static bool is_statement_keyword(const char *word, unsigned length) {
    return is_reserved_statement_keyword(word, length) || WORD_EQ(word, length, "enum");
}

static bool is_reserved_word(const char *name, unsigned length) {
    return is_reserved_statement_keyword(name, length) || is_non_statement_reserved_word(name, length);
}

static bool is_reserved_statement_keyword(const char *word, unsigned length) {
    switch (length) {
        case 2: return WORD_EQ(word, length, "do") || WORD_EQ(word, length, "if");
        case 3: return WORD_EQ(word, length, "for") || WORD_EQ(word, length, "try") || WORD_EQ(word, length, "var");
        case 4: return WORD_EQ(word, length, "case") || WORD_EQ(word, length, "else") || WORD_EQ(word, length, "with");
        case 5:
            return WORD_EQ(word, length, "break") || WORD_EQ(word, length, "catch") || WORD_EQ(word, length, "const") ||
                   WORD_EQ(word, length, "throw") || WORD_EQ(word, length, "while");
        case 6: return WORD_EQ(word, length, "export") || WORD_EQ(word, length, "return") || WORD_EQ(word, length, "switch");
        case 7: return WORD_EQ(word, length, "default") || WORD_EQ(word, length, "finally");
        case 8: return WORD_EQ(word, length, "continue") || WORD_EQ(word, length, "debugger");
        default: return false;
    }
}

static bool is_non_statement_reserved_word(const char *word, unsigned length) {
    switch (length) {
        case 2: return WORD_EQ(word, length, "in");
        case 3: return WORD_EQ(word, length, "new");
        case 4:
            return WORD_EQ(word, length, "null") || WORD_EQ(word, length, "this") || WORD_EQ(word, length, "true") ||
                   WORD_EQ(word, length, "void");
        case 5: return WORD_EQ(word, length, "class") || WORD_EQ(word, length, "false") || WORD_EQ(word, length, "super");
        case 6: return WORD_EQ(word, length, "delete") || WORD_EQ(word, length, "import") || WORD_EQ(word, length, "typeof");
        case 7: return WORD_EQ(word, length, "extends");
        case 8: return WORD_EQ(word, length, "function");
        case 10: return WORD_EQ(word, length, "instanceof");
        default: return false;
    }
}

static bool scan_export_default(Scanner *scanner, TSLexer *lexer) {
    while (is_whitespace(lexer->lookahead)) {
        skip(lexer);
    }
    for (const char *word = "default"; *word; word++) {
        if (lexer->lookahead != *word) {
            return false;
        }
        advance(lexer);
    }
    if (is_identifier_part(lexer->lookahead)) {
        return false;
    }
    lexer->mark_end(lexer);
    scanner->default_declaration_pending = starts_default_declaration(lexer);
    lexer->result_symbol = scanner->default_declaration_pending ? EXPORT_DEFAULT_DECLARATION : EXPORT_DEFAULT;
    return true;
}

static bool starts_default_declaration(TSLexer *lexer) {
    if (!scan_keyword_trivia(lexer, true, true)) return false;
    if (lexer->lookahead == '@') return true;
    char word[16];
    unsigned len = scan_identifier(lexer, word, sizeof(word), false);
    if (WORD_EQ(word, len, "function") || WORD_EQ(word, len, "class")) return true;
    if (!WORD_EQ(word, len, "async") || !scan_keyword_trivia(lexer, false, true)) return false;
    len = scan_identifier(lexer, word, sizeof(word), false);
    return WORD_EQ(word, len, "function");
}

static bool skip_trivia_whitespace(TSLexer *lexer, bool allow_line_breaks, bool *at_line_start);

static bool scan_keyword_trivia(TSLexer *lexer, bool allow_line_breaks, bool at_line_start) {
    while (skip_trivia_whitespace(lexer, allow_line_breaks, &at_line_start)) {
        if (lexer->lookahead == '<' || (at_line_start && lexer->lookahead == '-')) {
            if (!scan_html_comment_line(lexer)) return false;
            continue;
        }
        if (lexer->lookahead != '/') return true;
        bool comment_newline = false;
        if (!scan_slash_comment(lexer, &comment_newline, false, true) || (!allow_line_breaks && comment_newline)) {
            return false;
        }
        at_line_start |= comment_newline;
    }
    return false;
}

static bool skip_trivia_whitespace(TSLexer *lexer, bool allow_line_breaks, bool *at_line_start) {
    while (is_whitespace(lexer->lookahead)) {
        bool newline = is_line_terminator(lexer->lookahead);
        if (!allow_line_breaks && newline) return false;
        *at_line_start |= newline;
        advance(lexer);
    }
    return true;
}

// code-gauge-allow functionNcss 36 -- Class heritage decisions share the cursor and newline state after trivia and optional HTML comments.
static bool scan_class_heritage_end(TSLexer *lexer, bool allow_html_comment) {
    lexer->mark_end(lexer);
    bool saw_newline = false;
    while (is_whitespace(lexer->lookahead)) {
        saw_newline |= is_line_terminator(lexer->lookahead);
        skip(lexer);
    }
    int32_t c = lexer->lookahead;
    switch (c) {
        case '<':
        case '-':
            if (allow_html_comment && scan_html_comment(lexer)) return true;
            break;
        case '/':
            advance(lexer);
            if (lexer->lookahead == '/' || lexer->lookahead == '*') return false;
            break;
        case 'f':
            if (!saw_newline && scan_word(lexer, "function")) return false;
            break;
        case '.': case '[': case '(': case '`':
            return false;
        case '?':
            advance(lexer);
            if (lexer->lookahead == '.') return false;
            break;
        default:
            break;
    }
    lexer->result_symbol = CLASS_HERITAGE_END;
    return true;
}
