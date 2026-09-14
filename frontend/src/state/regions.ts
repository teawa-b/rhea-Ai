/* Continents / market regions the globe can fly to ("show me Europe"). Only
 * countries in the registry are listed; the camera centre is picked so the
 * region's markets sit in view. */
import type { CountryCode } from "@shared/types";

export type RegionDef = { id: string; name: string; lat: number; lng: number; countries: CountryCode[]; aliases: string[] };

export const REGIONS: RegionDef[] = [
  { id: "europe", name: "Europe", lat: 50.5, lng: 6, countries: ["GB", "IE", "NL", "DE", "FR", "CH", "DK"], aliases: ["europe", "european", "eu", "european union", "western europe", "emea"] },
  { id: "asia", name: "Asia", lat: 28, lng: 108, countries: ["CN", "HK", "TW", "JP", "KR", "IN", "SG"], aliases: ["asia", "asian", "east asia", "apac", "asia pacific", "asia-pacific", "far east"] },
  { id: "greater-china", name: "Greater China", lat: 27, lng: 114, countries: ["CN", "HK", "TW"], aliases: ["greater china", "china region"] },
  { id: "north-america", name: "North America", lat: 45, lng: -100, countries: ["US", "CA"], aliases: ["north america", "north american", "americas", "the americas"] },
  { id: "oceania", name: "Oceania", lat: -25, lng: 140, countries: ["AU"], aliases: ["oceania", "australasia", "pacific"] },
];

export const REGION_BY_ID: Record<string, RegionDef> = Object.fromEntries(REGIONS.map((r) => [r.id, r]));

export function resolveRegion(query: string): RegionDef | undefined {
  const q = query.trim().toLowerCase().replace(/^the\s+/, "").replace(/[.!?]+$/, "");
  if (!q) return undefined;
  return REGIONS.find((r) => r.id === q || r.aliases.includes(q)) ?? REGIONS.find((r) => q.length >= 4 && r.name.toLowerCase().startsWith(q));
}
