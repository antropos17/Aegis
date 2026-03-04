---
name: testing
description: Vitest testing patterns for Aegis. ESM imports, mocking, test structure. Use when writing or editing tests.
---
# Testing Patterns

## Stack
- Vitest 4 + esbuild transform
- 34 test files, 568 tests, 4 skip

## Structure
- tests/ directory mirrors src/ structure
- ESM imports: `import { fn } from '../src/...'` (NOT createRequire)
- vi.mock() for module mocking
- vi.fn() for function spies
- describe → it → expect pattern

## Running
- `npm test` — full suite
- `npx vitest run tests/specific-file.test.js` — single file
- `npx vitest --reporter=verbose` — detailed output

## Rules
- New tests: always .js (Vitest resolves both .js and .ts)
- DI hooks pattern for testable main process code
- Platform tests: use vi.mock for platform-specific modules
