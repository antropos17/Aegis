# Selected-source command flow (A4.2, partial)

`--static-scan-json` can associate literal command values, simple wrapper calls
and primitive function returns across selected JavaScript or Python files. For
example, a caller passing a returned download-and-execute string to a process
function can receive STA001, with evidence for the caller and value-producing
helper. The command is never executed.

This extends [JavaScript](JAVASCRIPT-STATIC-ANALYSIS.md) and
[Python](PYTHON-STATIC-ANALYSIS.md) command review. It remains a bounded syntactic
association: runtime module identity, execution order, reachability and safety
are not established. Findings always retain `confidence: heuristic`, and the
report retains `safety: not-determined`.

## Selection and module associations

The existing reader first collects the explicitly selected adapter's files within
its entry, byte and depth budgets. Analysis then uses the same retained bytes,
sorted by relative path. A scan-local catalog indexes eligible UTF-8 source.
Resolving an import performs no additional filesystem or network access. Files
outside the selected profile, skipped links, missing files and rejected bytes
cannot supply inferred values.

| Language | Supported association |
| --- | --- |
| JavaScript | Exact relative `./` or `../` references with explicit lowercase `.js`, `.mjs` or `.cjs` extensions; selected ESM exports, imports and named re-exports |
| Python | A simple sibling module name, or leading-dot relative name, mapped to an already selected `.py` file; named imports and module aliases |

JavaScript package names, extension inference, directory indexes, import maps,
package exports and custom loaders are unresolved. CommonJS `require` can refer
to an inspected ESM export model as a syntax association; this does not reproduce
runtime interoperability or ordinary CommonJS export assignments.
CommonJS loader specifiers that depend on function returns remain unresolved,
including through imported computed constants. Return inference is disabled while
validating mutations, so it cannot establish a new loader identity afterward.

Python sibling mapping does not reproduce `sys.path`, import hooks, packages or
initializers. Dotted absolute names, package entry files and star imports remain
unresolved. Every local module association reports
`python-import-runtime-not-verified`. A `helper.py` competing with an observed
`helper/__init__.py` or unavailable `helper` subtree is ambiguous.

Absolute paths, URLs, drives, backslashes, encoded references, query/fragment
suffixes and references escaping the selected root are rejected. Case or Unicode
compatibility collisions remain ambiguous, including competing names whose bytes
were excluded from the catalog. Names that were never observed because traversal
stopped cannot be ruled out; filesystem coverage issues remain visible.

## Values, wrappers and returns

Imported literal strings can feed the existing process-call checkers. Simple
functions can substitute literal arguments into a final process call or another
supported wrapper. Existing argv and shell distinctions are preserved.

Return helpers can supply command strings or other supported primitive arguments
to these calls. A JavaScript `function command(url) { return "curl " + url + " | sh"; }`
or a Python `def command(url): return "curl " + url + " | sh"` can feed a supported
process call when the supplied URL is a known string. Nested return forwarding,
selected imports and return values passed through wrappers retain source evidence.
The analyzer interprets only its existing bounded value grammar; it does not call
the function or obtain a process's output.

Command wrappers in JavaScript support selected plain function/arrow shapes with
positional name parameters, optional immutable declarations and one final call.
Python supports undecorated module-level synchronous functions with plain positional parameters
and one expression/return call, optionally preceded by a docstring. Async functions,
generators, defaults, rest/destructured parameters, complex bodies and dynamic
arguments remain unresolved. Mutation, rebinding and observed escapes can disable
inference; these checks do not model every runtime effect.

Return helpers require an explicit return expression or JavaScript expression
arrow. JavaScript permits preceding primitive `const` declarations; Python permits
an optional docstring before its single return. Returned functions, modules,
objects, arrays and other containers remain unknown, as do ordinary process-call
results. Bodies with additional effects, branches, exceptions or unsupported
expressions cannot supply an inferred return value. Bare returns and implicit
fallthrough are not used to infer command values.

Existing direct calls and function bodies continue to be inspected syntactically.
Flow inspection does not prove a function executes. A wrapper-derived finding is
located at its entry call, with the actual process-call location in its evidence.
Unsupported branches, module effects and calls retain explicit coverage issues.

## Evidence and compatibility

Reports retain schema version 1 and use `aegis-static-patterns` version 9.
Flow findings use `javascript-command-flow` or `python-command-flow`:

- `path`, `sha256`, `line`: the entry caller and its original bytes.
- `flow.sink`: relative path, original SHA-256 and line of the process call.
- `flow.files`: sorted unique paths and original hashes for contributing callers,
  imported values, re-exports, return helpers and function bodies.

Only paths present in the admitted catalog can enter flow evidence. Missing,
malformed or excessive evidence discards that flow finding and adds a fixed issue.
Source text, argument values, module specifiers and parser exception messages are
not emitted. Relative filenames and hashes remain potentially identifying metadata.

The source hashes describe individually observed bytes. They are not a coherent
atomic project snapshot or proof of execution. The `codeFlowReturns` scope field
makes reports from before return-flow coverage incompatible as external-import
baselines; fresh comparison is required. Earlier flow scope fields and limits
still apply. Nothing is automatically trusted or accepted.

## Resource limits

| Scope | Limit |
| --- | --- |
| Admitted source files | 128 |
| Retained source text | 1,048,576 UTF-16 code units |
| Each retained source | 65,536 code units, plus existing parser limits |
| Module/import depth, or combined wrapper/return depth | 8 |
| Prepared module models per entry file | 32 |
| Combined wrapper/return expansions per entry file | 256 |
| Contributing files per flow finding | 16 |
| Shared flow-work budget | 32,768 units |
| Shared module-resolution attempts | 2,048 |

Each prepared language model also bounds escape-identity tracing to 8,192 steps
and depth 64, with cycle detection and cached summaries. This is a separate
traversal; its value reads still spend the language's existing value-work budget.
Exhaustion invalidates module assumptions and produces a fixed value-limit issue.

The report exposes these bounds in `limits` and catalog/work counters in `usage`.
Failed resolution and repeated work consume budgets. Recursion and import cycles
produce fixed gaps. Catalog overflow preserves ordinary file inspection while
marking the affected files incomplete for flow coverage. Read truncation still
depends on filesystem enumeration; later analysis is sorted. Parsing is synchronous
with input/work limits and no separate wall-clock timeout.

Return helpers and wrappers share expansion counters and an active function stack.
An argument helper, nested return or local initializer consumes the same call/work
budgets. Re-entering an active function is conservatively unresolved even when a
particular runtime call might terminate.

## Remaining work and verification

General dataflow through arbitrary objects, complex return bodies, closures,
module side effects and runtime dependencies remains outside this subset. It adds no
instruction-semantic analysis, payload decoding, arbitrary filesystem/network
API interpretation or action blocking. A4.2 remains partial.

Tests cover the public directory/CLI boundaries and internal catalog limits:
literal flows, caller/sink hashes, changed dependency bytes, scope exclusions,
mutation, cycles, combined return/wrapper bounds, malformed evidence, ambiguous
imports, redaction and non-execution.
Verification results are recorded in the implementation PR.

Primary references checked on 2026-09-15:

- [Node.js ESM documentation](https://nodejs.org/api/esm.html): explicit extensions, URL semantics, module modes and runtime interoperability. AEGIS implements the narrower association table above.
- [Python import system](https://docs.python.org/3/reference/import.html): search paths, hooks, packages and relative imports. A sibling file does not establish runtime module identity.

Return semantics checked on 2026-09-16:

- [ECMAScript return statement](https://tc39.es/ecma262/multipage/ecmascript-language-statements-and-declarations.html#sec-return-statement): returned expressions, omitted values and surrounding control effects. AEGIS excludes complex bodies rather than simulating these effects.
- [Python return statement](https://docs.python.org/3/reference/simple_stmts.html#the-return-statement): expression results, `finally` and generator behavior. The supported subset uses plain synchronous functions with one explicit return.
