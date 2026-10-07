import { describe, test, expect } from "vitest";
import type { ConvertResult } from "../src/index.js";
import { check, convert, format } from "../src/index.js";

// Parse a source that must check without errors
const recipe = (source: string) => {
    const { recipe, diagnostics } = check(source);
    expect(diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    return recipe;
};

// The converted recipe as text, and its diagnostics as [severity, message, line, column]
const result = ({ recipe, diagnostics }: ConvertResult) => ({
    text: format(recipe),
    diagnostics: diagnostics.map((d) => [d.severity, d.message, d.line, d.column]),
});

const v60 = "@V60 15g 250g 94°C\ngrind medium-fine\n\n0:00 50g ~10s bloom\n0:45 150g ~15s spiral\n90°C\n1:30 250g\n\ntarget 3:00\n";

describe("convert", () => {
    test("grams to ounces, Celsius to Fahrenheit", () => {
        expect(result(convert(recipe(v60), { dose: "oz", water: "oz", temp: "°F" }))).toEqual({
            text: "@V60 0.5oz 8.8oz 201°F\ngrind medium-fine\n\n0:00 1.8oz ~10s bloom\n0:45 5.3oz ~15s spiral\n194°F\n1:30 8.8oz\n\ntarget 3:00\n",
            diagnostics: [],
        });
    });

    test("only the asked units change", () => {
        expect(result(convert(recipe(v60), { temp: "°F" })).text).toBe(
            "@V60 15g 250g 201°F\ngrind medium-fine\n\n0:00 50g ~10s bloom\n0:45 150g ~15s spiral\n194°F\n1:30 250g\n\ntarget 3:00\n",
        );
    });

    test("the same units change nothing", () => {
        expect(result(convert(recipe("@V60 15g 250g 93.5°C\n250g"), { dose: "g", water: "g", temp: "°C" })).text).toBe(
            "@V60 15g 250g 93.5°C\n250g\n",
        );
    });

    test("back from ounces and Fahrenheit", () => {
        expect(result(convert(recipe("@Melitta 0.7oz 12floz 195-205°F\n+2floz bloom\n12floz"), { dose: "g", water: "ml", temp: "°C" })).text).toBe(
            "@Melitta 20g 355ml 91-96°C\n+59ml bloom\n355ml\n",
        );
    });

    test("'+' pours follow the rounded total, so it stays exact", () => {
        const converted = convert(recipe("@V60 15g 100g\n+33g\n+33g\n+34g"), { water: "oz" });
        expect(result(converted).text).toBe("@V60 15g 3.5oz\n+1.2oz\n+1.1oz\n+1.2oz\n");
        expect(check(format(converted.recipe)).diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    });

    test("never between weights and volumes", () => {
        expect(result(convert(recipe(v60), { water: "ml" })).diagnostics).toEqual([
            ["error", "The water is a weight in g: Brewlang never turns weights into volumes, convert it to g or oz", 1, 10],
        ]);
    });

    test("pours too close to stay apart", () => {
        expect(result(convert(recipe("@V60 15g\n50g\n52g"), { water: "oz" })).diagnostics).toEqual([
            ["error", "In oz, this pour rounds to the same water as the one before: keep the water in g", 3, 1],
        ]);
    });

    test("the source recipe is untouched", () => {
        const source = recipe(v60);
        convert(source, { dose: "oz", water: "oz", temp: "°F" });
        expect(format(source)).toBe(v60);
    });
});
