# Brewlang

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6?logo=typescript&logoColor=white)
![Zero dependencies](https://img.shields.io/badge/dependencies-0-brightgreen)
![Status: v0](https://img.shields.io/badge/status-v0-orange)

A plain-text markup language for coffee brewing recipes. Write a recipe the way you would note it in a notebook, and get data a tool can check, format and scale.

```
---
title: Chemex by James Hoffmann
filter: paper
---

@Chemex 30g 500g 100°C
grind medium

/rinse
0:00 80g ~10s bloom spiral -- saturate all the coffee
0:45 300g ~30s spiral
1:15 500g ~30s spiral
1:45 /stir
1:58 /drawdown

target 4:10
```

This repository is the TypeScript reference implementation: a lexer, parser, checker, formatter and scaler for `.brew` files, plus a small `brewlang` CLI. It has no runtime dependencies.

Brewlang is at v0: the syntax can still change.

## The language

A `.brew` file has optional YAML frontmatter, a header line, then one step per line.

| Element | Example | Meaning |
|---|---|---|
| Header | `@V60 15g 250g 94°C` | Brewer, dose, total water (optional), starting temperature (optional) |
| Grind | `grind medium-fine` | One of `extra-fine`, `fine`, `medium-fine`, `medium`, `medium-coarse`, `coarse`, `extra-coarse` |
| Pour | `0:45 150g ~15s spiral` | Pour up to 150g on the scale, starting at 0:45, over about 15s |
| Added pour | `+60g bloom` | Add 60g of water |
| Action | `2:00 /swirl`, `/press ~30s` | A gesture, always prefixed with `/` |
| Temperature | `90°C` | Alone on its line: applies to every following step |
| Target | `target 3:00` | When the brew should end |
| Comment | `-- gently` | Until the end of the line |

- **Times are optional.** Untimed steps before the first timed one are preparation (`/rinse`, `/close`). A recipe with no times at all runs step by step, and waits are written `/wait ~4m`.
- **Pour qualifiers** form a closed list: `bloom`, plus at most one technique among `spiral`, `center` and `pulse`.
- **Actions** are open: any `/name` is accepted. Known actions are checked against the brewer: `/open` and `/close` only work on a valve brewer like `@Switch`.
- **Units:** dose in `g` or `oz`; water in `g`, `ml`, `oz` or `floz`; temperature in `°C` or `°F`. A recipe sticks to one unit per measure, and nothing is converted. Ranges are accepted: `90-93°C`, `40-50g`.
- **Brewers:** `@V60`, `@Kalita`, `@Melitta`, `@Chemex`, `@Origami`, `@UFO`, `@Phin`, `@Switch`, `@Clever`, `@Pulsar`, `@AeroPress`, `@FrenchPress` and `@Siphon`, matched ignoring case. Any other name is accepted without action checks.

See [`examples/`](https://github.com/brewlang/brewlang/tree/main/examples) for real recipes rewritten in Brewlang.

## CLI

Build first with `npm run build`, then:

```sh
brewlang check recipe.brew...            # report errors, warnings and suggestions
brewlang fmt recipe.brew...              # rewrite files in their canonical form
brewlang fmt --check recipe.brew...      # only report the files that are not formatted
brewlang scale --dose 25g recipe.brew    # print the recipe scaled to a new dose
brewlang scale --water 400g recipe.brew  # ... or to a new total water
brewlang json recipe.brew                # print the recipe as JSON
```

Diagnostics use the `file:line:column` format that editors and terminals link:

```
bad.brew:1:10: error: The header announces 250g but the pours end at 100g. Make them match
bad.brew:3:6: error: The scale is already at 150g: pour to a higher total, or add water with '+'
bad.brew:4:1: warning: Unknown action '/swril'. Did you mean '/swirl'?
```

The exit code is 0 when everything is fine, 1 when a file has errors or is not formatted, and 2 for bad usage. Only errors fail `check`: warnings and suggestions are printed but do not change the exit code.

`scale` and `json` print their result on stdout and their diagnostics on stderr, so the result can be piped into a file. They never change the source file.

## Library

```ts
import { check, format, scaleToDose } from "brewlang";

const { recipe, diagnostics } = check(source);

if (!diagnostics.some((d) => d.severity === "error")) {
  console.log(format(recipe));

  const scaled = scaleToDose(recipe, { value: 25, unit: "g" });
  console.log(format(scaled.recipe));
}
```

| Function | What it does |
|---|---|
| `check(source)` | Parses and checks a source: the recipe and every diagnostic, in file order. The main entry point |
| `parse(source)` | Syntax only: the `Recipe` AST and the syntax errors |
| `analyze(recipe)` | Semantic checks on a parsed recipe |
| `lex(source)` | The tokens |
| `format(recipe)` | The recipe as canonical `.brew` text. Never changes the meaning |
| `scale(recipe, factor)` | Every weight multiplied by `factor` |
| `scaleToDose(recipe, { value, unit })` | Scaled to a new dose |
| `scaleToWater(recipe, { value, unit })` | Scaled to a new total water: the header's, or where the pours end |
| `convert(recipe, { dose, water, temp })` | In other units: dose in `g` or `oz`, water within weights (`g`, `oz`) or volumes (`ml`, `floz`), temperatures in `°C` or `°F` |
| `toJson(recipe)` | The recipe as JSON, described by [`schema/brewlang-0.1.schema.json`](schema/brewlang-0.1.schema.json) |

Nothing throws. Every function collects `Diagnostic { severity, message, line, column }` values, with 1-based positions, and keeps going. There are three severities:

- **error:** the recipe is invalid.
- **warning:** probably a mistake.
- **suggestion:** a possible improvement.

`format`, `toJson`, `convert` and the scaling functions expect a recipe without errors.

### Scaling

Scaling multiplies the dose, the header water and every pour. Times, durations, temperatures and the grind stay as written, with a warning: a bigger batch drains slower, so it needs a coarser grind.

Amounts are rounded the way a scale shows them: to 1 g or 1 ml, and to 0.1 oz or 0.1 floz. Added pours (`+60g`) are computed from the rounded running total, so the scaled pours still add up to the scaled header water.

### JSON

`toJson` gives the recipe as plain data, for apps that do not want to parse `.brew` themselves. The format is versioned (`"brewlang": "0.1"`) and described by a [JSON Schema](schema/brewlang-0.1.schema.json). Field names follow [CoffeeJSON](https://github.com/coffeejson-org/coffeejson) where the two formats overlap: `coffee`, `water`, `water_temp`, `at_s`, `to_water`, `action_duration_s`, units spelled out (`gram`, `celsius`), ranges as `min` and `max`.

```json
{
  "brewlang": "0.1",
  "metadata": { "title": "Chemex by James Hoffmann", "filter": "paper" },
  "brewer": "Chemex",
  "coffee": { "value": 30, "unit": "gram" },
  "water": { "value": 500, "unit": "gram" },
  "water_temp": { "value": 100, "unit": "celsius" },
  "grind": { "size": "medium" },
  "steps": [
    { "kind": "action", "name": "rinse" },
    { "kind": "pour", "at_s": 0, "to_water": { "value": 80, "unit": "gram" }, "action_duration_s": 10, "bloom": true, "technique": "spiral" },
    { "kind": "target", "at_s": 250 }
  ]
}
```

- **Lossless:** everything the recipe says is kept, including `+60g` pours (`add_water`), temperature changes (`"kind": "temp"`), comments and the unit of durations (`"duration_unit": "m"` for `~4m`). Only the layout, like blank lines, is not.
- **Metadata:** only the frontmatter's simple `key: value` lines, as text. Any other line is left out, with a warning.
- **Grind:** on the recipe, not among the steps. A recipe has at most one `grind` line, right after the header.

### Units

`convert` rewrites a recipe in the reader's units, rounded like scaling: 1 g or ml, 0.1 oz or floz, 1 degree. Weights never become volumes, so water in `g` converts only to `oz`, and `ml` only to `floz`. Added pours are derived from the rounded running total, as when scaling.

## Canonical tests

[`tests/canonical/`](tests/canonical/) holds `.brew` recipes that any Brewlang implementation must agree on:

- **`valid/`:** recipes with no diagnostic at all.
- **`invalid/`, `warnings/` and `suggestions/`:** each `.brew` has its expected diagnostics in a `.json` next to it.
- **`scaling/`:** the `.json` also gives the scaling (`factor`, `dose` or `water`), and a `.expected.brew` holds the scaled recipe.
- **`json/`:** the `.json` is the recipe's JSON output.

## Development

This package lives in the [brewlang monorepo](https://github.com/brewlang/brewlang), next to [`@brewlang/render`](../render). From the repository root:

```sh
npm install
npm test           # the tests of every package, once
npm run typecheck
npm run build      # compiles each package to its dist/
```

In this folder, `npx vitest` watches the language tests only.

## License

[MIT](LICENSE)
