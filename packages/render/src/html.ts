import type { ChartModel, RecipeModel } from "./model.js";

/// Escape text for HTML: recipes are user input
const escape = (text: string) =>
  text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** How a card lays out the recipe; brew.css styles each one. */
export type Layout = "classic" | "minimal" | "receipt" | "poster" | "chart";
export const LAYOUTS: readonly Layout[] = ["classic", "minimal", "receipt", "poster", "chart"];

export interface HtmlOptions {
  /** Sign the card 'Brewlang' at the bottom, for an image to share. Default: false. */
  signed?: boolean;
  /** Force a theme; by default the card follows the brew.css defaults and the page's variables. */
  theme?: "light" | "dark";
  /** The layout: 'classic' (default), 'minimal' (one dense line per step), 'receipt' (a till receipt),
   *  'poster' (the numbers big, the steps small) or 'chart' (the water poured over time, then the steps). */
  layout?: Layout;
}

/// The site's address as a Code 128 barcode (code set B, 321 modules): bars as one SVG path, a module wide each
const SITE = "https://brewlang.github.io";
const SITE_BARS = "M0 0h2v1h-2zM3 0h1v1h-1zM6 0h1v1h-1zM11 0h1v1h-1zM14 0h2v1h-2zM20 0h1v1h-1zM22 0h1v1h-1zM25 0h4v1h-4zM30 0h1v1h-1zM33 0h1v1h-1zM36 0h4v1h-4zM41 0h1v1h-1zM44 0h1v1h-1zM46 0h1v1h-1zM49 0h4v1h-4zM55 0h1v1h-1zM57 0h4v1h-4zM63 0h1v1h-1zM66 0h3v1h-3zM71 0h1v1h-1zM74 0h2v1h-2zM77 0h1v1h-1zM79 0h3v1h-3zM84 0h2v1h-2zM88 0h1v1h-1zM90 0h3v1h-3zM95 0h2v1h-2zM99 0h1v1h-1zM102 0h1v1h-1zM107 0h2v1h-2zM110 0h1v1h-1zM113 0h1v1h-1zM116 0h4v1h-4zM121 0h1v1h-1zM123 0h2v1h-2zM127 0h1v1h-1zM132 0h4v1h-4zM138 0h1v1h-1zM140 0h1v1h-1zM143 0h2v1h-2zM147 0h1v1h-1zM149 0h1v1h-1zM154 0h1v1h-1zM157 0h1v1h-1zM159 0h2v1h-2zM165 0h2v1h-2zM171 0h1v1h-1zM173 0h1v1h-1zM176 0h1v1h-1zM179 0h2v1h-2zM182 0h1v1h-1zM187 0h1v1h-1zM190 0h2v1h-2zM194 0h3v1h-3zM198 0h1v1h-1zM201 0h2v1h-2zM204 0h1v1h-1zM209 0h1v1h-1zM214 0h2v1h-2zM217 0h1v1h-1zM220 0h1v1h-1zM223 0h4v1h-4zM228 0h1v1h-1zM231 0h1v1h-1zM234 0h2v1h-2zM240 0h1v1h-1zM242 0h1v1h-1zM245 0h4v1h-4zM251 0h1v1h-1zM253 0h1v1h-1zM256 0h1v1h-1zM261 0h2v1h-2zM264 0h1v1h-1zM267 0h2v1h-2zM271 0h3v1h-3zM275 0h1v1h-1zM280 0h2v1h-2zM283 0h1v1h-1zM286 0h1v1h-1zM290 0h4v1h-4zM295 0h1v1h-1zM297 0h1v1h-1zM302 0h1v1h-1zM305 0h2v1h-2zM308 0h2v1h-2zM313 0h3v1h-3zM317 0h1v1h-1zM319 0h2v1h-2z";

/// The receipt's barcode: a link on screen, scannable on an image; no text, the address is its label
const barcode = () =>
  `<a class="brew-barcode" href="${SITE}" aria-label="brewlang.github.io"><svg viewBox="0 0 321 1" preserveAspectRatio="none" aria-hidden="true"><path d="${SITE_BARS}"/></svg></a>`;

/// A share of the chart, as a percentage for CSS and the viewBox alike, rounded to keep the HTML short
const pct = (n: number) => Math.round(n * 1000) / 10;

/// The water on the scale over time. The SVG draws only lines, stretched to the chart's box; the dots, the times
/// and the total are HTML placed in percentages, so they keep their size and shape at any width
function chart(model: ChartModel): string {
  const end = model.target ? model.end : model.end * 1.08 || 1;
  const x = (t: number) => pct(Math.min(t, end) / end);
  const y = (v: number) => pct(1 - v / model.total);

  let line = `M0 100`;
  for (const pour of model.pours) line += ` L${x(pour.at)} ${y(pour.from)} L${x(pour.until)} ${y(pour.to)}`;
  const last = model.pours[model.pours.length - 1]!;
  line += ` L100 ${y(last.to)}`;

  const html: string[] = [
    `<figure class="brew-chart-box" role="img" aria-label="Water on the scale over time">`,
    `<div class="brew-chart-plot"><svg class="brew-chart" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">`,
    `<path class="brew-chart-area" d="${line} L100 100 Z"/>`,
    `<path class="brew-chart-grid" d="M0 0 L100 0"/>`,
  ];
  if (model.target) html.push(`<path class="brew-chart-target" d="M100 0 L100 100"/>`);
  html.push(`<path class="brew-chart-line" d="${line}"/>`, `<path class="brew-chart-axis" d="M0 100 L100 100"/></svg>`);
  for (const pour of model.pours) html.push(`<span class="brew-chart-dot" style="left:${x(pour.until)}%;top:${y(pour.to)}%"></span>`);
  html.push(`<span class="brew-chart-total">${escape(model.totalLabel)}</span></div>`);

  // The times under the chart; one too close to the one before would overlap it, and the target keeps its place
  html.push(`<div class="brew-chart-ticks">`);
  let lastTick = -Infinity;
  for (const pour of model.pours) {
    const at = x(pour.at);
    if (at - lastTick < 9 || (model.target && 100 - at < 9)) continue;
    html.push(`<span class="brew-chart-tick" style="left:${at}%">${escape(pour.time)}</span>`);
    lastTick = at;
  }
  if (model.target) html.push(`<span class="brew-chart-tick brew-chart-end">${escape(model.target)}</span>`);
  html.push(`</div></figure>`);
  return html.join("");
}

/// The kicker, its parts in spans so a layout can set the brewer apart: 'Chemex · Pour-over'
function kicker(model: RecipeModel): string {
  const brewer = escape(model.brewer);
  const text = escape(model.kicker);
  if (!text.startsWith(`${brewer} · `)) return text;
  return `<span class="brew-brewer">${brewer}</span><span class="brew-sep"> · </span><span class="brew-method">${text.slice(brewer.length + 3)}</span>`;
}

/** Renders a card as an HTML string, styled by brew.css: every class starts with 'brew-'. */
export function toHtml(model: RecipeModel, options: HtmlOptions = {}): string {
  const html: string[] = [];
  const theme = options.theme ? ` data-theme="${options.theme}"` : "";
  const layout = options.layout && options.layout !== "classic" ? ` data-layout="${options.layout}"` : "";

  html.push(`<article class="brew-card"${theme}${layout}>`);
  html.push(
    `<header class="brew-head"><div class="brew-kicker">${kicker(model)}</div><h2 class="brew-title">${escape(model.title)}</h2></header>`,
  );

  if (model.note) html.push(`<p class="brew-note">${escape(model.note)}</p>`);

  html.push(`<dl class="brew-specs">`);
  for (const spec of model.specs) {
    const accent = spec.accent ? ` class="brew-accent"` : "";
    html.push(`<div class="brew-spec"><dt>${escape(spec.label)}</dt><dd${accent}>${escape(spec.value)}</dd></div>`);
  }
  html.push(`</dl>`);

  if (model.extras.length) {
    html.push(`<p class="brew-extras">`);
    for (const extra of model.extras) {
      const note = extra.note ? ` <span class="brew-muted">· ${escape(extra.note)}</span>` : "";
      html.push(`<span><span class="brew-muted">${escape(extra.label)}</span> <strong>${escape(extra.value)}</strong>${note}</span>`);
    }
    html.push(`</p>`);
  }

  if (model.prep.length) {
    html.push(`<section class="brew-prep"><h3>Before you start</h3><ul>`);
    for (const prep of model.prep) {
      html.push(`<li><span class="brew-prep-title">${escape(prep.title)}</span>`);
      if (prep.meta) html.push(`<span class="brew-muted"> · ${escape(prep.meta)}</span>`);
      if (prep.comment) html.push(` <span class="brew-comment">${escape(prep.comment)}</span>`);
      html.push(`</li>`);
    }
    html.push(`</ul></section>`);
  }

  if (options.layout === "chart" && model.chart) html.push(chart(model.chart));

  html.push(`<ol class="brew-steps">`);
  for (const step of model.steps) {
    html.push(`<li class="brew-step">`);
    html.push(`<div class="brew-time${step.timed ? "" : " brew-untimed"}">${escape(step.time)}</div>`);
    html.push(`<div class="brew-body">`);
    // An action's comment fits on its title line; a pour's goes under its amounts
    const isPour = step.fill !== undefined;
    const inline = !isPour && step.comment ? ` <span class="brew-comment">${escape(step.comment)}</span>` : "";
    html.push(`<div class="brew-step-title${step.unknown ? " brew-unknown" : ""}">${escape(step.title)}${inline}</div>`);
    if (step.meta || step.qualifiers.length) {
      html.push(`<div class="brew-meta">`);
      if (step.meta) html.push(`<span>${escape(step.meta)}</span>`);
      for (const q of step.qualifiers) html.push(`<span class="brew-chip">${escape(q)}</span>`);
      html.push(`</div>`);
    }
    if (isPour && step.comment) html.push(`<div class="brew-comment">${escape(step.comment)}</div>`);
    html.push(`</div>`);
    if (step.fill !== undefined) {
      html.push(
        `<div class="brew-water"><div class="brew-bar"><div class="brew-bar-fill" style="width:${Math.round(step.fill * 100)}%"></div></div><div class="brew-bar-label">${escape(step.total ?? "")}</div></div>`,
      );
    }
    html.push(`</li>`);
  }
  html.push(`</ol>`);

  if (model.target) {
    html.push(`<p class="brew-target"><span>Aim to finish at</span><span class="brew-target-time">${escape(model.target)}</span></p>`);
    if (model.targetNote) html.push(`<p class="brew-target-note">${escape(model.targetNote)}</p>`);
  }

  if (options.signed) html.push(`<footer class="brew-foot">Brewlang</footer>`);
  if (options.layout === "receipt") html.push(barcode());

  html.push(`</article>`);
  return html.join("");
}
