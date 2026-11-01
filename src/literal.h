#ifndef TREE_SITTER_JAVASCRIPT_LITERAL_H_
#define TREE_SITTER_JAVASCRIPT_LITERAL_H_

#include "tree_sitter/parser.h"

static bool scan_character_reference(TSLexer *lexer);
static bool scan_template_escape_value(TSLexer *lexer);
static bool scan_literal_hex_digits(TSLexer *lexer, unsigned length);
static bool scan_template_code_point(TSLexer *lexer);
static int literal_hex_digit(int32_t c);
static bool literal_is_letter(int32_t c);
static bool reference_is_digit(int32_t c, bool hex);

static bool scan_template_chars(TSLexer *lexer, TSSymbol symbol) {
    lexer->result_symbol = symbol;
    for (bool has_content = false;; has_content = true) {
        lexer->mark_end(lexer);
        if (lexer->eof(lexer)) return false;
        switch (lexer->lookahead) {
            case '`':
            case '\\':
                return has_content;
            case '$':
                lexer->advance(lexer, false);
                if (lexer->lookahead == '{') return has_content;
                break;
            default:
                lexer->advance(lexer, false);
        }
    }
}

static bool scan_jsx_text(TSLexer *lexer, TSSymbol symbol) {
    bool saw_text = false;
    bool at_newline = false;
    lexer->result_symbol = symbol;
    for (;;) {
        lexer->mark_end(lexer);
        if (lexer->eof(lexer)) return saw_text;
        switch (lexer->lookahead) {
            case '<': case '>': case '{': case '}':
                return saw_text;
            case '&':
                if (scan_character_reference(lexer)) return saw_text;
                saw_text = true;
                at_newline = false;
                continue;
            default:
                break;
        }
        // JSX trims ASCII whitespace; Unicode spaces remain text on every platform.
        bool is_space = (lexer->lookahead >= '\t' && lexer->lookahead <= '\r') || lexer->lookahead == ' ';
        // JSX line boundaries are CR and LF, including where U+2028/U+2029 are text.
        if (lexer->lookahead == '\n' || lexer->lookahead == '\r') {
            at_newline = true;
        } else {
            at_newline &= is_space;
            saw_text |= !at_newline;
        }
        lexer->advance(lexer, false);
    }
}

static bool scan_character_reference(TSLexer *lexer) {
    lexer->advance(lexer, false);
    unsigned length = 0;
    if (lexer->lookahead == '#') {
        lexer->advance(lexer, false);
        bool hex = lexer->lookahead == 'x' || lexer->lookahead == 'X';
        if (hex) lexer->advance(lexer, false);
        unsigned max_length = hex ? 6 : 5;
        while (length < max_length && reference_is_digit(lexer->lookahead, hex)) {
            lexer->advance(lexer, false);
            length++;
        }
    } else {
        while (length < 30 && literal_is_letter(lexer->lookahead)) {
            lexer->advance(lexer, false);
            length++;
        }
    }
    return length > 0 && lexer->lookahead == ';';
}

static bool scan_template_escape(TSLexer *lexer, TSSymbol symbol) {
    lexer->advance(lexer, false);
    if (lexer->eof(lexer) || !scan_template_escape_value(lexer)) return false;
    lexer->mark_end(lexer);
    lexer->result_symbol = symbol;
    return true;
}

static bool scan_template_escape_value(TSLexer *lexer) {
    int32_t c = lexer->lookahead;
    lexer->advance(lexer, false);
    switch (c) {
        case '0':
            return lexer->lookahead < '0' || lexer->lookahead > '9';
        case 'x':
            return scan_literal_hex_digits(lexer, 2);
        case 'u':
            return lexer->lookahead == '{' ? scan_template_code_point(lexer) : scan_literal_hex_digits(lexer, 4);
        case '\r':
            if (lexer->lookahead == '\n') lexer->advance(lexer, false);
            return true;
        default:
            return c < '0' || c > '9';
    }
}

static bool scan_literal_hex_digits(TSLexer *lexer, unsigned length) {
    for (unsigned i = 0; i < length; i++) {
        if (literal_hex_digit(lexer->lookahead) < 0) return false;
        lexer->advance(lexer, false);
    }
    return true;
}

static bool scan_template_code_point(TSLexer *lexer) {
    lexer->advance(lexer, false);
    uint32_t value = 0;
    bool has_digit = false;
    int digit;
    while ((digit = literal_hex_digit(lexer->lookahead)) >= 0) {
        has_digit = true;
        value = value * 16 + (unsigned)digit;
        if (value > 0x10FFFF) return false;
        lexer->advance(lexer, false);
    }
    if (!has_digit || lexer->lookahead != '}') return false;
    lexer->advance(lexer, false);
    return true;
}

static int literal_hex_digit(int32_t c) {
    if (c >= '0' && c <= '9') return c - '0';
    if (c >= 'a' && c <= 'f') return c - 'a' + 10;
    if (c >= 'A' && c <= 'F') return c - 'A' + 10;
    return -1;
}

static bool literal_is_letter(int32_t c) {
    return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z');
}

static bool reference_is_digit(int32_t c, bool hex) {
    return hex ? literal_hex_digit(c) >= 0 : c >= '0' && c <= '9';
}

#endif
