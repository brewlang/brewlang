/// What a brewer can do; actions are restricted by type, not by brewer
export type BrewerType = "dripper" | "valve" | "aeropress" | "press" | "siphon";

export interface Brewer {
  name: string; // As written after '@'; matched ignoring case
  type: BrewerType;
  valve?: "open" | "closed"; // Starting state of the valve, by convention
}

/// One entry per brewing method, not per product: a V60 is a V60
export const BREWERS: readonly Brewer[] = [
  { name: "V60", type: "dripper" },
  { name: "Kalita", type: "dripper" },
  { name: "Melitta", type: "dripper" },
  { name: "Chemex", type: "dripper" },
  { name: "Origami", type: "dripper" },
  { name: "UFO", type: "dripper" },
  { name: "Phin", type: "dripper" },
  { name: "Switch", type: "valve", valve: "open" },
  { name: "Clever", type: "valve", valve: "closed" }, // Opens only when set on the cup
  { name: "Pulsar", type: "valve", valve: "open" },
  { name: "AeroPress", type: "aeropress" },
  { name: "FrenchPress", type: "press" },
  { name: "Siphon", type: "siphon" },
];

export interface KnownAction {
  types?: readonly BrewerType[]; // Absent = every brewer
}

/// The core vocabulary; any other action is accepted, known ones are checked against the brewer
export const ACTIONS: Readonly<Record<string, KnownAction>> = {
  swirl: {},
  stir: {},
  skim: {}, // Remove the foam and fines floating on top
  wait: {},
  rinse: {},
  "level-bed": {},
  press: { types: ["aeropress", "press"] },
  invert: { types: ["aeropress"] }, // Turn it upside down, for an inverted recipe
  flip: { types: ["aeropress"] }, // Turn it back onto the cup
  open: { types: ["valve"] },
  close: { types: ["valve"] },
  drawdown: { types: ["dripper", "valve"] },
};

/// Other names for core actions, accepted as equivalents
export const ACTION_ALIASES: Readonly<Record<string, string>> = {
  plunge: "press",
};

/// Find a brewer by name, ignoring case: 'aeropress' -> AeroPress
export const findBrewer = (name: string): Brewer | undefined =>
  BREWERS.find((brewer) => brewer.name.toLowerCase() === name.toLowerCase());

/// Find a core action by its name or an alias: 'plunge' -> press
export const findAction = (name: string): KnownAction | undefined =>
  ACTIONS[ACTION_ALIASES[name] ?? name];
