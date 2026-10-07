import { describe, test, expect } from "vitest";
import { lex } from "../src/lexer.js";

// Helpers: keep only what each test cares about
const kinds = (source: string) => lex(source).tokens.map((t) => [t.kind, t.text]);
const positions = (source: string) => lex(source).tokens.map((t) => [t.kind, t.line, t.column]);
const errors = (source: string) =>
    lex(source).diagnostics.map((d) => [d.severity, d.message, d.line, d.column]);

describe("header", () => {
    test("brewer, dose and temperature", () => {
        expect(kinds("@V60 15g 94°C")).toEqual([
            ["BREWER", "@V60"],
            ["NUMBER", "15"],
            ["UNIT", "g"],
            ["NUMBER", "94"],
            ["UNIT", "°C"],
            ["EOF", ""],
        ]);
    });

    test("with total water", () => {
        expect(kinds("@Origami 15g 250g 93°C")).toEqual([
            ["BREWER", "@Origami"],
            ["NUMBER", "15"],
            ["UNIT", "g"],
            ["NUMBER", "250"],
            ["UNIT", "g"],
            ["NUMBER", "93"],
            ["UNIT", "°C"],
            ["EOF", ""],
        ]);
    });

    test("decimal dose", () => {
        expect(kinds("@V60 15.5g")).toEqual([
            ["BREWER", "@V60"],
            ["NUMBER", "15.5"],
            ["UNIT", "g"],
            ["EOF", ""],
        ]);
    });

    test("multi-letter unit", () => {
        expect(kinds("8floz")).toEqual([
            ["NUMBER", "8"],
            ["UNIT", "floz"],
            ["EOF", ""],
        ]);
    });
});

describe("words", () => {
    test("grind size with a dash", () => {
        expect(kinds("grind medium-fine")).toEqual([
            ["WORD", "grind"],
            ["WORD", "medium-fine"],
            ["EOF", ""],
        ]);
    });

    test("grinder slug with digits", () => {
        expect(kinds("grinder c40 24")).toEqual([
            ["WORD", "grinder"],
            ["WORD", "c40"],
            ["NUMBER", "24"],
            ["EOF", ""],
        ]);
    });

    test("qualifiers", () => {
        expect(kinds("bloom center")).toEqual([
            ["WORD", "bloom"],
            ["WORD", "center"],
            ["EOF", ""],
        ]);
    });
});

describe("newlines", () => {
    test("positions are reset on a new line", () => {
        expect(positions("@V60 15g\ngrind fine")).toEqual([
            ["BREWER", 1, 1],
            ["NUMBER", 1, 6],
            ["UNIT", 1, 8],
            ["NEWLINE", 1, 9],
            ["WORD", 2, 1],
            ["WORD", 2, 7],
            ["EOF", 2, 11],
        ]);
    });

    test("CRLF produces a single newline", () => {
        expect(kinds("grind fine\r\ntarget")).toEqual([
            ["WORD", "grind"],
            ["WORD", "fine"],
            ["NEWLINE", "\n"],
            ["WORD", "target"],
            ["EOF", ""],
        ]);
    });

    test("blank lines produce consecutive newlines", () => {
        expect(kinds("grind fine\n\ntarget")).toEqual([
            ["WORD", "grind"],
            ["WORD", "fine"],
            ["NEWLINE", "\n"],
            ["NEWLINE", "\n"],
            ["WORD", "target"],
            ["EOF", ""],
        ]);
    });
});

describe("symbols", () => {
    test("additive pour", () => {
        expect(kinds("+60g")).toEqual([
            ["PLUS", "+"],
            ["NUMBER", "60"],
            ["UNIT", "g"],
            ["EOF", ""],
        ]);
    });

    test("duration", () => {
        expect(kinds("~15s")).toEqual([
            ["TILDE", "~"],
            ["NUMBER", "15"],
            ["UNIT", "s"],
            ["EOF", ""],
        ]);
    });

    test("temperature range", () => {
        expect(kinds("90-93°C")).toEqual([
            ["NUMBER", "90"],
            ["DASH", "-"],
            ["NUMBER", "93"],
            ["UNIT", "°C"],
            ["EOF", ""],
        ]);
    });

    test("range in the header", () => {
        expect(kinds("@V60 15g 90-93°C")).toEqual([
            ["BREWER", "@V60"],
            ["NUMBER", "15"],
            ["UNIT", "g"],
            ["NUMBER", "90"],
            ["DASH", "-"],
            ["NUMBER", "93"],
            ["UNIT", "°C"],
            ["EOF", ""],
        ]);
    });

    test("decimal range", () => {
        expect(kinds("15.5-16.5g")).toEqual([
            ["NUMBER", "15.5"],
            ["DASH", "-"],
            ["NUMBER", "16.5"],
            ["UNIT", "g"],
            ["EOF", ""],
        ]);
    });

    test("range positions", () => {
        expect(positions("90-93°C")).toEqual([
            ["NUMBER", 1, 1],
            ["DASH", 1, 3],
            ["NUMBER", 1, 4],
            ["UNIT", 1, 6],
            ["EOF", 1, 8],
        ]);
    });

    test("a dash inside a word is not a DASH", () => {
        expect(kinds("grind extra-coarse")).toEqual([
            ["WORD", "grind"],
            ["WORD", "extra-coarse"],
            ["EOF", ""],
        ]);
    });
});

test("action", () => {
    expect(kinds("/swirl")).toEqual([
        ["ACTION", "/swirl"],
        ["EOF", ""],
    ]);
});

test("action with a dash", () => {
    expect(kinds("/level-bed ~30s")).toEqual([
        ["ACTION", "/level-bed"],
        ["TILDE", "~"],
        ["NUMBER", "30"],
        ["UNIT", "s"],
        ["EOF", ""],
    ]);
});

describe("errors", () => {
    test("a number has at most one decimal part", () => {
        expect(errors("15.5.2g")).toEqual([
            ["error", "Unexpected character '.'", 1, 5],
        ]);
    });

    test("unknown character", () => {
        expect(errors("15g #")).toEqual([
            ["error", "Unexpected character '#'", 1, 5],
        ]);
    });

    test("a brewer name starts with a letter", () => {
        expect(errors("@60")).toEqual([
            ["error", "Brewer name must start with a letter", 1, 2],
        ]);
    });

    test("an action needs a name", () => {
        expect(errors("/ swirl")).toEqual([
            ["error", "Action name must start with a letter", 1, 2],
        ]);
    });

    test("lexing goes on after an error", () => {
        expect(kinds("15g # 94°C")).toEqual([
            ["NUMBER", "15"],
            ["UNIT", "g"],
            ["ERROR", "#"],
            ["NUMBER", "94"],
            ["UNIT", "°C"],
            ["EOF", ""],
        ]);
    });

    test("several errors are all reported", () => {
        expect(errors("15g #\n@60 94°C\n0:5 50g")).toEqual([
            ["error", "Unexpected character '#'", 1, 5],
            ["error", "Brewer name must start with a letter", 2, 2],
            ["error", "Time must have two digits after ':'", 3, 4],
        ]);
    });

    test("a bad brewer is a single ERROR token", () => {
        expect(kinds("@60 15g")).toEqual([
            ["ERROR", "@60"],
            ["NUMBER", "15"],
            ["UNIT", "g"],
            ["EOF", ""],
        ]);
    });

    test("an action without a name is an ERROR token", () => {
        expect(kinds("/ swirl")).toEqual([
            ["ERROR", "/"],
            ["WORD", "swirl"],
            ["EOF", ""],
        ]);
    });

    test("a valid source has no diagnostics", () => {
        expect(errors("@V60 15g 94°C\n0:00 50g ~10s bloom")).toEqual([]);
    });
});

describe("comments", () => {
    test("comment alone on its line", () => {
        expect(kinds("-- citron, thé noir")).toEqual([
            ["COMMENT", "-- citron, thé noir"],
            ["EOF", ""],
        ]);
    });

    test("comment at the end of a step", () => {
        expect(kinds("150g -- spiral")).toEqual([
            ["NUMBER", "150"],
            ["UNIT", "g"],
            ["COMMENT", "-- spiral"],
            ["EOF", ""],
        ]);
    });

    test("the newline is not part of the comment", () => {
        expect(kinds("-- note\ngrind fine")).toEqual([
            ["COMMENT", "-- note"],
            ["NEWLINE", "\n"],
            ["WORD", "grind"],
            ["WORD", "fine"],
            ["EOF", ""],
        ]);
    });

    test("a range followed by a comment", () => {
        expect(kinds("90-93°C -- plus chaud")).toEqual([
            ["NUMBER", "90"],
            ["DASH", "-"],
            ["NUMBER", "93"],
            ["UNIT", "°C"],
            ["COMMENT", "-- plus chaud"],
            ["EOF", ""],
        ]);
    });

    test("symbols inside a comment are not tokens", () => {
        expect(kinds("-- @V60 +60g ~15s /swirl #1")).toEqual([
            ["COMMENT", "-- @V60 +60g ~15s /swirl #1"],
            ["EOF", ""],
        ]);
    });

    test("empty comment", () => {
        expect(kinds("--")).toEqual([
            ["COMMENT", "--"],
            ["EOF", ""],
        ]);
    });

    test("comment positions", () => {
        expect(positions("15g -- note\ngrind")).toEqual([
            ["NUMBER", 1, 1],
            ["UNIT", 1, 3],
            ["COMMENT", 1, 5],
            ["NEWLINE", 1, 12],
            ["WORD", 2, 1],
            ["EOF", 2, 6],
        ]);
    });
});

describe("time", () => {
    test("step start", () => {
        expect(kinds("0:45")).toEqual([
            ["TIME", "0:45"],
            ["EOF", ""],
        ]);
    });

    test("minutes with several digits", () => {
        expect(kinds("12:30")).toEqual([
            ["TIME", "12:30"],
            ["EOF", ""],
        ]);
    });

    test("pour step", () => {
        expect(kinds("0:45 150g ~15s spiral")).toEqual([
            ["TIME", "0:45"],
            ["NUMBER", "150"],
            ["UNIT", "g"],
            ["TILDE", "~"],
            ["NUMBER", "15"],
            ["UNIT", "s"],
            ["WORD", "spiral"],
            ["EOF", ""],
        ]);
    });

    test("action step", () => {
        expect(kinds("2:00 /swirl")).toEqual([
            ["TIME", "2:00"],
            ["ACTION", "/swirl"],
            ["EOF", ""],
        ]);
    });

    test("additive pour", () => {
        expect(kinds("1:30 +60g")).toEqual([
            ["TIME", "1:30"],
            ["PLUS", "+"],
            ["NUMBER", "60"],
            ["UNIT", "g"],
            ["EOF", ""],
        ]);
    });

    test("target", () => {
        expect(kinds("target 3:00")).toEqual([
            ["WORD", "target"],
            ["TIME", "3:00"],
            ["EOF", ""],
        ]);
    });

    test("seconds are not checked by the lexer", () => {
        expect(kinds("0:75")).toEqual([
            ["TIME", "0:75"],
            ["EOF", ""],
        ]);
    });

    test("time positions", () => {
        expect(positions("0:00 50g\n0:45 150g")).toEqual([
            ["TIME", 1, 1],
            ["NUMBER", 1, 6],
            ["UNIT", 1, 8],
            ["NEWLINE", 1, 9],
            ["TIME", 2, 1],
            ["NUMBER", 2, 6],
            ["UNIT", 2, 9],
            ["EOF", 2, 10],
        ]);
    });

    test("seconds need two digits", () => {
        expect(errors("0:5")).toEqual([
            ["error", "Time must have two digits after ':'", 1, 4],
        ]);
    });

    test("seconds are required", () => {
        expect(errors("0: 50g")).toEqual([
            ["error", "Time must have two digits after ':'", 1, 3],
        ]);
    });

    test("seconds have at most two digits", () => {
        expect(errors("0:450")).toEqual([
            ["error", "Time must have two digits after ':'", 1, 5],
        ]);
    });

    test("a bad time is a single ERROR token", () => {
        expect(kinds("0:5 50g")).toEqual([
            ["ERROR", "0:5"],
            ["NUMBER", "50"],
            ["UNIT", "g"],
            ["EOF", ""],
        ]);
        expect(kinds("0:450")).toEqual([
            ["ERROR", "0:450"],
            ["EOF", ""],
        ]);
        expect(kinds("0: 50g")).toEqual([
            ["ERROR", "0:"],
            ["NUMBER", "50"],
            ["UNIT", "g"],
            ["EOF", ""],
        ]);
    });

    test("a time has no decimal part", () => {
        expect(errors("0.5:00")).toEqual([
            ["error", "Unexpected character ':'", 1, 4],
        ]);
    });

    test("a time starts with a digit", () => {
        expect(errors(":45")).toEqual([
            ["error", "Unexpected character ':'", 1, 1],
        ]);
    });
});

describe("frontmatter", () => {
    test("simple block", () => {
        expect(kinds("---\ntitle: V60 Guji\n---")).toEqual([
            ["FRONTMATTER", "---\ntitle: V60 Guji\n---"],
            ["EOF", ""],
        ]);
    });

    test("followed by the header", () => {
        expect(kinds("---\ntitle: V60\n---\n\n@V60 15g")).toEqual([
            ["FRONTMATTER", "---\ntitle: V60\n---"],
            ["NEWLINE", "\n"],
            ["NEWLINE", "\n"],
            ["BREWER", "@V60"],
            ["NUMBER", "15"],
            ["UNIT", "g"],
            ["EOF", ""],
        ]);
    });

    test("YAML is not split into tokens", () => {
        expect(kinds("---\nbean: ethiopie-guji\nversion: 1\nfilter: paper\n---")).toEqual([
            ["FRONTMATTER", "---\nbean: ethiopie-guji\nversion: 1\nfilter: paper\n---"],
            ["EOF", ""],
        ]);
    });

    test("empty block", () => {
        expect(kinds("---\n---")).toEqual([
            ["FRONTMATTER", "---\n---"],
            ["EOF", ""],
        ]);
    });

    test("CRLF", () => {
        expect(kinds("---\r\ntitle: V60\r\n---\r\n@V60")).toEqual([
            ["FRONTMATTER", "---\r\ntitle: V60\r\n---"],
            ["NEWLINE", "\n"],
            ["BREWER", "@V60"],
            ["EOF", ""],
        ]);
    });

    test("frontmatter positions", () => {
        expect(positions("---\ntitle: V60\n---\n@V60")).toEqual([
            ["FRONTMATTER", 1, 1],
            ["NEWLINE", 3, 4],
            ["BREWER", 4, 1],
            ["EOF", 4, 5],
        ]);
    });

    test("'---' later in the file is a comment", () => {
        expect(kinds("@V60 15g\n---")).toEqual([
            ["BREWER", "@V60"],
            ["NUMBER", "15"],
            ["UNIT", "g"],
            ["NEWLINE", "\n"],
            ["COMMENT", "---"],
            ["EOF", ""],
        ]);
    });

    test("'--- note' at the start is a comment", () => {
        expect(kinds("--- note\n@V60")).toEqual([
            ["COMMENT", "--- note"],
            ["NEWLINE", "\n"],
            ["BREWER", "@V60"],
            ["EOF", ""],
        ]);
    });

    test("unclosed block", () => {
        expect(errors("---\ntitle: V60\n\n@V60 15g")).toEqual([
            ["error", "Unclosed metadata block. Add a line with '---' to close it.", 1, 1],
        ]);
    });

    test("an unclosed block takes the rest of the file", () => {
        expect(kinds("---\ntitle: V60\n\n@V60 15g")).toEqual([
            ["ERROR", "---\ntitle: V60\n\n@V60 15g"],
            ["EOF", ""],
        ]);
    });

    test("'--- fin' does not close the block", () => {
        expect(errors("---\ntitle: V60\n--- fin")).toEqual([
            ["error", "Unclosed metadata block. Add a line with '---' to close it.", 1, 1],
        ]);
    });
});

describe("whitespace", () => {
    test("tabs separate tokens", () => {
        expect(kinds("@V60\t15g\t94°C")).toEqual([
            ["BREWER", "@V60"],
            ["NUMBER", "15"],
            ["UNIT", "g"],
            ["NUMBER", "94"],
            ["UNIT", "°C"],
            ["EOF", ""],
        ]);
    });

    test("a tab counts as one column", () => {
        expect(positions("15g\t94°C")).toEqual([
            ["NUMBER", 1, 1],
            ["UNIT", 1, 3],
            ["NUMBER", 1, 5],
            ["UNIT", 1, 7],
            ["EOF", 1, 9],
        ]);
    });
});

test("canonical recipes: V60 Guji", () => {
    const source = [
        "---",
        "title: V60 Guji",
        "bean: ethiopie-guji",
        "version: 1",
        "---",
        "",
        "@V60 15g 94°C",
        "grind medium-fine",
        "",
        "/rinse",
        "/level-bed",
        "0:00 50g ~10s bloom center",
        "0:45 150g ~15s spiral",
        "90°C",
        "1:30 250g ~20s center",
        "2:00 /swirl",
        "",
        "target 3:00",
    ].join("\n");

    const { tokens, diagnostics } = lex(source);
    expect(diagnostics).toEqual([]);
    expect(tokens[0]?.kind).toBe("FRONTMATTER");
    expect(tokens.at(-1)?.kind).toBe("EOF");
});
