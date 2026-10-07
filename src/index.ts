import type { ParseResult } from "./ast.js";
import { analyze } from "./analyzer.js";
import { parse } from "./parser.js";

export type * from "./ast.js";
export { DOSE_UNITS, GRIND_SIZES, QUALIFIERS, TEMP_UNITS, WATER_UNITS } from "./ast.js";
export type { Diagnostic, Severity } from "./diagnostics.js";
export { analyze } from "./analyzer.js";
export { format } from "./formatter.js";
export type * from "./json.js";
export { JSON_VERSION, toJson } from "./json.js";
export { lex } from "./lexer.js";
export type { Token, TokenKind } from "./tokens.js";
export { parse } from "./parser.js";
export type { ScaleResult, ScaleTarget } from "./scaler.js";
export { scale, scaleToDose, scaleToWater } from "./scaler.js";
export * from "./registry.js";

/** Parses and checks a Brewlang source: the recipe, and every diagnostic in file order. */
export function check(source: string): ParseResult {
  const { recipe, diagnostics } = parse(source);

  // The analysis needs a complete recipe: skip it when the source has syntax errors
  if (!diagnostics.some((d) => d.severity === "error")) {
    diagnostics.push(...analyze(recipe));
  }

  diagnostics.sort((a, b) => a.line - b.line || a.column - b.column);

  return { recipe, diagnostics };
}
