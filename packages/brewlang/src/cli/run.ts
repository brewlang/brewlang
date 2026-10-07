import type { Diagnostic } from "../diagnostics.js";
import { check, format, parse, scaleToDose, scaleToWater, toJson } from "../index.js";

/// What the CLI needs from the outside world; main.ts plugs in Node, tests plug in memory
export interface Io {
  readFile(path: string): string; // Throws when the file cannot be read
  writeFile(path: string, content: string): void;
  out(line: string): void;
  err(line: string): void;
}

const USAGE = "Usage: brewlang <check|fmt> [--check] <file.brew>...";
const SCALE_USAGE = "Usage: brewlang scale --dose <25g> | --water <400g> <file.brew>";
const JSON_USAGE = "Usage: brewlang json <file.brew>";

/// '<file>:<line>:<column>: <severity>: <message>', the format editors and terminals link
const formatDiagnostic = (path: string, d: Diagnostic) =>
  `${path}:${d.line}:${d.column}: ${d.severity}: ${d.message}`;

/** Runs a brewlang command and returns its exit code: 0 ok, 1 problems found, 2 bad usage. */
export function run(args: string[], io: Io): number {
  const [command, ...rest] = args;
  if (command === "scale") return scaleCommand(rest, io);
  if (command === "json") return jsonCommand(rest, io);

  const checkOnly = rest.includes("--check");
  const paths = rest.filter((arg) => arg !== "--check");

  if (command !== "check" && command !== "fmt") {
    if (command === undefined) {
      io.err(USAGE);
      io.err(SCALE_USAGE);
      io.err(JSON_USAGE);
    } else {
      io.err(`Unknown command '${command}'. Use check, fmt, scale or json`);
    }
    return 2;
  }

  if (paths.length === 0) {
    io.err(USAGE);
    return 2;
  }

  let failed = false;

  for (const path of paths) {
    let source: string;
    try {
      source = io.readFile(path);
    } catch (error) {
      io.err(`${path}: cannot read the file (${error instanceof Error ? error.message : error})`);
      failed = true;
      continue;
    }

    const ok = command === "check" ? checkFile(path, source, io) : formatFile(path, source, checkOnly, io);
    if (!ok) failed = true;
  }

  return failed ? 1 : 0;
}

/// Print every diagnostic; only errors make the file fail
function checkFile(path: string, source: string, io: Io): boolean {
  const { diagnostics } = check(source);
  for (const d of diagnostics) io.out(formatDiagnostic(path, d));
  return !diagnostics.some((d) => d.severity === "error");
}

/// Rewrite the file in its canonical form; with --check, only report it. Syntax errors leave it untouched
function formatFile(path: string, source: string, checkOnly: boolean, io: Io): boolean {
  const { recipe, diagnostics } = parse(source);

  const errors = diagnostics.filter((d) => d.severity === "error");
  if (errors.length > 0) {
    for (const d of errors) io.out(formatDiagnostic(path, d));
    return false;
  }

  const formatted = format(recipe);
  if (formatted === source) return true;

  if (checkOnly) {
    io.out(`${path}: not formatted`);
    return false;
  }

  io.writeFile(path, formatted);
  return true;
}

/// Print the recipe scaled to a new dose or water; the source file is never changed
function scaleCommand(args: string[], io: Io): number {
  const [flag, wanted, path, ...extra] = args;
  const amount = /^(\d+(?:\.\d+)?)([a-z]+)$/i.exec(wanted ?? "");

  if ((flag !== "--dose" && flag !== "--water") || !path || extra.length > 0) {
    io.err(SCALE_USAGE);
    return 2;
  }
  if (!amount) {
    io.err(`Write the ${flag.slice(2)} with its unit, like ${flag} ${flag === "--dose" ? "25g" : "400g"}`);
    return 2;
  }

  let source: string;
  try {
    source = io.readFile(path);
  } catch (error) {
    io.err(`${path}: cannot read the file (${error instanceof Error ? error.message : error})`);
    return 1;
  }

  // Only a checked recipe can be scaled: its water has to add up
  const { recipe, diagnostics } = check(source);
  const errors = diagnostics.filter((d) => d.severity === "error");
  if (errors.length > 0) {
    for (const d of errors) io.err(formatDiagnostic(path, d));
    return 1;
  }

  const target = { value: Number(amount[1]), unit: amount[2]! };
  const scaled = flag === "--dose" ? scaleToDose(recipe, target) : scaleToWater(recipe, target);

  // Diagnostics go to stderr, so the scaled recipe can be piped to a file
  for (const d of scaled.diagnostics) io.err(formatDiagnostic(path, d));
  if (scaled.diagnostics.some((d) => d.severity === "error")) return 1;

  io.out(format(scaled.recipe).trimEnd());
  return 0;
}

/// Print the recipe as JSON; diagnostics go to stderr, so the JSON can be piped to a file
function jsonCommand(args: string[], io: Io): number {
  const [path, ...extra] = args;
  if (!path || extra.length > 0) {
    io.err(JSON_USAGE);
    return 2;
  }

  let source: string;
  try {
    source = io.readFile(path);
  } catch (error) {
    io.err(`${path}: cannot read the file (${error instanceof Error ? error.message : error})`);
    return 1;
  }

  // Only a checked recipe has a JSON form: one grind, water that adds up
  const { recipe, diagnostics } = check(source);
  const errors = diagnostics.filter((d) => d.severity === "error");
  if (errors.length > 0) {
    for (const d of errors) io.err(formatDiagnostic(path, d));
    return 1;
  }

  const result = toJson(recipe);
  for (const d of result.diagnostics) io.err(formatDiagnostic(path, d));

  io.out(JSON.stringify(result.json, null, 2));
  return 0;
}
