import { describe, test, expect } from "vitest";
import { check } from "../src/index.js";

const diagnostics = (source: string) =>
    check(source).diagnostics.map((d) => [d.severity, d.message, d.line, d.column]);

describe("check", () => {
    test("valid recipe", () => {
        const result = check("@V60 15g 250g 94°C\n0:00 50g bloom\n0:45 250g\ntarget 3:00");
        expect(result.diagnostics).toEqual([]);
        expect(result.recipe.steps).toHaveLength(3);
    });

    test("runs the analysis after a clean parse", () => {
        expect(diagnostics("@V60 15g\n0:45 50g\n0:30 150g")).toEqual([
            ["error", "This step starts at 0:30, before the previous one at 0:45", 3, 1],
        ]);
    });

    test("skips the analysis when the source has syntax errors", () => {
        expect(diagnostics("@V60 15g\n0:45 50g\n0:30 150g\ngrind")).toEqual([
            ["error", "Add a grind size after 'grind', like 'grind medium-fine'", 4, 6],
        ]);
    });

    test("diagnostics are sorted by position", () => {
        // checkUnits runs before checkTempChanges, but its error comes later in the file
        expect(diagnostics("@V60 15g 94°C\n90°C\n50g\n200°F").map((d) => d[2])).toEqual([2, 4]);
    });
});
