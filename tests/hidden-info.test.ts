import { describe, expect, it } from 'vitest';
import type { Game } from '../src/game';
import { advanceTo, setupGame } from './helpers';

/** Одна и та же партия, но саботажник — разный подопечный. Возвращает всё, что видит спасатель. */
function playAs(saboteur: string) {
  const game = setupGame({ saboteurs: [saboteur], kinds: ['fire', 'flood'] });
  const seen: unknown[] = [];
  const record = (g: Game) => seen.push({ state: g.getPublicState(), events: g.drainEvents() });

  record(game);
  advanceTo(game, 10_000);
  game.startIncident(saboteur, 'w3');
  record(game);
  advanceTo(game, 12_000);
  game.rescue('w3');
  record(game);
  advanceTo(game, 30_000);
  game.startIncident(saboteur, 'w4');
  record(game);
  game.accuse('w5'); // неверное обвинение в обоих вариантах
  record(game);
  advanceTo(game, 38_000); // w4 погибает
  record(game);
  return { game, seen };
}

describe('скрытая информация', () => {
  it('пока игра идёт, спасатель видит одно и то же, кто бы ни был саботажником', () => {
    const asW1 = playAs('w1');
    const asW2 = playAs('w2');

    expect(asW1.seen).toEqual(asW2.seen);
    expect(asW1.game.getPublicState().isOver).toBe(false);
  });

  it('после конца игры саботажники раскрываются', () => {
    const asW1 = playAs('w1');
    const asW2 = playAs('w2');
    asW1.game.update(300_000);
    asW2.game.update(300_000);

    expect(asW1.game.getPublicState().saboteurIds).toEqual(['w1']);
    expect(asW2.game.getPublicState().saboteurIds).toEqual(['w2']);
  });

  it('несчастный случай в публичном состоянии не содержит саботажника', () => {
    const game = setupGame({ saboteurs: ['w7'] });
    advanceTo(game, 10_000);
    game.startIncident('w7', 'w2');

    const state = game.getPublicState();
    expect(state.saboteurIds).toBeNull();
    expect(state.incidents).toHaveLength(1);
    expect(Object.keys(state.incidents[0] ?? {}).sort()).toEqual(['kind', 'remainingMs', 'startedAt', 'wardId']);
    // Саботажник выглядит как обычный подопечный.
    expect(state.wards[6]).toEqual({ id: 'w7', status: 'alive', accused: false });
  });

  it('публичное состояние — копия: его изменение не влияет на игру', () => {
    const game = setupGame({ saboteurs: ['w1'] });
    advanceTo(game, 10_000);
    game.startIncident('w1', 'w2');

    const state = game.getPublicState() as unknown as {
      wards: { status: string }[];
      incidents: unknown[];
      deaths: number;
    };
    (state.wards[1] as { status: string }).status = 'dead';
    state.incidents.length = 0;
    state.deaths = 99;

    const fresh = game.getPublicState();
    expect(fresh.wards[1]?.status).toBe('alive');
    expect(fresh.incidents).toHaveLength(1);
    expect(fresh.deaths).toBe(0);
  });

  it('drainEvents отдаёт события один раз', () => {
    const game = setupGame({ saboteurs: ['w1'] });
    game.accuse('w2');
    expect(game.drainEvents()).toHaveLength(1);
    expect(game.drainEvents()).toEqual([]);
  });
});
