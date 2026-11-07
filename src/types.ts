/** Генератор случайных чисел: каждый вызов возвращает число в диапазоне [0, 1). */
export type Rng = () => number;

export type FailReason =
  | 'game_over'
  | 'unknown_ward'
  | 'not_saboteur'
  | 'too_early'
  | 'sabotage_cooldown'
  | 'ward_not_alive'
  | 'incident_already_active'
  | 'no_active_incident'
  | 'rescue_cooldown'
  | 'already_accused'
  /** Добавлено сверх условия: цель несчастного случая — саботажник (в том числе он сам). */
  | 'target_is_saboteur';

export type Result = { ok: true } | { ok: false; reason: FailReason };

export type Winner = 'rescuer' | 'saboteurs';

export type GameOverReason =
  | 'saboteur_caught'
  | 'too_many_deaths'
  | 'too_many_wrong_accusations'
  | 'time_up';

export type GameEvent =
  | { type: 'incident_started'; t: number; wardId: string; kind: string }
  | { type: 'incident_rescued'; t: number; wardId: string }
  | { type: 'incident_cancelled'; t: number; wardId: string }
  | { type: 'ward_died'; t: number; wardId: string }
  | { type: 'saboteur_caught'; t: number; wardId: string }
  | { type: 'wrong_accusation'; t: number; wardId: string }
  | { type: 'game_over'; t: number; winner: Winner; reason: GameOverReason };

export type WardStatus = 'alive' | 'dead' | 'caught';

export interface PublicWard {
  readonly id: string;
  readonly status: WardStatus;
  /** Спасатель уже обвинял этого подопечного. */
  readonly accused: boolean;
}

export interface PublicIncident {
  /** Цель несчастного случая. Кто его устроил, не раскрывается. */
  readonly wardId: string;
  readonly kind: string;
  readonly startedAt: number;
  /** Сколько миллисекунд осталось на спасение. */
  readonly remainingMs: number;
}

/** Состояние, которое можно отдавать спасателю. Саботажники в нём не видны, пока игра идёт. */
export interface PublicState {
  readonly time: number;
  readonly timeLeftMs: number;
  readonly wards: readonly PublicWard[];
  readonly incidents: readonly PublicIncident[];
  readonly deaths: number;
  readonly wrongAccusations: number;
  /** Сколько миллисекунд осталось до конца кулдауна спасателя (0 — можно спасать). */
  readonly rescueCooldownLeftMs: number;
  readonly isOver: boolean;
  readonly winner: Winner | null;
  readonly endReason: GameOverReason | null;
  /** Идентификаторы саботажников. `null`, пока игра идёт. */
  readonly saboteurIds: readonly string[] | null;
}
