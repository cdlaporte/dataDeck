import type { Engine } from './Engine';

let current: Engine | null = null;

/** The live engine (owned by <Stage/>), for actions that need it (snapshots, t-SNE controls). */
export function getEngine(): Engine | null {
  return current;
}

export function setEngine(engine: Engine | null) {
  current = engine;
}
