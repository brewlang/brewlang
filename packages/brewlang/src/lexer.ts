import type { Diagnostic } from "./diagnostics.js";
import type { Token } from "./tokens.js";

const isDigit = (c: string) => /[0-9]/.test(c);
const isLetter = (c: string) => /\p{L}/u.test(c);
const isIdentifierChar = (c: string) => isLetter(c) || isDigit(c) || c === "-";
const isSeparator = (c: string) =>
  c === " " || c === "\t" || c === "\r" || c === "\n" || c === "";
const delimiterLine = /---[ \r]*(?=\n|$)/y; // A line with only '---'

export interface LexResult {
  tokens: Token[];
  diagnostics: Diagnostic[];
}

/** Splits a Brewlang source into tokens, and reports every error found. */
export function lex(source: string): LexResult {
  return new Lexer(source).lex();
}

export class Lexer {
  private tokens: Token[] = [];
  private diagnostics: Diagnostic[] = [];
  private pos = 0; // Current position in the source string
  private line = 1; // Current line number
  private column = 1; // Current column number in the current line

  // Start of the current token's text
  private tokenStart = 0; // Start of the current token's text
  private tokenStartColumn = 1; // Start of the current token's column
  private tokenStartLine = 1; // Start of the current token's line

  /// Create a new Lexer instance with the given source string
  constructor(private readonly source: string) {}

  /// Lex the source string into tokens
  lex(): LexResult {
    // The metadata block can only be at the start of the file
    this.lexFrontmatter();

    // Main lexing loop
    while (this.pos < this.source.length) {
      this.tokenStart = this.pos;
      this.tokenStartColumn = this.column;
      this.tokenStartLine = this.line;
      const c = this.peek();

      // Skip whitespace
      if (c === " " || c === "\t" || c === "\r") {
        this.next();
        continue;
      }

      if (this.lexPlus()) {
        continue;
      }

      if (this.lexTilde()) {
        continue;
      }

      if (this.lexComment()) {
        continue;
      }

      if (this.lexDash()) {
        continue;
      }

      if (this.lexBrewer()) {
        continue;
      }

      if (this.lexAction()) {
        continue;
      }

      if (this.lexWord()) {
        continue;
      }

      if (this.lexTime()) {
        continue;
      }

      if (this.lexNumber()) {
        continue;
      }

      if (this.lexNewline()) {
        continue;
      }

      // Unknown character: report it and skip it
      this.error(`Unexpected character '${c}'`);
      this.next();
      this.addToken("ERROR");
    }

    // Add an EOF token at the end of the token list
    this.tokens.push({
      kind: "EOF",
      text: "",
      line: this.line,
      column: this.column,
    });

    return { tokens: this.tokens, diagnostics: this.diagnostics };
  }

  /// Advance the position and column counters
  private next() {
    this.pos++;
    this.column++;
  }

  /// Peek at the current character without advancing
  private peek() {
    return this.source[this.pos] ?? "";
  }

  /// Peek at the next character without advancing
  private peekNext() {
    return this.source[this.pos + 1] ?? "";
  }

  private addToken(kind: Token["kind"]) {
    this.tokens.push({
      kind,
      text: this.source.slice(this.tokenStart, this.pos),
      line: this.tokenStartLine,
      column: this.tokenStartColumn,
    });
  }

  /// Report an error at the current position, or at the given one
  private error(message: string, line = this.line, column = this.column) {
    this.diagnostics.push({ severity: "error", message, line, column });
  }

  /// Skip the rest of a malformed token and add it as an ERROR token
  private skipToSeparator() {
    while (!isSeparator(this.peek())) this.next();
    this.addToken("ERROR");
  }

  // Tokenization methods for different token types can be added here

  /// Lex a BREWER token starting with '@' followed by letters/digits
  private lexBrewer(): boolean {
    if (this.peek() !== "@") return false;

    this.next();

    if (!isLetter(this.peek())) {
      this.error("Brewer name must start with a letter");
      this.skipToSeparator();
      return true;
    }

    while (isIdentifierChar(this.peek())) this.next();

    this.addToken("BREWER");

    return true;
  }

  /// Lex a NUMBER token consisting of digits with g, ml, °C, etc. immediately following
  private lexNumber(): boolean {
    if (!isDigit(this.peek())) return false;

    // Get the digits
    while (isDigit(this.peek())) this.next();

    // Check for a decimal point followed by more digits
    if (this.peek() === "." && isDigit(this.peekNext())) {
      this.next(); // Consume the decimal point

      while (isDigit(this.peek())) this.next();
    }

    this.addToken("NUMBER");

    // Then check for UNIT token immediately following the number
    if (isLetter(this.peek()) || this.peek() === "°") {
      this.tokenStart = this.pos; // Update token start for UNIT token
      this.tokenStartColumn = this.column; // Update token start column for UNIT token

      this.next(); // Consume the first letter or '°'

      // Then check for UNIT token immediately following the number
      while (isLetter(this.peek())) this.next();

      this.addToken("UNIT");
    }

    return true;
  }

  /// Lex a WORD token consisting of letters, digits, and hyphens
  private lexWord(): boolean {
    if (!isLetter(this.peek())) {
      return false;
    }

    this.next();

    // Advance through letters, digits, and hyphens for words
    while (isIdentifierChar(this.peek())) {
      // Comment
      if (this.peek() === "-" && this.peekNext() === "-") break;

      this.next();
    }

    this.addToken("WORD");
    return true;
  }

  /// Lex a NEWLINE token consisting of '\n' or '\r\n'
  private lexNewline(): boolean {
    if (this.peek() === "\n") {
      this.next();
      this.addToken("NEWLINE");
      this.line++;
      this.column = 1;
      return true;
    }
    return false;
  }

  /// Lex a PLUS token consisting of '+'
  private lexPlus(): boolean {
    if (this.peek() === "+") {
      this.next();
      this.addToken("PLUS");
      return true;
    }
    return false;
  }

  /// Lex a TILDE token consisting of '~'
  private lexTilde(): boolean {
    if (this.peek() === "~") {
      this.next();
      this.addToken("TILDE");
      return true;
    }
    return false;
  }

  /// Lex a dash token in range '90-93'
  private lexDash(): boolean {
    if (this.peek() === "-") {
      this.next();
      this.addToken("DASH");
      return true;
    }

    return false;
  }

  /// Lex a comment that end by newline or at EOF
  private lexComment(): boolean {
    if (!(this.peek() === "-" && this.peekNext() === "-")) return false;

    this.next();

    while (
      this.peek() !== "\n" &&
      this.peek() !== "\r" &&
      this.pos < this.source.length
    ) {
      this.next();
    }

    this.addToken("COMMENT");

    return true;
  }

  /// Lex an ACTION token consisting of '/' followed by letters
  private lexAction(): boolean {
    if (this.peek() !== "/") return false;

    this.next();

    // First character after '/' must be a letter
    if (!isLetter(this.peek())) {
      this.error("Action name must start with a letter");
      this.skipToSeparator();
      return true;
    }

    while (isIdentifierChar(this.peek())) {
      // Comment
      if (this.peek() === "-" && this.peekNext() === "-") break;

      this.next();
    }

    this.addToken("ACTION");
    return true;
  }

  /// Lex a TIME token with format 00:00 (minutes:seconds)
  private lexTime(): boolean {
    let cursor = this.pos;

    while (isDigit(this.source[cursor] ?? "")) cursor++;

    // If there is no number or next no number carct isn't ":"
    if (cursor === this.pos || this.source[cursor] !== ":") return false;

    // It's a time: consume the minutes and the ':'
    while (this.pos <= cursor) this.next();

    // Check for two digits after the colon, if not report an error
    for (let i = 0; i < 2; i++) {
      if (!isDigit(this.peek())) return this.badTime();

      this.next();
    }

    // No third digit after the colon
    if (isDigit(this.peek())) return this.badTime();

    this.addToken("TIME");

    return true;
  }

  /// Lex a FRONTMATTER token: a YAML block between two '---' lines at the start of the file
  private lexFrontmatter(): boolean {
    if (!this.isDelimiterLine()) return false;

    // Consume the opening '---' and the rest of its line
    while (this.peek() !== "\n" && this.pos < this.source.length) this.next();

    while (this.pos < this.source.length) {
      // Consume the newline
      this.next();
      this.line++;
      this.column = 1;

      if (this.isDelimiterLine()) {
        // Only '---' is part of the token; spaces, '\r' and '\n' are lexed by the main loop
        for (let i = 0; i < 3; i++) this.next();
        this.addToken("FRONTMATTER");
        return true;
      }

      while (this.peek() !== "\n" && this.pos < this.source.length) this.next();
    }

    // Unclosed: the rest of the file is taken as metadata, to avoid an error on each YAML line
    this.error("Unclosed metadata block. Add a line with '---' to close it.", 1, 1);
    this.addToken("ERROR");
    return true;
  }

  /// Report a malformed time and add its digits as an ERROR token
  private badTime(): boolean {
    this.error("Time must have two digits after ':'");
    while (isDigit(this.peek())) this.next();
    this.addToken("ERROR");
    return true;
  }

  /// Check if the current line is exactly '---' (trailing spaces allowed)
  private isDelimiterLine(): boolean {
    delimiterLine.lastIndex = this.pos;
    return delimiterLine.test(this.source);
  }
}
