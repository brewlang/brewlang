/// <reference types="vite/client" />
import { Ajv2020 } from "ajv/dist/2020.js";

// The published JSON Schema, read the way an integrator would
const schema = Object.values(
    import.meta.glob<object>("../schema/brewlang-*.schema.json", { import: "default", eager: true }),
)[0]!;

const check = new Ajv2020({ allErrors: true }).compile(schema);

/// Schema errors for a JSON document, as 'path message' lines; empty when it is valid
export const validate = (json: unknown): string[] =>
    check(json) ? [] : (check.errors ?? []).map((e) => `${e.instancePath} ${e.message}`);
