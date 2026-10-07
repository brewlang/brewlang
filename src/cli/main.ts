#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { run } from "./run.js";

process.exitCode = run(process.argv.slice(2), {
  readFile: (path) => readFileSync(path, "utf8"),
  writeFile: (path, content) => writeFileSync(path, content),
  out: (line) => console.log(line),
  err: (line) => console.error(line),
});
