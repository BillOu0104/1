import { hashSeed } from '../physics/random';

export type SeedMode = 'random' | 'fixed';
let nonce = 0;
/** Fresh entropy per round. Never persisted as the next startup's random input. */
export function createRandomSeed(): string {
  const words = crypto.getRandomValues(new Uint32Array(4));
  return `random-${Array.from(words, (v) => v.toString(16).padStart(8, '0')).join('')}-${++nonce}`;
}
export function nextRoundSeed(seed: string, mode: SeedMode): string {
  return mode === 'random' ? createRandomSeed() : String(hashSeed(`${seed}:next`));
}
