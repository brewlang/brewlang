# Brewlang

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
![Status: v0](https://img.shields.io/badge/status-v0-orange)

A plain-text markup language for coffee brewing recipes. Write a recipe the way you would note it in a notebook, and get data a tool can check, format, scale and display.

```
@Chemex 30g 500g 100°C
grind medium

/rinse
0:00 80g ~10s bloom spiral
0:45 300g ~30s spiral
1:15 500g ~30s spiral
1:45 /stir

target 4:10
```

**Try it in the [playground](https://brewlang.github.io/playground/), and read the [documentation](https://brewlang.github.io/doc/).** Brewlang is at v0: the syntax can still change.

## Packages

| Package | What it does |
|---|---|
| [`brewlang`](packages/brewlang) | The language: lexer, parser, checker, formatter, scaling, unit conversion, JSON output, and the `brewlang` CLI. No runtime dependencies. |
| [`@brewlang/render`](packages/render) | Recipe cards: an HTML string from any recipe, a `<brew-recipe>` element, and `brew.css` to style them. |

[`examples/`](examples/) holds real recipes rewritten in Brewlang. The playground lives in [brewlang/playground](https://github.com/brewlang/playground). [`docs/llms.txt`](docs/llms.txt) describes the format for AI assistants.

## Development

The repository is an npm workspace. From its root:

```sh
npm install
npm test           # every package's tests, once
npm run typecheck
npm run build      # brewlang first, then @brewlang/render, which depends on it
```

## License

[MIT](LICENSE)
