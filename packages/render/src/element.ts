import type { RenderOptions } from "./index.js";
import { render } from "./index.js";

/// '°F', 'F', 'fahrenheit' -> '°F'
function tempUnit(temp: string | null): RenderOptions["temp"] {
  const letter = temp?.replace(/^°/, "").charAt(0).toUpperCase();
  return letter === "C" ? "°C" : letter === "F" ? "°F" : undefined;
}

/**
 * A recipe card: `<brew-recipe src="chemex.brew"></brew-recipe>`, or the recipe as the element's text.
 * Attributes: `scale` (2 doubles it), `weight` (g or oz), `temp` (°C or °F), `heading` (the title when the
 * recipe has none), `theme` (light or dark).
 * The card is rendered in the page, not in a shadow root: style it with brew.css and its --brew-* variables.
 */
export class BrewRecipeElement extends HTMLElement {
  static observedAttributes = ["src", "scale", "weight", "temp", "heading", "theme"];

  #source: string | undefined;
  #loaded: string | null = null; // The src last fetched

  /** The .brew text shown; setting it renders the card again. */
  get source() {
    return this.#source ?? "";
  }
  set source(text: string) {
    this.#source = text;
    this.#render();
  }

  connectedCallback() {
    // Inline text is read once, before the card replaces it
    if (this.#source === undefined && !this.hasAttribute("src")) this.#source = this.textContent ?? "";
    this.#update();
  }

  attributeChangedCallback() {
    if (this.isConnected) this.#update();
  }

  async #update() {
    const src = this.getAttribute("src");
    if (src && src !== this.#loaded) {
      this.#loaded = src;
      try {
        const response = await fetch(src);
        if (!response.ok) throw new Error(`${response.status}`);
        this.#source = await response.text();
      } catch {
        this.textContent = `Could not load ${src}`;
        return;
      }
    }
    this.#render();
  }

  #render() {
    if (this.#source === undefined) return;

    const options: RenderOptions = {};
    const factor = Number(this.getAttribute("scale"));
    if (factor > 0) options.factor = factor;
    const weight = this.getAttribute("weight");
    if (weight === "g" || weight === "oz") options.weight = weight;
    const temp = tempUnit(this.getAttribute("temp"));
    if (temp) options.temp = temp;
    const heading = this.getAttribute("heading");
    if (heading) options.title = heading;
    const theme = this.getAttribute("theme");
    if (theme === "light" || theme === "dark") options.theme = theme;

    const { html, diagnostics } = render(this.#source, options);
    this.innerHTML = html;
    this.toggleAttribute("invalid", diagnostics.some((d) => d.severity === "error"));
    this.dispatchEvent(new CustomEvent("brew-render", { detail: { diagnostics } }));
  }
}

if (!customElements.get("brew-recipe")) customElements.define("brew-recipe", BrewRecipeElement);
