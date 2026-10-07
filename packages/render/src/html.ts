import type { RecipeModel } from "./model.js";

/// Escape text for HTML: recipes are user input
const escape = (text: string) =>
  text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export interface HtmlOptions {
  /** Sign the card 'Brewlang' at the bottom, for an image to share. Default: false. */
  signed?: boolean;
  /** Force a theme; by default the card follows the brew.css defaults and the page's variables. */
  theme?: "light" | "dark";
}

/** Renders a card as an HTML string, styled by brew.css: every class starts with 'brew-'. */
export function toHtml(model: RecipeModel, options: HtmlOptions = {}): string {
  const html: string[] = [];
  const theme = options.theme ? ` data-theme="${options.theme}"` : "";

  html.push(`<article class="brew-card"${theme}>`);
  html.push(
    `<header class="brew-head"><div class="brew-kicker">${escape(model.kicker)}</div><h2 class="brew-title">${escape(model.title)}</h2></header>`,
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

  html.push(`</article>`);
  return html.join("");
}
