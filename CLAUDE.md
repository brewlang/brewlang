# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Brewlang is a markup language for coffee brewing recipes (`.brew` files). This repo is the TypeScript library that lexes, parses, checks and formats them, plus a small `brewlang` CLI. No runtime dependencies.

## Commands

- `npm test` — Vitest in watch mode; `npx vitest run` for a single pass
- `npx vitest run tests/parser.test.ts` — one file; add `-t "header"` to filter by test name
- `npm run typecheck` — type-checks `src` and `tests` without Node types (`tsconfig.json`), then the CLI with them (`src/cli/tsconfig.json`)
- `npm run build` — compiles `src` only to `dist/` (`tsconfig.build.json`)
- `node dist/cli/main.js check|fmt [--check] <file.brew>...` — the CLI, after a build
- `node dist/cli/main.js scale --dose 25g|--water 400g <file.brew>` — prints the scaled recipe; diagnostics go to stderr
- `node dist/cli/main.js json <file.brew>` — prints the recipe as JSON; diagnostics go to stderr

## Language spec

The spec lives in Notion, not in the repo: "Spec v0" (syntax, EBNF, semantic rules), "Décisions & questions ouvertes", and "Recettes canoniques & tests". Check it before changing what the lexer/parser accepts or writing tests for new syntax.

A `.brew` file is: optional `---` YAML frontmatter (kept raw by the parser; `toJson` reads only its `key: value` lines), a header line `@V60 15g 250g 94°C`, then one step per line: `grind <size>`, pours (`0:45 150g ~15s spiral`, `+60g bloom`), actions (`2:00 /swirl`), temperature changes (`90°C` alone), `target 3:00`, and `--` comments.

## Architecture

Pipeline, all exposed from `src/index.ts`:

1. `lex` (`src/lexer.ts`) — source → `Token[]` + diagnostics. Bad input becomes an `ERROR` token so lexing continues.
2. `parse` (`src/parser.ts`) — calls `lex`, builds a `Recipe` AST (`src/ast.ts`). Recovers per line: a malformed line is reported and skipped (`skipLine`), so one parse returns every syntax error. Parser does not re-report `ERROR` tokens.
3. `analyze` (`src/analyzer.ts`) — semantic checks on a valid `Recipe` (one grind before the steps, time ordering, unit consistency, water totals, overlaps, techniques, actions per brewer type, temp changes). Emits errors, warnings and suggestions.
4. `check` (`src/index.ts`) — `parse`, then `analyze` only if there are no syntax errors, then sorts all diagnostics by line/column. This is the main entry point.
5. `format` (`src/formatter.ts`) — `Recipe` → canonical `.brew` text. Never changes the meaning; needs a recipe without syntax errors.
6. `scale`, `scaleToDose`, `scaleToWater` (`src/scaler.ts`) — a checked `Recipe` → a new one with every weight multiplied; times untouched, with a warning. Rounds to 1 g/ml or 0.1 oz/floz; `+` pours are derived from the rounded running total so it stays exact.
7. `toJson` (`src/json.ts`) — a checked `Recipe` → `BrewJson`, described by `schema/brewlang-0.1.schema.json`. Lossless except layout; the grind goes on the recipe, not in the steps. Change the schema, `JSON_VERSION` and `tests/canonical/json/` together.

`src/registry.ts` holds the brewers (one per method, each with a type) and the core action vocabulary with its aliases; actions are restricted by brewer type. Unknown brewers have no restriction.

The CLI is split so the library never sees Node: `src/cli/run.ts` holds all the logic behind an injected `Io` (tested in memory), `src/cli/main.ts` plugs in `fs` and `process`.

`tests/canonical/` holds `.brew` recipes any implementation must agree on: `valid/` has no diagnostic, `invalid/`, `warnings/` and `suggestions/` have their expected diagnostics in a `.json` next to each file. `scaling/` puts the scaling (`factor`, `dose` or `water`) in that `.json` too, and the scaled recipe in a `.expected.brew`. `json/` has the expected `toJson` output in its `.json`; tests also validate it, and every example, against the schema with Ajv (dev dependency only).

Diagnostics never throw: every stage collects `Diagnostic { severity, message, line, column }` (1-based) and keeps going.

Closed vocabularies (grind sizes, pour qualifiers, units) are `as const` arrays in `ast.ts`; their union types derive from them. Add a value there, not in the parser. Action names (`/swirl`) are open vocabulary.

## Conventions

- ESM with `nodenext`: relative imports need the `.js` extension; use `import type` for types (`verbatimModuleSyntax`).
- Strict TS with `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`: assign optional fields conditionally (`if (x) node.x = x`) rather than setting them to `undefined`.
- `/** */` doc comments on exported functions, `///` on internal members and AST fields.
- `src/` uses 2-space indent; `tests/` uses 4-space.
- Tests compare whole AST nodes or `[severity, message, line, column]` tuples via small helpers at the top of each test file.
- Commit messages are in French.
- No CoffeeJSON in the code for now: interop is only a future question in the Notion spec. The JSON output reuses CoffeeJSON's field names where the concepts overlap, so a future export stays simple; keep it that way when adding fields.
