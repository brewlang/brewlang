import { describe, test, expect } from "vitest";
import { parse } from "../src/parser.js";

// Helpers: keep only what each test cares about
const header = (source: string) => parse(source).recipe.header;
const errors = (source: string) =>
    parse(source).diagnostics.map((d) => [d.severity, d.message, d.line, d.column]);

describe("header", () => {
    test("brewer, dose, water and temperature", () => {
        expect(header("@V60 15g 250g 94°C")).toEqual({
            kind: "Header",
            brewer: "V60",
            dose: { amount: { value: 15 }, unit: "g", line: 1, column: 6 },
            water: { amount: { value: 250 }, unit: "g", line: 1, column: 10 },
            temp: { amount: { value: 94 }, unit: "°C", line: 1, column: 15 },
            line: 1,
            column: 1,
        });
        expect(errors("@V60 15g 250g 94°C")).toEqual([]);
    });

    test("dose only", () => {
        const h = header("@V60 15g");
        expect(h?.dose.amount).toEqual({ value: 15 });
        expect(h?.water).toBeUndefined();
        expect(h?.temp).toBeUndefined();
    });

    test("temperature without water", () => {
        const h = header("@V60 15g 94°C");
        expect(h?.water).toBeUndefined();
        expect(h?.temp?.unit).toBe("°C");
    });

    test("decimal dose and temperature range", () => {
        const h = header("@Chemex 30.5g 90-93°C");
        expect(h?.dose.amount).toEqual({ value: 30.5 });
        expect(h?.temp?.amount).toEqual({ value: 90, max: 93 });
    });

    test("ounces and fahrenheit", () => {
        const h = header("@V60 0.5oz 8floz 200°F");
        expect(h?.dose.unit).toBe("oz");
        expect(h?.water?.unit).toBe("floz");
        expect(h?.temp?.unit).toBe("°F");
    });

    test("trailing comment", () => {
        expect(header("@V60 15g -- light roast")?.comment).toBe("light roast");
    });

    test("after metadata and blank lines", () => {
        const result = parse("---\ntitle: Guji\n---\n\n\n@V60 15g\n");
        expect(result.recipe.frontmatter?.raw).toBe("title: Guji\n");
        expect(result.recipe.header?.line).toBe(6);
        expect(result.diagnostics).toEqual([]);
    });
});

describe("header errors", () => {
    test("empty source", () => {
        expect(header("")).toBeUndefined();
        expect(errors("")).toEqual([
            ["error", "A recipe must start with a header, like '@V60 15g 94°C'", 1, 1],
        ]);
    });

    test("missing brewer", () => {
        expect(errors("15g 94°C")).toEqual([
            ["error", "A recipe must start with a header, like '@V60 15g 94°C'", 1, 1],
        ]);
    });

    test("missing dose", () => {
        expect(errors("@V60")).toEqual([
            ["error", "Add the dose after the brewer, like '@V60 15g'", 1, 5],
        ]);
    });

    test("missing unit", () => {
        expect(errors("@V60 15 94°C")).toEqual([
            ["error", "Add a unit right after the number, like '15g' or '94°C'", 1, 9],
        ]);
    });

    test("dose in a volume unit", () => {
        expect(header("@V60 15ml")).toBeUndefined();
        expect(errors("@V60 15ml")).toEqual([
            ["error", "Weigh the dose in g or oz, not 'ml'", 1, 6],
        ]);
    });

    test("unknown unit", () => {
        expect(errors("@V60 15g 2cups")).toEqual([
            [
                "error",
                "Unknown unit 'cups'. Use g, ml, oz or floz for water, °C or °F for temperature",
                1,
                10,
            ],
        ]);
    });

    test("water after temperature", () => {
        const source = "@V60 15g 94°C 250g";
        expect(header(source)?.temp?.amount).toEqual({ value: 94 });
        expect(header(source)?.water).toBeUndefined();
        expect(errors(source)).toEqual([
            ["error", "Write the header in this order: '@V60 15g 250g 94°C'", 1, 15],
        ]);
    });

    test("unfinished range", () => {
        expect(errors("@V60 15g 90-°C")).toEqual([
            ["error", "Unexpected character '°'", 1, 13],
        ]);
    });

    test("unexpected token", () => {
        expect(header("@V60 15g /swirl")?.dose.amount).toEqual({ value: 15 });
        expect(errors("@V60 15g /swirl")).toEqual([
            ["error", "Unexpected '/swirl' in the header", 1, 10],
        ]);
    });

    test("ratio instead of water", () => {
        const source = "@V60 18g 1:15 94°C";
        expect(header(source)?.temp?.amount).toEqual({ value: 94 });
        expect(errors(source)).toEqual([
            [
                "error",
                "Brewlang computes the ratio from the dose and the water: write the water instead, like '@V60 18g 270g'",
                1,
                10,
            ],
        ]);
    });

    test("ratio with a dose range", () => {
        expect(errors("@V60 15-16g 1:16")[0]?.[1]).toBe(
            "Brewlang computes the ratio from the dose and the water: write the water instead, like '@V60 15g 250g'",
        );
    });

    test("lexer error is not reported twice", () => {
        expect(errors("@1 15g")).toEqual([
            ["error", "Brewer name must start with a letter", 1, 2],
        ]);
    });
});

describe("steps", () => {
    const steps = (source: string) => parse(source).recipe.steps;

    test("no steps after the header", () => {
        expect(steps("@V60 15g\n")).toEqual([]);
    });

    test("comment line", () => {
        expect(steps("@V60 15g\n-- bloom bien\n")).toEqual([
            { kind: "Comment", text: "bloom bien", line: 2, column: 1 },
        ]);
        expect(errors("@V60 15g\n-- bloom bien\n")).toEqual([]);
    });

    test("blank lines between steps are skipped", () => {
        const s = steps("@V60 15g\n\n-- a\n\n\n-- b");
        expect(s.map((step) => step.line)).toEqual([3, 6]);
    });

    test("unknown line is reported and skipped", () => {
        const source = "@V60 15g\nhello world\n-- ok";
        expect(steps(source)).toEqual([{ kind: "Comment", text: "ok", line: 3, column: 1 }]);
        expect(errors(source)).toEqual([
            ["error", "Unexpected 'hello' at the start of a step", 2, 1],
        ]);
    });
});

describe("target", () => {
    const steps = (source: string) => parse(source).recipe.steps;

    test("target time in seconds", () => {
        expect(steps("@V60 15g\ntarget 3:00")).toEqual([
            {
                kind: "Target",
                time: { seconds: 180, line: 2, column: 8 },
                line: 2,
                column: 1,
            },
        ]);
        expect(errors("@V60 15g\ntarget 3:00")).toEqual([]);
    });

    test("target with a comment", () => {
        const [target] = steps("@V60 15g\ntarget 12:30 -- long brew");
        expect(target).toMatchObject({ kind: "Target", comment: "long brew" });
        expect(target).toMatchObject({ time: { seconds: 750 } });
    });

    test("missing time", () => {
        expect(steps("@V60 15g\ntarget")).toEqual([]);
        expect(errors("@V60 15g\ntarget")).toEqual([
            ["error", "Add a time after 'target', like 'target 3:00'", 2, 7],
        ]);
    });

    test("seconds over 59", () => {
        expect(steps("@V60 15g\ntarget 0:75")).toEqual([]);
        expect(errors("@V60 15g\ntarget 0:75")).toEqual([
            ["error", "Seconds must be under 60 in '0:75'", 2, 8],
        ]);
    });

    test("unexpected token after the time", () => {
        expect(errors("@V60 15g\ntarget 3:00 15g")).toEqual([
            ["error", "Unexpected '15' after the target", 2, 13],
        ]);
    });
});

describe("temperature change", () => {
    const steps = (source: string) => parse(source).recipe.steps;

    test("temperature alone on its line", () => {
        expect(steps("@V60 15g\n90°C")).toEqual([
            {
                kind: "TempChange",
                temp: { amount: { value: 90 }, unit: "°C", line: 2, column: 1 },
                line: 2,
                column: 1,
            },
        ]);
        expect(errors("@V60 15g\n90°C")).toEqual([]);
    });

    test("range and comment", () => {
        const [change] = steps("@V60 15g\n195-200°F -- cooler");
        expect(change).toMatchObject({
            kind: "TempChange",
            temp: { amount: { value: 195, max: 200 }, unit: "°F" },
            comment: "cooler",
        });
    });

    test("missing unit", () => {
        expect(steps("@V60 15g\n90")).toEqual([]);
        expect(errors("@V60 15g\n90")).toEqual([
            ["error", "Add a unit right after the number, like '15g' or '94°C'", 2, 3],
        ]);
    });

    test("unknown unit", () => {
        expect(errors("@V60 15g\n90cups")).toEqual([
            [
                "error",
                "Unknown unit 'cups'. Use g, ml, oz or floz for water, °C or °F for temperature",
                2,
                1,
            ],
        ]);
    });

    test("unexpected token after the temperature", () => {
        expect(errors("@V60 15g\n90°C /swirl")).toEqual([
            ["error", "Unexpected '/swirl' after the temperature", 2, 6],
        ]);
    });
});

describe("pour", () => {
    const steps = (source: string) => parse(source).recipe.steps;

    test("timed cumulative pour with duration and qualifiers", () => {
        const source = "@V60 15g\n0:45 150g ~15s spiral";
        expect(steps(source)).toEqual([
            {
                kind: "Pour",
                time: { seconds: 45, line: 2, column: 1 },
                mode: "cumulative",
                water: { amount: { value: 150 }, unit: "g", line: 2, column: 6 },
                duration: { value: 15, unit: "s", line: 2, column: 11 },
                qualifiers: ["spiral"],
                line: 2,
                column: 1,
            },
        ]);
        expect(errors(source)).toEqual([]);
    });

    test("pour without time", () => {
        const [pour] = steps("@V60 15g\n150g");
        expect(pour).toMatchObject({ kind: "Pour", mode: "cumulative", qualifiers: [] });
        expect(pour).not.toHaveProperty("time");
    });

    test("added water with '+'", () => {
        const [pour] = steps("@V60 15g\n+60g bloom");
        expect(pour).toMatchObject({
            kind: "Pour",
            mode: "add",
            water: { amount: { value: 60 }, unit: "g" },
            qualifiers: ["bloom"],
            line: 2,
            column: 1,
        });
    });

    test("modifiers in any order, with a comment", () => {
        const [pour] = steps("@V60 15g\n0:00 50g bloom ~10s center -- gentle");
        expect(pour).toMatchObject({
            duration: { value: 10, unit: "s" },
            qualifiers: ["bloom", "center"],
            comment: "gentle",
        });
    });

    test("unknown qualifier", () => {
        const source = "@V60 15g\n150g swirl spiral";
        expect(steps(source)[0]).toMatchObject({ qualifiers: ["spiral"] });
        expect(errors(source)).toEqual([
            ["error", "'swirl' is an action: write '/swirl' on its own line", 2, 6],
        ]);
    });

    test("pour in a temperature unit", () => {
        expect(errors("@V60 15g\n+90°C")).toEqual([
            ["error", "Pour water in g, ml, oz or floz, not '°C'", 2, 2],
        ]);
    });

    test("temperature after a pour", () => {
        const source = "@V60 15g\n1:30 250g 90-92°C spiral";
        expect(steps(source)[0]).toMatchObject({ qualifiers: ["spiral"] });
        expect(errors(source)).toEqual([
            [
                "error",
                "Put the temperature alone on its line, before this pour: it applies to every following step",
                2,
                11,
            ],
        ]);
    });

    test("second amount after a pour", () => {
        expect(errors("@V60 15g\n150g 20g")).toEqual([
            ["error", "Unexpected '20' after the pour", 2, 6],
        ]);
    });

    test("two durations", () => {
        expect(errors("@V60 15g\n150g ~10s ~20s")).toEqual([
            ["error", "A step has only one duration", 2, 11],
        ]);
    });

    test("time alone", () => {
        expect(errors("@V60 15g\n0:45")).toEqual([
            [
                "error",
                "Add a pour or an action after the time, like '0:45 150g' or '2:00 /swirl'",
                2,
                5,
            ],
        ]);
    });

    test("temperature change with a time", () => {
        expect(steps("@V60 15g\n1:00 90°C")).toEqual([]);
        expect(errors("@V60 15g\n1:00 90°C")).toEqual([
            ["error", "A temperature change has no time: write '90°C' alone on its line", 2, 1],
        ]);
    });
});

describe("duration in minutes and seconds", () => {
    const steps = (source: string) => parse(source).recipe.steps;

    test("'~3:30' is kept in seconds", () => {
        expect(steps("@V60 15g\n/drawdown ~3:30")).toEqual([
            {
                kind: "Action",
                name: "drawdown",
                duration: { value: 210, unit: "m:ss", line: 2, column: 11 },
                line: 2,
                column: 1,
            },
        ]);
        expect(steps("@V60 15g\n0:45 150g ~1:05 spiral")[0]).toMatchObject({
            duration: { value: 65, unit: "m:ss" },
            qualifiers: ["spiral"],
        });
    });

    test("seconds over 59", () => {
        expect(errors("@V60 15g\n/wait ~3:75")).toEqual([
            ["error", "Seconds must be under 60 in '3:75'", 2, 8],
        ]);
    });
});

describe("duration errors", () => {
    test("missing number", () => {
        expect(errors("@V60 15g\n150g ~s")).toEqual([
            ["error", "Add a number after '~', like '~15s' or '~3:30'", 2, 7],
        ]);
    });

    test("wrong unit", () => {
        expect(errors("@V60 15g\n150g ~15g")).toEqual([
            ["error", "Write the duration in s, m or m:ss, like '~15s', '~4m' or '~3:30'", 2, 9],
        ]);
    });
});

describe("action", () => {
    const steps = (source: string) => parse(source).recipe.steps;

    test("timed action", () => {
        expect(steps("@V60 15g\n2:00 /swirl")).toEqual([
            {
                kind: "Action",
                time: { seconds: 120, line: 2, column: 1 },
                name: "swirl",
                line: 2,
                column: 1,
            },
        ]);
        expect(errors("@V60 15g\n2:00 /swirl")).toEqual([]);
    });

    test("action with a duration and a comment", () => {
        const [action] = steps("@AeroPress 15g\n/press ~30s -- slowly");
        expect(action).toMatchObject({
            kind: "Action",
            name: "press",
            duration: { value: 30, unit: "s" },
            comment: "slowly",
        });
        expect(action).not.toHaveProperty("time");
    });

    test("minutes and hyphenated name", () => {
        const [wait, level] = steps("@V60 15g\n/wait ~4m\n/level-bed");
        expect(wait).toMatchObject({ name: "wait", duration: { value: 4, unit: "m" } });
        expect(level).toMatchObject({ name: "level-bed" });
    });

    test("qualifier on an action", () => {
        expect(errors("@V60 15g\n/swirl spiral")).toEqual([
            ["error", "Unexpected 'spiral' after the action", 2, 8],
        ]);
    });
});

describe("full recipe", () => {
    test("Switch recipe from the spec", () => {
        const source = [
            "@Switch 15g 93°C",
            "",
            "/close",
            "0:00 60g ~10s bloom",
            "0:45 150g ~15s spiral",
            "90°C",
            "1:30 250g ~20s center",
            "2:00 /open",
            "",
            "target 3:00",
        ].join("\n");
        const result = parse(source);
        expect(result.diagnostics).toEqual([]);
        expect(result.recipe.steps.map((step) => step.kind)).toEqual([
            "Action",
            "Pour",
            "Pour",
            "TempChange",
            "Pour",
            "Action",
            "Target",
        ]);
    });
});

describe("grind", () => {
    const steps = (source: string) => parse(source).recipe.steps;

    test("grind size", () => {
        expect(steps("@V60 15g\ngrind medium-fine")).toEqual([
            { kind: "Grind", size: "medium-fine", line: 2, column: 1 },
        ]);
        expect(errors("@V60 15g\ngrind medium-fine")).toEqual([]);
    });

    test("grind with a comment", () => {
        const [grind] = steps("@V60 15g\ngrind coarse -- for a French press");
        expect(grind).toMatchObject({ size: "coarse", comment: "for a French press" });
    });

    test("missing size", () => {
        expect(steps("@V60 15g\ngrind")).toEqual([]);
        expect(errors("@V60 15g\ngrind")).toEqual([
            ["error", "Add a grind size after 'grind', like 'grind medium-fine'", 2, 6],
        ]);
    });

    test("grinder setting instead of a size", () => {
        expect(errors("@V60 15g\ngrind 24")).toEqual([
            ["error", "Add a grind size after 'grind', like 'grind medium-fine'", 2, 7],
        ]);
    });

    test("unknown size", () => {
        expect(steps("@V60 15g\ngrind medium-fin")).toEqual([]);
        expect(errors("@V60 15g\ngrind medium-fin")).toEqual([
            [
                "error",
                "Unknown grind size 'medium-fin'. Use extra-fine, fine, medium-fine, medium, medium-coarse, coarse or extra-coarse",
                2,
                7,
            ],
        ]);
    });

    test("unexpected token after the size", () => {
        expect(errors("@V60 15g\ngrind fine 15g")).toEqual([
            ["error", "Unexpected '15' after the grind size", 2, 12],
        ]);
    });
});
