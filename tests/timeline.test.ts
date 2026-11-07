import { describe, expect, it } from 'vitest';
import type { Balance } from '../src/balance';
import { Game } from '../src/game';
import { createSeededRng } from '../src/rng';
import type { GameEvent } from '../src/types';
import {
  advanceTo,
  fixedSteps,
  oneStep,
  randomScript,
  randomSteps,
  runScript,
  setupGame,
  wardStatus,
} from './helpers';

describe('время', () => {
  it('game.time равно сумме всех dtMs', () => {
    const game = new Game({ rng: createSeededRng(1) });
    game.update(1);
    game.update(2.5);
    game.update(0);
    game.update(1_000);
    expect(game.time).toBe(1_003.5);
    expect(game.getPublicState().timeLeftMs).toBe(300_000 - 1_003.5);
  });

  it.each([-1, Number.NaN, Number.POSITIVE_INFINITY])('update(%s) → RangeError, время не меняется', (dt) => {
    const game = new Game({ rng: createSeededRng(1) });
    game.update(500);
    expect(() => game.update(dt)).toThrow(RangeError);
    expect(game.time).toBe(500);
  });

  it('раунд заканчивается победой спасателя ровно в roundDurationMs', () => {
    const game = setupGame({ saboteurs: ['w1'] });
    advanceTo(game, 299_999);
    expect(game.getPublicState().isOver).toBe(false);

    game.update(1);
    expect(game.getPublicState()).toMatchObject({
      time: 300_000,
      timeLeftMs: 0,
      isOver: true,
      winner: 'rescuer',
      endReason: 'time_up',
      saboteurIds: ['w1'],
    });
    expect(game.drainEvents()).toEqual([{ type: 'game_over', t: 300_000, winner: 'rescuer', reason: 'time_up' }]);
  });

  it('после конца игры время стоит, update ничего не делает, действия → game_over', () => {
    const game = setupGame({ saboteurs: ['w1'] });
    game.update(500_000);
    expect(game.time).toBe(300_000);
    game.drainEvents();
    const before = game.getPublicState();

    game.update(1_000);
    expect(game.time).toBe(300_000);
    expect(game.startIncident('w1', 'w2')).toEqual({ ok: false, reason: 'game_over' });
    expect(game.rescue('w2')).toEqual({ ok: false, reason: 'game_over' });
    expect(game.accuse('w1')).toEqual({ ok: false, reason: 'game_over' });
    expect(game.accuse('w99')).toEqual({ ok: false, reason: 'game_over' });
    expect(game.getPublicState()).toEqual(before);
    expect(game.drainEvents()).toEqual([]);
  });

  it('смерть посреди большого шага, решающая исход, останавливает время в момент смерти', () => {
    const game = setupGame({ saboteurs: ['w1'], balance: { deathsToLose: 1 } });
    advanceTo(game, 10_000);
    game.startIncident('w1', 'w2');

    game.update(60_000);
    expect(game.time).toBe(18_000);
    expect(game.getPublicState()).toMatchObject({ winner: 'saboteurs', endReason: 'too_many_deaths' });
  });
});

describe('порядок событий в один момент', () => {
  /** Случай начинается так, чтобы цель погибла ровно в конце раунда. */
  function deathAtRoundEnd(balance: Partial<Balance>): { game: Game; events: GameEvent[] } {
    const game = setupGame({ saboteurs: ['w1'], balance });
    advanceTo(game, 292_000);
    game.startIncident('w1', 'w2');
    game.drainEvents();
    game.update(8_000);
    return { game, events: game.drainEvents() };
  }

  it('смерть в момент конца раунда обрабатывается раньше: если она решающая — побеждают саботажники', () => {
    const { game, events } = deathAtRoundEnd({ deathsToLose: 1 });
    expect(events).toEqual([
      { type: 'ward_died', t: 300_000, wardId: 'w2' },
      { type: 'game_over', t: 300_000, winner: 'saboteurs', reason: 'too_many_deaths' },
    ]);
    expect(game.time).toBe(300_000);
  });

  it('если смерть не решающая — сначала ward_died, потом конец по времени', () => {
    const { game, events } = deathAtRoundEnd({});
    expect(events).toEqual([
      { type: 'ward_died', t: 300_000, wardId: 'w2' },
      { type: 'game_over', t: 300_000, winner: 'rescuer', reason: 'time_up' },
    ]);
    expect(game.getPublicState().deaths).toBe(1);
  });

  it('случай, который не успел закончиться до конца раунда, никого не убивает', () => {
    const game = setupGame({ saboteurs: ['w1'] });
    advanceTo(game, 295_000);
    game.startIncident('w1', 'w2');
    game.update(100_000);

    expect(wardStatus(game, 'w2')).toBe('alive');
    expect(game.getPublicState()).toMatchObject({ deaths: 0, winner: 'rescuer', endReason: 'time_up' });
  });

  it('одновременные смерти идут в порядке начала случаев', () => {
    const game = setupGame({ saboteurs: ['w1', 'w2'] });
    advanceTo(game, 10_000);
    game.startIncident('w2', 'w5');
    game.startIncident('w1', 'w3');
    game.drainEvents();

    game.update(8_000);
    expect(game.drainEvents()).toEqual([
      { type: 'ward_died', t: 18_000, wardId: 'w5' },
      { type: 'ward_died', t: 18_000, wardId: 'w3' },
    ]);
  });

  it('игра заканчивается на первой решающей смерти, даже если в тот же момент гибнет ещё кто-то', () => {
    const game = setupGame({ saboteurs: ['w1', 'w2'], balance: { deathsToLose: 1 } });
    advanceTo(game, 10_000);
    game.startIncident('w1', 'w3');
    game.startIncident('w2', 'w4');
    game.drainEvents();

    game.update(8_000);
    expect(game.drainEvents()).toEqual([
      { type: 'ward_died', t: 18_000, wardId: 'w3' },
      { type: 'game_over', t: 18_000, winner: 'saboteurs', reason: 'too_many_deaths' },
    ]);
    expect(wardStatus(game, 'w4')).toBe('alive');
  });

  it('смерти в разные моменты внутри одного шага идут в хронологическом порядке', () => {
    const game = setupGame({ saboteurs: ['w1', 'w2'], balance: { sabotageCooldownMs: 1_000 } });
    advanceTo(game, 10_000);
    game.startIncident('w1', 'w3'); // гибнет в 18 000
    advanceTo(game, 11_000);
    game.startIncident('w1', 'w4'); // гибнет в 19 000
    advanceTo(game, 11_500);
    game.startIncident('w2', 'w5'); // гибнет в 19 500
    game.drainEvents();

    game.update(30_000);
    expect(game.drainEvents()).toEqual([
      { type: 'ward_died', t: 18_000, wardId: 'w3' },
      { type: 'ward_died', t: 19_000, wardId: 'w4' },
      { type: 'ward_died', t: 19_500, wardId: 'w5' },
      { type: 'game_over', t: 19_500, winner: 'saboteurs', reason: 'too_many_deaths' },
    ]);
    expect(game.time).toBe(19_500);
  });
});

describe('большой шаг времени', () => {
  it('update(60_000) даёт тот же итог, что 60 вызовов update(1000)', () => {
    const play = (step: (game: Game) => void) => {
      const game = setupGame({ saboteurs: ['w1', 'w2'], kinds: ['fire', 'flood', 'fall'] });
      advanceTo(game, 10_000);
      game.startIncident('w1', 'w3');
      game.startIncident('w2', 'w4');
      game.rescue('w4');
      step(game);
      game.startIncident('w1', 'w5');
      return { events: game.drainEvents(), state: game.getPublicState() };
    };

    const big = play((game) => game.update(60_000));
    const small = play((game) => {
      for (let i = 0; i < 60; i++) game.update(1_000);
    });

    expect(big).toEqual(small);
    expect(big.state.time).toBe(70_000);
    expect(big.events.map((e) => e.type)).toEqual([
      'incident_started',
      'incident_started',
      'incident_rescued',
      'ward_died',
      'incident_started',
    ]);
  });

  const busyBalance: Partial<Balance> = {
    saboteurCount: 3,
    initialSabotageDelayMs: 0,
    sabotageCooldownMs: 1_000,
    incidentWindowMs: 1_500,
    rescueCooldownMs: 700,
    deathsToLose: 4,
    roundDurationMs: 60_000,
  };

  it.each([
    ['баланс по умолчанию', {}],
    ['частые случаи, три саботажника', busyBalance],
  ] as const)('случайные сценарии (%s): шаги любой длины дают одну и ту же партию', (_name, balance) => {
    const eventTypes = new Set<string>();
    const endReasons = new Set<string>();

    for (let seed = 1; seed <= 150; seed++) {
      const script = randomScript(seed, balance);
      const reference = runScript(seed, script, oneStep, balance);

      expect(runScript(seed, script, fixedSteps(1_000), balance)).toEqual(reference);
      expect(runScript(seed, script, randomSteps(seed, 700), balance)).toEqual(reference);
      if (seed <= 10) {
        // Шаг в 1 мс — самый медленный вариант, поэтому только на части сценариев.
        expect(runScript(seed, script, fixedSteps(1), balance)).toEqual(reference);
      }

      reference.events.forEach((e) => eventTypes.add(e.type));
      endReasons.add(reference.final.endReason ?? 'none');
    }

    // Сценарии действительно проверяют разные ситуации, а не пустую игру.
    expect([...eventTypes].sort()).toEqual(
      expect.arrayContaining(['game_over', 'incident_rescued', 'incident_started', 'ward_died']),
    );
    expect(endReasons.has('none')).toBe(false);
    expect(endReasons.size).toBeGreaterThan(1);
  });
});
