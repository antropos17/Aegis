# JavaScript command review (A4.2, partial)

`--static-scan-json` now inspects literal Node process-launch calls inside selected
`.js`, `.cjs` and `.mjs` files. This helps review downloaded skills, hooks and MCP
packages before execution. It uses the existing directory selection and read
boundaries described in [Local static review](STATIC-ANALYSIS.md).

```powershell
node src/main/main.js --static-scan-json package "X:/reviews/downloaded-skill"
```

## Supported subset

Acorn 8.16.0 parses ECMAScript 2024 syntax into an AST. `.cjs` uses CommonJS mode;
`.mjs` uses module mode; `.js` tries CommonJS and then module syntax. File mode is
selected from syntax and extension; package `type`, custom loaders, runtime hooks
and actual module resolution are not reproduced. Source is never evaluated,
imported or executed, and referenced modules are never opened by the resolver.

Recognized module names are `child_process` and `node:child_process`. Supported
bindings include unshadowed CommonJS `require`, ES named/default/namespace imports,
simple object destructuring, and `const` aliases. Constant strings, string-only
concatenation and string-only template interpolation can supply commands, member
names and arguments. Comments, regular expressions and ordinary quoted examples
do not become process calls.

| Calls | Inspection |
| --- | --- |
| `exec`, `execSync` | Literal command text through the existing shell-pattern checker |
| `spawn`, `spawnSync`, `execFile`, `execFileSync` | Literal command plus an inline string argv array; shell parsing only for an explicit supported shell or a recognized shell-wrapper invocation |
| `fork` | Coverage gap: referenced program is not followed |

Inline options may select `shell: true`, `shell: false` where applicable, or a
literal shell path whose basename is `sh`, `bash`, `dash`, `zsh`, `cmd`,
`powershell` or `pwsh` (optionally ending in `.exe`). Other process options receive
a coverage issue. Local function/arrow callbacks are accepted in the async APIs;
their effects are not interpreted. Shell dialects and platform-specific quoting
retain the limits of the existing command-pattern checker.

For example, these two calls have different review results:

```javascript
const { spawn } = require('node:child_process');
spawn('curl', ['https://example.invalid/install', '|', 'sh']);
spawn('curl', ['https://example.invalid/install', '|', 'sh'], { shell: true });
```

The first passes `|` as data. The second joins the arguments for a shell and
produces the existing STA001 review finding. A finding is heuristic evidence of a
pattern; it does not establish reachability, successful execution or malicious intent.

## Unresolved behavior

Lexical declarations, parameters, catch bindings and hoisted `var` declarations
prevent a local name from being mistaken for the Node loader or an imported method.
CommonJS block-function hoisting is treated conservatively without deciding strict
mode or branch execution. Mutable `let`/`var` values, stored arrays/options objects,
getters, spreads, dynamic command arguments and unknown calls remain unresolved.
Only inline arrays/options are read as container values; `const` does not make a
stored object immutable.

Observed assignments invalidate affected bindings. Passing/storing the known
process-module object in another call/container invalidates module resolution for
the file. Direct global `eval`/`Function` calls invalidate known loader/module
resolution and report dynamic code. These conservative checks do not model every
possible mutation, indirect dynamic execution or dependency side effect.

Branches and function bodies are scanned syntactically, including unreachable
code. A fixed issue states that control flow was not evaluated. No interfile or
interprocedural dataflow, module execution order, environment expansion, deobfuscation,
filesystem/network API analysis or instruction semantics is implemented. Python,
TypeScript and JSX remain unsupported. Imported libraries and child program paths
are not followed; files already inside the selected traversal are inspected independently.

## Report and resource bounds

Reports keep schema version 1 and advance `aegis-static-patterns` to version 2.
Findings reuse STA001–STA006 with `context: javascript-command`, the call's starting
line, relative filename and SHA-256 of the original bytes. No commands, literals,
URLs, source snippets or parser exception messages are emitted. The full report
still contains relative paths and hashes, which may themselves disclose information.

The scope includes `javascript: literal-node-child-process-calls` and
`javascriptControlFlow: not-evaluated`. New scope and limit fields make older scan
baselines incompatible for external-result comparison; a fresh scan is required.
This does not authenticate external findings or automatically accept a snapshot.

| Per-file budget | Limit |
| --- | --- |
| JavaScript source | 65,536 UTF-16 code units after the shared UTF-8/file-byte checks |
| Parser tokens | 8,192, including the end token |
| AST nodes | 8,192 |
| Delimiter nesting and AST depth | 64 |
| Static value-resolution steps | 8,192 shared across resolution passes |
| Value-resolution depth | 64 |
| Constant string | 16,384 code units |
| Inline argv array | Fewer than 256 elements |
| Inspected process calls | 256 |

The shared scan bounds still cap files, total bytes, findings and issues. Parser,
AST and value limits return fixed issue codes and an incomplete result. Parsing is
synchronous and input/work bounded; it has no separate wall-clock timeout. A clean
result only describes the supported subset. Every report retains
`safety: not-determined`; static review does not block actions or grant trust.

## Verification and references

Behavioral tests exercise the public directory scan and Node CLI: import/alias
resolution, argv/shell distinctions, harmless literal text, lexical shadows,
mutations/escapes, unsupported input, redaction, non-execution and resource caps.
Earlier baseline compatibility is checked through the external report importer.
Test and CI results are recorded in the implementation PR.

Primary references checked on 2026-09-15:

- [Acorn 8.16.0 parser documentation](https://github.com/acornjs/acorn/blob/8.16.0/acorn/README.md): parse modes, syntax version, locations and token callbacks.
- [Node child_process documentation](https://nodejs.org/api/child_process.html): process API overloads, shell selection and argument joining.

Acorn is MIT-licensed and is pinned as a production dependency using the same
version and integrity already present in the lockfile. AEGIS adds the bounded
analysis layer; it does not embed or invoke a Cisco scanner.
