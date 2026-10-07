/// <reference types="vite/client" />
import { describe, test, expect } from "vitest";
import { format, parse } from "../src/index.js";

// Format a source that must parse without errors
const fmt = (source: string) => {
    const { recipe, diagnostics } = parse(source);
    expect(diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    return format(recipe);
};

describe("lines", () => {
    test("spacing and final newline", () => {
        expect(fmt("@V60   15g  250g\t94°C")).toBe("@V60 15g 250g 94°C\n");
    });

    test("brewer name from the registry", () => {
        expect(fmt("@v60 15g")).toBe("@V60 15g\n");
        expect(fmt("@frenchpress 30g")).toBe("@FrenchPress 30g\n");
        expect(fmt("@myDripper 15g")).toBe("@myDripper 15g\n");
    });

    test("numbers and times", () => {
        expect(fmt("@V60 15.0g 0250g\n00:45 +060.50g")).toBe("@V60 15g 250g\n0:45 +60.5g\n");
    });

    test("ranges", () => {
        expect(fmt("@V60 15g 90-93°C\n195-200°F")).toBe("@V60 15g 90-93°C\n195-200°F\n");
    });

    test("pour modifiers: duration, then bloom, then the others", () => {
        expect(fmt("@V60 15g\n0:00 50g center bloom ~10s")).toBe(
            "@V60 15g\n0:00 50g ~10s bloom center\n",
        );
        expect(fmt("@V60 15g\n50g spiral spiral")).toBe("@V60 15g\n50g spiral\n");
    });

    test("durations keep the author's unit", () => {
        expect(fmt("@V60 15g\n/wait ~45s\n/wait ~4m\n/drawdown ~03:30")).toBe(
            "@V60 15g\n/wait ~45s\n/wait ~4m\n/drawdown ~3:30\n",
        );
    });

    test("actions keep their name as written", () => {
        expect(fmt("@AeroPress 15g\n0:00 /close\n1:30   /plunge   ~30s")).toBe(
            "@AeroPress 15g\n0:00 /close\n1:30 /plunge ~30s\n",
        );
    });

    test("comments", () => {
        expect(fmt("@V60 15g   --header\n--  alone\n150g   --   slow\ngrind fine--x\ntarget 3:00 --")).toBe(
            "@V60 15g -- header\n-- alone\n150g -- slow\ngrind fine -- x\ntarget 3:00 --\n",
        );
    });

    test("grind, target and temperature change", () => {
        expect(fmt("@V60 15g\ngrind   medium-fine\n90°C\ntarget 03:00")).toBe(
            "@V60 15g\ngrind medium-fine\n90°C\ntarget 3:00\n",
        );
    });
});

describe("layout", () => {
    test("blank lines are kept, several become one", () => {
        expect(fmt("\n\n@V60 15g\ngrind fine\n\n\n\n0:00 50g\n0:45 250g\n\n\ntarget 3:00\n\n")).toBe(
            "@V60 15g\ngrind fine\n\n0:00 50g\n0:45 250g\n\ntarget 3:00\n",
        );
    });

    test("frontmatter kept as written, followed by one blank line", () => {
        expect(fmt("---\ntitle:  Guji\nversion: 1\n---\n@V60 15g")).toBe(
            "---\ntitle:  Guji\nversion: 1\n---\n\n@V60 15g\n",
        );
        expect(fmt("---\n---\n\n\n\n@V60 15g")).toBe("---\n---\n\n@V60 15g\n");
    });

    test("CRLF becomes LF", () => {
        expect(fmt("---\r\ntitle: Guji\r\n---\r\n@V60 15g\r\n0:00 250g\r\n")).toBe(
            "---\ntitle: Guji\n---\n\n@V60 15g\n0:00 250g\n",
        );
    });
});

describe("guarantees", () => {
    const messy = "---\ntitle: x\n---\n\n\n@v60 15.0g  250g 94°C --  hi\n\n/rinse\n00:00 50g center ~10s bloom\n0:45  +100g\n90°C\n1:30 250g\n\n\ntarget 3:00";

    test("formatting twice changes nothing", () => {
        expect(fmt(fmt(messy))).toBe(fmt(messy));
    });

    test("the formatted recipe means the same", () => {
        // Same tree once positions are left out; the order of qualifiers carries no meaning
        const strip = (source: string) =>
            JSON.parse(JSON.stringify(parse(source).recipe, (key, value) => {
                if (key === "line" || key === "column") return undefined;
                return key === "qualifiers" ? [...value].sort() : value;
            }));
        const formatted = strip(fmt(messy));
        expect(formatted.header.brewer).toBe("V60");
        expect({ ...formatted, header: { ...formatted.header, brewer: "v60" } }).toEqual(strip(messy));
    });

    const canonical = import.meta.glob<string>("./canonical/valid/*.brew", {
        query: "?raw",
        import: "default",
        eager: true,
    });

    test.each(Object.entries(canonical))("%s is already canonical", (_, source) => {
        expect(fmt(source)).toBe(source);
    });
});
