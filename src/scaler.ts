import type { Diagnostic, Severity } from "./diagnostics.js";
import type { Amount, Node, Recipe, step as Step } from "./ast.js";
import { formatQuantity } from "./formatter.js";

/// The amount wanted after scaling: '25g' of coffee, '400g' of water
export interface ScaleTarget {
  value: number;
  unit: string;
}

export interface ScaleResult {
  recipe: Recipe; // The source recipe, untouched, when there are errors
  diagnostics: Diagnostic[];
}

/// Build an amount from two bounds, a single value when they are equal
const range = (low: number, high: number): Amount =>
  low === high ? { value: low } : { value: low, max: high };

/// Round to what a scale shows: 1 g or ml, 0.1 oz or floz
const round = (value: number, unit: string) =>
  unit === "oz" || unit === "floz" ? Math.round(value * 10) / 10 : Math.round(value);

/// A factor for a message: 1.6666 -> '×1.67'
const formatFactor = (factor: number) => `×${Number(factor.toFixed(2))}`;

const diagnostic = (severity: Severity, message: string, { line, column }: Node): Diagnostic => ({
  severity,
  message,
  line,
  column,
});

/// Water on the scale after the last pour, as bounds; the header total wins when written
function totalWater(recipe: Recipe): { low: number; high: number; unit: string } | undefined {
  const water = recipe.header?.water;
  if (water) {
    const { value, max = value } = water.amount;
    return { low: value, high: max, unit: water.unit };
  }

  let total: { low: number; high: number; unit: string } | undefined;
  for (const step of recipe.steps) {
    if (step.kind !== "Pour") continue;
    const { value, max = value } = step.water.amount;
    const { low = 0, high = 0 } = total ?? {};
    total =
      step.mode === "add"
        ? { low: low + value, high: high + max, unit: step.water.unit }
        : { low: value, high: max, unit: step.water.unit };
  }
  return total;
}

/** Multiplies every weight of a checked recipe (dose, water, pours) by a factor; times stay as written, with a warning. */
export function scale(recipe: Recipe, factor: number): ScaleResult {
  const { header } = recipe;
  if (!header) return { recipe, diagnostics: [] };

  const fail = (message: string, node: Node): ScaleResult => ({
    recipe,
    diagnostics: [diagnostic("error", message, node)],
  });

  if (!(factor > 0) || !Number.isFinite(factor)) {
    return fail(`The scaling factor must be a positive number, like 1.5, not ${factor}`, header.dose);
  }

  const scaled = (value: number, unit: string) => round(value * factor, unit);

  const { dose } = header;
  const doseAmount = range(
    scaled(dose.amount.value, dose.unit),
    scaled(dose.amount.max ?? dose.amount.value, dose.unit),
  );
  if (doseAmount.value === 0) {
    return fail(
      `Scaled ${formatFactor(factor)}, the dose rounds to 0${dose.unit}: use a bigger factor`,
      dose,
    );
  }

  // Round the water on the scale, then derive each '+' from it: the rounded total stays exact
  let low = 0;
  let high = 0;
  let scaledLow = 0;
  let scaledHigh = 0;
  const steps: Step[] = [];

  for (const step of recipe.steps) {
    if (step.kind !== "Pour") {
      steps.push(step);
      continue;
    }

    const { value, max = value } = step.water.amount;
    const { unit } = step.water;
    [low, high] = step.mode === "add" ? [low + value, high + max] : [value, max];

    const [nextLow, nextHigh] = [scaled(low, unit), scaled(high, unit)];
    if (nextLow <= scaledLow) {
      return fail(
        `Scaled ${formatFactor(factor)}, this pour rounds to the same water as the one before: use a bigger factor`,
        step.water,
      );
    }

    const amount =
      step.mode === "add"
        ? range(round(nextLow - scaledLow, unit), round(nextHigh - scaledHigh, unit))
        : range(nextLow, nextHigh);
    [scaledLow, scaledHigh] = [nextLow, nextHigh];

    steps.push({ ...step, water: { ...step.water, amount } });
  }

  const newHeader = { ...header, dose: { ...dose, amount: doseAmount } };
  if (header.water) {
    const { amount, unit } = header.water;
    newHeader.water = {
      ...header.water,
      amount: range(scaled(amount.value, unit), scaled(amount.max ?? amount.value, unit)),
    };
  }

  // Bigger batches drain slower, smaller ones faster: the grind has to follow
  const diagnostics: Diagnostic[] = [];
  if (factor !== 1) {
    const advice = factor > 1 ? "a coarser grind and a later finish" : "a finer grind and an earlier finish";
    diagnostics.push(
      diagnostic("warning", `Amounts ${formatFactor(factor)}, times unchanged: plan ${advice}`, dose),
    );
  }

  return { recipe: { ...recipe, header: newHeader, steps }, diagnostics };
}

/** Scales a checked recipe to a new dose, in the recipe's dose unit. */
export function scaleToDose(recipe: Recipe, dose: ScaleTarget): ScaleResult {
  const { header } = recipe;
  if (!header) return { recipe, diagnostics: [] };

  const { amount, unit } = header.dose;
  const fail = (message: string): ScaleResult => ({
    recipe,
    diagnostics: [diagnostic("error", message, header.dose)],
  });

  if (dose.unit !== unit) {
    return fail(`The recipe weighs its dose in ${unit}: give the new dose in ${unit} too, like '${dose.value}${unit}'`);
  }
  if (amount.max !== undefined) {
    return fail(`The dose is a range, ${formatQuantity(amount, unit)}: scale this recipe by its water instead`);
  }

  return scale(recipe, dose.value / amount.value);
}

/** Scales a checked recipe to a new total water: the header's, or where the pours end. */
export function scaleToWater(recipe: Recipe, water: ScaleTarget): ScaleResult {
  const { header } = recipe;
  if (!header) return { recipe, diagnostics: [] };

  const node = header.water ?? header;
  const fail = (message: string): ScaleResult => ({
    recipe,
    diagnostics: [diagnostic("error", message, node)],
  });

  const total = totalWater(recipe);
  if (!total) {
    return fail("This recipe gives no total water: scale it by its dose instead");
  }
  if (water.unit !== total.unit) {
    return fail(
      `The recipe measures its water in ${total.unit}: give the new water in ${total.unit} too, like '${water.value}${total.unit}'`,
    );
  }
  if (total.low !== total.high) {
    return fail(
      `The water ends at a range, ${formatQuantity(range(total.low, total.high), total.unit)}: scale this recipe by its dose instead`,
    );
  }

  return scale(recipe, water.value / total.low);
}
