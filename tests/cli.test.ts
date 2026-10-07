import { describe, test, expect } from "vitest";
import { run } from "../src/cli/run.js";

// Run the CLI on in-memory files; returns the exit code, the output and the files after the run
const cli = (args: string[], files: Record<string, string> = {}) => {
    const out: string[] = [];
    const err: string[] = [];
    const code = run(args, {
        readFile: (path) => {
            const content = files[path];
            if (content === undefined) throw new Error("no such file");
            return content;
        },
        writeFile: (path, content) => {
            files[path] = content;
        },
        out: (line) => out.push(line),
        err: (line) => err.push(line),
    });
    return { code, out, err, files };
};

const valid = "@V60 15g 250g\n0:00 50g bloom\n0:45 250g\n";

describe("usage", () => {
    test("no command", () => {
        const { code, err } = cli([]);
        expect(code).toBe(2);
        expect(err[0]).toBe("Usage: brewlang <check|fmt> [--check] <file.brew>...");
    });

    test("unknown command", () => {
        const { code, err } = cli(["lint", "a.brew"]);
        expect(code).toBe(2);
        expect(err[0]).toBe("Unknown command 'lint'. Use check, fmt, scale or json");
    });

    test("no file", () => {
        expect(cli(["check"]).code).toBe(2);
    });

    test("unreadable file", () => {
        const { code, err } = cli(["check", "missing.brew"]);
        expect(code).toBe(1);
        expect(err).toEqual(["missing.brew: cannot read the file (no such file)"]);
    });
});

describe("check", () => {
    test("valid file prints nothing", () => {
        const { code, out } = cli(["check", "a.brew"], { "a.brew": valid });
        expect(code).toBe(0);
        expect(out).toEqual([]);
    });

    test("diagnostics with file, position and severity", () => {
        const { code, out } = cli(["check", "a.brew"], {
            "a.brew": "@V60 15g 250g\n0:00 150g\n0:45 100g\n1:30 250g\n2:00 /swril\n",
        });
        expect(code).toBe(1);
        expect(out).toEqual([
            "a.brew:3:6: error: The scale is already at 150g: pour to a higher total, or add water with '+'",
            "a.brew:5:1: warning: Unknown action '/swril'. Did you mean '/swirl'?",
        ]);
    });

    test("warnings and suggestions alone do not fail", () => {
        const { code, out } = cli(["check", "a.brew"], { "a.brew": "@V60 15g\n0:00 40g\n0:45 250g\n" });
        expect(code).toBe(0);
        expect(out).toEqual(["a.brew:2:1: suggestion: This pour looks like a bloom: add 'bloom' if it is one"]);
    });

    test("several files", () => {
        const { code, out } = cli(["check", "a.brew", "b.brew"], { "a.brew": valid, "b.brew": "@V60" });
        expect(code).toBe(1);
        expect(out).toEqual(["b.brew:1:5: error: Add the dose after the brewer, like '@V60 15g'"]);
    });
});

describe("fmt", () => {
    test("rewrites the file", () => {
        const { code, files } = cli(["fmt", "a.brew"], { "a.brew": "@v60   15g\n00:45 50g" });
        expect(code).toBe(0);
        expect(files["a.brew"]).toBe("@V60 15g\n0:45 50g\n");
    });

    test("leaves a file with syntax errors untouched", () => {
        const { code, out, files } = cli(["fmt", "a.brew"], { "a.brew": "@v60   15g\ngrind" });
        expect(code).toBe(1);
        expect(files["a.brew"]).toBe("@v60   15g\ngrind");
        expect(out).toEqual([
            "a.brew:2:6: error: Add a grind size after 'grind', like 'grind medium-fine'",
        ]);
    });

    test("semantic errors do not block formatting", () => {
        const { code, files } = cli(["fmt", "a.brew"], { "a.brew": "@V60  15g\n0:45 50g\n0:30 100g" });
        expect(code).toBe(0);
        expect(files["a.brew"]).toBe("@V60 15g\n0:45 50g\n0:30 100g\n");
    });

    test("--check lists unformatted files without writing", () => {
        const files = { "a.brew": valid, "b.brew": "@V60  15g" };
        const result = cli(["fmt", "--check", "a.brew", "b.brew"], files);
        expect(result.code).toBe(1);
        expect(result.out).toEqual(["b.brew: not formatted"]);
        expect(result.files["b.brew"]).toBe("@V60  15g");
    });

    test("--check passes on formatted files", () => {
        expect(cli(["fmt", "--check", "a.brew"], { "a.brew": valid }).code).toBe(0);
    });
});

describe("scale", () => {
    test("prints the scaled recipe, the warning on stderr", () => {
        const { code, out, err, files } = cli(["scale", "--dose", "30g", "a.brew"], { "a.brew": valid });
        expect(code).toBe(0);
        expect(out).toEqual(["@V60 30g 500g\n0:00 100g bloom\n0:45 500g"]);
        expect(err).toEqual([
            "a.brew:1:6: warning: Amounts ×2, times unchanged: plan a coarser grind and a later finish",
        ]);
        expect(files["a.brew"]).toBe(valid);
    });

    test("by the water", () => {
        const { code, out } = cli(["scale", "--water", "125g", "a.brew"], { "a.brew": valid });
        expect(code).toBe(0);
        expect(out).toEqual(["@V60 8g 125g\n0:00 25g bloom\n0:45 125g"]);
    });

    test("an error from the scaling", () => {
        const { code, out, err } = cli(["scale", "--dose", "1oz", "a.brew"], { "a.brew": valid });
        expect(code).toBe(1);
        expect(out).toEqual([]);
        expect(err).toEqual([
            "a.brew:1:6: error: The recipe weighs its dose in g: give the new dose in g too, like '1g'",
        ]);
    });

    test("a recipe with errors is not scaled", () => {
        const { code, err } = cli(["scale", "--dose", "30g", "a.brew"], { "a.brew": "@V60 15g 250g\n0:00 100g\n" });
        expect(code).toBe(1);
        expect(err).toEqual(["a.brew:1:10: error: The header announces 250g but the pours end at 100g. Make them match"]);
    });

    test("bad usage", () => {
        expect(cli(["scale", "a.brew"]).err).toEqual([
            "Usage: brewlang scale --dose <25g> | --water <400g> <file.brew>",
        ]);
        expect(cli(["scale", "--dose", "30", "a.brew"]).err).toEqual([
            "Write the dose with its unit, like --dose 25g",
        ]);
    });
});

describe("json", () => {
    test("prints the recipe as JSON", () => {
        const { code, out, err } = cli(["json", "a.brew"], { "a.brew": valid });
        expect(code).toBe(0);
        expect(err).toEqual([]);
        expect(JSON.parse(out.join("\n"))).toEqual({
            brewlang: "0.1",
            brewer: "V60",
            coffee: { value: 15, unit: "gram" },
            water: { value: 250, unit: "gram" },
            steps: [
                { kind: "pour", at_s: 0, to_water: { value: 50, unit: "gram" }, bloom: true },
                { kind: "pour", at_s: 45, to_water: { value: 250, unit: "gram" } },
            ],
        });
    });

    test("metadata left out, the warning on stderr", () => {
        const { code, err } = cli(["json", "a.brew"], { "a.brew": `---\ntags:\n  - light\n---\n${valid}` });
        expect(code).toBe(0);
        expect(err).toEqual([
            "a.brew:2:1: warning: Only 'key: value' lines go into the JSON metadata: this line is left out",
            "a.brew:3:1: warning: Only 'key: value' lines go into the JSON metadata: this line is left out",
        ]);
    });

    test("a recipe with errors has no JSON", () => {
        const { code, out, err } = cli(["json", "a.brew"], { "a.brew": "@V60 15g\ngrind fine\ngrind coarse\n" });
        expect(code).toBe(1);
        expect(out).toEqual([]);
        expect(err).toEqual(["a.brew:3:1: error: The grind is already set on line 2: keep only one 'grind' line"]);
    });

    test("bad usage", () => {
        expect(cli(["json"]).err).toEqual(["Usage: brewlang json <file.brew>"]);
        expect(cli(["json", "a.brew", "b.brew"]).code).toBe(2);
    });
});
