import type { Diagnostic } from "./diagnostics.js";
import type { Amount, DoseUnit, Quantity, Recipe, step as Step, TempUnit, WaterUnit } from "./ast.js";
import { diagnostic, range, round } from "./scaler.js";

/// The units wanted after converting; a missing one stays as written
export interface ConvertUnits {
  dose?: DoseUnit;
  water?: WaterUnit;
  temp?: TempUnit;
}

export interface ConvertResult {
  recipe: Recipe; // The source recipe, untouched, when there are errors
  diagnostics: Diagnostic[];
}

/// How many of the smaller unit make one of the bigger: 1 oz = 28.35 g, 1 floz = 29.57 ml
const GRAMS_PER_OUNCE = 28.349523125;
const MILLILITERS_PER_FLUID_OUNCE = 29.5735295625;

/// Weights and volumes never convert into each other
const family = (unit: string) => (unit === "ml" || unit === "floz" ? "volume" : "weight");

/// A value in another unit of the same kind: 15 g -> 0.53 oz, 94 °C -> 201.2 °F
function convertValue(value: number, from: string, to: string): number {
  if (from === to) return value;
  if (from === "g" && to === "oz") return value / GRAMS_PER_OUNCE;
  if (from === "oz" && to === "g") return value * GRAMS_PER_OUNCE;
  if (from === "ml" && to === "floz") return value / MILLILITERS_PER_FLUID_OUNCE;
  if (from === "floz" && to === "ml") return value * MILLILITERS_PER_FLUID_OUNCE;
  if (from === "°C" && to === "°F") return (value * 9) / 5 + 32;
  if (from === "°F" && to === "°C") return ((value - 32) * 5) / 9;
  throw new Error(`No conversion from ${from} to ${to}`); // Ruled out by the callers
}

/// Round the way a scale or a thermometer shows it: 1 g or ml, 0.1 oz or floz, 1 degree
const roundIn = (value: number, unit: string) => (unit === "°C" || unit === "°F" ? Math.round(value) : round(value, unit));

/// A quantity in another unit, both bounds of a range rounded
const convertQuantity = <U extends string>(quantity: Quantity<string>, unit: U): Quantity<U> => {
  if (quantity.unit === unit) return quantity as Quantity<U>; // Already there: no rounding
  const { value, max = value } = quantity.amount;
  const convert = (v: number) => roundIn(convertValue(v, quantity.unit, unit), unit);
  return { ...quantity, unit, amount: range(convert(value), convert(max)) };
};

/** Converts a checked recipe to other units: dose in g or oz, water within weights or volumes, temperatures in °C or °F. */
export function convert(recipe: Recipe, units: ConvertUnits): ConvertResult {
  const { header } = recipe;
  if (!header) return { recipe, diagnostics: [] };

  const fail = (message: string, node: Quantity<string>): ConvertResult => ({
    recipe,
    diagnostics: [diagnostic("error", message, node)],
  });

  // The recipe uses one unit per measure: the first one written is the water's
  const water = header.water ?? recipe.steps.find((step) => step.kind === "Pour")?.water;
  const toWater = water && units.water && units.water !== water.unit ? units.water : undefined;
  if (water && toWater && family(water.unit) !== family(toWater)) {
    const same = family(water.unit) === "weight" ? "g or oz" : "ml or floz";
    return fail(
      `The water is a ${family(water.unit)} in ${water.unit}: Brewlang never turns weights into volumes, convert it to ${same}`,
      water,
    );
  }

  const newHeader = { ...header };

  if (units.dose && units.dose !== header.dose.unit) {
    newHeader.dose = convertQuantity(header.dose, units.dose);
    if (newHeader.dose.amount.value === 0) {
      return fail(`In ${units.dose}, the dose rounds to 0: keep it in ${header.dose.unit}`, header.dose);
    }
  }

  const toTemp = units.temp;
  if (toTemp && header.temp) newHeader.temp = convertQuantity(header.temp, toTemp);

  // Round the water on the scale, then derive each '+' from it: the rounded total stays exact
  let low = 0;
  let high = 0;
  let newLow = 0;
  let newHigh = 0;
  const steps: Step[] = [];

  for (const step of recipe.steps) {
    if (step.kind === "TempChange" && toTemp) {
      steps.push({ ...step, temp: convertQuantity(step.temp, toTemp) });
      continue;
    }
    if (step.kind !== "Pour" || !toWater) {
      steps.push(step);
      continue;
    }

    const { value, max = value } = step.water.amount;
    const { unit } = step.water;
    [low, high] = step.mode === "add" ? [low + value, high + max] : [value, max];

    const [nextLow, nextHigh] = [
      roundIn(convertValue(low, unit, toWater), toWater),
      roundIn(convertValue(high, unit, toWater), toWater),
    ];
    if (nextLow <= newLow) {
      return fail(`In ${toWater}, this pour rounds to the same water as the one before: keep the water in ${unit}`, step.water);
    }

    const amount: Amount =
      step.mode === "add"
        ? range(round(nextLow - newLow, toWater), round(nextHigh - newHigh, toWater))
        : range(nextLow, nextHigh);
    [newLow, newHigh] = [nextLow, nextHigh];

    steps.push({ ...step, water: { ...step.water, unit: toWater, amount } });
  }

  if (header.water && toWater) newHeader.water = convertQuantity(header.water, toWater);

  return { recipe: { ...recipe, header: newHeader, steps }, diagnostics: [] };
}
