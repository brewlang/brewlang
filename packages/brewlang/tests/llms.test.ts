/// <reference types="vite/client" />
import { describe, test, expect } from "vitest";
import { ACTION_ALIASES, ACTIONS, BREWERS, DOSE_UNITS, GRIND_SIZES, QUALIFIERS, TEMP_UNITS, WATER_UNITS } from "../src/index.js";
import llms from "../../../docs/llms.txt?raw";

// docs/llms.txt describes the language for AI assistants: it must name every closed word and every core action
describe("llms.txt names the whole vocabulary", () => {
    test.each(BREWERS.map((brewer) => `@${brewer.name}`))("%s", (word) => {
        expect(llms).toContain(`\`${word}\``);
    });

    test.each([...Object.keys(ACTIONS), ...Object.keys(ACTION_ALIASES)].map((name) => `/${name}`))("%s", (word) => {
        expect(llms).toContain(`\`${word}\``);
    });

    test.each([...GRIND_SIZES, ...QUALIFIERS])("%s", (word) => {
        expect(llms).toContain(`\`${word}\``);
    });

    test.each([...new Set([...DOSE_UNITS, ...WATER_UNITS, ...TEMP_UNITS])])("%s", (unit) => {
        expect(llms).toContain(`\`${unit}\``);
    });
});
