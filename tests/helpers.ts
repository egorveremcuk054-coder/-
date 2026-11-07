import { resolveBalance, type Balance } from '../src/balance';
import { Game } from '../src/game';
import { createSeededRng } from '../src/rng';
import type { GameEvent, PublicState, Result, Rng } from '../src/types';

/** Значение генератора, при котором из size вариантов выберется вариант с номером index. */
export function pick(index: number, size: number): number {
  return (index + 0.5) / size;
}

/**
 * Генератор с заранее заданными значениями. Когда они кончаются, отдаёт fallback,
 * а без fallback падает — так тест ловит лишние вызовы генератора.
 */
export function scriptedRng(values: readonly number[], fallback?: number): Rng {
  let index = 0;
  return () => {
    const value = values[index];
    index += 1;
    if (value !== undefined) return value;
    if (fallback !== undefined) return fallback;
    throw new Error(`scriptedRng: значения кончились на вызове №${index}`);
  };
}

/**
 * Игра с заданными саботажниками и (по желанию) заданной последовательностью видов несчастных случаев.
 * Без kinds все случаи получают первый вид из баланса.
 */
export function setupGame(opts: {
  saboteurs: readonly string[];
  kinds?: readonly string[];
  balance?: Partial<Balance>;
}): Game {
  const balance = resolveBalance({ saboteurCount: opts.saboteurs.length, ...opts.balance });
  const pool = Array.from({ length: balance.wardCount }, (_, i) => `w${i + 1}`);
  const values: number[] = [];

  // Повторяем частичную перетасовку из Game и подбираем значения, которые дадут нужных саботажников.
  opts.saboteurs.forEach((id, i) => {
    const position = pool.indexOf(id);
    if (position < i) throw new Error(`setupGame: ${id} нет среди подопечных или он указан дважды`);
    values.push(pick(position - i, pool.length - i));
    pool[position] = pool[i] as string;
    pool[i] = id;
  });

  for (const kind of opts.kinds ?? []) {
    const index = balance.incidentKinds.indexOf(kind);
    if (index < 0) throw new Error(`setupGame: вида ${kind} нет в балансе`);
    values.push(pick(index, balance.incidentKinds.length));
  }

  const fallback = opts.kinds ? undefined : pick(0, balance.incidentKinds.length);
  return new Game({ balance, rng: scriptedRng(values, fallback) });
}

/** Продвигает игру к моменту t одним шагом. */
export function advanceTo(game: Game, t: number): void {
  game.update(t - game.time);
}

export function wardStatus(game: Game, id: string): string | undefined {
  return game.getPublicState().wards.find((w) => w.id === id)?.status;
}

/** Доигрывает партию до конца по времени и возвращает раскрытых саботажников. */
export function revealSaboteurs(game: Game): readonly string[] {
  game.update(Number.MAX_SAFE_INTEGER);
  const ids = game.getPublicState().saboteurIds;
  if (!ids) throw new Error('игра не закончилась');
  return ids;
}

export interface ScriptAction {
  readonly at: number;
  readonly action: 'startIncident' | 'rescue' | 'accuse';
  readonly args: readonly [string] | readonly [string, string];
}

/** Случайный, но воспроизводимый сценарий действий для сравнения разных способов шагать по времени. */
export function randomScript(seed: number, balance: Partial<Balance> = {}): ScriptAction[] {
  const resolved = resolveBalance(balance);
  const rng = createSeededRng(seed ^ 0x5bd1e995);
  const randomWard = () => `w${Math.floor(rng() * resolved.wardCount) + 1}`;
  const actions: ScriptAction[] = [];
  const tick = 250;
  const actionCount = 120;
  let at = 0;
  for (let i = 0; i < actionCount; i++) {
    at += tick * Math.floor(rng() * 12);
    const roll = rng();
    if (roll < 0.55) {
      actions.push({ at, action: 'startIncident', args: [randomWard(), randomWard()] });
    } else if (roll < 0.95) {
      actions.push({ at, action: 'rescue', args: [randomWard()] });
    } else {
      actions.push({ at, action: 'accuse', args: [randomWard()] });
    }
  }
  return actions;
}

export interface RunResult {
  readonly results: Result[];
  readonly events: GameEvent[];
  readonly states: PublicState[];
  readonly final: PublicState;
}

/**
 * Прогоняет сценарий. split(gap) решает, какими шагами update() пройти промежуток между действиями.
 * После каждого действия запоминается публичное состояние.
 */
export function runScript(
  seed: number,
  script: readonly ScriptAction[],
  split: (gap: number) => number[],
  balance: Partial<Balance> = {},
): RunResult {
  const game = new Game({ balance, rng: createSeededRng(seed) });
  const results: Result[] = [];
  const events: GameEvent[] = [];
  const states: PublicState[] = [];
  let clock = 0;

  const advance = (to: number) => {
    for (const dt of split(to - clock)) game.update(dt);
    clock = to;
  };

  for (const step of script) {
    advance(step.at);
    const [a, b] = step.args;
    const result =
      step.action === 'startIncident'
        ? game.startIncident(a, b ?? a)
        : step.action === 'rescue'
          ? game.rescue(a)
          : game.accuse(a);
    results.push(result);
    events.push(...game.drainEvents());
    states.push(game.getPublicState());
  }

  advance(clock + resolveBalance(balance).roundDurationMs);
  events.push(...game.drainEvents());
  return { results, events, states, final: game.getPublicState() };
}

/** Один шаг на весь промежуток. */
export const oneStep = (gap: number): number[] => [gap];

/** Шаги по size миллисекунд и остаток. */
export const fixedSteps =
  (size: number) =>
  (gap: number): number[] => {
    const steps: number[] = [];
    let left = gap;
    while (left > size) {
      steps.push(size);
      left -= size;
    }
    steps.push(left);
    return steps;
  };

/** Шаги случайной целой длины от 0 до maxStep (нулевые шаги тоже проверяем). */
export const randomSteps = (seed: number, maxStep: number) => {
  const rng = createSeededRng(seed);
  return (gap: number): number[] => {
    const steps: number[] = [];
    let left = gap;
    while (left > 0) {
      const dt = Math.min(left, Math.floor(rng() * (maxStep + 1)));
      steps.push(dt);
      left -= dt;
    }
    return steps;
  };
};
