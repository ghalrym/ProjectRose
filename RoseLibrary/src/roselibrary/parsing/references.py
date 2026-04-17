from dataclasses import dataclass
from pathlib import PurePosixPath

from roselibrary.parsing.parser import SymbolInfo


@dataclass
class ReferenceInfo:
    source_symbol_name: str | None  # None if at module level
    target_symbol_name: str
    target_file_path: str | None
    type: str  # "import", "call", "assignment", "destructure"
    line_number: int


@dataclass
class ImportEntry:
    local_name: str
    original_name: str
    module_path: str | None  # Relative file path, or None if third-party


class ReferenceExtractor:
    def extract_references(
        self,
        tree,
        source: str,
        language: str,
        symbols: list[SymbolInfo],
        file_path: str,
    ) -> list[ReferenceInfo]:
        if language == "python":
            return self._extract_python_references(tree, source, symbols, file_path)
        # TypeScript uses the same AST structure as JavaScript
        return self._extract_js_references(tree, source, symbols, file_path)

    def _find_enclosing_symbol(
        self, line: int, symbols: list[SymbolInfo]
    ) -> str | None:
        """Find the symbol that contains the given line number (1-based)."""
        best = None
        for sym in symbols:
            if sym.line_start <= line <= sym.line_end:
                if best is None or (sym.line_end - sym.line_start) < (best.line_end - best.line_start):
                    best = sym
            for child in sym.children:
                if child.line_start <= line <= child.line_end:
                    if best is None or (child.line_end - child.line_start) < (best.line_end - best.line_start):
                        best = child
        return best.qualified_name if best else None

    def _resolve_python_module(self, module_name: str, file_path: str) -> str | None:
        """Resolve a Python module name to a file path. Returns None for third-party."""
        if not module_name.startswith("."):
            return None  # Absolute import = third-party
        # Relative import
        current_dir = str(PurePosixPath(file_path).parent)
        # Count leading dots
        dots = 0
        for ch in module_name:
            if ch == ".":
                dots += 1
            else:
                break
        remainder = module_name[dots:]

        # Go up directories for each dot beyond the first
        base = current_dir
        for _ in range(dots - 1):
            base = str(PurePosixPath(base).parent)

        if remainder:
            parts = remainder.split(".")
            resolved = str(PurePosixPath(base) / "/".join(parts)) + ".py"
        else:
            # from . import something — the module is the package __init__
            resolved = str(PurePosixPath(base) / "__init__.py")

        return resolved

    def _resolve_js_module(self, module_path: str, file_path: str) -> str | None:
        """Resolve a JS module specifier to a file path. Returns None for third-party."""
        if not module_path.startswith("."):
            return None  # Not relative = third-party

        current_dir = str(PurePosixPath(file_path).parent)
        resolved = str(PurePosixPath(current_dir) / module_path)

        # Normalize
        resolved = str(PurePosixPath(resolved))

        # Add extension if not present — try to infer from the importing file
        if not PurePosixPath(resolved).suffix:
            importing_ext = PurePosixPath(file_path).suffix.lower()
            if importing_ext in (".ts", ".tsx"):
                resolved += ".ts"
            else:
                resolved += ".js"

        return resolved

    def _extract_python_references(
        self, tree, source: str, symbols: list[SymbolInfo], file_path: str
    ) -> list[ReferenceInfo]:
        refs = []
        import_map: dict[str, ImportEntry] = {}

        self._walk_python_imports(tree.root_node, file_path, import_map, refs, symbols)
        self._walk_python_calls_and_assignments(
            tree.root_node, import_map, refs, symbols, file_path
        )
        return refs

    def _walk_python_imports(self, node, file_path, import_map, refs, symbols):
        for child in node.children:
            if child.type == "import_from_statement":
                self._process_python_from_import(child, file_path, import_map, refs, symbols)
            elif child.type == "import_statement":
                self._process_python_import(child, file_path, import_map, refs, symbols)
            # Recurse into blocks (function/class bodies)
            if child.type in ("block", "module"):
                self._walk_python_imports(child, file_path, import_map, refs, symbols)

    def _process_python_from_import(self, node, file_path, import_map, refs, symbols):
        # from <module> import <names>
        module_name = None
        for child in node.children:
            if child.type in ("dotted_name", "relative_import"):
                module_name = child.text.decode("utf-8")
                break

        if module_name is None:
            # Handle: from . import foo — the module is represented differently
            # Reconstruct from the dots and dotted_name children
            parts = []
            for child in node.children:
                if child.type == ".":
                    parts.append(".")
                elif child.type == "dotted_name" and not parts:
                    module_name = child.text.decode("utf-8")
                    break
            if not module_name and parts:
                module_name = "".join(parts)

        if module_name is None:
            return

        resolved_path = self._resolve_python_module(module_name, file_path)
        line = node.start_point[0] + 1
        enclosing = self._find_enclosing_symbol(line, symbols)

        # Extract imported names
        for child in node.children:
            if child.type == "dotted_name" and child != node.children[1]:
                # This is an imported name (not the module name)
                local_name = child.text.decode("utf-8")
                original_name = local_name
                import_map[local_name] = ImportEntry(local_name, original_name, resolved_path)
                refs.append(ReferenceInfo(
                    source_symbol_name=enclosing,
                    target_symbol_name=original_name,
                    target_file_path=resolved_path,
                    type="import",
                    line_number=line,
                ))
            elif child.type == "aliased_import":
                original = None
                alias = None
                for sub in child.children:
                    if sub.type == "dotted_name":
                        if original is None:
                            original = sub.text.decode("utf-8")
                        else:
                            alias = sub.text.decode("utf-8")
                    elif sub.type == "identifier":
                        if original is None:
                            original = sub.text.decode("utf-8")
                        else:
                            alias = sub.text.decode("utf-8")
                if original:
                    local = alias or original
                    import_map[local] = ImportEntry(local, original, resolved_path)
                    refs.append(ReferenceInfo(
                        source_symbol_name=enclosing,
                        target_symbol_name=original,
                        target_file_path=resolved_path,
                        type="import",
                        line_number=line,
                    ))
            elif child.type == "identifier":
                # Could be an imported name in simple cases
                text = child.text.decode("utf-8")
                if text not in ("import", "from", "as"):
                    import_map[text] = ImportEntry(text, text, resolved_path)
                    refs.append(ReferenceInfo(
                        source_symbol_name=enclosing,
                        target_symbol_name=text,
                        target_file_path=resolved_path,
                        type="import",
                        line_number=line,
                    ))

    def _process_python_import(self, node, file_path, import_map, refs, symbols):
        line = node.start_point[0] + 1
        enclosing = self._find_enclosing_symbol(line, symbols)

        for child in node.children:
            if child.type == "dotted_name":
                name = child.text.decode("utf-8")
                # import foo.bar → third-party (no dots prefix)
                import_map[name] = ImportEntry(name, name, None)
                refs.append(ReferenceInfo(
                    source_symbol_name=enclosing,
                    target_symbol_name=name,
                    target_file_path=None,
                    type="import",
                    line_number=line,
                ))
            elif child.type == "aliased_import":
                original = None
                alias = None
                for sub in child.children:
                    if sub.type == "dotted_name":
                        if original is None:
                            original = sub.text.decode("utf-8")
                        else:
                            alias = sub.text.decode("utf-8")
                    elif sub.type == "identifier":
                        alias = sub.text.decode("utf-8")
                if original:
                    local = alias or original
                    import_map[local] = ImportEntry(local, original, None)
                    refs.append(ReferenceInfo(
                        source_symbol_name=enclosing,
                        target_symbol_name=original,
                        target_file_path=None,
                        type="import",
                        line_number=line,
                    ))

    def _walk_python_calls_and_assignments(self, node, import_map, refs, symbols, file_path):
        if node.type == "call":
            self._process_python_call(node, import_map, refs, symbols)
        elif node.type == "assignment":
            self._process_python_assignment(node, import_map, refs, symbols)

        for child in node.children:
            self._walk_python_calls_and_assignments(child, import_map, refs, symbols, file_path)

    def _process_python_call(self, node, import_map, refs, symbols):
        func_node = node.children[0] if node.children else None
        if not func_node:
            return

        line = node.start_point[0] + 1
        enclosing = self._find_enclosing_symbol(line, symbols)

        if func_node.type == "identifier":
            name = func_node.text.decode("utf-8")
            entry = import_map.get(name)
            refs.append(ReferenceInfo(
                source_symbol_name=enclosing,
                target_symbol_name=entry.original_name if entry else name,
                target_file_path=entry.module_path if entry else None,
                type="call",
                line_number=line,
            ))
        elif func_node.type == "attribute":
            # e.g., obj.method()
            text = func_node.text.decode("utf-8")
            parts = text.split(".")
            if len(parts) >= 2:
                base = parts[0]
                method = parts[-1]
                entry = import_map.get(base)
                if entry:
                    refs.append(ReferenceInfo(
                        source_symbol_name=enclosing,
                        target_symbol_name=method,
                        target_file_path=entry.module_path,
                        type="call",
                        line_number=line,
                    ))

    def _process_python_assignment(self, node, import_map, refs, symbols):
        # Check for: x = imported_name (direct reassignment)
        if node.child_count < 3:
            return

        lhs = node.children[0]
        rhs = node.children[-1]

        line = node.start_point[0] + 1
        enclosing = self._find_enclosing_symbol(line, symbols)

        # Direct assignment: x = imported_thing
        if lhs.type == "identifier" and rhs.type == "identifier":
            rhs_name = rhs.text.decode("utf-8")
            entry = import_map.get(rhs_name)
            if entry:
                local_name = lhs.text.decode("utf-8")
                # Track the alias in import map for further resolution
                import_map[local_name] = ImportEntry(
                    local_name, entry.original_name, entry.module_path
                )
                refs.append(ReferenceInfo(
                    source_symbol_name=enclosing,
                    target_symbol_name=entry.original_name,
                    target_file_path=entry.module_path,
                    type="assignment",
                    line_number=line,
                ))

        # Destructuring: a, b = something (pattern_list or tuple_pattern)
        elif lhs.type in ("pattern_list", "tuple_pattern"):
            if rhs.type == "call":
                # Destructure from function call
                func_node = rhs.children[0] if rhs.children else None
                if func_node and func_node.type == "identifier":
                    fname = func_node.text.decode("utf-8")
                    entry = import_map.get(fname)
                    refs.append(ReferenceInfo(
                        source_symbol_name=enclosing,
                        target_symbol_name=entry.original_name if entry else fname,
                        target_file_path=entry.module_path if entry else None,
                        type="destructure",
                        line_number=line,
                    ))

    def _extract_js_references(
        self, tree, source: str, symbols: list[SymbolInfo], file_path: str
    ) -> list[ReferenceInfo]:
        refs = []
        import_map: dict[str, ImportEntry] = {}

        self._walk_js_imports(tree.root_node, file_path, import_map, refs, symbols)
        self._walk_js_calls_and_assignments(
            tree.root_node, import_map, refs, symbols
        )
        return refs

    def _walk_js_imports(self, node, file_path, import_map, refs, symbols):
        for child in node.children:
            if child.type == "import_statement":
                self._process_js_import(child, file_path, import_map, refs, symbols)
            elif child.type == "export_statement":
                # Handle re-exports: export { foo } from './bar'
                self._process_js_reexport(child, file_path, import_map, refs, symbols)
            elif child.type in ("lexical_declaration", "variable_declaration"):
                # Handle require(): const foo = require('./bar')
                self._process_js_require(child, file_path, import_map, refs, symbols)

    def _process_js_import(self, node, file_path, import_map, refs, symbols):
        # Skip `import type { ... } from '...'` — type-only imports have no runtime references
        child_types = [c.type for c in node.children]
        if "type" in child_types:
            return

        line = node.start_point[0] + 1
        enclosing = self._find_enclosing_symbol(line, symbols)

        module_path = None
        for child in node.children:
            if child.type == "string":
                module_path = child.text.decode("utf-8").strip("'\"")
                break

        if module_path is None:
            return

        resolved = self._resolve_js_module(module_path, file_path)

        # Walk import specifiers
        for child in node.children:
            if child.type == "import_clause":
                for sub in child.children:
                    if sub.type == "identifier":
                        # Default import
                        name = sub.text.decode("utf-8")
                        import_map[name] = ImportEntry(name, "default", resolved)
                        refs.append(ReferenceInfo(
                            source_symbol_name=enclosing,
                            target_symbol_name="default",
                            target_file_path=resolved,
                            type="import",
                            line_number=line,
                        ))
                    elif sub.type == "named_imports":
                        for spec in sub.children:
                            if spec.type == "import_specifier":
                                original = None
                                alias = None
                                idents = [c for c in spec.children if c.type == "identifier"]
                                if len(idents) == 2:
                                    original = idents[0].text.decode("utf-8")
                                    alias = idents[1].text.decode("utf-8")
                                elif len(idents) == 1:
                                    original = idents[0].text.decode("utf-8")
                                if original:
                                    local = alias or original
                                    import_map[local] = ImportEntry(local, original, resolved)
                                    refs.append(ReferenceInfo(
                                        source_symbol_name=enclosing,
                                        target_symbol_name=original,
                                        target_file_path=resolved,
                                        type="import",
                                        line_number=line,
                                    ))
                    elif sub.type == "namespace_import":
                        # import * as foo from '...'
                        for ident in sub.children:
                            if ident.type == "identifier":
                                name = ident.text.decode("utf-8")
                                import_map[name] = ImportEntry(name, "*", resolved)
                                refs.append(ReferenceInfo(
                                    source_symbol_name=enclosing,
                                    target_symbol_name="*",
                                    target_file_path=resolved,
                                    type="import",
                                    line_number=line,
                                ))

    def _process_js_reexport(self, node, file_path, import_map, refs, symbols):
        # export { foo } from './bar' or export { foo as bar } from './bar'
        module_path = None
        for child in node.children:
            if child.type == "string":
                module_path = child.text.decode("utf-8").strip("'\"")
                break

        if module_path is None:
            return  # Not a re-export, just a regular export

        resolved = self._resolve_js_module(module_path, file_path)
        line = node.start_point[0] + 1
        enclosing = self._find_enclosing_symbol(line, symbols)

        for child in node.children:
            if child.type == "export_clause":
                for spec in child.children:
                    if spec.type == "export_specifier":
                        idents = [c for c in spec.children if c.type == "identifier"]
                        if idents:
                            original = idents[0].text.decode("utf-8")
                            local = idents[1].text.decode("utf-8") if len(idents) > 1 else original
                            import_map[local] = ImportEntry(local, original, resolved)
                            refs.append(ReferenceInfo(
                                source_symbol_name=enclosing,
                                target_symbol_name=original,
                                target_file_path=resolved,
                                type="import",
                                line_number=line,
                            ))

    def _process_js_require(self, node, file_path, import_map, refs, symbols):
        for decl in node.children:
            if decl.type != "variable_declarator":
                continue
            name_node = None
            call_node = None
            for child in decl.children:
                if child.type == "identifier":
                    name_node = child
                elif child.type == "call_expression":
                    # Check if it's require(...)
                    func = child.children[0] if child.children else None
                    if func and func.type == "identifier" and func.text == b"require":
                        call_node = child
            if name_node and call_node:
                # Get the module path from arguments
                args = next(
                    (c for c in call_node.children if c.type == "arguments"), None
                )
                if args:
                    for arg in args.children:
                        if arg.type == "string":
                            module_path = arg.text.decode("utf-8").strip("'\"")
                            resolved = self._resolve_js_module(module_path, file_path)
                            line = node.start_point[0] + 1
                            enclosing = self._find_enclosing_symbol(line, symbols)
                            name = name_node.text.decode("utf-8")
                            import_map[name] = ImportEntry(name, name, resolved)
                            refs.append(ReferenceInfo(
                                source_symbol_name=enclosing,
                                target_symbol_name=name,
                                target_file_path=resolved,
                                type="import",
                                line_number=line,
                            ))
                            break

    def _walk_js_calls_and_assignments(self, node, import_map, refs, symbols):
        if node.type == "call_expression":
            self._process_js_call(node, import_map, refs, symbols)
        elif node.type in ("variable_declarator", "assignment_expression"):
            self._process_js_assignment(node, import_map, refs, symbols)

        for child in node.children:
            self._walk_js_calls_and_assignments(child, import_map, refs, symbols)

    def _process_js_call(self, node, import_map, refs, symbols):
        func_node = node.children[0] if node.children else None
        if not func_node:
            return

        line = node.start_point[0] + 1
        enclosing = self._find_enclosing_symbol(line, symbols)

        if func_node.type == "identifier":
            name = func_node.text.decode("utf-8")
            if name == "require":
                return  # Already handled in import phase
            entry = import_map.get(name)
            refs.append(ReferenceInfo(
                source_symbol_name=enclosing,
                target_symbol_name=entry.original_name if entry else name,
                target_file_path=entry.module_path if entry else None,
                type="call",
                line_number=line,
            ))
        elif func_node.type == "member_expression":
            # obj.method()
            obj_node = func_node.children[0] if func_node.children else None
            prop_node = func_node.children[-1] if len(func_node.children) >= 2 else None
            if obj_node and obj_node.type == "identifier" and prop_node:
                obj_name = obj_node.text.decode("utf-8")
                method_name = prop_node.text.decode("utf-8")
                entry = import_map.get(obj_name)
                if entry:
                    refs.append(ReferenceInfo(
                        source_symbol_name=enclosing,
                        target_symbol_name=method_name,
                        target_file_path=entry.module_path,
                        type="call",
                        line_number=line,
                    ))

    def _process_js_assignment(self, node, import_map, refs, symbols):
        line = node.start_point[0] + 1
        enclosing = self._find_enclosing_symbol(line, symbols)

        name_node = None
        value_node = None

        for child in node.children:
            if child.type == "identifier" and name_node is None:
                name_node = child
            elif child.type not in ("=", "identifier", ",", ";"):
                value_node = child

        if not name_node or not value_node:
            return

        # Direct assignment: const x = importedThing
        if value_node.type == "identifier":
            rhs_name = value_node.text.decode("utf-8")
            entry = import_map.get(rhs_name)
            if entry:
                local_name = name_node.text.decode("utf-8")
                import_map[local_name] = ImportEntry(
                    local_name, entry.original_name, entry.module_path
                )
                refs.append(ReferenceInfo(
                    source_symbol_name=enclosing,
                    target_symbol_name=entry.original_name,
                    target_file_path=entry.module_path,
                    type="assignment",
                    line_number=line,
                ))

        # Destructuring: const { a, b } = obj
        if node.type == "variable_declarator":
            lhs = node.children[0] if node.children else None
            if lhs and lhs.type == "object_pattern":
                rhs = node.children[-1]
                if rhs.type == "identifier":
                    rhs_name = rhs.text.decode("utf-8")
                    entry = import_map.get(rhs_name)
                    if entry:
                        for child in lhs.children:
                            if child.type == "shorthand_property_identifier_pattern":
                                prop = child.text.decode("utf-8")
                                refs.append(ReferenceInfo(
                                    source_symbol_name=enclosing,
                                    target_symbol_name=prop,
                                    target_file_path=entry.module_path,
                                    type="destructure",
                                    line_number=line,
                                ))
                            elif child.type == "pair_pattern":
                                idents = [c for c in child.children if c.type in ("property_identifier", "identifier")]
                                if idents:
                                    prop = idents[0].text.decode("utf-8")
                                    refs.append(ReferenceInfo(
                                        source_symbol_name=enclosing,
                                        target_symbol_name=prop,
                                        target_file_path=entry.module_path,
                                        type="destructure",
                                        line_number=line,
                                    ))
