#ifndef TREE_SITTER_JAVASCRIPT_FUNCTION_CONTEXT_H_
#define TREE_SITTER_JAVASCRIPT_FUNCTION_CONTEXT_H_

#include "tree_sitter/parser.h"

#include <string.h>

typedef struct {
    unsigned depth;
    uint8_t async[TREE_SITTER_SERIALIZATION_BUFFER_SIZE - 4];
    uint8_t generator[TREE_SITTER_SERIALIZATION_BUFFER_SIZE - 4];
    unsigned generator_bytes;
} FunctionContext;

static bool function_context_async(const FunctionContext *context) {
    unsigned index = context->depth - 1;
    return context->depth && (context->async[index / 8] & (1u << (index % 8)));
}

static bool function_context_generator(const FunctionContext *context) {
    unsigned index = context->depth - 1;
    return context->depth && (context->generator[index / 8] & (1u << (index % 8)));
}

static bool function_context_enter(FunctionContext *context, bool async, bool generator) {
    unsigned context_bytes = (context->depth + 8) / 8;
    unsigned generator_bytes = generator ? context_bytes : context->generator_bytes;
    if (4 + context_bytes + generator_bytes > TREE_SITTER_SERIALIZATION_BUFFER_SIZE) return false;
    unsigned index = context->depth++;
    if (async) context->async[index / 8] |= 1u << (index % 8);
    else context->async[index / 8] &= ~(1u << (index % 8));
    if (generator) context->generator[index / 8] |= 1u << (index % 8);
    else context->generator[index / 8] &= ~(1u << (index % 8));
    context->generator_bytes = generator_bytes;
    return true;
}

static void function_context_leave(FunctionContext *context) {
    if (!context->depth) return;
    unsigned index = --context->depth;
    context->async[index / 8] &= ~(1u << (index % 8));
    context->generator[index / 8] &= ~(1u << (index % 8));
    while (context->generator_bytes && !context->generator[context->generator_bytes - 1]) context->generator_bytes--;
}

static unsigned function_context_serialize(const FunctionContext *context, char *buffer) {
    buffer[0] = (char)(context->depth & 0xff);
    buffer[1] = (char)(context->depth >> 8);
    unsigned context_bytes = (context->depth + 7) / 8;
    memcpy(buffer + 2, context->async, context_bytes);
    memcpy(buffer + 2 + context_bytes, context->generator, context->generator_bytes);
    return 2 + context_bytes + context->generator_bytes;
}

static void function_context_deserialize(FunctionContext *context, const char *buffer, unsigned length) {
    context->depth = length >= 2 ? (unsigned char)buffer[0] | ((unsigned char)buffer[1] << 8) : 0;
    unsigned context_bytes = (context->depth + 7) / 8;
    if (context_bytes) memcpy(context->async, buffer + 2, context_bytes);
    context->generator_bytes = length > 2 + context_bytes ? length - 2 - context_bytes : 0;
    memset(context->generator, 0, sizeof(context->generator));
    if (context->generator_bytes) memcpy(context->generator, buffer + 2 + context_bytes, context->generator_bytes);
}

#endif
