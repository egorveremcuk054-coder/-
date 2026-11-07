import { afterEach, describe, expect, it, vi } from 'vitest';
import { Game } from '../src/game';
import { createSeededRng } from '../src/rng';
import { oneStep, randomScript, runScript } from './helpers';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('детерминизм', () => {
  it('один и тот же генератор и те же действия дают ту же партию', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const script = randomScript(seed);
      expect(runScript(seed, script, oneStep)).toEqual(runScript(seed, script, oneStep));
    }
  });

  it('с разными генераторами партии различаются', () => {
    const script = randomScript(1);
    const outcomes = new Set<string>();
    for (let seed = 1; seed <= 30; seed++) {
      const run = runScript(seed, script, oneStep);
      outcomes.add(JSON.stringify([run.final.saboteurIds, run.events]));
    }
    expect(outcomes.size).toBeGreaterThan(1);
  });

  it('createSeededRng воспроизводим и возвращает числа из [0, 1)', () => {
    const a = createSeededRng(42);
    const b = createSeededRng(42);
    for (let i = 0; i < 1_000; i++) {
      const value = a();
      expect(value).toBe(b());
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it('игра не обращается к Math.random, Date.now и таймерам', () => {
    const random = vi.spyOn(Math, 'random');
    const now = vi.spyOn(Date, 'now');
    // В tsconfig нет типов DOM и Node, поэтому таймеры описываем сами.
    const timers = globalThis as unknown as Record<'setTimeout' | 'setInterval', (...args: unknown[]) => unknown>;
    const timeout = vi.spyOn(timers, 'setTimeout');
    const interval = vi.spyOn(timers, 'setInterval');

    const game = new Game({ rng: createSeededRng(3) });
    for (const id of ['w1', 'w2', 'w3', 'w4', 'w5', 'w6', 'w7', 'w8']) {
      game.update(5_000);
      game.startIncident(id, 'w1');
      game.startIncident(id, 'w2');
      game.rescue('w1');
      game.getPublicState();
    }
    game.accuse('w4');
    game.update(400_000);
    game.drainEvents();

    expect(random).not.toHaveBeenCalled();
    expect(now).not.toHaveBeenCalled();
    expect(timeout).not.toHaveBeenCalled();
    expect(interval).not.toHaveBeenCalled();
  });
});
