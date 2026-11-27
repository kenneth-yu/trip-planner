export interface Transition<S extends string, E extends string> {
  from: S;
  event: E;
  to: S;
  guard?: string;
}

export interface Machine<S extends string, E extends string> {
  name: string;
  title: string;
  initial: S;
  finals: readonly S[];
  transitions: readonly Transition<S, E>[];
}

export class InvalidTransition extends Error {
  constructor(
    readonly machine: string,
    readonly from: string,
    readonly event: string,
  ) {
    super(`${machine}: no transition from ${from} on ${event}.`);
    this.name = "InvalidTransition";
  }
}

export function defineMachine<S extends string, E extends string>(m: Machine<S, E>): Machine<S, E> {
  for (const final of m.finals) {
    if (m.transitions.some((t) => t.from === final)) throw new Error(`${m.name}: final state ${final} has an exit.`);
  }
  const seen = new Set<string>();
  for (const t of m.transitions) {
    const key = `${t.from}|${t.event}`;
    if (seen.has(key)) throw new Error(`${m.name}: ${t.from} has two transitions on ${t.event}.`);
    seen.add(key);
  }
  return m;
}

function find<S extends string, E extends string>(m: Machine<S, E>, from: S, event: E): Transition<S, E> | undefined {
  return m.transitions.find((t) => t.from === from && t.event === event);
}

export function canTransition<S extends string, E extends string>(m: Machine<S, E>, from: S, event: E): boolean {
  return find(m, from, event) !== undefined;
}

export function transition<S extends string, E extends string>(m: Machine<S, E>, from: S, event: E): S {
  const found = find(m, from, event);
  if (!found) throw new InvalidTransition(m.name, from, event);
  return found.to;
}

export function statesOf<S extends string, E extends string>(m: Machine<S, E>): S[] {
  const states = new Set<S>([m.initial, ...m.finals]);
  for (const t of m.transitions) {
    states.add(t.from);
    states.add(t.to);
  }
  return [...states];
}

export function reachableFrom<S extends string, E extends string>(m: Machine<S, E>, start: S): Set<S> {
  const reached = new Set<S>([start]);
  const queue: S[] = [start];
  for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
    for (const t of m.transitions) {
      if (t.from === next && !reached.has(t.to)) {
        reached.add(t.to);
        queue.push(t.to);
      }
    }
  }
  return reached;
}
