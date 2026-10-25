//! This crate provides JavaScript language support for the [tree-sitter] parsing library.
//!
//! Typically, you will use the [`LANGUAGE`] constant to add this language to a
//! tree-sitter [`Parser`], and then use the parser to parse some code:
//!
//! ```
//! let code = "const App = () => <p>Hello</p>;\n";
//! let mut parser = tree_sitter::Parser::new();
//! let language = tree_sitter_javascript::LANGUAGE;
//! parser
//!     .set_language(&language.into())
//!     .expect("Error loading JavaScript parser");
//! let tree = parser.parse(code, None).unwrap();
//! assert!(!tree.root_node().has_error());
//! ```
//!
//! [`Parser`]: https://docs.rs/willbooster-tree-sitter/15.0.0/tree_sitter/struct.Parser.html
//! [tree-sitter]: https://tree-sitter.github.io/

use tree_sitter_language::LanguageFn;

unsafe extern "C" {
    fn tree_sitter_javascript() -> *const ();
    fn tree_sitter_javascript_script() -> *const ();
}

/// The tree-sitter [`LanguageFn`] for this grammar.
pub const LANGUAGE: LanguageFn = unsafe { LanguageFn::from_raw(tree_sitter_javascript) };

/// Parses the ECMAScript Script goal, where top-level `await` is an identifier.
pub const LANGUAGE_SCRIPT: LanguageFn =
    unsafe { LanguageFn::from_raw(tree_sitter_javascript_script) };

/// The content of the [`node-types.json`] file for this grammar.
///
/// [`node-types.json`]: https://tree-sitter.github.io/tree-sitter/using-parsers/6-static-node-types
pub const NODE_TYPES: &str = include_str!("../../src/node-types.json");

#[cfg(test)]
mod tests {
    #[test]
    fn parses_await_with_the_selected_source_goal() {
        let source = "await\nvalue; async function f(){ await operand; } await(next);";
        for (language, expected) in [(super::LANGUAGE, 3), (super::LANGUAGE_SCRIPT, 1)] {
            let mut parser = tree_sitter::Parser::new();
            parser.set_language(&language.into()).unwrap();
            let tree = parser.parse(source, None).unwrap();
            assert!(!tree.root_node().has_error());
            let awaits = tree
                .root_node()
                .to_sexp()
                .matches("(await_expression ")
                .count();
            assert_eq!(awaits, expected);
        }
    }

    #[test]
    fn parses_top_level_yield_as_a_script_identifier() {
        let mut parser = tree_sitter::Parser::new();
        parser.set_language(&super::LANGUAGE_SCRIPT.into()).unwrap();
        let tree = parser
            .parse(
                "yield / divisor / g; function* f(){ yield /value/g; }",
                None,
            )
            .unwrap();
        assert!(!tree.root_node().has_error());
        let printed = tree.root_node().to_sexp();
        assert_eq!(printed.matches("(yield_expression ").count(), 1);
        assert_eq!(printed.matches("(binary_expression ").count(), 2);
    }
}
