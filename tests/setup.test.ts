import { describe, expect, it } from 'vitest';
import { defaultBalance, resolveBalance, type Balance } from '../src/balance';
import { Game } from '../src/game';
import { createSeededRng } from '../src/rng';
import { advanceTo, revealSaboteurs, setupGame } from './helpers';

const ALL_WARDS = ['w1', 'w2', 'w3', 'w4', 'w5', 'w6', 'w7', 'w8'];

describe('создание игры', () => {
  it('создаёт подопечных w1..wN: все живы, время 0, никаких событий', () => {
    const game = new Game({ rng: createSeededRng(1) });
    const state = game.getPublicState();

    expect(game.time).toBe(0);
    expect(state.wards).toEqual(ALL_WARDS.map((id) => ({ id, status: 'alive', accused: false })));
    expect(state).toMatchObject({
      time: 0,
      timeLeftMs: 300_000,
      incidents: [],
      deaths: 0,
      wrongAccusations: 0,
      rescueCooldownLeftMs: 0,
      isOver: false,
      winner: null,
      endReason: null,
      saboteurIds: null,
    });
    expect(game.drainEvents()).toEqual([]);
  });

  it('саботажника выбирает переданный генератор', () => {
    const game = setupGame({ saboteurs: ['w3'] });
    advanceTo(game, 10_000);

    for (const id of ALL_WARDS.filter((w) => w !== 'w3')) {
      expect(game.startIncident(id, 'w1')).toEqual({ ok: false, reason: 'not_saboteur' });
    }
    expect(game.startIncident('w3', 'w1')).toEqual({ ok: true });
  });

  it('несколько саботажников выбираются без повторов', () => {
    const game = setupGame({ saboteurs: ['w5', 'w2', 'w8'] });
    expect(revealSaboteurs(game)).toEqual(['w2', 'w5', 'w8']);
  });

  it('при разных seed саботажниками оказываются разные подопечные', () => {
    const seen = new Set<string>();
    for (let seed = 1; seed <= 200; seed++) {
      const ids = revealSaboteurs(new Game({ rng: createSeededRng(seed) }));
      expect(ids).toHaveLength(1);
      seen.add(ids[0] as string);
    }
    expect([...seen].sort()).toEqual(ALL_WARDS);
  });

  it.each([1, 1.5, -0.1, Number.NaN])('генератор вернул %s вместо числа из [0, 1) → RangeError', (value) => {
    expect(() => new Game({ rng: () => value })).toThrow(RangeError);
  });
});

describe('баланс', () => {
  it('значения по умолчанию совпадают с условием задания', () => {
    expect(defaultBalance).toEqual({
      roundDurationMs: 300_000,
      wardCount: 8,
      saboteurCount: 1,
      initialSabotageDelayMs: 10_000,
      sabotageCooldownMs: 20_000,
      incidentWindowMs: 8_000,
      rescueCooldownMs: 3_000,
      deathsToLose: 3,
      wrongAccusationsToLose: 2,
      incidentKinds: ['fall', 'fire', 'flood'],
    });
  });

  it('defaultBalance нельзя случайно изменить', () => {
    expect(Object.isFrozen(defaultBalance)).toBe(true);
    expect(Object.isFrozen(defaultBalance.incidentKinds)).toBe(true);
  });

  it('частичный баланс подставляется поверх значений по умолчанию', () => {
    const game = new Game({
      rng: createSeededRng(7),
      balance: { wardCount: 3, roundDurationMs: 1_000 },
    });
    expect(game.getPublicState().wards.map((w) => w.id)).toEqual(['w1', 'w2', 'w3']);

    game.update(999);
    expect(game.getPublicState().isOver).toBe(false);
    game.update(1);
    expect(game.getPublicState()).toMatchObject({ isOver: true, winner: 'rescuer', endReason: 'time_up' });
  });

  it('поле со значением undefined не затирает значение по умолчанию', () => {
    expect(resolveBalance({ wardCount: undefined }).wardCount).toBe(defaultBalance.wardCount);
  });

  it('изменение переданного массива incidentKinds после создания игры на неё не влияет', () => {
    const kinds = ['slip'];
    const game = setupGame({ saboteurs: ['w1'], balance: { incidentKinds: kinds } });
    kinds[0] = 'changed';

    advanceTo(game, 10_000);
    game.startIncident('w1', 'w2');
    expect(game.getPublicState().incidents[0]?.kind).toBe('slip');
  });

  it.each<[string, Partial<Balance>]>([
    ['один подопечный', { wardCount: 1 }],
    ['дробное число подопечных', { wardCount: 4.5 }],
    ['ноль саботажников', { saboteurCount: 0 }],
    ['все подопечные — саботажники', { saboteurCount: 8 }],
    ['нулевое окно спасения', { incidentWindowMs: 0 }],
    ['нулевая длительность раунда', { roundDurationMs: 0 }],
    ['отрицательный кулдаун саботажника', { sabotageCooldownMs: -1 }],
    ['кулдаун спасателя NaN', { rescueCooldownMs: Number.NaN }],
    ['бесконечная задержка', { initialSabotageDelayMs: Number.POSITIVE_INFINITY }],
    ['deathsToLose = 0', { deathsToLose: 0 }],
    ['дробный wrongAccusationsToLose', { wrongAccusationsToLose: 1.5 }],
    ['пустой список видов', { incidentKinds: [] }],
  ])('некорректный баланс (%s) → RangeError', (_name, balance) => {
    expect(() => new Game({ rng: createSeededRng(1), balance })).toThrow(RangeError);
  });
});
