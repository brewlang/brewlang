/// <reference types="vite/client" />
import { describe, test, expect } from "vitest";
import type { Diagnostic } from "../src/index.js";
import { check, toJson } from "../src/index.js";
import { validate } from "./schema.js";

const examples = import.meta.glob<string>("../examples/*.brew", { query: "?raw", import: "default", eager: true });

/// The JSON of a source that must check without errors
const json = (source: string) => {
    const { recipe, diagnostics } = check(source);
    expect(diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    return toJson(recipe);
};

/// A diagnostic as a [severity, message, line, column] tuple
const tuple = (d: Diagnostic) => [d.severity, d.message, d.line, d.column];

describe("metadata", () => {
    test("simple lines, quotes dropped", () => {
        const result = json("---\ntitle: 'My V60'\nversion: 1\nfilter: paper, V60 cone\n---\n@V60 15g");
        expect(result.json?.metadata).toEqual({ title: "My V60", version: "1", filter: "paper, V60 cone" });
        expect(result.diagnostics).toEqual([]);
    });

    test("other lines are left out, with a warning", () => {
        const result = json("---\ntitle: V60\ntags:\n  - light\n---\n@V60 15g");
        expect(result.json?.metadata).toEqual({ title: "V60" });
        expect(result.diagnostics.map(tuple)).toEqual([
            ["warning", "Only 'key: value' lines go into the JSON metadata: this line is left out", 3, 1],
            ["warning", "Only 'key: value' lines go into the JSON metadata: this line is left out", 4, 1],
        ]);
    });

    test("no metadata without key: value lines", () => {
        expect(json("---\n# nothing\n---\n@V60 15g").json).not.toHaveProperty("metadata");
    });
});

describe("recipe", () => {
    test("brewer named as in the registry", () => {
        expect(json("@frenchpress 30g").json?.brewer).toBe("FrenchPress");
        expect(json("@myDripper 15g").json?.brewer).toBe("myDripper");
    });

    test("ounces of coffee", () => {
        expect(json("@V60 0.5oz").json?.coffee).toEqual({ value: 0.5, unit: "ounce" });
    });

    test("grind on the recipe, not in the steps", () => {
        const result = json("@V60 15g\ngrind fine\n50g");
        expect(result.json?.grind).toEqual({ size: "fine" });
        expect(result.json?.steps).toEqual([{ kind: "pour", to_water: { value: 50, unit: "gram" } }]);
    });

    test("an action alias is kept as written", () => {
        expect(json("@AeroPress 15g\n/plunge").json?.steps).toEqual([{ kind: "action", name: "plunge" }]);
    });

    test("no header, no JSON", () => {
        expect(toJson({ kind: "Recipe", steps: [], line: 1, column: 1 })).toEqual({ diagnostics: [] });
    });
});

describe("schema", () => {
    test.each(Object.entries(examples))("%s", (_, source) => {
        expect(validate(json(source).json)).toEqual([]);
    });

    test("rejects a quantity with both a value and a range", () => {
        const bad = { brewlang: "0.1", brewer: "V60", coffee: { value: 15, min: 14, max: 16, unit: "gram" }, steps: [] };
        expect(validate(bad)).not.toEqual([]);
    });

    test("rejects a pour with both forms of water", () => {
        const water = { value: 50, unit: "gram" };
        const bad = { brewlang: "0.1", brewer: "V60", coffee: { value: 15, unit: "gram" }, steps: [{ kind: "pour", to_water: water, add_water: water }] };
        expect(validate(bad)).not.toEqual([]);
    });
});
