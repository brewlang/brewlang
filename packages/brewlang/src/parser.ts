import type { Diagnostic } from "./diagnostics.js";
import type { Token, TokenKind } from "./tokens.js";
import type {
  Action,
  Amount,
  Comment,
  Duration,
  Frontmatter,
  Grind,
  GrindSize,
  Header,
  Node,
  ParseResult,
  Pour,
  Qualifier,
  Quantity,
  Recipe,
  step as Step,
  Target,
  TempChange,
  TempUnit,
  Time,
  WaterUnit,
} from "./ast.js";
import { DOSE_UNITS, GRIND_SIZES, QUALIFIERS, TEMP_UNITS, WATER_UNITS } from "./ast.js";
import { editDistance } from "./distance.js";
import { lex } from "./lexer.js";
import { findAction } from "./registry.js";

/// Check that a quantity's unit is in the given list, and narrow its type
const hasUnit = <U extends string>(
  quantity: Quantity<string>,
  units: readonly U[],
): quantity is Quantity<U> => (units as readonly string[]).includes(quantity.unit);

/// Check that a word is a known pour qualifier, and narrow its type
const isQualifier = (word: string): word is Qualifier =>
  (QUALIFIERS as readonly string[]).includes(word);

/// Check that a word is a known grind size, and narrow its type
const isGrindSize = (word: string): word is GrindSize =>
  (GRIND_SIZES as readonly string[]).includes(word);

/// Text of a COMMENT token, without the '--'
const commentText = (token: Token) => token.text.slice(2).trim();

/// '94°c', '94C' or '94f' -> '94°C' or '94°F': a temperature written without the right unit
const temperatureFix = (quantity: Quantity<string>): string | undefined => {
  const letter = quantity.unit.replace(/^°/, "").toUpperCase();
  if (letter !== "C" && letter !== "F") return undefined;
  const { value, max } = quantity.amount;
  return `${value}${max === undefined ? "" : `-${max}`}°${letter}`;
};

/// The message for a unit Brewlang does not know, with a fix when it is a misspelled temperature
const unknownUnit = (quantity: Quantity<string>) => {
  const fix = temperatureFix(quantity);
  return fix
    ? `Unknown unit '${quantity.unit}'. Did you mean '${fix}'?`
    : `Unknown unit '${quantity.unit}'. Use g, ml, oz or floz for water, °C or °F for temperature`;
};

/// The message for a word that is not a qualifier: a typo, an action without its '/', or the list
const unknownQualifier = (word: string) => {
  const closest = QUALIFIERS.find((q) => editDistance(word, q) <= 1);
  if (closest) return `Unknown qualifier '${word}'. Did you mean '${closest}'?`;
  if (findAction(word)) return `'${word}' is an action: write '/${word}' on its own line`;
  return `Unknown qualifier '${word}'. Use bloom, spiral, center or pulse`;
};

/** Parses a Brewlang source into a Recipe, and reports every error found. */
export function parse(source: string): ParseResult {
  const { tokens, diagnostics } = lex(source);
  return new Parser(tokens, diagnostics).parse();
}

export class Parser {
  private pos = 0; // Index of the current token

  /// Create a new Parser over the lexer's tokens, keeping its diagnostics
  constructor(
    private readonly tokens: Token[],
    private readonly diagnostics: Diagnostic[] = [],
  ) {}

  /// Parse the tokens into a Recipe
  parse(): ParseResult {
    const recipe: Recipe = { kind: "Recipe", steps: [], line: 1, column: 1 };

    const frontmatter = this.parseFrontmatter();
    if (frontmatter) recipe.frontmatter = frontmatter;

    // Blank lines are allowed between the metadata and the header
    this.skipNewlines();

    const header = this.parseHeader();
    if (header) recipe.header = header;

    // One step per line until EOF
    while (!this.check("EOF")) {
      // Blank lines between steps are allowed
      if (this.match("NEWLINE")) continue;

      const step = this.parseStep();
      if (step) recipe.steps.push(step);
    }

    return { recipe, diagnostics: this.diagnostics };
  }

  /// Current token without advancing; the lexer always ends the list with EOF
  private peek(): Token {
    return this.tokens[Math.min(this.pos, this.tokens.length - 1)]!;
  }

  /// Return the current token and advance, never past EOF
  private next(): Token {
    const token = this.peek();
    if (token.kind !== "EOF") this.pos++;
    return token;
  }

  /// Check the kind of the current token without advancing
  private check(kind: TokenKind): boolean {
    return this.peek().kind === kind;
  }

  /// Consume the current token if it has the given kind
  private match(kind: TokenKind): Token | undefined {
    return this.check(kind) ? this.next() : undefined;
  }

  /// Report an error at the given token or node, or at the current token
  private error(message: string, at: Token | Node = this.peek()) {
    // ERROR tokens were already reported by the lexer
    if ("kind" in at && at.kind === "ERROR") return;

    this.diagnostics.push({
      severity: "error",
      message,
      line: at.line,
      column: at.column,
    });
  }

  /// Skip blank lines
  private skipNewlines() {
    while (this.check("NEWLINE")) this.next();
  }

  /// Skip the rest of a malformed line, including its newline
  private skipLine() {
    while (!this.check("NEWLINE") && !this.check("EOF")) this.next();
    this.match("NEWLINE");
  }

  /// Expect the end of the line; report anything left on it
  private endLine(context: string) {
    if (this.match("NEWLINE") || this.check("EOF")) return;

    this.error(`Unexpected '${this.peek().text}' ${context}`);
    this.skipLine();
  }

  /// Parse the YAML block between two '---' lines, kept as raw text
  private parseFrontmatter(): Frontmatter | undefined {
    const token = this.match("FRONTMATTER");
    if (!token) return undefined;

    // The token text is the whole block: drop the opening line and the closing '---'
    const raw = token.text.slice(token.text.indexOf("\n") + 1, -3);
    return { kind: "Frontmatter", raw, line: token.line, column: token.column };
  }

  /// Parse the header: '@V60 15g 250g 94°C -- comment'
  private parseHeader(): Header | undefined {
    const brewer = this.peek();

    if (brewer.kind !== "BREWER") {
      this.error("A recipe must start with a header, like '@V60 15g 94°C'");
      this.skipLine();
      return undefined;
    }

    this.next();

    if (!this.check("NUMBER")) {
      this.error("Add the dose after the brewer, like '@V60 15g'");
      this.skipLine();
      return undefined;
    }

    const dose = this.parseQuantity();
    if (!dose) {
      this.skipLine();
      return undefined;
    }

    if (!hasUnit(dose, DOSE_UNITS)) {
      this.error(`Weigh the dose in g or oz, not '${dose.unit}'`, dose);
      this.skipLine();
      return undefined;
    }

    const header: Header = {
      kind: "Header",
      brewer: brewer.text.slice(1),
      dose,
      line: brewer.line,
      column: brewer.column,
    };

    // Optional water then temperature: the unit tells which one it is
    while (this.check("NUMBER") || this.check("TIME")) {
      // A ratio, '1:16', reads as a time
      if (this.check("TIME")) {
        this.reportRatio(header);
        continue;
      }

      const quantity = this.parseQuantity();

      if (!quantity) {
        this.skipLine();
        return header;
      }

      if (hasUnit(quantity, TEMP_UNITS) && !header.temp) {
        header.temp = quantity;
      } else if (hasUnit(quantity, WATER_UNITS) && !header.water && !header.temp) {
        header.water = quantity;
      } else if (hasUnit(quantity, TEMP_UNITS) || hasUnit(quantity, WATER_UNITS)) {
        this.error("Write the header in this order: '@V60 15g 250g 94°C'", quantity);
      } else {
        this.error(unknownUnit(quantity), quantity);
      }
    }

    const comment = this.match("COMMENT");
    if (comment) header.comment = commentText(comment);

    this.endLine("in the header");

    return header;
  }

  /// Parse one step line; its first token tells which step it is
  private parseStep(): Step | undefined {
    const token = this.peek();

    switch (token.kind) {
      case "COMMENT":
        return this.parseComment();

      case "WORD":
        if (token.text === "grind") return this.parseGrind();
        if (token.text === "target") return this.parseTarget();
        break;

      case "TIME":
      case "ACTION":
      case "PLUS":
      case "NUMBER":
        return this.parseTimedStep();
    }

    this.error(`Unexpected '${token.text}' at the start of a step`);
    this.skipLine();
    return undefined;
  }

  /// Parse a comment alone on its line: '-- text'
  private parseComment(): Comment {
    const token = this.next();
    this.endLine("after the comment");

    return {
      kind: "Comment",
      text: commentText(token),
      line: token.line,
      column: token.column,
    };
  }

  /// Parse the grind size: 'grind medium-fine'
  private parseGrind(): Grind | undefined {
    const keyword = this.next();

    const size = this.match("WORD");
    if (!size) {
      this.error("Add a grind size after 'grind', like 'grind medium-fine'");
      this.skipLine();
      return undefined;
    }

    if (!isGrindSize(size.text)) {
      this.error(
        `Unknown grind size '${size.text}'. Use extra-fine, fine, medium-fine, medium, medium-coarse, coarse or extra-coarse`,
        size,
      );
      this.skipLine();
      return undefined;
    }

    const grind: Grind = {
      kind: "Grind",
      size: size.text,
      line: keyword.line,
      column: keyword.column,
    };

    const comment = this.match("COMMENT");
    if (comment) grind.comment = commentText(comment);

    this.endLine("after the grind size");

    return grind;
  }

  /// Parse the expected brew time: 'target 3:00'
  private parseTarget(): Target | undefined {
    const keyword = this.next();

    if (!this.check("TIME")) {
      this.error("Add a time after 'target', like 'target 3:00'");
      this.skipLine();
      return undefined;
    }

    const time = this.parseTime();
    if (!time) {
      this.skipLine();
      return undefined;
    }

    const target: Target = {
      kind: "Target",
      time,
      line: keyword.line,
      column: keyword.column,
    };

    const comment = this.match("COMMENT");
    if (comment) target.comment = commentText(comment);

    this.endLine("after the target");

    return target;
  }

  /// Parse a pour, an action or a temperature change; pours and actions may start with a time
  private parseTimedStep(): Pour | Action | TempChange | undefined {
    const start = this.peek();

    let time: Time | undefined;
    if (this.check("TIME")) {
      time = this.parseTime();
      if (!time) {
        this.skipLine();
        return undefined;
      }
    }

    if (this.check("ACTION")) return this.parseAction(start, time);
    if (this.check("PLUS") || this.check("NUMBER")) return this.parseWaterOrTemp(start, time);

    this.error("Add a pour or an action after the time, like '0:45 150g' or '2:00 /swirl'");
    this.skipLine();
    return undefined;
  }

  /// Parse a line starting with a quantity: its unit tells a pour, '150g', from a temperature, '90°C'
  private parseWaterOrTemp(start: Token, time: Time | undefined): Pour | TempChange | undefined {
    const plus = this.match("PLUS");

    const quantity = this.parseQuantity();
    if (!quantity) {
      this.skipLine();
      return undefined;
    }

    if (hasUnit(quantity, WATER_UNITS)) {
      const mode = plus ? "add" : "cumulative";
      return this.parsePour(start, time, mode, quantity);
    }

    if (plus) {
      this.error(`Pour water in g, ml, oz or floz, not '${quantity.unit}'`, quantity);
    } else if (!hasUnit(quantity, TEMP_UNITS)) {
      this.error(unknownUnit(quantity), quantity);
    } else if (time) {
      this.error("A temperature change has no time: write '90°C' alone on its line", time);
    } else {
      return this.parseTempChange(quantity);
    }

    this.skipLine();
    return undefined;
  }

  /// Parse the rest of a pour: '0:45 150g ~15s spiral', modifiers in any order
  private parsePour(
    start: Token,
    time: Time | undefined,
    mode: Pour["mode"],
    water: Quantity<WaterUnit>,
  ): Pour {
    const pour: Pour = {
      kind: "Pour",
      mode,
      water,
      qualifiers: [],
      line: start.line,
      column: start.column,
    };
    if (time) pour.time = time;

    while (this.check("TILDE") || this.check("WORD") || this.check("NUMBER")) {
      // A temperature after a pour, '1:30 250g 90°C', goes on its own line
      if (this.check("NUMBER")) {
        const start = this.peek();
        const quantity = this.parseQuantity();
        if (!quantity) {
          this.skipLine();
          return pour;
        }

        if (hasUnit(quantity, TEMP_UNITS)) {
          this.error(
            "Put the temperature alone on its line, before this pour: it applies to every following step",
            quantity,
          );
        } else {
          this.error(`Unexpected '${start.text}' after the pour`, start);
        }
        continue;
      }

      if (this.check("TILDE")) {
        const duration = this.parseDuration(pour.duration);
        if (!duration) {
          this.skipLine();
          return pour;
        }
        pour.duration = duration;
        continue;
      }

      const word = this.next();
      if (isQualifier(word.text)) {
        pour.qualifiers.push(word.text);
      } else {
        this.error(unknownQualifier(word.text), word);
      }
    }

    const comment = this.match("COMMENT");
    if (comment) pour.comment = commentText(comment);

    this.endLine("after the pour");

    return pour;
  }

  /// Parse an action: '2:00 /swirl' or '/press ~30s'
  private parseAction(start: Token, time: Time | undefined): Action {
    const name = this.next();

    const action: Action = {
      kind: "Action",
      name: name.text.slice(1),
      line: start.line,
      column: start.column,
    };
    if (time) action.time = time;

    if (this.check("TILDE")) {
      const duration = this.parseDuration();
      if (!duration) {
        this.skipLine();
        return action;
      }
      action.duration = duration;
    }

    const comment = this.match("COMMENT");
    if (comment) action.comment = commentText(comment);

    this.endLine("after the action");

    return action;
  }

  /// Build a temperature change from its parsed temperature; it applies to every following step
  private parseTempChange(temp: Quantity<TempUnit>): TempChange {
    const change: TempChange = {
      kind: "TempChange",
      temp,
      line: temp.line,
      column: temp.column,
    };

    const comment = this.match("COMMENT");
    if (comment) change.comment = commentText(comment);

    this.endLine("after the temperature");

    return change;
  }

  /// Parse a duration: '~15s', '~4m' or '~3:30'; reports a second one when the step already has one
  private parseDuration(previous?: Duration): Duration | undefined {
    const tilde = this.next();

    const duration = this.check("TIME") ? this.parseClockDuration() : this.parseUnitDuration();
    if (!duration) return undefined;

    if (previous) {
      this.error("A step has only one duration", tilde);
      return previous;
    }

    return { ...duration, line: tilde.line, column: tilde.column };
  }

  /// '~3:30': minutes and seconds, kept in seconds
  private parseClockDuration(): Pick<Duration, "value" | "unit"> | undefined {
    const time = this.parseTime();
    return time && { value: time.seconds, unit: "m:ss" };
  }

  /// '~15s' or '~4m': a number and its unit
  private parseUnitDuration(): Pick<Duration, "value" | "unit"> | undefined {
    const value = this.match("NUMBER");
    if (!value) {
      this.error("Add a number after '~', like '~15s' or '~3:30'");
      return undefined;
    }

    const unit = this.match("UNIT");
    if (!unit || (unit.text !== "s" && unit.text !== "m")) {
      this.error("Write the duration in s, m or m:ss, like '~15s', '~4m' or '~3:30'", unit);
      return undefined;
    }

    return { value: Number(value.text), unit: unit.text };
  }

  /// Parse a time, '0:45', into seconds; the lexer already checked its format
  private parseTime(): Time | undefined {
    const token = this.next();
    const [minutes, seconds] = token.text.split(":").map(Number) as [number, number];

    if (seconds >= 60) {
      this.error(`Seconds must be under 60 in '${token.text}'`, token);
      return undefined;
    }

    return { seconds: minutes * 60 + seconds, line: token.line, column: token.column };
  }

  /// Report a ratio in the header, and suggest the water it stands for: '15g 1:16' -> '15g 240g'
  private reportRatio(header: Header) {
    const ratio = this.next();
    const [coffee, water] = ratio.text.split(":").map(Number) as [number, number];
    const { amount, unit } = header.dose;

    const example =
      amount.max === undefined && coffee > 0
        ? `@${header.brewer} ${amount.value}${unit} ${Math.round((amount.value * water) / coffee)}${unit}`
        : `@${header.brewer} 15g 250g`;

    this.error(
      `Brewlang computes the ratio from the dose and the water: write the water instead, like '${example}'`,
      ratio,
    );
  }

  /// Parse an amount and its unit: '15g', '90-93°C'; the caller checks the unit
  private parseQuantity(): Quantity<string> | undefined {
    const start = this.peek();

    const amount = this.parseAmount();
    if (!amount) return undefined;

    const unit = this.match("UNIT");
    if (!unit) {
      this.error("Add a unit right after the number, like '15g' or '94°C'");
      return undefined;
    }

    return { amount, unit: unit.text, line: start.line, column: start.column };
  }

  /// Parse a value or a range: '94' or '90-93'
  private parseAmount(): Amount | undefined {
    const value = this.match("NUMBER");
    if (!value) return undefined;

    const amount: Amount = { value: Number(value.text) };

    if (this.match("DASH")) {
      const max = this.match("NUMBER");
      if (!max) {
        this.error("Add the upper bound of the range, like '90-93°C'");
        return undefined;
      }
      amount.max = Number(max.text);
    }

    return amount;
  }
}
