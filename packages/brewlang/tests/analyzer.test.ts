import { describe, test, expect } from "vitest";
import { parse } from "../src/parser.js";
import { analyze } from "../src/analyzer.js";

// Parse a source that must be valid, then keep only what each test cares about
const diagnostics = (source: string) => {
    const { recipe, diagnostics: parseErrors } = parse(source);
    expect(parseErrors).toEqual([]);
    return analyze(recipe).map((d) => [d.severity, d.message, d.line, d.column]);
};

// Errors and warnings only, for tests about one rule that may also trigger a suggestion
const problems = (source: string) => diagnostics(source).filter((d) => d[0] !== "suggestion");

describe("valid recipe", () => {
    test("V60 from the spec", () => {
        const source = [
            "---",
            "title: V60 Ethiopia Guji",
            "---",
            "",
            "@V60 15g 250g 94°C",
            "grind medium-fine",
            "",
            "/rinse",
            "/level-bed",
            "0:00 50g ~10s bloom center",
            "0:45 150g ~15s spiral",
            "1:30 250g ~20s center",
            "2:00 /swirl",
            "",
            "target 3:00",
        ].join("\n");
        expect(diagnostics(source)).toEqual([]);
    });
});

describe("times", () => {
    test("decreasing times", () => {
        expect(diagnostics("@V60 15g\n0:45 50g\n0:30 150g")).toEqual([
            ["error", "This step starts at 0:30, before the previous one at 0:45", 3, 1],
        ]);
    });

    test("equal times run in the written order", () => {
        expect(diagnostics("@V60 15g\n0:00 50g\n0:00 /swirl")).toEqual([]);
    });

    test("untimed steps between timed ones are ignored", () => {
        expect(diagnostics("@V60 15g\n1:00 50g\n/swirl\n2:00 150g")).toEqual([]);
    });

    test("one error per inversion, not for every following step", () => {
        expect(diagnostics("@V60 15g\n1:00 50g\n0:30 100g\n0:40 150g")).toEqual([
            ["error", "This step starts at 0:30, before the previous one at 1:00", 3, 1],
        ]);
    });
});

describe("units", () => {
    test("pours mixing g and ml", () => {
        expect(problems("@V60 15g\n0:00 50g\n0:45 150ml")).toEqual([
            ["error", "Write every water amount in 'g' like the first one, not in 'ml'", 3, 6],
        ]);
    });

    test("header water sets the unit", () => {
        expect(problems("@V60 15g 250ml\n0:00 50g\n0:45 250ml")).toEqual([
            ["error", "Write every water amount in 'ml' like the first one, not in 'g'", 2, 6],
        ]);
    });

    test("temperatures mixing °C and °F", () => {
        expect(problems("@V60 15g 94°C\n0:00 50g\n195°F")).toEqual([
            ["error", "Write every temperature in '°C' like the first one, not in '°F'", 3, 1],
        ]);
    });

    test("every mismatch is reported", () => {
        expect(problems("@V60 15g\n50g\n+100ml\n+100floz").map((d) => d[2])).toEqual([3, 4]);
    });

    test("dose and water units are independent", () => {
        expect(problems("@V60 0.5oz 250ml 200°F\n0:00 250ml")).toEqual([]);
    });
});

describe("water", () => {
    test("cumulative pour below the scale", () => {
        expect(problems("@V60 15g\n0:00 150g\n0:45 100g")).toEqual([
            [
                "error",
                "The scale is already at 150g: pour to a higher total, or add water with '+'",
                3,
                6,
            ],
        ]);
    });

    test("cumulative pour equal to the scale", () => {
        expect(problems("@V60 15g\n150g\n150g").map((d) => d[2])).toEqual([3]);
    });

    test("added water counts in the total", () => {
        expect(problems("@V60 15g\n+60g\n100g\n+50g\n140g")).toEqual([
            [
                "error",
                "The scale is already at 150g: pour to a higher total, or add water with '+'",
                5,
                1,
            ],
        ]);
    });

    test("adding nothing", () => {
        expect(problems("@V60 15g\n50g\n+0g")).toEqual([
            ["error", "'+0g' adds no water: remove this step or pour more", 3, 2],
        ]);
    });

    test("header water matches the last pour", () => {
        expect(problems("@V60 15g 250g\n50g\n+100g\n250g")).toEqual([]);
    });

    test("header water differs from the total", () => {
        expect(problems("@V60 15g 250g\n50g\n240g")).toEqual([
            ["error", "The header announces 250g but the pours end at 240g. Make them match", 1, 10],
        ]);
    });

    test("header water without pours is the total", () => {
        expect(problems("@FrenchPress 30g 500g\n/stir\n/wait ~4m")).toEqual([]);
    });

    test("ranges", () => {
        expect(problems("@V60 15g 240-250g\n50g\n240-250g")).toEqual([]);
        expect(problems("@V60 15g 250g\n50g\n+190-200g")).toEqual([
            [
                "error",
                "The header announces 250g but the pours end at 240-250g. Make them match",
                1,
                10,
            ],
        ]);
    });

    test("mixed units are only reported once", () => {
        expect(problems("@V60 15g 250g\n150ml\n100g").map((d) => d[1])).toEqual([
            "Write every water amount in 'g' like the first one, not in 'ml'",
        ]);
    });
});

describe("overlap", () => {
    test("pour lasting past the next step", () => {
        expect(problems("@V60 15g\n0:00 50g ~50s\n0:45 150g")).toEqual([
            [
                "error",
                "This pour lasts until 0:50, after the next step at 0:45. Shorten it or start the next step later",
                2,
                10,
            ],
        ]);
    });

    test("ending exactly when the next step starts", () => {
        expect(problems("@V60 15g\n0:00 50g ~45s\n0:45 150g")).toEqual([]);
    });

    test("duration in minutes and seconds", () => {
        expect(problems("@V60 15g\n0:00 50g ~0:50\n0:45 150g")[0]?.[1]).toBe(
            "This pour lasts until 0:50, after the next step at 0:45. Shorten it or start the next step later",
        );
        expect(problems("@V60 15g\n0:00 50g ~0:45\n0:45 150g")).toEqual([]);
    });

    test("duration in minutes", () => {
        expect(problems("@V60 15g\n0:00 50g ~1m\n0:45 /swirl").map((d) => d[2])).toEqual([2]);
    });

    test("untimed steps in between are skipped", () => {
        expect(problems("@V60 15g\n0:00 50g ~50s\n/swirl\n0:45 150g").map((d) => d[2])).toEqual([
            2,
        ]);
    });

    test("no check without a time on both sides", () => {
        expect(problems("@V60 15g\n50g ~50s\n150g")).toEqual([]);
        expect(problems("@V60 15g\n0:00 50g ~50s\n150g")).toEqual([]);
    });

    test("actions may last into the next step", () => {
        expect(problems("@AeroPress 15g\n0:00 /press ~30s\n0:10 /swirl")).toEqual([]);
    });

    test("decreasing times are reported once, not as an overlap", () => {
        expect(problems("@V60 15g\n1:00 50g ~10s\n0:30 150g").map((d) => d[1])).toEqual([
            "This step starts at 0:30, before the previous one at 1:00",
        ]);
    });
});

describe("techniques", () => {
    test("two techniques on a pour", () => {
        expect(diagnostics("@V60 15g\n0:00 50g bloom spiral center")).toEqual([
            ["error", "A pour has only one technique: choose spiral or center", 2, 1],
        ]);
    });

    test("bloom is not a technique", () => {
        expect(diagnostics("@V60 15g\n0:00 50g bloom center")).toEqual([]);
    });

    test("the same technique twice is not two techniques", () => {
        expect(diagnostics("@V60 15g\n50g spiral spiral")).toEqual([]);
    });
});

describe("temperature lines", () => {
    test("before the first step", () => {
        expect(diagnostics("@V60 15g\n90°C\n0:00 50g")).toEqual([
            [
                "warning",
                "This temperature applies from the start: put it in the header instead, like '@V60 15g 90°C'",
                2,
                1,
            ],
        ]);
    });

    test("after a step", () => {
        expect(diagnostics("@V60 15g 94°C\n/rinse\n90°C\n0:00 50g")).toEqual([]);
    });

    test("same value as the current temperature", () => {
        expect(diagnostics("@V60 15g 94°C\n0:00 50g\n94°C\n0:45 150g")).toEqual([
            ["warning", "The temperature is already 94°C: remove this line", 3, 1],
        ]);
    });

    test("same value as the previous temperature line", () => {
        expect(diagnostics("@V60 15g 94°C\n50g\n90-92°C\n150g\n90-92°C\n250g")).toEqual([
            ["warning", "The temperature is already 90-92°C: remove this line", 5, 1],
        ]);
    });

    test("replaced right away by another line", () => {
        expect(diagnostics("@V60 15g 94°C\n50g\n92°C\n-- cooler\n90°C\n150g")).toEqual([
            ["warning", "The next temperature line replaces this one before any step: remove it", 3, 1],
        ]);
    });

    test("at the end of the recipe", () => {
        expect(diagnostics("@V60 15g 94°C\n50g\n90°C")).toEqual([]);
    });
});

describe("suggestions", () => {
    test("first pour looks like a bloom", () => {
        expect(diagnostics("@V60 15g\n0:00 45g\n0:45 250g")).toEqual([
            ["suggestion", "This pour looks like a bloom: add 'bloom' if it is one", 2, 1],
        ]);
    });

    test("no bloom suggestion above 3x the dose, with bloom, or for a single pour", () => {
        expect(diagnostics("@V60 15g\n0:00 46g\n0:45 250g")).toEqual([]);
        expect(diagnostics("@V60 15g\n0:00 45g bloom\n0:45 250g")).toEqual([]);
        expect(diagnostics("@AeroPress 15g\n0:00 40g")).toEqual([]);
    });

    test("no bloom suggestion when dose and water units differ", () => {
        expect(diagnostics("@V60 15g\n0:00 40ml\n0:45 250ml")).toEqual([]);
    });

    test("only the first pour can look like a bloom", () => {
        expect(diagnostics("@V60 15g\n0:00 50g\n0:30 +30g\n0:45 250g")).toEqual([
            [
                "suggestion",
                "This recipe mixes totals on the scale, like '150g', and water to add, like '+60g': check that each pour reads as intended",
                3,
                1,
            ],
        ]);
    });

    test("timed preparation", () => {
        expect(diagnostics("@Switch 15g\n0:00 /close\n0:00 60g bloom\n0:45 250g")).toEqual([
            [
                "suggestion",
                "Remove '0:00': an action before the first pour is a preparation, done before starting the timer",
                2,
                1,
            ],
        ]);
    });

    test("actions after the first pour, or later than 0:00, are not preparations", () => {
        expect(diagnostics("@Switch 15g\n0:00 60g bloom\n0:00 /close\n0:45 250g")).toEqual([]);
        expect(diagnostics("@V60 15g\n0:10 /rinse\n0:30 60g bloom\n0:45 250g")).toEqual([]);
    });

    test("mixed pour forms are suggested once", () => {
        expect(diagnostics("@V60 15g\n50g bloom\n+100g\n250g\n+50g").map((d) => d[2])).toEqual([3]);
    });
});

describe("actions", () => {
    test("known actions on their brewer", () => {
        expect(diagnostics("@Switch 15g\n/close\n0:00 60g bloom\n0:45 250g\n2:00 /open")).toEqual([]);
        expect(diagnostics("@AeroPress 15g\n/invert\n0:00 200g\n1:30 /flip\n1:40 /press ~30s")).toEqual([]);
        expect(diagnostics("@Chemex 30g\n/rinse\n/level-bed\n0:00 500g\n4:00 /drawdown")).toEqual([]);
    });

    test("valve action on a V60", () => {
        expect(diagnostics("@V60 15g\n0:00 250g\n2:00 /open")).toEqual([
            [
                "error",
                "'/open' only works with @Switch, @Clever or @Pulsar: remove it or change the brewer",
                3,
                1,
            ],
        ]);
    });

    test("press on a V60", () => {
        expect(diagnostics("@V60 15g\n/press")).toEqual([
            [
                "error",
                "'/press' only works with @AeroPress or @FrenchPress: remove it or change the brewer",
                2,
                1,
            ],
        ]);
    });

    test("drawdown on an AeroPress", () => {
        expect(diagnostics("@AeroPress 15g\n/drawdown")).toEqual([
            [
                "error",
                "'/drawdown' only works with a dripper, @Switch, @Clever or @Pulsar: remove it or change the brewer",
                2,
                1,
            ],
        ]);
    });

    test("level-bed works everywhere", () => {
        expect(diagnostics("@FrenchPress 30g\n/level-bed\n500g")).toEqual([]);
    });

    test("brewer names ignore case", () => {
        expect(diagnostics("@aeropress 15g\n/press")).toEqual([]);
        expect(diagnostics("@v60 15g\n/open")[0]?.[1]).toBe(
            "'/open' only works with @Switch, @Clever or @Pulsar: remove it or change the brewer",
        );
    });

    test("unknown brewer: no restriction", () => {
        expect(diagnostics("@MyDripper 15g\n/close\n/press\n0:00 250g\n2:00 /open")).toEqual([]);
    });

    test("actions follow the brewer type", () => {
        expect(diagnostics("@Clever 15g\n0:00 250g\n2:00 /open\n/drawdown")).toEqual([]);
        expect(diagnostics("@UFO 15g\n0:00 250g\n/drawdown")).toEqual([]);
        expect(diagnostics("@Siphon 20g\n0:00 300g\n/stir\n/press")[0]?.[1]).toBe(
            "'/press' only works with @AeroPress or @FrenchPress: remove it or change the brewer",
        );
    });

    test("aliases follow their action", () => {
        expect(diagnostics("@AeroPress 15g\n0:00 200g\n1:40 /plunge ~30s")).toEqual([]);
        expect(diagnostics("@V60 15g\n/plunge")[0]?.[1]).toBe(
            "'/plunge' only works with @AeroPress or @FrenchPress: remove it or change the brewer",
        );
    });

    test("typo close to a known action", () => {
        expect(diagnostics("@V60 15g\n0:00 250g\n2:00 /swril")).toEqual([
            ["warning", "Unknown action '/swril'. Did you mean '/swirl'?", 3, 1],
        ]);
        expect(diagnostics("@V60 15g\n/levelbed")[0]?.[1]).toBe(
            "Unknown action '/levelbed'. Did you mean '/level-bed'?",
        );
    });

    test("skim works everywhere, and catches its typos", () => {
        expect(diagnostics("@FrenchPress 30g\n500g\n/stir\n/skim")).toEqual([]);
        expect(diagnostics("@Clever 15g\n250g\n/skim")).toEqual([]);
        expect(diagnostics("@FrenchPress 30g\n500g\n/skin")[0]?.[1]).toBe(
            "Unknown action '/skin'. Did you mean '/skim'?",
        );
    });

    test("unknown actions far from every known one are accepted", () => {
        expect(diagnostics("@V60 15g\n/tap\n/spin\n/tap-brewer")).toEqual([]);
    });
});

describe("valve state", () => {
    test("Switch starts open, closed in preparation", () => {
        expect(diagnostics("@Switch 15g\n/close\n0:00 60g bloom\n0:45 250g\n2:00 /open")).toEqual([]);
    });

    test("opening a Switch that starts open", () => {
        expect(diagnostics("@Switch 15g\n0:00 60g bloom\n0:45 250g\n2:00 /open")).toEqual([
            [
                "warning",
                "The @Switch valve starts open: add '/close' before the first step if the brew starts closed, or remove this '/open'",
                4,
                1,
            ],
        ]);
    });

    test("Clever starts closed", () => {
        expect(diagnostics("@Clever 15g\n0:00 250g\n2:00 /open")).toEqual([]);
        expect(diagnostics("@Clever 15g\n/close\n0:00 250g\n2:00 /open")).toEqual([
            ["warning", "The @Clever valve starts closed: remove this '/close'", 2, 1],
        ]);
    });

    test("Pulsar starts open", () => {
        expect(diagnostics("@Pulsar 15g\n/close\n0:00 250g\n2:00 /open")).toEqual([]);
    });

    test("valve already in that state later on", () => {
        expect(diagnostics("@Switch 15g\n/close\n0:00 60g bloom\n0:30 /close\n1:00 /open\n1:30 /open")).toEqual([
            ["warning", "The valve is already closed: remove this '/close'", 4, 1],
            ["warning", "The valve is already open: remove this '/open'", 6, 1],
        ]);
    });

    test("no state for brewers without a valve, or unknown ones", () => {
        expect(diagnostics("@MyDripper 15g\n/open\n0:00 250g\n/open")).toEqual([]);
    });
});

describe("AeroPress position", () => {
    test("standard recipe: press without flipping", () => {
        expect(diagnostics("@AeroPress 15g\n0:00 200g\n1:30 /press ~30s")).toEqual([]);
    });

    test("inverted recipe: invert first, flip before pressing", () => {
        expect(diagnostics("@AeroPress 15g\n/invert\n0:00 200g\n1:30 /flip\n1:40 /press ~30s")).toEqual([]);
    });

    test("pressing while still inverted", () => {
        expect(diagnostics("@AeroPress 15g\n/invert\n0:00 200g\n1:30 /press ~30s")).toEqual([
            ["warning", "The AeroPress is still inverted: add '/flip' before pressing", 4, 1],
        ]);
    });

    test("flipping without inverting first", () => {
        expect(diagnostics("@AeroPress 15g\n0:00 200g\n1:30 /flip\n1:40 /press")).toEqual([
            [
                "warning",
                "The AeroPress starts upright: add '/invert' before the first step for an inverted recipe, or remove this '/flip'",
                3,
                1,
            ],
        ]);
    });

    test("inverting twice", () => {
        expect(diagnostics("@AeroPress 15g\n/invert\n/invert\n0:00 200g\n1:30 /flip")).toEqual([
            ["warning", "The AeroPress is already inverted: remove this '/invert'", 3, 1],
        ]);
    });

    test("invert is for the AeroPress only", () => {
        expect(diagnostics("@V60 15g\n/invert")[0]?.[1]).toBe(
            "'/invert' only works with @AeroPress: remove it or change the brewer",
        );
    });
});
