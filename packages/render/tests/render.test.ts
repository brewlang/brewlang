/// <reference types="vite/client" />
import { describe as group, test, expect } from "vitest";
import { check } from "brewlang";
import { describe, render, toHtml } from "../src/index.js";

const examples = import.meta.glob<string>("../../../examples/*.brew", { query: "?raw", import: "default", eager: true });

const v60 = `---
title: V60 Guji
filter: paper
---

@V60 15g 250g 94°C
grind medium-fine

/rinse
0:00 50g ~10s bloom center -- gently
0:45 150g ~15s spiral
90°C
1:30 +100g
2:00 /swril
2:10 /wait

target 3:00
`;

/// The model of a source that must check without errors
const model = (source: string) => {
    const { recipe, diagnostics } = check(source);
    expect(diagnostics.filter((d) => d.severity === "error")).toEqual([]);
    return describe(recipe)!;
};

group("describe", () => {
    test("head and specs", () => {
        const m = model(v60);
        expect(m.kicker).toBe("V60 · Pour-over");
        expect(m.title).toBe("V60 Guji");
        expect(m.specs).toEqual([
            { label: "Dose", value: "15 g" },
            { label: "Water", value: "250 g" },
            { label: "Temp", value: "94 °C" },
            { label: "Ratio", value: "1:16.7", accent: true },
        ]);
        expect(m.extras).toEqual([
            { label: "Grind", value: "medium-fine" },
            { label: "Filter", value: "paper" },
        ]);
        expect(m.prep).toEqual(["Rinse the filter"]);
        expect(m.target).toBe("3:00");
    });

    test("steps", () => {
        expect(model(v60).steps).toEqual([
            { time: "0:00", timed: true, title: "Pour to 50 g", unknown: false, meta: "+50 g · over 10 s", qualifiers: ["bloom", "center"], comment: "gently", fill: 0.2, total: "50 g" },
            { time: "0:45", timed: true, title: "Pour to 150 g", unknown: false, meta: "+100 g · over 15 s", qualifiers: ["spiral"], fill: 0.6, total: "150 g" },
            { time: "·", timed: false, title: "Water at 90 °C", unknown: false, meta: "", qualifiers: [] },
            { time: "1:30", timed: true, title: "Pour to 250 g", unknown: false, meta: "+100 g", qualifiers: [], fill: 1, total: "250 g" },
            { time: "2:00", timed: true, title: "/swril", unknown: true, meta: "", qualifiers: [] },
            { time: "2:10", timed: true, title: "Wait", unknown: false, meta: "until it is ready", qualifiers: [] },
        ]);
    });

    test("no timer: numbered steps and your own pace", () => {
        const m = model("@FrenchPress 30g 500g 95°C\n500g\n/stir\n/wait ~4m\n/press ~30s");
        expect(m.steps.map((s) => [s.time, s.title, s.meta])).toEqual([
            ["01", "Pour to 500 g", "+500 g"],
            ["02", "Stir", ""],
            ["03", "Wait", "4 min"],
            ["04", "Press", "30 s"],
        ]);
        expect(m.extras).toContainEqual({ label: "Pace", value: "your own, no timer" });
    });

    test("ratio only between the same units", () => {
        expect(model("@V60 15g 250ml\n250ml").specs[3]!.value).toBe("—");
        expect(model("@V60 15-16g 250g\n250g").specs[3]!.value).toBe("—");
    });

    test("title when the metadata has none", () => {
        const { recipe } = check("@V60 15g");
        expect(describe(recipe)!.title).toBe("Untitled recipe");
        expect(describe(recipe, { title: "chemex" })!.title).toBe("chemex");
    });

    test("no header, no card", () => {
        expect(describe(check("").recipe)).toBeUndefined();
    });
});

group("toHtml", () => {
    test("classes start with brew-", () => {
        const html = toHtml(model(v60));
        expect(html.startsWith('<article class="brew-card">')).toBe(true);
        const classes = [...html.matchAll(/class="([^"]+)"/g)].flatMap((m) => m[1]!.split(" "));
        expect(classes.filter((c) => !c.startsWith("brew-"))).toEqual([]);
    });

    test("text is escaped", () => {
        const html = toHtml(model(`---\ntitle: <script>alert("x")</script> & co\n---\n@V60 15g\n50g -- <b>hot</b>`));
        expect(html).toContain("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; co");
        expect(html).toContain("&lt;b&gt;hot&lt;/b&gt;");
        expect(html).not.toContain("<script>");
    });

    test("theme and signature", () => {
        const html = toHtml(model(v60), { theme: "dark", signed: true });
        expect(html.startsWith('<article class="brew-card" data-theme="dark">')).toBe(true);
        expect(html).toContain('<footer class="brew-foot">Brewlang</footer>');
    });
});

group("render", () => {
    test("scaled and converted for display, the ratio as written", () => {
        const { model: m, notes } = render(v60, { factor: 2, weight: "oz", temp: "°F" });
        expect(m!.specs.map((s) => s.value)).toEqual(["1.1 oz", "17.6 oz", "201 °F", "1:16.7"]);
        expect(notes.map((d) => d.message)).toEqual([
            "Amounts ×2, times unchanged: plan a coarser grind and a later finish",
        ]);
    });

    test("water written as a volume stays a volume", () => {
        const { model: m } = render("@V60 15g 250ml\n250ml", { weight: "oz" });
        expect(m!.specs.map((s) => s.value).slice(0, 2)).toEqual(["0.5 oz", "8.5 fl oz"]);
    });

    test("with errors, the recipe as parsed, unscaled", () => {
        const { model: m, diagnostics, notes } = render("@V60 15g\n50g blom", { factor: 2 });
        expect(diagnostics.some((d) => d.severity === "error")).toBe(true);
        expect(notes).toEqual([]);
        expect(m!.specs[0]!.value).toBe("15 g");
    });

    test("no header, no HTML", () => {
        expect(render("-- nothing yet").html).toBe("");
    });

    test.each(Object.entries(examples))("%s", (_, source) => {
        const { html, diagnostics } = render(source);
        expect(diagnostics.filter((d) => d.severity === "error")).toEqual([]);
        expect(html).toContain('class="brew-step"');
    });
});
