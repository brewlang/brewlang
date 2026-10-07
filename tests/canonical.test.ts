/// <reference types="vite/client" />
import { describe, test, expect } from "vitest";
import type { Diagnostic, ScaleResult, ScaleTarget } from "../src/index.js";
import { check, format, scale, scaleToDose, scaleToWater, toJson } from "../src/index.js";
import { validate } from "./schema.js";

// Canonical recipes: any Brewlang implementation must give the same diagnostics.
// valid/ has no diagnostic at all; the other folders list theirs in a .json next to each .brew.
// scaling/ also gives the scaling in its .json, and the scaled recipe in a .expected.brew.
// json/ gives the JSON output of each recipe in its .json
const sources = import.meta.glob<string>("./canonical/**/*.brew", {
    query: "?raw",
    import: "default",
    eager: true,
});
const expected = import.meta.glob<Diagnostic[]>("./canonical/**/*.json", {
    import: "default",
    eager: true,
});

/// Recipe files of one folder, keyed by their name without the extension
const recipes = (folder: string) =>
    Object.entries(sources)
        .filter(([path]) => path.startsWith(`./canonical/${folder}/`) && !path.endsWith(".expected.brew"))
        .map(([path, source]) => [path.slice(0, -".brew".length), source] as const);

describe("valid", () => {
    test.each(recipes("valid"))("%s", (_, source) => {
        expect(check(source).diagnostics).toEqual([]);
    });
});

for (const folder of ["invalid", "warnings", "suggestions"]) {
    describe(folder, () => {
        test.each(recipes(folder))("%s", (name, source) => {
            const diagnostics = expected[`${name}.json`];
            expect(diagnostics, `missing ${name}.json`).toBeDefined();
            expect(check(source).diagnostics).toEqual(diagnostics);
        });
    });
}

/// How a scaling case scales: by a factor, a dose or a total water
interface Scaling {
    factor?: number;
    dose?: ScaleTarget;
    water?: ScaleTarget;
    diagnostics: Diagnostic[];
}

describe("scaling", () => {
    test.each(recipes("scaling"))("%s", (name, source) => {
        const scaling = expected[`${name}.json`] as unknown as Scaling | undefined;
        expect(scaling, `missing ${name}.json`).toBeDefined();
        const { factor, dose, water, diagnostics } = scaling!;

        const { recipe, diagnostics: problems } = check(source);
        expect(problems.filter((d) => d.severity === "error")).toEqual([]);

        const result: ScaleResult = dose
            ? scaleToDose(recipe, dose)
            : water
              ? scaleToWater(recipe, water)
              : scale(recipe, factor!);
        expect(result.diagnostics).toEqual(diagnostics);

        // An error leaves nothing to compare; otherwise the scaled recipe must still check
        const scaled = sources[`${name}.expected.brew`];
        if (diagnostics.some((d) => d.severity === "error")) {
            expect(scaled, `${name}.expected.brew should not exist`).toBeUndefined();
        } else {
            expect(format(result.recipe)).toBe(scaled);
            expect(check(scaled!).diagnostics.filter((d) => d.severity === "error")).toEqual([]);
        }
    });
});

describe("json", () => {
    test.each(recipes("json"))("%s", (name, source) => {
        const { recipe, diagnostics } = check(source);
        expect(diagnostics.filter((d) => d.severity === "error")).toEqual([]);

        const result = toJson(recipe);
        expect(result.diagnostics).toEqual([]);
        expect(result.json).toEqual(expected[`${name}.json`]);
        expect(validate(result.json)).toEqual([]);
    });
});

test("every .json has its .brew", () => {
    const orphans = Object.keys(expected).filter((path) => !sources[path.replace(/\.json$/, ".brew")]);
    expect(orphans).toEqual([]);
});
