import { describe, expect, it } from 'vitest';
import { advanceTo, setupGame, wardStatus } from './helpers';

const fail = (reason: string) => ({ ok: false, reason });
const OK = { ok: true };

describe('startIncident: когда можно начать', () => {
  it('раньше initialSabotageDelayMs нельзя, ровно в этот момент — можно', () => {
    const game = setupGame({ saboteurs: ['w1'] });

    expect(game.startIncident('w1', 'w2')).toEqual(fail('too_early'));
    advanceTo(game, 9_999);
    expect(game.startIncident('w1', 'w2')).toEqual(fail('too_early'));
    advanceTo(game, 10_000);
    expect(game.startIncident('w1', 'w2')).toEqual(OK);
  });

  it('кулдаун саботажника считается от момента начала, граница включительно', () => {
    const game = setupGame({ saboteurs: ['w1'] });
    advanceTo(game, 10_000);
    expect(game.startIncident('w1', 'w2')).toEqual(OK);

    advanceTo(game, 12_000);
    expect(game.rescue('w2')).toEqual(OK);

    advanceTo(game, 29_999);
    expect(game.startIncident('w1', 'w3')).toEqual(fail('sabotage_cooldown'));
    advanceTo(game, 30_000);
    expect(game.startIncident('w1', 'w3')).toEqual(OK);
  });

  it('у каждого саботажника свой кулдаун', () => {
    const game = setupGame({ saboteurs: ['w1', 'w2'] });
    advanceTo(game, 10_000);

    expect(game.startIncident('w1', 'w3')).toEqual(OK);
    expect(game.startIncident('w1', 'w4')).toEqual(fail('sabotage_cooldown'));
    expect(game.startIncident('w2', 'w4')).toEqual(OK);
  });

  it('неудачная попытка не запускает кулдаун саботажника', () => {
    const game = setupGame({ saboteurs: ['w1', 'w2'] });
    advanceTo(game, 10_000);
    expect(game.startIncident('w1', 'w3')).toEqual(OK);

    expect(game.startIncident('w2', 'w3')).toEqual(fail('incident_already_active'));
    expect(game.startIncident('w2', 'w4')).toEqual(OK);
  });
});

describe('startIncident: кто и против кого', () => {
  it('неизвестный идентификатор → unknown_ward', () => {
    const game = setupGame({ saboteurs: ['w1'] });
    advanceTo(game, 10_000);

    expect(game.startIncident('w99', 'w2')).toEqual(fail('unknown_ward'));
    expect(game.startIncident('w1', 'w99')).toEqual(fail('unknown_ward'));
    expect(game.startIncident('', '')).toEqual(fail('unknown_ward'));
  });

  it('начинать может только саботажник', () => {
    const game = setupGame({ saboteurs: ['w1'] });
    advanceTo(game, 10_000);
    expect(game.startIncident('w2', 'w3')).toEqual(fail('not_saboteur'));
  });

  it('цель не может быть саботажником, в том числе им самим', () => {
    const game = setupGame({ saboteurs: ['w1', 'w2'] });
    advanceTo(game, 10_000);

    expect(game.startIncident('w1', 'w2')).toEqual(fail('target_is_saboteur'));
    expect(game.startIncident('w1', 'w1')).toEqual(fail('target_is_saboteur'));
  });

  it('цель должна быть жива', () => {
    const game = setupGame({ saboteurs: ['w1'] });
    advanceTo(game, 10_000);
    game.startIncident('w1', 'w2');
    advanceTo(game, 30_000);

    expect(wardStatus(game, 'w2')).toBe('dead');
    expect(game.startIncident('w1', 'w2')).toEqual(fail('ward_not_alive'));
  });

  it('на цели не может быть двух активных случаев', () => {
    const game = setupGame({ saboteurs: ['w1', 'w2'] });
    advanceTo(game, 10_000);

    expect(game.startIncident('w1', 'w3')).toEqual(OK);
    expect(game.startIncident('w2', 'w3')).toEqual(fail('incident_already_active'));
  });

  it('разоблачённый саботажник больше не может начинать случаи', () => {
    const game = setupGame({ saboteurs: ['w1', 'w2'] });
    advanceTo(game, 10_000);
    expect(game.accuse('w1')).toEqual(OK);

    expect(game.startIncident('w1', 'w3')).toEqual(fail('ward_not_alive'));
  });

  it('проверки идут в задокументированном порядке', () => {
    const game = setupGame({ saboteurs: ['w1'] });

    // Не саботажник важнее, чем «рано».
    expect(game.startIncident('w2', 'w3')).toEqual(fail('not_saboteur'));
    // «Рано» важнее, чем неправильная цель.
    expect(game.startIncident('w1', 'w1')).toEqual(fail('too_early'));
  });
});

describe('startIncident: что происходит', () => {
  it('событие incident_started не раскрывает саботажника', () => {
    const game = setupGame({ saboteurs: ['w1'], kinds: ['fire'] });
    advanceTo(game, 10_000);
    game.startIncident('w1', 'w2');

    expect(game.drainEvents()).toEqual([{ type: 'incident_started', t: 10_000, wardId: 'w2', kind: 'fire' }]);
  });

  it('вид случая выбирает генератор', () => {
    const game = setupGame({ saboteurs: ['w1'], kinds: ['flood', 'fall'] });
    advanceTo(game, 10_000);
    game.startIncident('w1', 'w2');
    game.rescue('w2');
    advanceTo(game, 30_000);
    game.startIncident('w1', 'w3');

    const kinds = game
      .drainEvents()
      .flatMap((e) => (e.type === 'incident_started' ? [e.kind] : []));
    expect(kinds).toEqual(['flood', 'fall']);
  });

  it('отказы не вызывают генератор', () => {
    // В генераторе ровно одно значение для вида. Если бы отказ его потратил, успешный вызов упал бы.
    const game = setupGame({ saboteurs: ['w1'], kinds: ['flood'] });
    game.startIncident('w1', 'w2');
    advanceTo(game, 10_000);
    game.startIncident('w2', 'w3');
    game.startIncident('w1', 'w1');
    game.startIncident('w1', 'w42');

    expect(game.startIncident('w1', 'w2')).toEqual(OK);
    expect(game.getPublicState().incidents[0]?.kind).toBe('flood');
  });

  it('публичное состояние показывает цель, вид и оставшееся время', () => {
    const game = setupGame({ saboteurs: ['w1'], kinds: ['fall'] });
    advanceTo(game, 10_000);
    game.startIncident('w1', 'w2');
    advanceTo(game, 13_000);

    expect(game.getPublicState().incidents).toEqual([
      { wardId: 'w2', kind: 'fall', startedAt: 10_000, remainingMs: 5_000 },
    ]);
  });

  it('цель погибает ровно в момент начало + incidentWindowMs', () => {
    const game = setupGame({ saboteurs: ['w1'] });
    advanceTo(game, 10_000);
    game.startIncident('w1', 'w2');
    game.drainEvents();

    advanceTo(game, 17_999);
    expect(wardStatus(game, 'w2')).toBe('alive');
    expect(game.getPublicState().incidents[0]?.remainingMs).toBe(1);

    game.update(1);
    expect(wardStatus(game, 'w2')).toBe('dead');
    expect(game.getPublicState()).toMatchObject({ deaths: 1, incidents: [], isOver: false });
    expect(game.drainEvents()).toEqual([{ type: 'ward_died', t: 18_000, wardId: 'w2' }]);
  });

  it('после deathsToLose смертей побеждают саботажники', () => {
    const game = setupGame({ saboteurs: ['w1'] });
    for (const [start, target] of [
      [10_000, 'w2'],
      [30_000, 'w3'],
      [50_000, 'w4'],
    ] as const) {
      advanceTo(game, start);
      expect(game.startIncident('w1', target)).toEqual(OK);
    }
    advanceTo(game, 100_000);

    expect(game.getPublicState()).toMatchObject({
      deaths: 3,
      isOver: true,
      winner: 'saboteurs',
      endReason: 'too_many_deaths',
    });
    expect(game.time).toBe(58_000);
    expect(game.drainEvents().at(-1)).toEqual({
      type: 'game_over',
      t: 58_000,
      winner: 'saboteurs',
      reason: 'too_many_deaths',
    });
  });
});
