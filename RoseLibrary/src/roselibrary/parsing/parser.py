from dataclasses import dataclass, field

import tree_sitter_javascript as tsjs
import tree_sitter_python as tspy
import tree_sitter_typescript as tsts
from tree_sitter import Language, Parser


@dataclass
class SymbolInfo:
    name: str
    qualified_name: str
    type: str  # "function", "class", "method"
    line_start: int
    line_end: int
    source_code: str
    parameters: str | None = None
    docstring: str | None = None
    children: list["SymbolInfo"] = field(default_factory=list)


PYTHON_EXTENSIONS = {".py"}
JS_EXTENSIONS = {".js", ".jsx", ".mjs"}
TS_EXTENSIONS = {".ts", ".tsx"}


class CodeParser:
    def __init__(self):
        self._py_parser = Parser(Language(tspy.language()))
        self._js_parser = Parser(Language(tsjs.language()))
        self._ts_parser = Parser(Language(tsts.language_typescript()))
        self._tsx_parser = Parser(Language(tsts.language_tsx()))

    def detect_language(self, path: str) -> str | None:
        from pathlib import PurePosixPath

        suffix = PurePosixPath(path).suffix.lower()
        if suffix in PYTHON_EXTENSIONS:
            return "python"
        if suffix in JS_EXTENSIONS:
            return "javascript"
        if suffix in TS_EXTENSIONS:
            return "typescript"
        return None

    def parse(self, source: str, language: str):
        if language == "python":
            parser = self._py_parser
        elif language == "typescript":
            # Use TSX parser for .tsx files — but since we normalize to
            # "typescript" for both, use TSX parser which is a superset
            parser = self._tsx_parser
        else:
            parser = self._js_parser
        return parser.parse(source.encode("utf-8"))

    def extract_symbols(self, tree, source: str, language: str) -> list[SymbolInfo]:
        lines = source.split("\n")
        if language == "python":
            return self._extract_python_symbols(tree.root_node, lines)
        # TypeScript AST is structurally compatible with JavaScript extraction
        return self._extract_js_symbols(tree.root_node, lines)

    def _get_source_for_node(self, node, lines: list[str]) -> str:
        start_line = node.start_point[0]
        end_line = node.end_point[0]
        if start_line == end_line:
            return lines[start_line][node.start_point[1]:node.end_point[1]]
        result = [lines[start_line][node.start_point[1]:]]
        for i in range(start_line + 1, end_line):
            result.append(lines[i])
        result.append(lines[end_line][:node.end_point[1]])
        return "\n".join(result)

    def _extract_python_docstring(self, body_node) -> str | None:
        if body_node is None or body_node.child_count == 0:
            return None
        first_stmt = body_node.children[0]
        if first_stmt.type == "expression_statement" and first_stmt.child_count > 0:
            expr = first_stmt.children[0]
            if expr.type == "string":
                text = expr.text.decode("utf-8")
                # Strip triple quotes
                for q in ('"""', "'''", '"', "'"):
                    if text.startswith(q) and text.endswith(q):
                        return text[len(q):-len(q)].strip()
                return text
        return None

    def _extract_python_params(self, node) -> str | None:
        for child in node.children:
            if child.type == "parameters":
                text = child.text.decode("utf-8")
                # Strip parentheses
                if text.startswith("(") and text.endswith(")"):
                    text = text[1:-1]
                return text.strip() or None
        return None

    def _extract_python_symbols(
        self, root_node, lines: list[str], parent_name: str | None = None
    ) -> list[SymbolInfo]:
        symbols = []
        for node in root_node.children:
            if node.type == "function_definition":
                name = None
                for child in node.children:
                    if child.type == "identifier":
                        name = child.text.decode("utf-8")
                        break
                if not name:
                    continue

                sym_type = "method" if parent_name else "function"
                qualified = f"{parent_name}.{name}" if parent_name else name
                body = next((c for c in node.children if c.type == "block"), None)

                symbols.append(SymbolInfo(
                    name=name,
                    qualified_name=qualified,
                    type=sym_type,
                    line_start=node.start_point[0] + 1,
                    line_end=node.end_point[0] + 1,
                    source_code=self._get_source_for_node(node, lines),
                    parameters=self._extract_python_params(node),
                    docstring=self._extract_python_docstring(body),
                ))

            elif node.type == "class_definition":
                name = None
                for child in node.children:
                    if child.type == "identifier":
                        name = child.text.decode("utf-8")
                        break
                if not name:
                    continue

                body = next((c for c in node.children if c.type == "block"), None)
                methods = []
                if body:
                    methods = self._extract_python_symbols(body, lines, parent_name=name)

                symbols.append(SymbolInfo(
                    name=name,
                    qualified_name=name,
                    type="class",
                    line_start=node.start_point[0] + 1,
                    line_end=node.end_point[0] + 1,
                    source_code=self._get_source_for_node(node, lines),
                    docstring=self._extract_python_docstring(body),
                    children=methods,
                ))
        return symbols

    def _extract_js_docstring(self, node, lines: list[str]) -> str | None:
        # Look for JSDoc comment immediately preceding the node
        prev = node.prev_named_sibling
        if prev and prev.type == "comment":
            text = prev.text.decode("utf-8")
            if text.startswith("/**"):
                # Strip /** and */
                text = text[3:]
                if text.endswith("*/"):
                    text = text[:-2]
                # Strip leading * from each line
                cleaned = []
                for line in text.split("\n"):
                    line = line.strip()
                    if line.startswith("* "):
                        line = line[2:]
                    elif line.startswith("*"):
                        line = line[1:]
                    cleaned.append(line)
                return "\n".join(cleaned).strip() or None
        return None

    def _extract_js_params(self, node) -> str | None:
        for child in node.children:
            if child.type == "formal_parameters":
                text = child.text.decode("utf-8")
                if text.startswith("(") and text.endswith(")"):
                    text = text[1:-1]
                return text.strip() or None
        return None

    def _extract_js_symbols(self, root_node, lines: list[str]) -> list[SymbolInfo]:
        symbols = []
        for node in root_node.children:
            if node.type == "function_declaration":
                name = None
                for child in node.children:
                    if child.type == "identifier":
                        name = child.text.decode("utf-8")
                        break
                if not name:
                    continue
                symbols.append(SymbolInfo(
                    name=name,
                    qualified_name=name,
                    type="function",
                    line_start=node.start_point[0] + 1,
                    line_end=node.end_point[0] + 1,
                    source_code=self._get_source_for_node(node, lines),
                    parameters=self._extract_js_params(node),
                    docstring=self._extract_js_docstring(node, lines),
                ))

            elif node.type == "class_declaration":
                name = None
                for child in node.children:
                    if child.type in ("identifier", "type_identifier"):
                        name = child.text.decode("utf-8")
                        break
                if not name:
                    continue

                body = next((c for c in node.children if c.type == "class_body"), None)
                methods = self._extract_js_class_methods(name, body, lines)

                symbols.append(SymbolInfo(
                    name=name,
                    qualified_name=name,
                    type="class",
                    line_start=node.start_point[0] + 1,
                    line_end=node.end_point[0] + 1,
                    source_code=self._get_source_for_node(node, lines),
                    docstring=self._extract_js_docstring(node, lines),
                    children=methods,
                ))

            elif node.type in ("lexical_declaration", "variable_declaration"):
                # Look for arrow functions or function expressions: const foo = () => {}
                for decl in node.children:
                    if decl.type == "variable_declarator":
                        name_node = None
                        value_node = None
                        for child in decl.children:
                            if child.type == "identifier":
                                name_node = child
                            elif child.type in ("arrow_function", "function_expression"):
                                value_node = child
                        if name_node and value_node:
                            name = name_node.text.decode("utf-8")
                            symbols.append(SymbolInfo(
                                name=name,
                                qualified_name=name,
                                type="function",
                                line_start=node.start_point[0] + 1,
                                line_end=node.end_point[0] + 1,
                                source_code=self._get_source_for_node(node, lines),
                                parameters=self._extract_js_params(value_node),
                                docstring=self._extract_js_docstring(node, lines),
                            ))

            elif node.type == "export_statement":
                # Handle: export function foo() {}, export class Bar {}, export const fn = () => {}
                for child in node.children:
                    if child.type in ("function_declaration", "class_declaration",
                                      "lexical_declaration", "variable_declaration"):
                        # Recursively extract from the inner declaration
                        inner = self._extract_js_symbols_from_node(child, lines)
                        symbols.extend(inner)
        return symbols

    def _extract_js_class_methods(self, class_name: str, body, lines: list[str]) -> list[SymbolInfo]:
        """Extract methods from a class body node."""
        methods = []
        if body is None:
            return methods
        for member in body.children:
            if member.type == "method_definition":
                mname = None
                for child in member.children:
                    if child.type == "property_identifier":
                        mname = child.text.decode("utf-8")
                        break
                if not mname:
                    continue
                methods.append(SymbolInfo(
                    name=mname,
                    qualified_name=f"{class_name}.{mname}",
                    type="method",
                    line_start=member.start_point[0] + 1,
                    line_end=member.end_point[0] + 1,
                    source_code=self._get_source_for_node(member, lines),
                    parameters=self._extract_js_params(member),
                    docstring=self._extract_js_docstring(member, lines),
                ))
        return methods

    def _extract_js_symbols_from_node(self, node, lines: list[str]) -> list[SymbolInfo]:
        """Extract symbols from a single node (used for export statement children)."""
        # Temporarily create a fake root with just this node
        # Reuse the logic by checking the node type directly
        results = []
        if node.type == "function_declaration":
            name = None
            for child in node.children:
                if child.type == "identifier":
                    name = child.text.decode("utf-8")
                    break
            if name:
                results.append(SymbolInfo(
                    name=name,
                    qualified_name=name,
                    type="function",
                    line_start=node.start_point[0] + 1,
                    line_end=node.end_point[0] + 1,
                    source_code=self._get_source_for_node(node, lines),
                    parameters=self._extract_js_params(node),
                    docstring=self._extract_js_docstring(node, lines),
                ))
        elif node.type == "class_declaration":
            name = None
            for child in node.children:
                if child.type in ("identifier", "type_identifier"):
                    name = child.text.decode("utf-8")
                    break
            if name:
                body = next((c for c in node.children if c.type == "class_body"), None)
                methods = self._extract_js_class_methods(name, body, lines)
                results.append(SymbolInfo(
                    name=name,
                    qualified_name=name,
                    type="class",
                    line_start=node.start_point[0] + 1,
                    line_end=node.end_point[0] + 1,
                    source_code=self._get_source_for_node(node, lines),
                    docstring=self._extract_js_docstring(node, lines),
                    children=methods,
                ))
        elif node.type in ("lexical_declaration", "variable_declaration"):
            for decl in node.children:
                if decl.type == "variable_declarator":
                    name_node = None
                    value_node = None
                    for child in decl.children:
                        if child.type == "identifier":
                            name_node = child
                        elif child.type in ("arrow_function", "function_expression"):
                            value_node = child
                    if name_node and value_node:
                        name = name_node.text.decode("utf-8")
                        results.append(SymbolInfo(
                            name=name,
                            qualified_name=name,
                            type="function",
                            line_start=node.start_point[0] + 1,
                            line_end=node.end_point[0] + 1,
                            source_code=self._get_source_for_node(node, lines),
                            parameters=self._extract_js_params(value_node),
                            docstring=self._extract_js_docstring(node, lines),
                        ))
        return results
