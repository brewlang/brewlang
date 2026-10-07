import type { Amount, BrewerType, Duration, Recipe } from "brewlang";
import { ACTION_ALIASES, ACTIONS, findBrewer, toJson } from "brewlang";

/// How each kind of brewer brews, for the line above the title
const KINDS: Record<BrewerType, string> = {
  dripper: "Pour-over",
  valve: "Hybrid",
  aeropress: "Immersion",
  press: "Immersion",
  siphon: "Vacuum",
};

/// What each core action asks the reader to do
const LABELS: Record<string, string> = {
  rinse: "Rinse the filter",
  "level-bed": "Level the bed",
  swirl: "Swirl",
  stir: "Stir",
  skim: "Skim",
  wait: "Wait",
  press: "Press",
  invert: "Invert the AeroPress",
  flip: "Flip onto the cup",
  open: "Open the valve",
  close: "Close the valve",
  drawdown: "Let it drain",
};

/// Units the way a reader says them
const UNIT_LABELS: Record<string, string> = { floz: "fl oz" };

/** A brewer's kind, in words: 'Pour-over', 'Immersion'…; 'Other brewer' outside the registry. */
export const brewerKind = (name: string) => {
  const brewer = findBrewer(name);
  return brewer ? KINDS[brewer.type] : "Other brewer";
};

/// '150 g', '240–250 g', '90 °C'
const amount = ({ value, max }: Amount, unit: string) =>
  `${value}${max === undefined ? "" : `–${max}`} ${UNIT_LABELS[unit] ?? unit}`;

/// 90 -> '1:30'
const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;

/// A duration in words: '45 s', '4 min', '3 min 30 s'
const durationText = ({ value, unit }: Duration) => {
  const seconds = unit === "m" ? value * 60 : value;
  if (seconds < 60) return `${seconds} s`;
  const rest = seconds % 60;
  return `${Math.floor(seconds / 60)} min${rest ? ` ${rest} s` : ""}`;
};

/// An action outside the core vocabulary, in words: '/tap-brewer' -> 'Tap brewer'
const humanize = (name: string) => {
  const words = name.replace(/[-_]+/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
};

/// Keep at most one decimal: float sums like 0.1 + 0.2 stay readable
const short = (n: number) => Math.round(n * 10) / 10;

/// A value or a range from two bounds
const range = (low: number, high: number): Amount => (low === high ? { value: low } : { value: low, max: high });

/** A step done before starting the timer: '/rinse -- preheat'. */
export interface PrepModel {
  title: string;
  meta: string;
  comment?: string;
}

/** One step of the card. */
export interface StepModel {
  time: string; // '0:45', '·' for an untimed step among timed ones, '01' when nothing is timed
  timed: boolean;
  title: string; // 'Pour to 150 g', 'Swirl'; an action outside the core vocabulary reads from its name: '/tap-brewer' -> 'Tap brewer'
  unknown: boolean;
  meta: string; // '+100 g · over 15 s'
  qualifiers: string[];
  comment?: string;
  fill?: number; // Pours only: the share of the total water on the scale after this pour, 0 to 1
  total?: string; // Pours only: the water on the scale after this pour
}

/** What a recipe card shows, in words: build it with describe(), render it with toHtml(). */
export interface RecipeModel {
  kicker: string; // 'Chemex · Pour-over'
  title: string;
  note?: string; // The header's comment: '@V60 15g 250g 90°C -- off the boil'
  specs: { label: string; value: string; accent?: boolean }[]; // Dose, water, temperature, ratio
  extras: { label: string; value: string; note?: string }[]; // Grind (with its comment), filter, pace
  prep: PrepModel[]; // Steps before the timer starts
  steps: StepModel[];
  target?: string;
  targetNote?: string; // The target's comment: 'target 3:00 -- expect some variance'
}

export interface DescribeOptions {
  /** The title when the metadata has none. Default: 'Untitled recipe'. */
  title?: string;
  /** The recipe as the author wrote it, when describing a scaled or converted copy: the ratio and the
   *  metadata come from it, since rounding would shift the ratio. */
  written?: Recipe;
}

/// Water at the end: the header total, or where the pours end
function totalWater(recipe: Recipe): { amount: Amount; unit: string } | undefined {
  const water = recipe.header?.water;
  if (water) return { amount: water.amount, unit: water.unit };

  let low = 0;
  let high = 0;
  let unit: string | undefined;
  for (const step of recipe.steps) {
    if (step.kind !== "Pour") continue;
    const { value, max = value } = step.water.amount;
    [low, high] = step.mode === "add" ? [low + value, high + max] : [value, max];
    unit = step.water.unit;
  }
  return unit ? { amount: range(low, high), unit } : undefined;
}

/// '1:16.7' when dose and water share a unit: Brewlang never turns weights into volumes
function ratio(recipe: Recipe): string {
  const dose = recipe.header?.dose;
  const water = totalWater(recipe);
  if (!dose || !water || water.unit !== dose.unit || dose.amount.max !== undefined || water.amount.max !== undefined) {
    return "—";
  }
  return `1:${short(water.amount.value / dose.amount.value)}`;
}

/** Describes a parsed recipe as a card; undefined when it has no header. */
export function describe(recipe: Recipe, options: DescribeOptions = {}): RecipeModel | undefined {
  const { header } = recipe;
  if (!header) return undefined;

  const written = options.written ?? recipe;
  const metadata = toJson(written).json?.metadata ?? {};
  const brewer = findBrewer(header.brewer);
  const steps = recipe.steps.filter((s) => s.kind === "Pour" || s.kind === "Action" || s.kind === "TempChange");
  const firstTimed = steps.findIndex((s) => (s.kind === "Pour" || s.kind === "Action") && s.time);

  // Water on the scale after each pour, and what each pour adds, as bounds
  let low = 0;
  let high = 0;
  const pours = new Map<object, { after: Amount; added: Amount }>();
  for (const step of steps) {
    if (step.kind !== "Pour") continue;
    const { value, max = value } = step.water.amount;
    const [before, beforeHigh] = [low, high];
    [low, high] = step.mode === "add" ? [low + value, high + max] : [value, max];
    pours.set(step, {
      after: range(low, high),
      added: step.mode === "add" ? step.water.amount : range(short(low - before), short(high - beforeHigh)),
    });
  }
  const total = totalWater(recipe);
  const totalHigh = total ? (total.amount.max ?? total.amount.value) : 0;

  const model: RecipeModel = {
    kicker: brewer ? `${brewer.name} · ${KINDS[brewer.type]}` : header.brewer,
    title: metadata.title || options.title || "Untitled recipe",
    specs: [
      { label: "Dose", value: amount(header.dose.amount, header.dose.unit) },
      { label: "Water", value: total ? amount(total.amount, total.unit) : "—" },
      { label: "Temp", value: header.temp ? amount(header.temp.amount, header.temp.unit) : "—" },
      { label: "Ratio", value: ratio(written), accent: true },
    ],
    extras: [],
    prep: [],
    steps: [],
  };

  const grind = recipe.steps.find((s) => s.kind === "Grind");
  if (header.comment) model.note = header.comment;
  if (grind) model.extras.push(grind.comment ? { label: "Grind", value: grind.size, note: grind.comment } : { label: "Grind", value: grind.size });
  if (metadata.filter) model.extras.push({ label: "Filter", value: metadata.filter });
  if (firstTimed < 0 && steps.length) model.extras.push({ label: "Pace", value: "your own, no timer" });

  let index = 0;
  steps.forEach((step, i) => {
    const view: StepModel = { time: "", timed: false, title: "", unknown: false, meta: "", qualifiers: [] };
    const meta: string[] = [];

    if (step.kind === "Pour") {
      const { after, added } = pours.get(step)!;
      view.title = `Pour to ${amount(after, step.water.unit)}`;
      meta.push(`+${amount(added, step.water.unit)}`);
      if (step.duration) meta.push(`over ${durationText(step.duration)}`);
      view.qualifiers = [...new Set(step.qualifiers)];
      view.fill = totalHigh ? Math.min(1, (after.max ?? after.value) / totalHigh) : 0;
      view.total = amount(after, step.water.unit);
    } else if (step.kind === "Action") {
      const name = ACTION_ALIASES[step.name] ?? step.name;
      view.unknown = !(name in ACTIONS);
      view.title = view.unknown ? humanize(step.name) : (LABELS[name] ?? humanize(step.name));
      if (step.duration) meta.push(durationText(step.duration));
      else if (name === "wait") meta.push("until it is ready");
    } else {
      view.title = `Water at ${amount(step.temp.amount, step.temp.unit)}`;
    }

    view.meta = meta.join(" · ");
    if (step.comment) view.comment = step.comment;

    // Untimed steps before the first timed one are done before starting the timer
    if (firstTimed > 0 && i < firstTimed) {
      const prep: PrepModel = { title: view.title, meta: view.meta };
      if (view.comment) prep.comment = view.comment;
      model.prep.push(prep);
      return;
    }

    index++;
    const time = (step.kind === "Pour" || step.kind === "Action") && step.time ? step.time : undefined;
    view.time = time ? clock(time.seconds) : firstTimed < 0 ? String(index).padStart(2, "0") : "·";
    view.timed = time !== undefined;
    model.steps.push(view);
  });

  const target = recipe.steps.find((s) => s.kind === "Target");
  if (target) {
    model.target = clock(target.time.seconds);
    if (target.comment) model.targetNote = target.comment;
  }

  return model;
}
