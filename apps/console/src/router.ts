import { useSyncExternalStore } from "react";

/**
 * Hash routing, read from the URL rather than mirrored into state. The
 * location is external state, so it is subscribed to with
 * useSyncExternalStore - not copied into a ref by an effect.
 */

export const ROUTES = [
  { id: "run", title: "Run", hash: "#/run" },
  { id: "verdicts", title: "Verdicts", hash: "#/verdicts" },
  { id: "attestations", title: "Attestations", hash: "#/attestations" },
  { id: "release", title: "Release evidence", hash: "#/release" },
  { id: "export", title: "Audit export", hash: "#/export" },
] as const;

export type RouteId = (typeof ROUTES)[number]["id"];
export const DEFAULT_ROUTE: RouteId = "run";

function isRouteId(value: string): value is RouteId {
  return ROUTES.some((route) => route.id === value);
}

function parse(hash: string): RouteId {
  const id = hash.replace(/^#\/?/, "");
  return isRouteId(id) ? id : DEFAULT_ROUTE;
}

function subscribe(listener: () => void): () => void {
  window.addEventListener("hashchange", listener);
  return () => {
    window.removeEventListener("hashchange", listener);
  };
}

function snapshot(): string {
  return window.location.hash;
}

export function useRoute(): RouteId {
  const hash = useSyncExternalStore(subscribe, snapshot, () => "");
  return parse(hash);
}

export function titleOf(id: RouteId): string {
  return ROUTES.find((route) => route.id === id)?.title ?? "Run";
}
