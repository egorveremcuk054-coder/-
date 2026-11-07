import type { Rng } from './types';

/**
 * Детерминированный генератор mulberry32: один и тот же seed даёт одну и ту же последовательность.
 * Это не часть игровой логики, а удобный генератор для тестов и сервера.
 * Константы ниже — параметры алгоритма, а не числа баланса.
 */
export function createSeededRng(seed: number): Rng {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
