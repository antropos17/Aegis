# Python command review (A4.2, partial)

The existing `--static-scan-json` command now inspects selected `.py` files for
literal process-launch patterns. It uses the same directory selection, hashes,
read limits and output rules as [Local static review](STATIC-ANALYSIS.md).

```powershell
node src/main/main.js --static-scan-json package "X:/reviews/downloaded-skill"
```

The parser runs inside Node. It never starts Python, loads the inspected source,
imports its dependencies, installs packages or sends its contents elsewhere.
Files referenced by imports or commands are not followed. A file already inside
the selected tree can be reviewed independently by the ordinary traversal.

## Supported subset

`@lezer/python` 1.1.19 supplies a Python concrete syntax tree. Error recovery is
disabled and error nodes are rejected. This is a bounded grammar-based review;
it does not establish that CPython would accept or execute the program. Source
must pass the shared UTF-8 and binary checks. Non-UTF-8 encoding declarations in
the first two eligible comment lines produce an explicit coverage gap.

Recognized import names are `subprocess` and `os`. Plain imports, `as` aliases,
named `from` imports and simple assignment aliases are supported. These names
describe expected APIs; AEGIS does not verify the installed module, search path,
local module shadowing, import hooks or monkey-patching by dependencies.

| Calls | Inspection |
| --- | --- |
| `subprocess.run`, `Popen`, `call`, `check_call`, `check_output` | One positional command or `args=`, with an inline string list/tuple or a supported literal string; optional literal Boolean `shell` |
| `subprocess.getoutput`, `getstatusoutput` | One literal command, positional or `cmd=`, through the shell-pattern checker |
| `os.system` | One positional literal shell command |
| `os.popen` | One literal shell command, positional or `cmd=`; additional positional options are unresolved |

With `shell=False`, an inline sequence retains each argument's boundary. With
`shell=True`, a string reaches the shell-pattern checker. A sequence plus
`shell=True` remains unresolved: its elements are not joined into a command.
A whitespace-containing string without a shell also remains unresolved because
platform handling differs. An `executable=` override prevents inferring the
executed program from `args`. Other process options receive a coverage issue;
their environment, input, descriptors, working directory and effects are not analyzed.

Plain, raw and `u`-prefixed strings support single/triple quotes, adjacent literal
concatenation, string-only `+`, common escapes, octal and Unicode escapes. Named
Unicode escapes, unknown escapes, bytes literals and formatted strings remain
unresolved. Only names with one recognized assignment can supply constant values.
Stored lists/tuples are conservatively unresolved; inline string sequences are supported.

## Names, mutations and incomplete analysis

Function parameters, assignments, imports, loop targets, context-manager targets
and exception aliases enter the scope index before call resolution. Identifier
comparison uses Python's NFKC normalization. Rebinding a name prevents retaining
its earlier inferred value. Selected module attribute mutations and observed
escapes into calls/containers invalidate known process-module values for the file.
Direct global dynamic-code and namespace-access calls also invalidate this knowledge.
This does not cover every mutation or indirect execution mechanism.

Function bodies and branches are reviewed syntactically, including unreachable
code. Control flow, call reachability and execution order are not evaluated.
Classes, lambdas and comprehensions form unresolved scope barriers; matching,
`global`/`nonlocal`, type aliases and type parameters can disable resolution for
the affected scope. This conservative behavior can miss real calls and is visible
in coverage issues. Runtime name lookup, closures, decorators and type evaluation
are not fully modeled.

A bounded [selected-source flow layer](STATIC-COMMAND-FLOW.md) now associates
imported strings, simple wrapper calls and primitive function returns. General
dataflow, arbitrary filesystem or network API analysis, payload decoding,
instruction semantics and action blocking
remain outside this subset.
An unmatched package is not declared safe. Review the reported gaps and the source
before making a separate trust decision.

## Contract and limits

Python review was introduced in `aegis-static-patterns` version 3. Reports retain
schema version 1; [Local static review](STATIC-ANALYSIS.md) lists the current rule-set version.
Findings reuse STA001–STA006, with `context: python-command`, a call's starting
line, the relative path and SHA-256 of original bytes. Commands, strings, URLs,
snippets and parser exception messages are not emitted. Paths and hashes remain
potentially identifying metadata.

Scope fields declare `python: literal-subprocess-and-os-calls`,
`pythonControlFlow: not-evaluated` and `pythonModules: names-only-not-resolved`.
Added scope and budgets make older reports incompatible as external-import
baselines; a fresh scan is required. Static review never accepts a snapshot.

| Per-file budget | Limit |
| --- | --- |
| Source | 65,536 UTF-16 code units after UTF-8 decoding |
| Parser advance calls | 8,192 |
| Syntax-tree nodes | 8,192 |
| Syntax-tree/value depth | 64 |
| Static value-resolution steps | 8,192 shared across passes |
| Decoded/combined string | 16,384 code units |
| Inline sequence | Fewer than 256 elements |
| Inspected process calls | 256 |

The shared filesystem, finding and issue limits still apply. Resource limits and
parser failures produce fixed coverage issues and an incomplete result. Parsing
is synchronous, with bounded input and work counters, without a separate
wall-clock timeout. Every result retains `safety: not-determined`.

## Dependencies and verification

The exact runtime dependency is `@lezer/python` 1.1.19. Its added lockfile entries
are `@lezer/common` 1.5.2, `@lezer/lr` 1.4.10 and `@lezer/highlight` 1.2.3; all are
MIT-licensed. Existing dependency versions and integrity values are preserved.
`npm ci` validates the edited lockfile without rewriting it.

Tests reach the public directory scan and CLI: API forms, import/constant aliases,
argv/shell boundaries, negative examples, lexical shadows, Unicode identifiers,
mutation/escape cases, unsupported constructs, redaction and parser/value/output
limits. A CLI fixture would create a marker if executed; the marker remains absent.
CI results are recorded in the implementation PR.

Primary references checked on 2026-09-15:

- [Lezer Python grammar](https://code.haverbeke.berlin/lezer/python) and [Lezer parser API](https://lezer.codemirror.net/docs/ref/): grammar, strict parsing, partial-parse advances and tree traversal; the installed pinned package/API declarations were also inspected.
- [Python subprocess](https://docs.python.org/3/library/subprocess.html) and [os](https://docs.python.org/3/library/os.html): call forms, shell handling and process arguments.
- [Python lexical analysis](https://docs.python.org/3/reference/lexical_analysis.html) and [execution model](https://docs.python.org/3/reference/executionmodel.html): strings, encoding, normalized identifiers and local name binding.
