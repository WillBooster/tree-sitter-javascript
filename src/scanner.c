#include "tree_sitter/alloc.h"
#include "tree_sitter/parser.h"

#include <stdio.h>
#include <string.h>

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
};

static bool scan_let(TSLexer *lexer);
static bool is_reserved_word(const char *name);

typedef struct {
    // A reused block arrow or postfix update can bypass the boundary state; serialize the pending semicolon.
    // Nested await end tokens must not clear it before the enclosing statement consumes it.
    bool automatic_semicolon_pending;
} Scanner;

void *tree_sitter_javascript_external_scanner_create() { return ts_calloc(1, sizeof(Scanner)); }

void tree_sitter_javascript_external_scanner_destroy(void *payload) { ts_free(payload); }

unsigned tree_sitter_javascript_external_scanner_serialize(void *payload, char *buffer) {
    Scanner *scanner = (Scanner *)payload;
    buffer[0] = (char)scanner->automatic_semicolon_pending;
    return 1;
}

void tree_sitter_javascript_external_scanner_deserialize(void *payload, const char *buffer, unsigned length) {
    Scanner *scanner = (Scanner *)payload;
    scanner->automatic_semicolon_pending = length > 0 && buffer[0];
}

static inline void advance(TSLexer *lexer) { lexer->advance(lexer, false); }

static inline void skip(TSLexer *lexer) { lexer->advance(lexer, true); }

static inline bool is_line_terminator(int32_t c) { return c == '\n' || c == '\r' || c == 0x2028 || c == 0x2029; }

// The characters of the whitespace class in the grammar's extras (which includes the line terminators). iswspace
// depends on the C library and locale and differs from that class.
static inline bool is_whitespace(int32_t c) {
    switch (c) {
        case '\t':
        case '\n':
        case '\v':
        case '\f':
        case '\r':
        case ' ':
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

static inline bool is_ascii_letter(int32_t c) { return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z'); }

static inline bool is_ascii_digit(int32_t c) { return c >= '0' && c <= '9'; }

// Counts the characters the grammar's identifiers may continue with (a backslash starts a `\u` escape), with every
// character from U+007F on other than whitespace, which suffices to tell `in` and `instanceof` from the identifiers they
// start.
static inline bool is_identifier_part(int32_t c) {
    return is_ascii_letter(c) || is_ascii_digit(c) || c == '_' || c == '$' || c == '\\' ||
           (c >= 0x7F && !is_whitespace(c));
}

// Consumes the lookahead while it matches `word`, and returns whether the whole word matched and ends there.
static bool scan_word(TSLexer *lexer, const char *word) {
    for (; *word; word++) {
        if (lexer->lookahead != *word) {
            return false;
        }
        skip(lexer);
    }
    return !is_identifier_part(lexer->lookahead);
}

static bool scan_template_chars(TSLexer *lexer) {
    lexer->result_symbol = TEMPLATE_CHARS;
    for (bool has_content = false;; has_content = true) {
        lexer->mark_end(lexer);
        if (lexer->eof(lexer)) {
            return false;
        }
        switch (lexer->lookahead) {
            case '`':
                return has_content;
            case '$':
                advance(lexer);
                if (lexer->lookahead == '{') {
                    return has_content;
                }
                break;
            case '\\':
                return has_content;
            default:
                advance(lexer);
        }
    }
}

typedef enum {
    REJECT,     // Semicolon is illegal, ie a syntax error occurred
    NO_NEWLINE, // Unclear if semicolon will be legal, continue
    ACCEPT,     // Semicolon is legal, assuming a comment was encountered
    // Like ACCEPT, but the line break is inside the block comment that the lexer stopped after, so it will not be seen
    // again once tree-sitter has consumed that comment.
    ACCEPT_IN_BLOCK_COMMENT,
    ACCEPT_IN_BLOCK_COMMENT_BEFORE_SLASH,
} WhitespaceResult;

/**
 * @param consume If false, only consume enough to check if comment indicates semicolon-legality
 */
static WhitespaceResult scan_whitespace_and_comments(TSLexer *lexer, bool *scanned_content, bool consume, bool skip_contents) {
    bool saw_block_newline = false;

    for (;;) {
        while (is_whitespace(lexer->lookahead)) {
            lexer->advance(lexer, skip_contents);
        }

        if (lexer->lookahead == '/') {
            lexer->advance(lexer, skip_contents);

            if (lexer->lookahead == '/') {
                lexer->advance(lexer, skip_contents);
                while (!lexer->eof(lexer) && !is_line_terminator(lexer->lookahead)) {
                    lexer->advance(lexer, skip_contents);
                }
                *scanned_content = true;
            } else if (lexer->lookahead == '*') {
                lexer->advance(lexer, skip_contents);
                while (!lexer->eof(lexer)) {
                    if (lexer->lookahead == '*') {
                        lexer->advance(lexer, skip_contents);
                        if (lexer->lookahead == '/') {
                            lexer->advance(lexer, skip_contents);
                            *scanned_content = true;

                            if (!consume && lexer->lookahead != '/') {
                                return saw_block_newline ? ACCEPT_IN_BLOCK_COMMENT : NO_NEWLINE;
                            }

                            break;
                        }
                    } else if (is_line_terminator(lexer->lookahead)) {
                        saw_block_newline = true;
                        lexer->advance(lexer, skip_contents);
                    } else {
                        lexer->advance(lexer, skip_contents);
                    }
                }
            } else {
                return !consume && saw_block_newline ? ACCEPT_IN_BLOCK_COMMENT_BEFORE_SLASH : REJECT;
            }
        } else {
            return ACCEPT;
        }
    }
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
    // After a declared name without an initializer: only `=` or `,` continues the declaration.
    LINE_BREAK_AFTER_BINDING_NAME,
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
    LINE_BREAK_AFTER_AWAIT_KEYWORD,
} LineBreakRule;

static bool scan_after_line_break(TSLexer *lexer, bool after_block_arrow, LineBreakRule rule, bool *scanned_content, bool before_slash);
static bool scan_identifier(TSLexer *lexer, char *word, unsigned capacity, bool skip_contents);
static bool follows_yield_operand(TSLexer *lexer);
static bool scan_resource_binding(TSLexer *lexer, bool plain_for_of, bool *infix_operator);

static bool scan_automatic_semicolon(TSLexer *lexer, bool comment_condition, bool after_block_arrow,
                                     LineBreakRule rule, bool *scanned_content, const bool *resource_symbols) {
    lexer->result_symbol = AUTOMATIC_SEMICOLON;
    lexer->mark_end(lexer);
    bool line_break_in_block_comment = false;
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
            if (result == ACCEPT_IN_BLOCK_COMMENT_BEFORE_SLASH) {
                return scan_after_line_break(lexer, after_block_arrow, rule, scanned_content, true);
            }

            if (after_block_arrow && lexer->eof(lexer)) {
                return true;
            }

            if (result == NO_NEWLINE && rule == LINE_BREAK_AFTER_AWAIT_KEYWORD) {
                return false;
            }
            if (result == ACCEPT || result == ACCEPT_IN_BLOCK_COMMENT) {
                resource_line_break = true;
                if (after_block_arrow || rule != LINE_BREAK_BY_NEXT_TOKEN) {
                    return scan_after_line_break(lexer, after_block_arrow, rule, scanned_content, false);
                }
                if (comment_condition && lexer->lookahead != ',' && lexer->lookahead != '=') {
                    return true;
                }
                line_break_in_block_comment = result == ACCEPT_IN_BLOCK_COMMENT;
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
            return line_break_in_block_comment && scan_after_line_break(lexer, false, rule, scanned_content, false);
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
    if (!before_slash && lexer->lookahead == ';') {
        return false;
    }
    switch (rule) {
        case LINE_BREAK_AFTER_AWAIT_KEYWORD:
            if (!before_slash && lexer->lookahead == '{') {
                lexer->result_symbol = AWAIT_IDENTIFIER_LINE_BREAK;
                return true;
            }
            if (before_slash) {
                return false;
            }
            if (is_identifier_part(lexer->lookahead) && !is_ascii_digit(lexer->lookahead)) {
                *scanned_content = true;
                char word[16] = {0};
                bool ascii_word = scan_identifier(lexer, word, sizeof(word), true);
                if (ascii_word && strcmp(word, "yield") == 0) {
                    if (follows_yield_operand(lexer)) {
                        return true;
                    }
                    lexer->result_symbol = AWAIT_YIELD_IDENTIFIER_START;
                    return true;
                }
                if (scan_whitespace_and_comments(lexer, scanned_content, true, true) != REJECT && lexer->lookahead == ':') {
                    return true;
                }
                if (ascii_word && strcmp(word, "async") == 0 && is_identifier_part(lexer->lookahead)) {
                    char parameter[16] = {0};
                    scan_identifier(lexer, parameter, sizeof(parameter), true);
                    scan_whitespace_and_comments(lexer, scanned_content, true, true);
                }
                if (ascii_word && strcmp(word, "async") == 0 && lexer->lookahead == '(') {
                    lexer->result_symbol = AWAIT_IDENTIFIER_LINE_BREAK;
                    return true;
                }
                if (lexer->lookahead == '=') {
                    skip(lexer);
                    return lexer->lookahead != '=';
                }
                if (!ascii_word) {
                    lexer->result_symbol = AWAIT_IDENTIFIER_LINE_BREAK;
                    return true;
                }
                if (strcmp(word, "import") == 0) {
                    return lexer->lookahead != '(' && lexer->lookahead != '.';
                }
                if ((strcmp(word, "using") == 0 || strcmp(word, "let") == 0) && is_identifier_part(lexer->lookahead) && !is_ascii_digit(lexer->lookahead)) {
                    char binding[16] = {0};
                    bool ascii_binding = scan_identifier(lexer, binding, sizeof(binding), true);
                    return !ascii_binding || (strcmp(binding, "in") != 0 && strcmp(binding, "instanceof") != 0);
                }
                static const char *const statements[] = {
                    "break", "case", "catch", "const", "continue", "debugger", "default", "do", "else", "enum",
                    "export", "finally", "for", "if", "return", "switch",
                    "throw", "try", "var", "while", "with",
                };
                for (unsigned i = 0; i < sizeof(statements) / sizeof(statements[0]); i++) {
                    if (strcmp(word, statements[i]) == 0) {
                        return true;
                    }
                }
                lexer->result_symbol = AWAIT_IDENTIFIER_LINE_BREAK;
                return true;
            }
            switch (lexer->lookahead) {
                case '.':
                case '{':
                case '[':
                case '(':
                case '`':
                case '\'':
                case '"':
                case '/':
                case '+':
                case '-':
                case '!':
                case '~':
                case '<':
                    return false;
                default:
                    if (is_ascii_digit(lexer->lookahead)) {
                        return false;
                    }
                    break;
            }
            break;
        case LINE_BREAK_ENDS:
            // A token that can start a statement starts the next one; any other token is left to the rules below,
            // which keep a bare `yield` continued by an enclosing `,` or `:`, and `yield` as a script's identifier
            // continued by an operator.
            switch (lexer->lookahead) {
                case '`':
                case '[':
                case '(':
                case '+':
                case '-':
                case '<':
                    return true;
                default:
                    if (before_slash) {
                        return true;
                    }
                    break;
            }
            break;
        case LINE_BREAK_AFTER_BINDING_NAME:
            return before_slash || (lexer->lookahead != '=' && lexer->lookahead != ',');
        case LINE_BREAK_AFTER_FIELD_NAME:
            return before_slash || (lexer->lookahead != '=' && lexer->lookahead != '(');
        case LINE_BREAK_AFTER_MODIFIER_WORD:
            return !before_slash && (lexer->lookahead == '}' || lexer->lookahead == '@' || lexer->eof(lexer));
        case LINE_BREAK_BEFORE_IMPORT_ATTRIBUTES:
            return before_slash || !scan_word(lexer, "with");
        case LINE_BREAK_AFTER_ACCESSOR_WORD:
            return !before_slash && (lexer->lookahead == '}' || lexer->lookahead == '@' || lexer->lookahead == '*' ||
                                     lexer->eof(lexer));
        default:
            break;
    }
    if (before_slash) {
        return false;
    }

    switch (lexer->lookahead) {
        case '`':
        case ',':
        case ':':
        case ';':
        case '*':
        case '%':
        case '>':
        case '<':
        case '=':
        case '[':
        case '(':
        case '?':
        case '^':
        case '|':
        case '&':
        case '/':
            return false;

        // Insert a semicolon before decimals literals but not otherwise.
        case '.':
            skip(lexer);
            return is_ascii_digit(lexer->lookahead);

        // Insert a semicolon before `--` and `++`, but not before binary `+` or `-`.
        case '+':
            skip(lexer);
            return lexer->lookahead == '+';
        case '-':
            skip(lexer);
            return lexer->lookahead == '-';

        // Don't insert a semicolon before `!=`, but do insert one before a unary `!`.
        case '!':
            skip(lexer);
            return lexer->lookahead != '=';

        // Don't insert a semicolon before `in` or `instanceof`, but do insert one
        // before an identifier.
        case 'i':
            skip(lexer);

            if (lexer->lookahead != 'n') {
                return true;
            }
            skip(lexer);

            if (!is_identifier_part(lexer->lookahead)) {
                return false;
            }

            for (unsigned i = 0; i < 8; i++) {
                if (lexer->lookahead != "stanceof"[i]) {
                    return true;
                }
                skip(lexer);
            }

            if (!is_identifier_part(lexer->lookahead)) {
                return false;
            }
            break;

        default:
            break;
    }

    return true;
}

static bool follows_yield_operand(TSLexer *lexer) {
    for (;;) {
        while (is_whitespace(lexer->lookahead)) {
            if (is_line_terminator(lexer->lookahead)) {
                return false;
            }
            skip(lexer);
        }
        if (lexer->lookahead != '/') {
            break;
        }
        skip(lexer);
        if (lexer->lookahead == '/') {
            return false;
        }
        if (lexer->lookahead != '*') {
            return true;
        }
        skip(lexer);
        for (;;) {
            if (lexer->eof(lexer) || is_line_terminator(lexer->lookahead)) {
                return false;
            }
            bool after_asterisk = lexer->lookahead == '*';
            skip(lexer);
            if (after_asterisk && lexer->lookahead == '/') {
                skip(lexer);
                break;
            }
        }
    }
    if (is_identifier_part(lexer->lookahead)) {
        char word[16] = {0};
        bool ascii_word = scan_identifier(lexer, word, sizeof(word), true);
        return !ascii_word || (strcmp(word, "in") != 0 && strcmp(word, "instanceof") != 0);
    }
    if (lexer->lookahead == '.') {
        skip(lexer);
        return is_ascii_digit(lexer->lookahead);
    }
    if (lexer->lookahead == '+' || lexer->lookahead == '-') {
        int32_t sign = lexer->lookahead;
        skip(lexer);
        if (lexer->lookahead != sign) {
            return false;
        }
        skip(lexer);
        bool scanned_content = false;
        scan_whitespace_and_comments(lexer, &scanned_content, true, true);
        return !lexer->eof(lexer) && lexer->lookahead != ';' && lexer->lookahead != '}' && lexer->lookahead != ')' &&
               lexer->lookahead != ']' && lexer->lookahead != ',' && lexer->lookahead != ':';
    }
    return lexer->lookahead == '*' || lexer->lookahead == ':' || lexer->lookahead == '(' ||
           lexer->lookahead == '[' || lexer->lookahead == '{' || lexer->lookahead == '`' ||
           lexer->lookahead == '\'' || lexer->lookahead == '"' || lexer->lookahead == '!' || lexer->lookahead == '~';
}

static bool scan_identifier(TSLexer *lexer, char *word, unsigned capacity, bool skip_contents) {
    unsigned length = 0;
    bool ascii_word = true;
    while (is_identifier_part(lexer->lookahead)) {
        if (lexer->lookahead == '\\') {
            ascii_word = false;
            lexer->advance(lexer, skip_contents);
            if (lexer->lookahead == 'u') {
                lexer->advance(lexer, skip_contents);
                if (lexer->lookahead == '{') {
                    lexer->advance(lexer, skip_contents);
                    while (is_ascii_digit(lexer->lookahead) ||
                           (lexer->lookahead >= 'a' && lexer->lookahead <= 'f') ||
                           (lexer->lookahead >= 'A' && lexer->lookahead <= 'F')) {
                        lexer->advance(lexer, skip_contents);
                    }
                    if (lexer->lookahead == '}') {
                        lexer->advance(lexer, skip_contents);
                    }
                }
            }
            continue;
        }
        if (lexer->lookahead > 0x7F || length == capacity - 1) {
            ascii_word = false;
        } else {
            word[length++] = (char)lexer->lookahead;
        }
        lexer->advance(lexer, skip_contents);
    }
    return ascii_word;
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

    const char *comment_start = "<!--";
    const char *comment_end = "-->";

    if (lexer->lookahead == '<') {
        for (unsigned i = 0; i < 4; i++) {
            if (lexer->lookahead != comment_start[i]) {
                return false;
            }
            advance(lexer);
        }
    } else if (lexer->lookahead == '-') {
        for (unsigned i = 0; i < 3; i++) {
            if (lexer->lookahead != comment_end[i]) {
                return false;
            }
            advance(lexer);
        }
    } else {
        return false;
    }

    while (!lexer->eof(lexer) && !is_line_terminator(lexer->lookahead)) {
        advance(lexer);
    }

    lexer->result_symbol = HTML_COMMENT;
    lexer->mark_end(lexer);

    return true;
}

static inline bool is_hex_digit(int32_t c) { return is_ascii_digit(c) || (c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F'); }

// Consumes the `&` at the lookahead and the characters after it that could continue an html_character_reference, and
// returns whether they form a complete one, i.e. whether the grammar's html_character_reference matches here.
static bool scan_character_reference(TSLexer *lexer) {
    advance(lexer);
    unsigned length = 0;
    if (lexer->lookahead == '#') {
        advance(lexer);
        bool hex = lexer->lookahead == 'x' || lexer->lookahead == 'X';
        if (hex) {
            advance(lexer);
        }
        unsigned max_length = hex ? 6 : 5;
        while (length < max_length && (hex ? is_hex_digit(lexer->lookahead) : is_ascii_digit(lexer->lookahead))) {
            advance(lexer);
            length++;
        }
    } else {
        while (length < 30 && is_ascii_letter(lexer->lookahead)) {
            advance(lexer);
            length++;
        }
    }
    return length > 0 && lexer->lookahead == ';';
}

static bool scan_jsx_text(TSLexer *lexer) {
    // saw_text will be true if we see any non-whitespace content, or any whitespace content that is not a newline and
    // does not immediately follow a newline.
    bool saw_text = false;
    // at_newline will be true if we are currently at a newline, or if we are at whitespace that is not a newline but
    // immediately follows a newline.
    bool at_newline = false;

    lexer->result_symbol = JSX_TEXT;
    for (;;) {
        lexer->mark_end(lexer);
        if (lexer->eof(lexer)) {
            return saw_text;
        }
        switch (lexer->lookahead) {
            case '<':
            case '>':
            case '{':
            case '}':
                return saw_text;
            case '&':
                // A complete character reference ends the text; any other `&` is a literal character, as in HTML.
                if (scan_character_reference(lexer)) {
                    return saw_text;
                }
                saw_text = true;
                at_newline = false;
                continue;
            default:
                break;
        }

        // Only ASCII whitespace counts, as in Babel's JSX whitespace trimming; other spaces, such as U+00A0, are text.
        bool is_wspace = (lexer->lookahead >= '\t' && lexer->lookahead <= '\r') || lexer->lookahead == ' ';
        // Babel splits JSX text into lines at CR and LF only, and keeps U+2028 and U+2029 as text.
        if (lexer->lookahead == '\n' || lexer->lookahead == '\r') {
            at_newline = true;
        } else {
            // If at_newline is already true, and we see some whitespace, then it must stay true.
            // Otherwise, it should be false.
            //
            // See the table below to determine the logic for computing `saw_text`.
            //
            // |------------------------------------|
            // | at_newline | is_wspace | saw_text  |
            // |------------|-----------|-----------|
            // | false (0)  | false (0) | true  (1) |
            // | false (0)  | true  (1) | true  (1) |
            // | true  (1)  | false (0) | true  (1) |
            // | true  (1)  | true  (1) | false (0) |
            // |------------------------------------|

            at_newline &= is_wspace;
            if (!at_newline) {
                saw_text = true;
            }
        }

        advance(lexer);
    }
}

// Canonical expression paths preserve public supertype queries. Keep postfix suffixes in the await operand while
// letting infix operators continue the enclosing expression.
static bool scan_expression_end(TSLexer *lexer, bool after_postfix, bool *statement_end, const bool *valid_symbols) {
    lexer->mark_end(lexer);
    lexer->result_symbol = after_postfix ? POSTFIX_UPDATE_END : AWAIT_OPERAND_END;
    bool saw_newline = false;
    for (;;) {
        while (is_whitespace(lexer->lookahead)) {
            saw_newline |= is_line_terminator(lexer->lookahead);
            skip(lexer);
        }
        if (lexer->lookahead != '/') {
            break;
        }
        skip(lexer);
        if (lexer->lookahead == '/') {
            while (!lexer->eof(lexer) && !is_line_terminator(lexer->lookahead)) {
                skip(lexer);
            }
        } else if (lexer->lookahead == '*') {
            skip(lexer);
            while (!lexer->eof(lexer)) {
                saw_newline |= is_line_terminator(lexer->lookahead);
                if (lexer->lookahead == '*') {
                    skip(lexer);
                    if (lexer->lookahead == '/') {
                        skip(lexer);
                        break;
                    }
                } else {
                    skip(lexer);
                }
            }
        } else {
            return valid_symbols[AWAIT_OPERAND_END] || after_postfix;
        }
    }
    if (valid_symbols[RESOURCE_BINDING_START] || valid_symbols[RESOURCE_BINDING_CONTINUATION] ||
        valid_symbols[PLAIN_RESOURCE_FOR_OF_CONTEXT]) {
        bool first_binding = valid_symbols[RESOURCE_BINDING_START] || valid_symbols[PLAIN_RESOURCE_FOR_OF_CONTEXT];
        if (!(saw_newline && first_binding) && is_identifier_part(lexer->lookahead) && !is_ascii_digit(lexer->lookahead)) {
            bool infix_operator = false;
            bool binding = scan_resource_binding(lexer, valid_symbols[PLAIN_RESOURCE_FOR_OF_CONTEXT], &infix_operator);
            if (binding) {
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
        case '`':
            *statement_end = after_postfix && saw_newline;
            return *statement_end;
        case '?':
            skip(lexer);
            return lexer->lookahead != '.';
        case 'i': {
            char word[16] = {0};
            bool ascii_word = scan_identifier(lexer, word, sizeof(word), true);
            return saw_newline || (ascii_word && (strcmp(word, "in") == 0 || strcmp(word, "instanceof") == 0));
        }
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

static bool scan_resource_binding(TSLexer *lexer, bool plain_for_of, bool *infix_operator) {
    char word[16] = {0};
    unsigned length = 0;
    bool ascii_word = true;
    bool escaped = false;
    while (is_identifier_part(lexer->lookahead)) {
        uint32_t character = (uint32_t)lexer->lookahead;
        if (character == '\\') {
            escaped = true;
            advance(lexer);
            if (lexer->lookahead != 'u') return false;
            advance(lexer);
            bool braced = lexer->lookahead == '{';
            if (braced) advance(lexer);
            character = 0;
            unsigned digits = 0;
            while (is_hex_digit(lexer->lookahead) && (braced || digits < 4)) {
                unsigned digit = is_ascii_digit(lexer->lookahead) ? lexer->lookahead - '0' :
                    (lexer->lookahead >= 'a' ? lexer->lookahead - 'a' : lexer->lookahead - 'A') + 10;
                character = character > 0x7F ? 0x80 : character * 16 + digit;
                advance(lexer);
                digits++;
            }
            if (braced) {
                if (digits == 0 || lexer->lookahead != '}') return false;
                advance(lexer);
            } else if (digits != 4) {
                return false;
            }
        } else {
            advance(lexer);
        }
        if (character > 0x7F || length == sizeof(word) - 1) {
            ascii_word = false;
        } else {
            word[length++] = (char)character;
        }
    }
    *infix_operator = !escaped && ascii_word && (strcmp(word, "in") == 0 || strcmp(word, "instanceof") == 0);
    if (ascii_word && plain_for_of && strcmp(word, "of") == 0) {
        bool scanned_content = false;
        return scan_whitespace_and_comments(lexer, &scanned_content, true, false) != REJECT && lexer->lookahead == '=';
    }
    return !ascii_word || (strcmp(word, "enum") != 0 && !is_reserved_word(word));
}

static bool scan_await_yield_identifier(TSLexer *lexer) {
    bool scanned_content = false;
    if (scan_whitespace_and_comments(lexer, &scanned_content, true, true) == REJECT || scanned_content) {
        return false;
    }
    for (const char *word = "yield"; *word; word++) {
        if (lexer->lookahead != *word) {
            return false;
        }
        advance(lexer);
    }
    if (is_identifier_part(lexer->lookahead)) {
        return false;
    }
    lexer->mark_end(lexer);
    lexer->result_symbol = AWAIT_YIELD_IDENTIFIER;
    return true;
}

static bool scan_await_keyword(TSLexer *lexer) {
    bool scanned_content = false;
    if (scan_whitespace_and_comments(lexer, &scanned_content, true, true) == REJECT || scanned_content) {
        return false;
    }
    for (const char *word = "await"; *word; word++) {
        if (lexer->lookahead != *word) {
            return false;
        }
        advance(lexer);
    }
    if (is_identifier_part(lexer->lookahead)) {
        return false;
    }
    lexer->mark_end(lexer);
    // Record the operand decision on both keyword and identifier tokens so restored nodes cannot keep stale roles.
    // Advancing without skipping after mark_end preserves the consuming keyword's start across probed comments.
    for (unsigned words = 0; words <= 2; words++) {
        if (scan_whitespace_and_comments(lexer, &scanned_content, true, false) == REJECT ||
            words == 2 || !is_identifier_part(lexer->lookahead)) {
            break;
        }
        char word[16] = {0};
        scan_identifier(lexer, word, sizeof(word), false);
    }
    lexer->result_symbol = AWAIT_KEYWORD;
    return true;
}

bool tree_sitter_javascript_external_scanner_scan(void *payload, TSLexer *lexer, const bool *valid_symbols) {
    Scanner *scanner = (Scanner *)payload;

    if (valid_symbols[TEMPLATE_CHARS]) {
        if (valid_symbols[AUTOMATIC_SEMICOLON]) {
            return false;
        }
        return scan_template_chars(lexer);
    }

    if (valid_symbols[POSTFIX_UPDATE_END]) {
        bool statement_end = false;
        bool ret = scan_expression_end(lexer, true, &statement_end, valid_symbols);
        scanner->automatic_semicolon_pending |= statement_end;
        return ret;
    }

    if (scanner->automatic_semicolon_pending && valid_symbols[AWAIT_OPERAND_END] &&
        !valid_symbols[COMPLETED_ARROW_FUNCTION] && !valid_symbols[LINE_BREAK_AFTER_AWAIT]) {
        lexer->mark_end(lexer);
        lexer->result_symbol = AWAIT_OPERAND_END;
        return true;
    }

    if (scanner->automatic_semicolon_pending &&
        (valid_symbols[AUTOMATIC_SEMICOLON] || valid_symbols[ARROW_FUNCTION_BLOCK_CONTINUATION])) {
        scanner->automatic_semicolon_pending = false;
        lexer->result_symbol =
            valid_symbols[AUTOMATIC_SEMICOLON] ? AUTOMATIC_SEMICOLON : ARROW_FUNCTION_BLOCK_CONTINUATION;
        lexer->mark_end(lexer);
        return true;
    }

    if (valid_symbols[JSX_TEXT] && scan_jsx_text(lexer)) {
        return true;
    }

    if (valid_symbols[AWAIT_YIELD_IDENTIFIER_CONTEXT] && valid_symbols[AWAIT_YIELD_IDENTIFIER]) {
        return scan_await_yield_identifier(lexer);
    }

    if (!valid_symbols[AWAIT_OPERAND_END] &&
        (valid_symbols[RESOURCE_BINDING_START] || valid_symbols[PLAIN_RESOURCE_FOR_OF_CONTEXT])) {
        bool scanned_content = false;
        bool ret = scan_automatic_semicolon(lexer, !valid_symbols[LOGICAL_OR], false, LINE_BREAK_BY_NEXT_TOKEN,
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
        bool statement_end = false;
        bool ret = scan_expression_end(lexer, false, &statement_end, valid_symbols);
        scanner->automatic_semicolon_pending |= statement_end;
        return ret;
    }

    if (valid_symbols[AUTOMATIC_SEMICOLON] || valid_symbols[ARROW_FUNCTION_BLOCK_END]) {
        bool after_block_arrow = valid_symbols[ARROW_FUNCTION_BLOCK_END];
        bool scanned_content = false;
        LineBreakRule rule = LINE_BREAK_BY_NEXT_TOKEN;
        if (valid_symbols[LINE_BREAK_AFTER_AWAIT]) {
            rule = LINE_BREAK_AFTER_AWAIT_KEYWORD;
        } else if (valid_symbols[LINE_BREAK_ENDS_STATEMENT]) {
            rule = LINE_BREAK_ENDS;
        } else if (valid_symbols[LINE_BREAK_AFTER_BINDING]) {
            rule = LINE_BREAK_AFTER_BINDING_NAME;
        } else if (valid_symbols[LINE_BREAK_AFTER_MODIFIER]) {
            rule = valid_symbols[LINE_BREAK_AFTER_FIELD] ? LINE_BREAK_AFTER_ACCESSOR_WORD : LINE_BREAK_AFTER_MODIFIER_WORD;
        } else if (valid_symbols[LINE_BREAK_AFTER_FIELD]) {
            rule = LINE_BREAK_AFTER_FIELD_NAME;
        } else if (valid_symbols[LINE_BREAK_BEFORE_ATTRIBUTES]) {
            rule = LINE_BREAK_BEFORE_IMPORT_ATTRIBUTES;
        }
        bool ret = scan_automatic_semicolon(lexer, !valid_symbols[LOGICAL_OR], after_block_arrow, rule, &scanned_content, NULL);
        if (ret && after_block_arrow) {
            lexer->result_symbol = ARROW_FUNCTION_BLOCK_END;
            scanner->automatic_semicolon_pending = true;
        }
        if (ret && !after_block_arrow && valid_symbols[STATEMENT_BOUNDARY] && lexer->result_symbol == AUTOMATIC_SEMICOLON) {
            lexer->result_symbol = STATEMENT_BOUNDARY;
        }
        if (!ret && !scanned_content && valid_symbols[TERNARY_QMARK] && lexer->lookahead == '?') {
            return scan_ternary_qmark(lexer);
        }
        if (!ret && !scanned_content && valid_symbols[AWAIT_YIELD_IDENTIFIER] && valid_symbols[LINE_BREAK_AFTER_AWAIT] && lexer->lookahead == 'y') {
            return scan_await_yield_identifier(lexer);
        }
        if (!ret && !scanned_content && valid_symbols[AWAIT_KEYWORD] && lexer->lookahead == 'a') {
            return scan_await_keyword(lexer);
        }
        if (!ret && !scanned_content && valid_symbols[LET] && !valid_symbols[SINGLE_STATEMENT_CONTEXT] && lexer->lookahead == 'l') {
            lexer->result_symbol = LET;
            return scan_let(lexer);
        }
        return ret;
    }

    if (valid_symbols[AWAIT_YIELD_IDENTIFIER] && valid_symbols[LINE_BREAK_AFTER_AWAIT]) {
        while (is_whitespace(lexer->lookahead)) {
            skip(lexer);
        }
        if (lexer->lookahead == 'y') {
            return scan_await_yield_identifier(lexer);
        }
    }

    while (is_whitespace(lexer->lookahead)) {
        skip(lexer);
    }
    if (valid_symbols[AWAIT_KEYWORD] && lexer->lookahead == 'a') {
        return scan_await_keyword(lexer);
    }
    if (valid_symbols[TERNARY_QMARK] && lexer->lookahead == '?') {
        return scan_ternary_qmark(lexer);
    }

    if (valid_symbols[LET] && !valid_symbols[SINGLE_STATEMENT_CONTEXT] && lexer->lookahead == 'l') {
        lexer->result_symbol = LET;
        return scan_let(lexer);
    }

    if (valid_symbols[HTML_COMMENT] && !valid_symbols[LOGICAL_OR] && !valid_symbols[ESCAPE_SEQUENCE] &&
        !valid_symbols[REGEX_PATTERN] && (lexer->lookahead == '<' || lexer->lookahead == '-')) {
        return scan_html_comment(lexer);
    }
    return false;
}

static bool scan_let(TSLexer *lexer) {
    for (const char *word = "let"; *word; word++) {
        if (lexer->lookahead != *word) return false;
        advance(lexer);
    }
    if (is_identifier_part(lexer->lookahead)) return false;
    lexer->mark_end(lexer);
    bool line_start = false;
    for (;;) {
        while (is_whitespace(lexer->lookahead)) {
            line_start |= is_line_terminator(lexer->lookahead);
            advance(lexer);
        }
        if (lexer->lookahead == '<' || (line_start && lexer->lookahead == '-')) {
            const char *prefix = lexer->lookahead == '<' ? "<!--" : "-->";
            for (; *prefix; prefix++) {
                if (lexer->lookahead != *prefix) return false;
                advance(lexer);
            }
            while (!lexer->eof(lexer) && !is_line_terminator(lexer->lookahead)) advance(lexer);
            continue;
        }
        if (lexer->lookahead != '/') break;
        advance(lexer);
        if (lexer->lookahead == '/') {
            while (!lexer->eof(lexer) && !is_line_terminator(lexer->lookahead)) advance(lexer);
        } else if (lexer->lookahead == '*') {
            advance(lexer);
            bool star = false;
            while (!lexer->eof(lexer)) {
                if (star && lexer->lookahead == '/') break;
                star = lexer->lookahead == '*';
                line_start |= is_line_terminator(lexer->lookahead);
                advance(lexer);
            }
            if (lexer->eof(lexer)) return false;
            advance(lexer);
        } else {
            return false;
        }
    }
    if (lexer->lookahead == '[' || lexer->lookahead == '{') return true;
    if (!is_identifier_part(lexer->lookahead) || is_ascii_digit(lexer->lookahead)) return false;
    char name[16] = {0};
    unsigned length = 0;
    while (is_identifier_part(lexer->lookahead)) {
        if (length == sizeof(name) - 1) return true;
        name[length++] = lexer->lookahead < 0x80 ? (char)lexer->lookahead : '?';
        advance(lexer);
    }
    return !is_reserved_word(name);
}

static bool is_reserved_word(const char *name) {
    static const char *const reserved[] = {
        "break", "case", "catch", "class", "const", "continue", "debugger", "default", "delete", "do", "else",
        "export", "extends", "false", "finally", "for", "function", "if", "import", "in", "instanceof", "new",
        "null", "return", "super", "switch", "this", "throw", "true", "try", "typeof", "var", "void", "while", "with"
    };
    for (unsigned i = 0; i < sizeof(reserved) / sizeof(reserved[0]); i++) {
        if (strcmp(name, reserved[i]) == 0) return true;
    }
    return false;
}
