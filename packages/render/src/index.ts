import type { ConvertUnits, Diagnostic, Recipe } from "brewlang";
import { check, convert, scale } from "brewlang";
import type { HtmlOptions } from "./html.js";
import { toHtml } from "./html.js";
import type { RecipeModel } from "./model.js";
import { describe } from "./model.js";

export type { HtmlOptions } from "./html.js";
export { toHtml } from "./html.js";
export type { DescribeOptions, RecipeModel, StepModel } from "./model.js";
export { brewerKind, describe } from "./model.js";

export interface RenderOptions extends HtmlOptions {
  /** Multiply every amount, for display only: 2 doubles the recipe. Default: 1. */
  factor?: number;
  /** Show the dose and the water in g or in oz; water written as a volume shows in ml or fl oz. */
  weight?: "g" | "oz";
  /** Show the temperatures in °C or °F. */
  temp?: "°C" | "°F";
  /** Finer control than weight and temp: each unit, as brewlang's convert takes them. */
  units?: ConvertUnits;
  /** The title when the metadata has none. */
  title?: string;
}

export interface RenderResult {
  /** The card as HTML; empty when the recipe has no header. */
  html: string;
  model?: RecipeModel;
  /** The recipe as shown: scaled and converted when asked and possible, else as written. */
  recipe: Recipe;
  /** What check found in the source. */
  diagnostics: Diagnostic[];
  /** What scaling and converting reported: a warning about times when scaled, or why they could not apply. */
  notes: Diagnostic[];
}

/// The units to convert to: weight and temp, then units on top; the water keeps its kind, weight or volume
function unitsFor(recipe: Recipe, options: RenderOptions): ConvertUnits | undefined {
  const units: ConvertUnits = {};
  if (options.weight) {
    const water = recipe.header?.water ?? recipe.steps.find((s) => s.kind === "Pour")?.water;
    const volume = water?.unit === "ml" || water?.unit === "floz";
    units.dose = options.weight;
    units.water = options.weight === "g" ? (volume ? "ml" : "g") : volume ? "floz" : "oz";
  }
  if (options.temp) units.temp = options.temp;
  Object.assign(units, options.units);
  return Object.keys(units).length ? units : undefined;
}

/** Checks a .brew source and renders it as a card. Scaling and units need a recipe without errors:
 *  with errors, the card shows the recipe as parsed. */
export function render(source: string, options: RenderOptions = {}): RenderResult {
  const { recipe: written, diagnostics } = check(source);
  const notes: Diagnostic[] = [];
  let recipe = written;

  if (!diagnostics.some((d) => d.severity === "error") && written.header) {
    if (options.factor !== undefined && options.factor !== 1) {
      const scaled = scale(recipe, options.factor);
      notes.push(...scaled.diagnostics);
      if (!scaled.diagnostics.some((d) => d.severity === "error")) recipe = scaled.recipe;
    }
    const units = unitsFor(recipe, options);
    if (units) {
      const converted = convert(recipe, units);
      notes.push(...converted.diagnostics);
      if (!converted.diagnostics.some((d) => d.severity === "error")) recipe = converted.recipe;
    }
  }

  const describeOptions = options.title === undefined ? { written } : { written, title: options.title };
  const model = describe(recipe, describeOptions);
  const result: RenderResult = { html: model ? toHtml(model, options) : "", recipe, diagnostics, notes };
  if (model) result.model = model;
  return result;
}
