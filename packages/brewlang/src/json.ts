import type { Diagnostic } from "./diagnostics.js";
import type {
  DoseUnit,
  Duration,
  Frontmatter,
  GrindSize,
  Quantity,
  Recipe,
  TempUnit,
  WaterUnit,
} from "./ast.js";
import { findBrewer } from "./registry.js";

/** Version of the JSON format, written in every document as `brewlang`. */
export const JSON_VERSION = "0.1";

/// Units spelled out, as CoffeeJSON writes them
const UNIT_NAMES = {
  g: "gram",
  oz: "ounce",
  ml: "milliliter",
  floz: "fluid_ounce",
  "°C": "celsius",
  "°F": "fahrenheit",
} as const;

type UnitNames = typeof UNIT_NAMES;

/** A quantity in JSON: one value, or a range from `min` to `max`. */
export type JsonQuantity<U extends string> = { value: number; unit: U } | { min: number; max: number; unit: U };

export type JsonMass = JsonQuantity<UnitNames[DoseUnit]>;
export type JsonWater = JsonQuantity<UnitNames[WaterUnit]>;
export type JsonTemp = JsonQuantity<UnitNames[TempUnit]>;

/** A grind size with underscores, as CoffeeJSON writes it: `medium_fine`. */
export type JsonGrindSize = GrindSize extends infer S extends string ? Underscored<S> : never;
type Underscored<S extends string> = S extends `${infer A}-${infer B}` ? `${A}_${Underscored<B>}` : S;

/** How long a step lasts, in seconds, and the unit the author wrote it in when not seconds. */
interface JsonTimed {
  at_s?: number;
  action_duration_s?: number;
  duration_unit?: "m" | "m:ss";
}

export interface JsonPour extends JsonTimed {
  kind: "pour";
  to_water?: JsonWater; // '150g': the total on the scale
  add_water?: JsonWater; // '+60g': water to add
  bloom?: true;
  technique?: "spiral" | "center" | "pulse";
  comment?: string;
}

export interface JsonAction extends JsonTimed {
  kind: "action";
  name: string;
  comment?: string;
}

export interface JsonTempChange {
  kind: "temp";
  water_temp: JsonTemp;
  comment?: string;
}

export interface JsonTarget {
  kind: "target";
  at_s: number;
  comment?: string;
}

export interface JsonComment {
  kind: "comment";
  text: string;
}

export type JsonStep = JsonPour | JsonAction | JsonTempChange | JsonTarget | JsonComment;

/** A recipe as JSON: field names follow CoffeeJSON where the two formats overlap. */
export interface BrewJson {
  brewlang: typeof JSON_VERSION;
  metadata?: Record<string, string>;
  brewer: string;
  coffee: JsonMass;
  water?: JsonWater;
  water_temp?: JsonTemp;
  header_comment?: string;
  grind?: { size: JsonGrindSize; comment?: string };
  steps: JsonStep[];
}

export interface JsonResult {
  json?: BrewJson; // Absent only when the recipe has no header
  diagnostics: Diagnostic[];
}

/// '90-93' in °C -> { min: 90, max: 93, unit: 'celsius' }
const quantity = <U extends keyof UnitNames>({ amount, unit }: Quantity<U>): JsonQuantity<UnitNames[U]> =>
  amount.max === undefined
    ? { value: amount.value, unit: UNIT_NAMES[unit] }
    : { min: amount.value, max: amount.max, unit: UNIT_NAMES[unit] };

/// '~4m' -> 240 seconds, with 'm' kept so the recipe can be written back as the author did
const duration = (step: { duration?: Duration }, json: JsonTimed) => {
  if (!step.duration) return;
  const { value, unit } = step.duration;
  json.action_duration_s = unit === "m" ? value * 60 : value;
  if (unit !== "s") json.duration_unit = unit;
};

/// A YAML 'key: value' line; quotes around the value are dropped
const METADATA_LINE = /^([A-Za-z_][\w-]*):[ \t]+(.*?)[ \t]*\r?$/;

/// The frontmatter's simple 'key: value' lines; any other line is left out, with a warning
function metadata(frontmatter: Frontmatter, diagnostics: Diagnostic[]): Record<string, string> {
  const entries: Record<string, string> = {};
  const lines = frontmatter.raw.split("\n").slice(0, -1);

  lines.forEach((line, index) => {
    if (/^\s*(#.*)?\r?$/.test(line)) return; // Blank lines and YAML comments

    const match = METADATA_LINE.exec(line);
    if (!match) {
      diagnostics.push({
        severity: "warning",
        message: "Only 'key: value' lines go into the JSON metadata: this line is left out",
        line: frontmatter.line + 1 + index,
        column: 1,
      });
      return;
    }

    const [, key, value] = match as unknown as [string, string, string];
    entries[key] = /^(["']).*\1$/.test(value) ? value.slice(1, -1) : value;
  });

  return entries;
}

/** Converts a checked recipe to JSON; metadata lines that are not 'key: value' come back as warnings. */
export function toJson(recipe: Recipe): JsonResult {
  const diagnostics: Diagnostic[] = [];
  const { header } = recipe;
  if (!header) return { diagnostics };

  // Keys are added in the order they are printed: version and metadata first
  const json = { brewlang: JSON_VERSION } as BrewJson;

  if (recipe.frontmatter) {
    const entries = metadata(recipe.frontmatter, diagnostics);
    if (Object.keys(entries).length > 0) json.metadata = entries;
  }

  json.brewer = findBrewer(header.brewer)?.name ?? header.brewer;
  json.coffee = quantity(header.dose);
  if (header.water) json.water = quantity(header.water);
  if (header.temp) json.water_temp = quantity(header.temp);
  if (header.comment !== undefined) json.header_comment = header.comment;

  // The grind goes before the steps, even though it is found among them
  const grind = recipe.steps.find((step) => step.kind === "Grind");
  if (grind) {
    json.grind = { size: grind.size.replaceAll("-", "_") as JsonGrindSize };
    if (grind.comment !== undefined) json.grind.comment = grind.comment;
  }

  json.steps = [];
  for (const step of recipe.steps) {
    switch (step.kind) {
      case "Grind":
        // Already on the recipe: the analyzer allows one grind, before the steps
        break;

      case "Pour": {
        const pour: JsonPour = { kind: "pour" };
        if (step.time) pour.at_s = step.time.seconds;
        if (step.mode === "add") pour.add_water = quantity(step.water);
        else pour.to_water = quantity(step.water);
        duration(step, pour);
        if (step.qualifiers.includes("bloom")) pour.bloom = true;
        const technique = step.qualifiers.find((q) => q !== "bloom");
        if (technique) pour.technique = technique;
        if (step.comment !== undefined) pour.comment = step.comment;
        json.steps.push(pour);
        break;
      }

      case "Action": {
        const action: JsonAction = { kind: "action", name: step.name };
        if (step.time) action.at_s = step.time.seconds;
        duration(step, action);
        if (step.comment !== undefined) action.comment = step.comment;
        json.steps.push(action);
        break;
      }

      case "TempChange": {
        const temp: JsonTempChange = { kind: "temp", water_temp: quantity(step.temp) };
        if (step.comment !== undefined) temp.comment = step.comment;
        json.steps.push(temp);
        break;
      }

      case "Target": {
        const target: JsonTarget = { kind: "target", at_s: step.time.seconds };
        if (step.comment !== undefined) target.comment = step.comment;
        json.steps.push(target);
        break;
      }

      case "Comment":
        json.steps.push({ kind: "comment", text: step.text });
        break;
    }
  }

  return { json, diagnostics };
}
