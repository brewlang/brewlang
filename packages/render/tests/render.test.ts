/// <reference types="vite/client" />
import { describe as group, test, expect } from "vitest";
import { check } from "brewlang";
import { describe, render, toHtml } from "../src/index.js";

const examples = import.meta.glob<string>("../../../examples/*.brew", { query: "?raw", import: "default", eager: true });

const v60 = `---
title: V60 Guji
filter: paper
---

@V60 15g 250g 94°C -- off the boil
grind medium-fine -- 700 µm

/rinse -- preheat
/level-bed
0:00 50g ~10s bloom center -- gently
0:45 150g ~15s spiral
90°C
1:30 +100g
2:00 /swril
2:10 /wait

target 3:00 -- expect some variance
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
        expect(m.brewer).toBe("V60");
        expect(m.title).toBe("V60 Guji");
        expect(m.specs).toEqual([
            { label: "Dose", value: "15 g" },
            { label: "Water", value: "250 g" },
            { label: "Temp", value: "94 °C" },
            { label: "Ratio", value: "1:16.7", accent: true },
        ]);
        expect(m.note).toBe("off the boil");
        expect(m.extras).toEqual([
            { label: "Grind", value: "medium-fine", note: "700 µm" },
            { label: "Filter", value: "paper" },
        ]);
        expect(m.prep).toEqual([
            { title: "Rinse the filter", meta: "", comment: "preheat" },
            { title: "Level the bed", meta: "" },
        ]);
        expect(m.target).toBe("3:00");
        expect(m.targetNote).toBe("expect some variance");
    });

    test("steps", () => {
        expect(model(v60).steps).toEqual([
            { time: "0:00", timed: true, title: "Pour to 50 g", unknown: false, meta: "+50 g · over 10 s", qualifiers: ["bloom", "center"], comment: "gently", fill: 0.2, total: "50 g" },
            { time: "0:45", timed: true, title: "Pour to 150 g", unknown: false, meta: "+100 g · over 15 s", qualifiers: ["spiral"], fill: 0.6, total: "150 g" },
            { time: "·", timed: false, title: "Water at 90 °C", unknown: false, meta: "", qualifiers: [] },
            { time: "1:30", timed: true, title: "Pour to 250 g", unknown: false, meta: "+100 g", qualifiers: [], fill: 1, total: "250 g" },
            { time: "2:00", timed: true, title: "Swril", unknown: true, meta: "", qualifiers: [] },
            { time: "2:10", timed: true, title: "Wait", unknown: false, meta: "until it is ready", qualifiers: [] },
        ]);
    });

    test("no timer: numbered steps, no extra line", () => {
        const m = model("@FrenchPress 30g 500g 95°C\n500g\n/stir\n/wait ~4m\n/press ~30s");
        expect(m.steps.map((s) => [s.time, s.title, s.meta])).toEqual([
            ["01", "Pour to 500 g", "+500 g"],
            ["02", "Stir", ""],
            ["03", "Wait", "4 min"],
            ["04", "Press", "30 s"],
        ]);
        expect(m.extras).toEqual([]);
    });

    test("an action outside the core vocabulary reads from its name", () => {
        const m = model("@V60 15g\n/dig -- a small hole\n0:00 50g\n0:30 /tap-brewer ~5s");
        expect(m.prep).toEqual([{ title: "Dig", meta: "", comment: "a small hole" }]);
        expect(m.steps[1]).toMatchObject({ title: "Tap brewer", unknown: true, meta: "5 s" });
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

    test("chart: the scale rising over each timed pour", () => {
        expect(model(v60).chart).toEqual({
            pours: [
                { at: 0, until: 10, from: 0, to: 50, time: "0:00" },
                { at: 45, until: 60, from: 50, to: 150, time: "0:45" },
                { at: 90, until: 90, from: 150, to: 250, time: "1:30" },
            ],
            total: 250,
            totalLabel: "250 g",
            end: 180,
            target: "3:00",
        });
    });

    test("chart: without a target, it ends with the last timed step", () => {
        expect(model("@V60 15g 250g\n0:00 50g\n0:30 250g ~20s\n1:00 /wait ~30s").chart).toMatchObject({ end: 90 });
        expect(model("@V60 15g 250g\n0:00 50g\n0:30 250g ~20s\n1:00 /wait ~30s").chart?.target).toBeUndefined();
    });

    test("chart: none without timed pours", () => {
        expect(model("@FrenchPress 30g 500g 95°C\n500g\n/stir").chart).toBeUndefined();
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

    test("the brewer has a span of its own in the kicker", () => {
        expect(toHtml(model(v60))).toContain(
            '<div class="brew-kicker"><span class="brew-brewer">V60</span><span class="brew-sep"> · </span><span class="brew-method">Pour-over</span></div>',
        );
    });

    test("a layout other than classic is an attribute of the card", () => {
        expect(toHtml(model(v60), { layout: "classic" }).startsWith('<article class="brew-card">')).toBe(true);
        expect(toHtml(model(v60), { layout: "receipt" }).startsWith('<article class="brew-card" data-layout="receipt">')).toBe(true);
    });

    test("the receipt ends with a barcode of the site, a link", () => {
        const html = toHtml(model(v60), { layout: "receipt" });
        expect(html).toContain('<a class="brew-barcode" href="https://brewlang.github.io" aria-label="brewlang.github.io"><svg');
        expect(html.endsWith("</a></article>")).toBe(true);
        expect(toHtml(model(v60))).not.toContain("brew-barcode");
    });

    test("the chart layout draws the water over time, others do not", () => {
        const html = toHtml(model(v60), { layout: "chart" });
        expect(html).toContain('<svg class="brew-chart"');
        expect(html).toContain('<span class="brew-chart-total">250 g</span>');
        expect(html).toContain('<span class="brew-chart-tick brew-chart-end">3:00</span>');
        expect(html).toContain('<span class="brew-chart-tick" style="left:25%">0:45</span>');
        expect(html.indexOf("brew-chart")).toBeLessThan(html.indexOf('class="brew-steps"'));
        expect(toHtml(model(v60), { layout: "poster" })).not.toContain("<svg");
        expect(toHtml(model("@FrenchPress 30g 500g 95°C\n500g"), { layout: "chart" })).not.toContain("<svg");
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
