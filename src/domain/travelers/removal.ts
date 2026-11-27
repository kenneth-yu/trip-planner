export interface BlockingItem {
  id: string;
  title: string;
  flightNumber: string | null;
  hasSeat: boolean;
}

export type RefusalSegment = { text: string } | { item: { id: string; label: string } };

const LISTED_WHEN_LONG = 2;
const SHOWN_IN_FULL = 3;

function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? name;
}

function link(item: BlockingItem): RefusalSegment {
  return { item: { id: item.id, label: item.title } };
}

function joined(items: BlockingItem[]): RefusalSegment[] {
  return items.flatMap((item, i): RefusalSegment[] => {
    if (i === 0) return [link(item)];
    return [{ text: i === items.length - 1 ? " and " : ", " }, link(item)];
  });
}

export function removalRefusal(travelerName: string, visible: BlockingItem[]): RefusalSegment[] {
  const only = visible.length === 1 ? visible[0] : undefined;
  if (only?.hasSeat && only.flightNumber) {
    return [{ text: `${firstName(travelerName)}'s seat is on ` }, { item: { id: only.id, label: only.flightNumber } }, { text: ". Remove it from that flight first." }];
  }
  if (visible.length === 0) return [{ text: `${travelerName} is still on something on this trip. Ask whoever added it to take them off.` }];
  if (visible.length === 1) return [{ text: `${travelerName} is on ` }, ...joined(visible), { text: ". Take them off it first." }];
  if (visible.length <= SHOWN_IN_FULL) return [{ text: `${travelerName} is on ` }, ...joined(visible), { text: ". Take them off those first." }];
  const listed = visible.slice(0, LISTED_WHEN_LONG).flatMap((item, i): RefusalSegment[] => (i === 0 ? [link(item)] : [{ text: ", " }, link(item)]));
  return [{ text: `${travelerName} is on ` }, ...listed, { text: ` and ${visible.length - LISTED_WHEN_LONG} more. Take them off those first.` }];
}
