// The version on this branch.
export interface Order {
  qty: number;
  tier: "gold" | "silver" | "none";
}

export function computeVat(cents: number, rate: number): number {
  return Math.round(cents * rate);
}

export function roundHalfEven(value: number): number {
  const floor = Math.floor(value);
  const diff = value - floor;
  if (diff > 0.5) return floor + 1;
  if (diff < 0.5) return floor;
  return floor % 2 === 0 ? floor : floor + 1;
}

export function bulkRate(order: Order): number {
  if (order.tier === "gold" && order.qty >= 100) return 0.8;
  if (order.tier === "silver" && order.qty > 100) return 0.9;
  return 1;
}

export function applyDiscount(cents: number, rate: number): number {
  return Math.round(cents * rate);
}
