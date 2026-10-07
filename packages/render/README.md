# @brewlang/render

Recipe cards for [Brewlang](https://github.com/brewlang/brewlang), the plain-text format for coffee recipes: give it a `.brew` recipe, get a card a reader can brew from.

It renders HTML, nothing else: a string you can send from a server, write into a static site, or drop into a page. The [playground](https://brewlang.github.io/playground/) uses it for its card.

Brewlang is at v0: the class names and the `--brew-*` variables can still change.

## In a page: `<brew-recipe>`

```html
<link rel="stylesheet" href="https://unpkg.com/@brewlang/render/brew.css" />
<script type="module">
  import "@brewlang/render/element";
</script>

<brew-recipe src="chemex.brew"></brew-recipe>

<brew-recipe weight="oz" temp="F" scale="2">
@V60 15g 250g 94°C
0:00 50g bloom
0:45 250g
</brew-recipe>
```

| Attribute | Effect |
|---|---|
| `src` | Load the recipe from a URL; without it, the element's text is the recipe |
| `scale` | Multiply every amount: `2` doubles the recipe |
| `weight` | Show the dose and the water in `g` or `oz`; water written as a volume shows in `ml` or `fl oz` |
| `temp` | Show the temperatures in `°C` or `°F` (`C` and `F` work too) |
| `heading` | The title when the recipe's metadata has none |
| `theme` | `light` or `dark` |

The card is rendered in the page, not in a shadow root, so your own CSS reaches it. The element gets an `invalid` attribute when the recipe has errors, and fires `brew-render` with the diagnostics in `event.detail`. Set `element.source` to show another recipe.

## As HTML: `render()`

```ts
import { render } from "@brewlang/render";

const { html, diagnostics, notes } = render(source, { factor: 1.5, weight: "oz", temp: "°F" });
```

`html` is the card, every text escaped. Scaling and units only change what the card shows, and need a recipe without errors: with errors, the card shows the recipe as parsed, and `diagnostics` says why. `notes` holds what scaling and converting reported, like the reminder that times stay as written.

For finer control:

| Function | What it does |
|---|---|
| `render(source, options)` | Check, scale, convert, describe, then `toHtml`: the usual way |
| `describe(recipe, { title, written })` | A parsed recipe → the card's content in words (`RecipeModel`): title, specs, preparation, steps, target |
| `toHtml(model, { signed, theme })` | A `RecipeModel` → HTML; `signed` adds "Brewlang" at the bottom, for an image to share |
| `brewerKind(name)` | `'V60'` → `'Pour-over'` |

With `describe`, pass the recipe as written in `written` when you describe a scaled or converted copy: the ratio comes from it, since rounding would shift it.

## Styling

`brew.css` styles every class, which all start with `brew-` (`.brew-card`, `.brew-step`, `.brew-chip`…). Restyle the card with its variables, on `.brew-card` or any parent:

```css
.brew-card {
  --brew-bg: white;
  --brew-ink: #222;
  --brew-accent: #b5542e;
  --brew-font-display: Georgia, serif;
  --brew-radius: 12px;
}
```

| Variable | Used for |
|---|---|
| `--brew-bg`, `--brew-ink`, `--brew-muted`, `--brew-faint` | Background and text |
| `--brew-rule`, `--brew-rule-soft`, `--brew-soft` | Lines and the "Before you start" box |
| `--brew-accent` | The brewer line, the ratio and the water bars |
| `--brew-qual`, `--brew-qual-line` | The `bloom`, `spiral`… chips |
| `--brew-font-display`, `--brew-font-body`, `--brew-font-mono` | Fonts; the defaults expect Newsreader, Instrument Sans and IBM Plex Mono, and fall back to the system's |
| `--brew-radius` | Corners |

`data-theme="dark"` on the card switches to the dark palette. The card adapts to its own width, not the window's: under 520px, the specs go on two columns.

## License

[MIT](LICENSE)
