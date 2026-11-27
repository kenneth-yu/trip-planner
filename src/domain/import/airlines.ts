const AIRLINES: Record<string, string> = {
  AA: "American",
  AC: "Air Canada",
  AF: "Air France",
  AI: "Air India",
  AS: "Alaska",
  B6: "JetBlue",
  BA: "British Airways",
  CA: "Air China",
  CI: "China Airlines",
  CX: "Cathay Pacific",
  CZ: "China Southern",
  DL: "Delta",
  EK: "Emirates",
  EY: "Etihad",
  HA: "Hawaiian",
  HX: "Hong Kong Airlines",
  JL: "Japan Airlines",
  KE: "Korean Air",
  KL: "KLM",
  LH: "Lufthansa",
  MU: "China Eastern",
  NH: "ANA",
  NZ: "Air New Zealand",
  OZ: "Asiana",
  QF: "Qantas",
  QR: "Qatar Airways",
  SQ: "Singapore Airlines",
  TG: "Thai Airways",
  TK: "Turkish Airlines",
  UA: "United",
  VS: "Virgin Atlantic",
  WN: "Southwest",
};

export function airlineFor(flightNumber: string): string | null {
  const code = flightNumber.replace(/\s/g, "").slice(0, 2).toUpperCase();
  return AIRLINES[code] ?? null;
}
