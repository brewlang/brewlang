import type { Amount, Duration, Header, Recipe, step as Step } from "./ast.js";
import { findBrewer } from "./registry.js";

/// Format seconds the way the author writes them: 90 -> '1:30'
export const formatTime = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;

/// Format a quantity the way the author writes it: '150g', '240-250g'
export const formatQuantity = ({ value, max }: Amount, unit: string) =>
  `${value}${max === undefined ? "" : `-${max}`}${unit}`;

/// A duration as the author wrote it: '~15s', '~4m' or '~3:30'
const formatDuration = ({ value, unit }: Duration) =>
  unit === "m:ss" ? `~${formatTime(value)}` : `~${value}${unit}`;

/// A trailing comment: ' -- text', or ' --' when empty
const formatComment = (comment: string | undefined) =>
  comment === undefined ? "" : ` --${comment ? ` ${comment}` : ""}`;

/** Writes a recipe back as .brew text, in its canonical form; the recipe must have parsed without errors. */
export function format(recipe: Recipe): string {
  const lines: string[] = [];

  if (recipe.frontmatter) {
    // The YAML is kept as written, without its line endings
    const yaml = recipe.frontmatter.raw.split("\n").slice(0, -1);
    lines.push("---", ...yaml.map((line) => line.replace(/\r$/, "")), "---", "");
  }

  let previousLine: number | undefined;
  if (recipe.header) {
    lines.push(formatHeader(recipe.header));
    previousLine = recipe.header.line;
  }

  for (const step of recipe.steps) {
    // Keep the author's blank lines between steps, several become one
    if (previousLine !== undefined && step.line > previousLine + 1) lines.push("");
    lines.push(formatStep(step));
    previousLine = step.line;
  }

  return `${lines.join("\n")}\n`;
}

/// '@V60 15g 250g 94°C -- comment', with the brewer named as in the registry
function formatHeader(header: Header): string {
  const brewer = findBrewer(header.brewer)?.name ?? header.brewer;
  const parts = [`@${brewer}`, formatQuantity(header.dose.amount, header.dose.unit)];

  if (header.water) parts.push(formatQuantity(header.water.amount, header.water.unit));
  if (header.temp) parts.push(formatQuantity(header.temp.amount, header.temp.unit));

  return parts.join(" ") + formatComment(header.comment);
}

/// One step on its line; pour modifiers go duration first, then bloom, then the others
function formatStep(step: Step): string {
  const parts: string[] = [];

  switch (step.kind) {
    case "Comment":
      return formatComment(step.text).trimStart();

    case "Grind":
      parts.push("grind", step.size);
      break;

    case "Target":
      parts.push("target", formatTime(step.time.seconds));
      break;

    case "TempChange":
      parts.push(formatQuantity(step.temp.amount, step.temp.unit));
      break;

    case "Pour": {
      if (step.time) parts.push(formatTime(step.time.seconds));
      const plus = step.mode === "add" ? "+" : "";
      parts.push(plus + formatQuantity(step.water.amount, step.water.unit));
      if (step.duration) parts.push(formatDuration(step.duration));

      const qualifiers = new Set(step.qualifiers);
      if (qualifiers.delete("bloom")) parts.push("bloom");
      parts.push(...qualifiers);
      break;
    }

    case "Action":
      if (step.time) parts.push(formatTime(step.time.seconds));
      parts.push(`/${step.name}`);
      if (step.duration) parts.push(formatDuration(step.duration));
      break;
  }

  return parts.join(" ") + formatComment(step.comment);
}
