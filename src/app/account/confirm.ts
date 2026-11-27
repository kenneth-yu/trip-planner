export function confirmationMatches(typed: string, expected: string): boolean {
  const normalise = (value: string) => value.trim().toLowerCase();
  const wanted = normalise(expected);
  return wanted.length > 0 && normalise(typed) === wanted;
}

export function joinNames(names: string[]): string {
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}
