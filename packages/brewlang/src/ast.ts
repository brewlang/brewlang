import type { Diagnostic } from "./diagnostics.js";

export interface Node {
  line: number;
  column: number;
}

export const GRIND_SIZES = [
  "extra-fine",
  "fine",
  "medium-fine",
  "medium",
  "medium-coarse",
  "coarse",
  "extra-coarse",
] as const;

export type GrindSize = (typeof GRIND_SIZES)[number];

export const QUALIFIERS = ["bloom", "spiral", "center", "pulse"] as const;
export type Qualifier = (typeof QUALIFIERS)[number];

export const DOSE_UNITS = ["g", "oz"] as const;
export type DoseUnit = (typeof DOSE_UNITS)[number];

export const WATER_UNITS = ["g", "ml", "oz", "floz"] as const;
export type WaterUnit = (typeof WATER_UNITS)[number];

export const TEMP_UNITS = ["°C", "°F"] as const;
export type TempUnit = (typeof TEMP_UNITS)[number];

export type DurationUnit = "s" | "m" | "m:ss"; // 'm:ss' is '~3:30', its value in seconds

/// A value or a range: '94' or '90-93'
export interface Amount {
  value: number;
  max?: number; // Upper bound of a range
}

/// An amount with its unit: '15g', '90-93°C'
export interface Quantity<U extends string> extends Node {
  amount: Amount;
  unit: U;
}

/// A step start, '0:45', stored in seconds
export interface Time extends Node {
  seconds: number;
}

/// A duration, '~15s', '~4m' or '~3:30', with the author's unit kept for formatting
export interface Duration extends Node {
  value: number;
  unit: DurationUnit;
}

/// The whole .brew file
export interface Recipe extends Node {
  kind: "Recipe";
  frontmatter?: Frontmatter;
  header?: Header; // Missing only when the source is invalid
  steps: step[];
}

/// The YAML metadata block, kept as raw text (the parser has no dependency)
export interface Frontmatter extends Node {
  kind: "Frontmatter";
  raw: string;
}

/// '@V60 15g 250g 94°C'
export interface Header extends Node {
  kind: "Header";
  brewer: string; // Without the '@'
  dose: Quantity<DoseUnit>;
  water?: Quantity<WaterUnit>;
  temp?: Quantity<TempUnit>;
  comment?: string;
}

/// Every step after the header; blank steps are not kept
export type step = Grind | Pour | Action | TempChange | Target | Comment;

/// 'grind medium-fine'
export interface Grind extends Node {
  kind: "Grind";
  size: GrindSize;
  comment?: string;
}

/// '0:45 150g ~15s spiral' or '+60g bloom'
export interface Pour extends Node {
  kind: "Pour";
  time?: Time; // Absent = at the user's pace
  mode: "cumulative" | "add"; // '150g' is a target on the scale, '+60g' is water to add
  water: Quantity<WaterUnit>;
  duration?: Duration;
  qualifiers: Qualifier[];
  comment?: string;
}

/// '2:00 /swirl' or '/press ~30s'
export interface Action extends Node {
  kind: "Action";
  time?: Time;
  name: string; // Without the '/'; open vocabulary
  duration?: Duration;
  comment?: string;
}

/// '90°C' alone on its line: applies to every following step
export interface TempChange extends Node {
  kind: "TempChange";
  temp: Quantity<TempUnit>;
  comment?: string;
}

/// 'target 3:00'
export interface Target extends Node {
  kind: "Target";
  time: Time;
  comment?: string;
}

/// '-- text' alone on its line
export interface Comment extends Node {
  kind: "Comment";
  text: string; // Without the '--'
}

export interface ParseResult {
  recipe: Recipe;
  diagnostics: Diagnostic[];
}
