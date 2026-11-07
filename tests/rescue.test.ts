import { describe, expect, it } from 'vitest';
import { advanceTo, setupGame, wardStatus } from './helpers';

const fail = (reason: string) => ({ ok: false, reason });
const OK = { ok: true };

describe('rescue', () => {
  it('спасение в последнюю миллисекунду окна работает, подопечный остаётся жив', () => {
    const game = setupGame({ saboteurs: ['w1'] });
    advanceTo(game, 10_000);
    game.startIncident('w1', 'w2');
    game.drainEvents();

    advanceTo(game, 17_999);
    expect(game.rescue('w2')).toEqual(OK);
    expect(game.drainEvents()).toEqual([{ type: 'incident_rescued', t: 17_999, wardId: 'w2' }]);

    advanceTo(game, 60_000);
    expect(wardStatus(game, 'w2')).toBe('alive');
    expect(game.getPublicState()).toMatchObject({ deaths: 0, incidents: [] });
    expect(game.drainEvents()).toEqual([]);
  });

  it('в момент начало + incidentWindowMs уже поздно', () => {
    const game = setupGame({ saboteurs: ['w1'] });
    advanceTo(game, 10_000);
    game.startIncident('w1', 'w2');

    advanceTo(game, 18_000);
    expect(game.rescue('w2')).toEqual(fail('no_active_incident'));
    expect(wardStatus(game, 'w2')).toBe('dead');
  });

  it('без активного случая спасать нечего', () => {
    const game = setupGame({ saboteurs: ['w1'] });
    expect(game.rescue('w2')).toEqual(fail('no_active_incident'));
    expect(game.rescue('w1')).toEqual(fail('no_active_incident'));
  });

  it('неизвестный подопечный → unknown_ward', () => {
    const game = setupGame({ saboteurs: ['w1'] });
    expect(game.rescue('w9')).toEqual(fail('unknown_ward'));
  });

  it('после успешного спасения кулдаун rescueCooldownMs, граница включительно', () => {
    const game = setupGame({ saboteurs: ['w1', 'w2'] });
    advanceTo(game, 10_000);
    game.startIncident('w1', 'w3');
    game.startIncident('w2', 'w4');

    expect(game.rescue('w3')).toEqual(OK);
    advanceTo(game, 12_999);
    expect(game.getPublicState().rescueCooldownLeftMs).toBe(1);
    expect(game.rescue('w4')).toEqual(fail('rescue_cooldown'));

    advanceTo(game, 13_000);
    expect(game.getPublicState().rescueCooldownLeftMs).toBe(0);
    expect(game.rescue('w4')).toEqual(OK);
  });

  it('неудачные попытки кулдаун не запускают', () => {
    const game = setupGame({ saboteurs: ['w1'] });
    advanceTo(game, 10_000);
    expect(game.rescue('w2')).toEqual(fail('no_active_incident'));
    expect(game.rescue('w99')).toEqual(fail('unknown_ward'));

    game.startIncident('w1', 'w2');
    expect(game.rescue('w2')).toEqual(OK);
  });

  it('кулдаун мешает спасти, и подопечный гибнет, если окно кончилось раньше кулдауна', () => {
    const game = setupGame({
      saboteurs: ['w1', 'w2'],
      balance: { rescueCooldownMs: 10_000 },
    });
    advanceTo(game, 10_000);
    game.startIncident('w1', 'w3');
    game.startIncident('w2', 'w4');
    expect(game.rescue('w3')).toEqual(OK);

    advanceTo(game, 17_999);
    expect(game.rescue('w4')).toEqual(fail('rescue_cooldown'));
    game.update(1);
    expect(wardStatus(game, 'w4')).toBe('dead');
  });

  it('если случая нет, отвечаем no_active_incident даже во время кулдауна', () => {
    const game = setupGame({ saboteurs: ['w1'] });
    advanceTo(game, 10_000);
    game.startIncident('w1', 'w2');
    game.rescue('w2');

    expect(game.rescue('w3')).toEqual(fail('no_active_incident'));
  });
});
