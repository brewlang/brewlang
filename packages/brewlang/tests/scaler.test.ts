import { describe, test, expect } from "vitest";
import type { ScaleResult } from "../src/index.js";
import { check, format, scale, scaleToDose, scaleToWater } from "../src/index.js";

// Parse a source that must check without errors
const recipe = (source: string) => {
    const { recipe, diagnostics } = check(source);
    expect(diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    return recipe;
};

// The scaled recipe as text, and its diagnostics as [severity, message, line, column]
const result = ({ recipe, diagnostics }: ScaleResult) => ({
    text: format(recipe),
    diagnostics: diagnostics.map((d) => [d.severity, d.message, d.line, d.column]),
});

const v60 = "@V60 15g 250g 94°C\ngrind medium-fine\n\n0:00 50g ~10s bloom\n0:45 150g ~15s spiral\n1:30 250g\n\ntarget 3:00\n";

describe("scale", () => {
    test("weights change, times, temperature and grind stay", () => {
        expect(result(scale(recipe(v60), 2))).toEqual({
            text: "@V60 30g 500g 94°C\ngrind medium-fine\n\n0:00 100g ~10s bloom\n0:45 300g ~15s spiral\n1:30 500g\n\ntarget 3:00\n",
            diagnostics: [
                ["warning", "Amounts ×2, times unchanged: plan a coarser grind and a later finish", 1, 6],
            ],
        });
    });

    test("scaling down advises the other way", () => {
        expect(result(scale(recipe(v60), 0.5)).diagnostics).toEqual([
            ["warning", "Amounts ×0.5, times unchanged: plan a finer grind and an earlier finish", 1, 6],
        ]);
    });

    test("×1 changes nothing and warns nothing", () => {
        expect(result(scale(recipe(v60), 1))).toEqual({ text: v60, diagnostics: [] });
    });

    test("grams round to the gram", () => {
        expect(result(scale(recipe("@V60 15g 250g\n0:00 50g\n0:45 250g"), 1.6)).text).toBe(
            "@V60 24g 400g\n0:00 80g\n0:45 400g\n",
        );
        expect(result(scale(recipe("@V60 15g 250g\n0:00 50g\n0:45 250g"), 0.33)).text).toBe(
            "@V60 5g 83g\n0:00 17g\n0:45 83g\n",
        );
    });

    test("ounces round to a tenth", () => {
        expect(result(scale(recipe("@V60 0.5oz 8.5floz\n0:00 2floz\n0:45 8.5floz"), 1.5)).text).toBe(
            "@V60 0.8oz 12.8floz\n0:00 3floz\n0:45 12.8floz\n",
        );
    });

    test("'+' pours follow the rounded total, so it stays exact", () => {
        const scaled = scale(recipe("@V60 15g 100g\n+33g\n+33g\n+34g"), 0.5);
        expect(result(scaled).text).toBe("@V60 8g 50g\n+17g\n+16g\n+17g\n");
        expect(check(format(scaled.recipe)).diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    });

    test("ranges scale on both bounds", () => {
        expect(result(scale(recipe("@V60 15g 90-93°C\n0:00 40-50g bloom\n0:45 +100g"), 2)).text).toBe(
            "@V60 30g 90-93°C\n0:00 80-100g bloom\n0:45 +200g\n",
        );
    });

    test("the source recipe is untouched", () => {
        const source = recipe(v60);
        scale(source, 2);
        expect(format(source)).toBe(v60);
    });

    test("a factor that is not positive", () => {
        expect(result(scale(recipe(v60), 0)).diagnostics).toEqual([
            ["error", "The scaling factor must be a positive number, like 1.5, not 0", 1, 6],
        ]);
    });

    test("a dose that rounds to nothing", () => {
        expect(result(scale(recipe(v60), 0.01)).diagnostics).toEqual([
            ["error", "Scaled ×0.01, the dose rounds to 0g: use a bigger factor", 1, 6],
        ]);
    });

    test("pours that round together", () => {
        expect(result(scale(recipe("@V60 15g\n0:00 50g\n0:45 51g"), 0.1)).diagnostics).toEqual([
            ["error", "Scaled ×0.1, this pour rounds to the same water as the one before: use a bigger factor", 3, 6],
        ]);
    });
});

describe("scaleToDose", () => {
    test("the factor comes from the dose", () => {
        expect(result(scaleToDose(recipe(v60), { value: 24, unit: "g" })).text).toBe(
            "@V60 24g 400g 94°C\ngrind medium-fine\n\n0:00 80g ~10s bloom\n0:45 240g ~15s spiral\n1:30 400g\n\ntarget 3:00\n",
        );
    });

    test("another unit", () => {
        expect(result(scaleToDose(recipe(v60), { value: 1, unit: "oz" })).diagnostics).toEqual([
            ["error", "The recipe weighs its dose in g: give the new dose in g too, like '1g'", 1, 6],
        ]);
    });

    test("a dose range", () => {
        expect(result(scaleToDose(recipe("@V60 15-16g 250g"), { value: 30, unit: "g" })).diagnostics).toEqual([
            ["error", "The dose is a range, 15-16g: scale this recipe by its water instead", 1, 6],
        ]);
    });
});

describe("scaleToWater", () => {
    test("from the header water", () => {
        expect(result(scaleToWater(recipe(v60), { value: 400, unit: "g" })).text).toBe(
            "@V60 24g 400g 94°C\ngrind medium-fine\n\n0:00 80g ~10s bloom\n0:45 240g ~15s spiral\n1:30 400g\n\ntarget 3:00\n",
        );
    });

    test("from where the pours end", () => {
        expect(result(scaleToWater(recipe("@V60 15g\n0:00 50g\n0:45 +200g"), { value: 500, unit: "g" })).text).toBe(
            "@V60 30g\n0:00 100g\n0:45 +400g\n",
        );
    });

    test("no total water", () => {
        expect(result(scaleToWater(recipe("@FrenchPress 30g\n/wait ~4m"), { value: 500, unit: "g" })).diagnostics).toEqual([
            ["error", "This recipe gives no total water: scale it by its dose instead", 1, 1],
        ]);
    });

    test("another unit", () => {
        expect(result(scaleToWater(recipe(v60), { value: 400, unit: "ml" })).diagnostics).toEqual([
            ["error", "The recipe measures its water in g: give the new water in g too, like '400g'", 1, 10],
        ]);
    });

    test("water ending on a range", () => {
        expect(result(scaleToWater(recipe("@V60 15g\n0:00 40-50g\n0:45 +200g"), { value: 500, unit: "g" })).diagnostics).toEqual([
            ["error", "The water ends at a range, 240-250g: scale this recipe by its dose instead", 1, 1],
        ]);
    });
});
