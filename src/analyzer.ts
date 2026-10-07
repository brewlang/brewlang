import type { Diagnostic, Severity } from "./diagnostics.js";
import { formatQuantity, formatTime } from "./formatter.js";
import type { BrewerType } from "./registry.js";
import { editDistance } from "./distance.js";
import { ACTION_ALIASES, ACTIONS, BREWERS, findAction, findBrewer } from "./registry.js";
import type { Action, Amount, Grind, Node, Pour, Quantity, Recipe, Target, Time } from "./ast.js";

/// Check that two quantities are the same value, range and unit
const sameQuantity = (a: Quantity<string>, b: Quantity<string>) =>
  a.unit === b.unit && a.amount.value === b.amount.value && a.amount.max === b.amount.max;

/// Pour qualifiers that say how to pour; bloom says why
const TECHNIQUES: readonly string[] = ["spiral", "center", "pulse"];

/// Build an amount from two bounds, a single value when they are equal
const range = (low: number, high: number): Amount =>
  low === high ? { value: low } : { value: low, max: high };

/// Join words for a message: ['a', 'b', 'c'] -> 'a, b or c'
const orList = (words: string[]) =>
  words.length > 1 ? `${words.slice(0, -1).join(", ")} or ${words.at(-1)}` : (words[0] ?? "");

/// Name the brewers of some types for a message: '@Switch, @Clever or @Pulsar', or 'a dripper' when many
const describeTypes = (types: readonly BrewerType[]) =>
  orList(
    types.flatMap((type) => {
      const names = BREWERS.filter((b) => b.type === type).map((b) => `@${b.name}`);
      return names.length > 3 ? [`a ${type}`] : names;
    }),
  );

/// Every action name the tool knows, aliases included
const ACTION_NAMES = [...Object.keys(ACTIONS), ...Object.keys(ACTION_ALIASES)];

/// The known action an unknown name was probably meant to be: 1 edit away, 2 for long names
const closestAction = (name: string): string | undefined =>
  ACTION_NAMES.find((known) => editDistance(name, known) <= (known.length > 5 ? 2 : 1));

/** Checks the meaning of a parsed recipe, and reports every problem found. */
export function analyze(recipe: Recipe): Diagnostic[] {
  return new Analyzer(recipe).analyze();
}

export class Analyzer {
  private readonly diagnostics: Diagnostic[] = [];

  /// Create a new Analyzer over a recipe that parsed without errors
  constructor(private readonly recipe: Recipe) {}

  /// Run every check on the recipe
  analyze(): Diagnostic[] {
    this.checkGrind();
    this.checkTimes();
    this.checkUnits();
    this.checkWater();
    this.checkOverlap();
    this.checkTechniques();
    this.checkActions();
    this.checkValve();
    this.checkAeroPress();
    this.checkTempChanges();
    this.checkBloom();
    this.checkPreparations();
    this.checkPourForms();
    this.checkTarget();

    return this.diagnostics;
  }

  /// Report an error at the given node
  private error(message: string, at: Node) {
    this.report("error", message, at);
  }

  /// Report a warning at the given node: probably a mistake, the recipe stays valid
  private warning(message: string, at: Node) {
    this.report("warning", message, at);
  }

  /// Report a suggestion at the given node: a possible improvement
  private suggestion(message: string, at: Node) {
    this.report("suggestion", message, at);
  }

  /// Add a diagnostic at the given node
  private report(severity: Severity, message: string, at: Node) {
    this.diagnostics.push({ severity, message, line: at.line, column: at.column });
  }

  /// One grind for the whole recipe, written before the first step
  private checkGrind() {
    let first: Grind | undefined;
    let stepSeen = false;

    for (const step of this.recipe.steps) {
      if (step.kind === "Comment") continue;
      if (step.kind !== "Grind") {
        stepSeen = true;
        continue;
      }

      if (first) {
        this.error(`The grind is already set on line ${first.line}: keep only one 'grind' line`, step);
      } else if (stepSeen) {
        this.error("Move 'grind' right after the header: it sets the grind for the whole recipe", step);
      }
      first ??= step;
    }
  }

  /// Timed steps go forward; equal times run in the written order
  private checkTimes() {
    let previous: Time | undefined;

    for (const step of this.recipe.steps) {
      // Only pours and actions have a time; untimed steps go at the user's pace
      if (step.kind !== "Pour" && step.kind !== "Action") continue;
      if (!step.time) continue;

      if (previous && step.time.seconds < previous.seconds) {
        this.error(
          `This step starts at ${formatTime(step.time.seconds)}, before the previous one at ${formatTime(previous.seconds)}`,
          step,
        );
      }

      previous = step.time;
    }
  }

  /// A recipe uses one unit for water and one for temperature; the first one written sets it
  private checkUnits() {
    const { header, steps } = this.recipe;
    const water: Quantity<string>[] = [];
    const temps: Quantity<string>[] = [];

    if (header?.water) water.push(header.water);
    if (header?.temp) temps.push(header.temp);

    for (const step of steps) {
      if (step.kind === "Pour") water.push(step.water);
      if (step.kind === "TempChange") temps.push(step.temp);
    }

    this.checkSameUnit(water, "water amount");
    this.checkSameUnit(temps, "temperature");
  }

  /// Report every quantity whose unit differs from the first one
  private checkSameUnit(quantities: Quantity<string>[], name: string) {
    const [first] = quantities;
    if (!first) return;

    for (const quantity of quantities) {
      if (quantity.unit !== first.unit) {
        this.error(
          `Write every ${name} in '${first.unit}' like the first one, not in '${quantity.unit}'`,
          quantity,
        );
      }
    }
  }

  /// Each pour raises the water on the scale; the header total, if any, is where the pours end
  private checkWater() {
    const { header, steps } = this.recipe;
    const pours = steps.filter((step) => step.kind === "Pour");

    // Without pours, the header water is the total, nothing to check
    const [first] = pours;
    if (!first) return;

    // Adding g to ml makes no sense; checkUnits already reported it
    const unit = header?.water?.unit ?? first.water.unit;
    if (pours.some((pour) => pour.water.unit !== unit)) return;

    // Water on the scale, low and high bounds for ranges; the order checks use the low one
    let low = 0;
    let high = 0;

    for (const pour of pours) {
      const { value, max = value } = pour.water.amount;

      if (pour.mode === "add") {
        if (max === 0) {
          this.error(
            `'+${formatQuantity(pour.water.amount, unit)}' adds no water: remove this step or pour more`,
            pour.water,
          );
        }
        low += value;
        high += max;
      } else {
        if (value <= low) {
          this.error(
            `The scale is already at ${formatQuantity(range(low, high), unit)}: pour to a higher total, or add water with '+'`,
            pour.water,
          );
        }
        low = value;
        high = max;
      }
    }

    if (!header?.water) return;

    const announced = header.water.amount;
    const end = range(low, high);

    if (announced.value !== end.value || announced.max !== end.max) {
      this.error(
        `The header announces ${formatQuantity(announced, unit)} but the pours end at ${formatQuantity(end, unit)}. Make them match`,
        header.water,
      );
    }
  }

  /// A pour ends before the next timed step starts: start + duration <= next start
  private checkOverlap() {
    const timed = this.recipe.steps.filter(
      (step): step is (Pour | Action) & { time: Time } =>
        (step.kind === "Pour" || step.kind === "Action") && step.time !== undefined,
    );

    for (const [i, step] of timed.entries()) {
      const next = timed[i + 1];
      if (step.kind !== "Pour" || !step.duration || !next) continue;

      // Decreasing times are already reported by checkTimes
      if (next.time.seconds < step.time.seconds) continue;

      const { value, unit } = step.duration;
      const end = step.time.seconds + (unit === "m" ? value * 60 : value); // 's' and 'm:ss' are in seconds

      if (end > next.time.seconds) {
        this.error(
          `This pour lasts until ${formatTime(end)}, after the next step at ${formatTime(next.time.seconds)}. Shorten it or start the next step later`,
          step.duration,
        );
      }
    }
  }

  /// A pour has at most one technique: spiral, center or pulse
  private checkTechniques() {
    for (const step of this.recipe.steps) {
      if (step.kind !== "Pour") continue;

      const techniques = [...new Set(step.qualifiers.filter((q) => TECHNIQUES.includes(q)))];
      if (techniques.length > 1) {
        this.error(
          `A pour has only one technique: choose ${orList(techniques)}`,
          step,
        );
      }
    }
  }

  /// Warn about temperature lines that change nothing; one warning per line
  private checkTempChanges() {
    const { header, steps } = this.recipe;
    let current = header?.temp;
    let started = false; // A pour or an action came before

    for (const [i, step] of steps.entries()) {
      if (step.kind === "Pour" || step.kind === "Action") started = true;
      if (step.kind !== "TempChange") continue;

      // Comments are not steps: look past them
      const next = steps.slice(i + 1).find((s) => s.kind !== "Comment");
      const { temp } = step;

      if (current && sameQuantity(current, temp)) {
        this.warning(
          `The temperature is already ${formatQuantity(temp.amount, temp.unit)}: remove this line`,
          step,
        );
      } else if (next?.kind === "TempChange") {
        this.warning(
          "The next temperature line replaces this one before any step: remove it",
          step,
        );
      } else if (!started && header) {
        const parts = [`@${header.brewer}`, formatQuantity(header.dose.amount, header.dose.unit)];
        if (header.water) parts.push(formatQuantity(header.water.amount, header.water.unit));
        parts.push(formatQuantity(temp.amount, temp.unit));

        this.warning(
          `This temperature applies from the start: put it in the header instead, like '${parts.join(" ")}'`,
          step,
        );
      }

      current = temp;
    }
  }

  /// Suggest 'bloom' on a small first pour: at most 3x the dose, and followed by another pour
  private checkBloom() {
    const { header, steps } = this.recipe;
    const [first, second] = steps.filter((step) => step.kind === "Pour");
    if (!header || !first || !second || first.qualifiers.includes("bloom")) return;

    // No mass to volume conversion: compare only g with g, oz with oz
    const { water } = first;
    if (water.unit !== header.dose.unit) return;

    const { value, max = value } = water.amount;
    if (max <= header.dose.amount.value * 3) {
      this.suggestion("This pour looks like a bloom: add 'bloom' if it is one", first);
    }
  }

  /// An action at 0:00 before the first pour is a preparation: suggest dropping its time
  private checkPreparations() {
    const { steps } = this.recipe;
    if (!steps.some((step) => step.kind === "Pour")) return;

    for (const step of steps) {
      if (step.kind === "Pour") return;

      if (step.kind === "Action" && step.time?.seconds === 0) {
        this.suggestion(
          "Remove '0:00': an action before the first pour is a preparation, done before starting the timer",
          step,
        );
      }
    }
  }

  /// Point out the first pour whose form differs from the first one: '150g' then '+60g'
  private checkPourForms() {
    const pours = this.recipe.steps.filter((step) => step.kind === "Pour");
    const mixed = pours.find((pour) => pour.mode !== pours[0]?.mode);

    if (mixed) {
      this.suggestion(
        "This recipe mixes totals on the scale, like '150g', and water to add, like '+60g': check that each pour reads as intended",
        mixed,
      );
    }
  }

  /// Known actions must fit the brewer; unknown ones are accepted, unless they look like a typo
  private checkActions() {
    const brewer = this.recipe.header && findBrewer(this.recipe.header.brewer);

    for (const step of this.recipe.steps) {
      if (step.kind !== "Action") continue;

      const action = findAction(step.name);

      if (!action) {
        const closest = closestAction(step.name);
        if (closest) {
          this.warning(`Unknown action '/${step.name}'. Did you mean '/${closest}'?`, step);
        }
        continue;
      }

      // An unknown brewer has no restriction
      if (!brewer || !action.types || action.types.includes(brewer.type)) continue;

      this.error(
        `'/${step.name}' only works with ${describeTypes(action.types)}: remove it or change the brewer`,
        step,
      );
    }
  }

  /// '/open' and '/close' must change the valve: it starts in the state the registry gives
  private checkValve() {
    const { header, steps } = this.recipe;
    const brewer = header && findBrewer(header.brewer);
    if (!brewer?.valve) return;

    let state = brewer.valve;
    let first = true; // No valve action yet: the state is still the convention

    for (const step of steps) {
      if (step.kind !== "Action" || (step.name !== "open" && step.name !== "close")) continue;

      const target = step.name === "open" ? "open" : "closed";

      // An action that changes nothing: the first one reveals a wrong guess about the convention
      if (target === state) {
        if (!first) {
          this.warning(`The valve is already ${state}: remove this '/${step.name}'`, step);
        } else if (state === "open") {
          this.warning(
            `The @${brewer.name} valve starts open: add '/close' before the first step if the brew starts closed, or remove this '/open'`,
            step,
          );
        } else {
          this.warning(`The @${brewer.name} valve starts closed: remove this '/close'`, step);
        }
      }

      state = target;
      first = false;
    }
  }

  /// The AeroPress starts upright: '/invert' turns it over, '/flip' turns it back onto the cup
  private checkAeroPress() {
    const { header, steps } = this.recipe;
    const brewer = header && findBrewer(header.brewer);
    if (brewer?.type !== "aeropress") return;

    let inverted = false;

    for (const step of steps) {
      if (step.kind !== "Action") continue;
      const name = ACTION_ALIASES[step.name] ?? step.name; // '/plunge' is a press

      if (name === "invert") {
        if (inverted) this.warning("The AeroPress is already inverted: remove this '/invert'", step);
        inverted = true;
      } else if (name === "flip") {
        if (!inverted) {
          this.warning(
            "The AeroPress starts upright: add '/invert' before the first step for an inverted recipe, or remove this '/flip'",
            step,
          );
        }
        inverted = false;
      } else if (name === "press" && inverted) {
        this.warning("The AeroPress is still inverted: add '/flip' before pressing", step);
      }
    }
  }

  /// One target, after the last timed step starts
  private checkTarget() {
    let target: Target | undefined;
    let last: Time | undefined; // Latest start among timed steps

    for (const step of this.recipe.steps) {
      if ((step.kind === "Pour" || step.kind === "Action") && step.time) {
        if (!last || step.time.seconds > last.seconds) last = step.time;
      }
      if (step.kind !== "Target") continue;

      if (target) {
        this.error(`The recipe already has a target on line ${target.line}: keep only one`, step);
      } else {
        target = step;
      }
    }

    if (target && last && target.time.seconds < last.seconds) {
      this.warning(
        `The target ${formatTime(target.time.seconds)} comes before the step at ${formatTime(last.seconds)}: the brew ends after its last step`,
        target.time,
      );
    }
  }
}
