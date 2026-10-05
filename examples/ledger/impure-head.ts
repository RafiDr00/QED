// Functions QED cannot verify, and the reason it gives for each.
export function createOrderId(prefix: string): string {
  // Reads the clock.
  return `${prefix}-${Date.now()}`;
}

export function pickWinner(entrants: string[]): string {
  // Reads the rng.
  return entrants[Math.floor(Math.random() * entrants.length)] ?? "";
}

export function parseConfig(cfg): unknown {
  // No type annotation, so there is nothing to generate from.
  return cfg;
}
