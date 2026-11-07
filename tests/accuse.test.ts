import { describe, expect, it } from 'vitest';
import { advanceTo, setupGame, wardStatus } from './helpers';

const fail = (reason: string) => ({ ok: false, reason });
const OK = { ok: true };

describe('accuse: верное обвинение', () => {
  it('саботажник разоблачён, его случай отменён, цель жива, спасатель победил', () => {
    const game = setupGame({ saboteurs: ['w1'] });
    advanceTo(game, 10_000);
    game.startIncident('w1', 'w2');
    advanceTo(game, 12_000);
    game.drainEvents();

    expect(game.accuse('w1')).toEqual(OK);
    expect(game.drainEvents()).toEqual([
      { type: 'saboteur_caught', t: 12_000, wardId: 'w1' },
      { type: 'incident_cancelled', t: 12_000, wardId: 'w2' },
      { type: 'game_over', t: 12_000, winner: 'rescuer', reason: 'saboteur_caught' },
    ]);
    expect(game.getPublicState()).toMatchObject({
      incidents: [],
      deaths: 0,
      isOver: true,
      winner: 'rescuer',
      endReason: 'saboteur_caught',
      saboteurIds: ['w1'],
    });
    expect(wardStatus(game, 'w1')).toBe('caught');

    // Отменённый случай никого не убивает: время после конца игры стоит.
    game.update(10_000);
    expect(game.time).toBe(12_000);
    expect(wardStatus(game, 'w2')).toBe('alive');
  });

  it('при нескольких саботажниках игра идёт, пока разоблачены не все', () => {
    const game = setupGame({ saboteurs: ['w1', 'w2'] });
    advanceTo(game, 10_000);
    game.startIncident('w1', 'w3');
    game.startIncident('w2', 'w4');

    expect(game.accuse('w1')).toEqual(OK);
    let state = game.getPublicState();
    expect(state.isOver).toBe(false);
    expect(state.incidents.map((i) => i.wardId)).toEqual(['w4']);
    expect(state.saboteurIds).toBeNull();

    expect(game.accuse('w2')).toEqual(OK);
    state = game.getPublicState();
    expect(state).toMatchObject({ isOver: true, winner: 'rescuer', saboteurIds: ['w1', 'w2'] });
  });
});

describe('accuse: неверное обвинение', () => {
  it('увеличивает счётчик; на wrongAccusationsToLose побеждают саботажники', () => {
    const game = setupGame({ saboteurs: ['w1'] });

    expect(game.accuse('w2')).toEqual(OK);
    expect(game.getPublicState()).toMatchObject({ wrongAccusations: 1, isOver: false });
    expect(game.getPublicState().wards[1]).toEqual({ id: 'w2', status: 'alive', accused: true });

    expect(game.accuse('w3')).toEqual(OK);
    expect(game.getPublicState()).toMatchObject({
      wrongAccusations: 2,
      isOver: true,
      winner: 'saboteurs',
      endReason: 'too_many_wrong_accusations',
    });
    expect(game.drainEvents()).toEqual([
      { type: 'wrong_accusation', t: 0, wardId: 'w2' },
      { type: 'wrong_accusation', t: 0, wardId: 'w3' },
      { type: 'game_over', t: 0, winner: 'saboteurs', reason: 'too_many_wrong_accusations' },
    ]);
  });

  it('не отменяет несчастный случай на обвинённом', () => {
    const game = setupGame({ saboteurs: ['w1'] });
    advanceTo(game, 10_000);
    game.startIncident('w1', 'w2');

    expect(game.accuse('w2')).toEqual(OK);
    expect(game.getPublicState().incidents.map((i) => i.wardId)).toEqual(['w2']);
  });
});

describe('accuse: отказы', () => {
  it('повторное обвинение не засчитывается', () => {
    const game = setupGame({ saboteurs: ['w1'], balance: { wrongAccusationsToLose: 3 } });
    game.accuse('w2');
    game.drainEvents();

    expect(game.accuse('w2')).toEqual(fail('already_accused'));
    expect(game.getPublicState().wrongAccusations).toBe(1);
    expect(game.drainEvents()).toEqual([]);
  });

  it('повторное обвинение разоблачённого саботажника → already_accused', () => {
    const game = setupGame({ saboteurs: ['w1', 'w2'] });
    game.accuse('w1');
    expect(game.accuse('w1')).toEqual(fail('already_accused'));
  });

  it('погибшего обвинить нельзя, счётчик не растёт', () => {
    const game = setupGame({ saboteurs: ['w1'] });
    advanceTo(game, 10_000);
    game.startIncident('w1', 'w2');
    advanceTo(game, 18_000);

    expect(game.accuse('w2')).toEqual(fail('ward_not_alive'));
    expect(game.getPublicState().wrongAccusations).toBe(0);
  });

  it('неизвестный подопечный → unknown_ward', () => {
    const game = setupGame({ saboteurs: ['w1'] });
    expect(game.accuse('w0')).toEqual(fail('unknown_ward'));
    expect(game.getPublicState().wrongAccusations).toBe(0);
  });
});
