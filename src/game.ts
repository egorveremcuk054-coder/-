import { resolveBalance, type Balance } from './balance';
import type {
  FailReason,
  GameEvent,
  GameOverReason,
  PublicState,
  Result,
  Rng,
  WardStatus,
  Winner,
} from './types';

interface Ward {
  readonly id: string;
  readonly isSaboteur: boolean;
  status: WardStatus;
  accused: boolean;
}

interface Incident {
  readonly target: Ward;
  readonly saboteur: Ward;
  readonly kind: string;
  readonly startedAt: number;
  /** Момент, когда цель погибнет, если её не спасут. */
  readonly deadline: number;
}

interface Outcome {
  readonly winner: Winner;
  readonly reason: GameOverReason;
}

const OK: Result = Object.freeze({ ok: true });

function fail(reason: FailReason): Result {
  return { ok: false, reason };
}

/** Случайный индекс в [0, size) из генератора. Проверяет, что генератор возвращает число из [0, 1). */
function randomIndex(rng: Rng, size: number): number {
  const value = rng();
  if (!(value >= 0 && value < 1)) {
    throw new RangeError(`rng() должен возвращать число из [0, 1), получено ${String(value)}`);
  }
  return Math.min(Math.floor(value * size), size - 1);
}

/** Частичная перетасовка Фишера — Йетса: count разных элементов, по одному вызову rng на элемент. */
function pickDistinct<T>(items: readonly T[], count: number, rng: Rng): T[] {
  const pool = [...items];
  for (let i = 0; i < count; i++) {
    const j = i + randomIndex(rng, pool.length - i);
    const picked = pool[j] as T;
    pool[j] = pool[i] as T;
    pool[i] = picked;
  }
  return pool.slice(0, count);
}

/**
 * Чистая логика игры «спасатель против саботажников».
 * Время приходит только через update(dtMs), случайность — только через rng из конструктора.
 */
export class Game {
  private readonly balance: Balance;
  private readonly rng: Rng;
  /** Подопечные в порядке w1..wN. */
  private readonly wards = new Map<string, Ward>();
  /** Активные несчастные случаи по идентификатору цели, в порядке начала. */
  private readonly incidents = new Map<string, Incident>();
  /** Когда у саботажника закончится кулдаун. Нет записи — кулдауна нет. */
  private readonly sabotageReadyAt = new Map<string, number>();
  private rescueReadyAt = 0;
  private now = 0;
  private deaths = 0;
  private wrongAccusations = 0;
  private outcome: Outcome | null = null;
  private events: GameEvent[] = [];

  constructor(opts: { balance?: Partial<Balance>; rng: Rng }) {
    this.balance = resolveBalance(opts.balance);
    this.rng = opts.rng;

    const ids = Array.from({ length: this.balance.wardCount }, (_, index) => `w${index + 1}`);
    const saboteurs = new Set(pickDistinct(ids, this.balance.saboteurCount, this.rng));
    for (const id of ids) {
      this.wards.set(id, { id, isSaboteur: saboteurs.has(id), status: 'alive', accused: false });
    }
  }

  /** Сколько миллисекунд прошло с начала раунда. После конца игры не меняется. */
  get time(): number {
    return this.now;
  }

  /**
   * Продвигает время на dtMs. Все события внутри шага обрабатываются по порядку,
   * каждое в свой точный момент, поэтому один большой шаг равен многим маленьким.
   * В один момент сначала смерти (в порядке начала несчастных случаев), потом конец раунда.
   */
  update(dtMs: number): void {
    if (!Number.isFinite(dtMs) || dtMs < 0) {
      throw new RangeError(`dtMs должно быть конечным числом ≥ 0, получено ${String(dtMs)}`);
    }
    if (this.outcome) {
      return;
    }

    const target = this.now + dtMs;
    const roundEnd = this.balance.roundDurationMs;

    while (!this.outcome) {
      const incident = this.nextDeadline();
      if (incident && incident.deadline <= target && incident.deadline <= roundEnd) {
        this.now = incident.deadline;
        this.killTarget(incident);
        continue;
      }
      if (roundEnd <= target) {
        this.now = roundEnd;
        this.finish('rescuer', 'time_up');
        return;
      }
      this.now = target;
      return;
    }
  }

  startIncident(saboteurId: string, wardId: string): Result {
    if (this.outcome) return fail('game_over');

    const saboteur = this.wards.get(saboteurId);
    const target = this.wards.get(wardId);
    if (!saboteur || !target) return fail('unknown_ward');
    if (!saboteur.isSaboteur) return fail('not_saboteur');
    if (saboteur.status !== 'alive') return fail('ward_not_alive');
    if (this.now < this.balance.initialSabotageDelayMs) return fail('too_early');

    const readyAt = this.sabotageReadyAt.get(saboteur.id);
    if (readyAt !== undefined && this.now < readyAt) return fail('sabotage_cooldown');

    if (target.isSaboteur) return fail('target_is_saboteur');
    if (target.status !== 'alive') return fail('ward_not_alive');
    if (this.incidents.has(target.id)) return fail('incident_already_active');

    // Генератор вызывается только для успешного начала: отказы не сдвигают последовательность.
    const kinds = this.balance.incidentKinds;
    const kind = kinds[randomIndex(this.rng, kinds.length)] as string;

    this.incidents.set(target.id, {
      target,
      saboteur,
      kind,
      startedAt: this.now,
      deadline: this.now + this.balance.incidentWindowMs,
    });
    this.sabotageReadyAt.set(saboteur.id, this.now + this.balance.sabotageCooldownMs);
    this.emit({ type: 'incident_started', t: this.now, wardId: target.id, kind });
    return OK;
  }

  rescue(wardId: string): Result {
    if (this.outcome) return fail('game_over');

    const ward = this.wards.get(wardId);
    if (!ward) return fail('unknown_ward');

    // update() обрабатывает дедлайны включительно, поэтому активный случай всегда
    // имеет deadline > now: в момент начало + incidentWindowMs спасать уже некого.
    if (!this.incidents.has(ward.id)) return fail('no_active_incident');
    if (this.now < this.rescueReadyAt) return fail('rescue_cooldown');

    this.incidents.delete(ward.id);
    this.rescueReadyAt = this.now + this.balance.rescueCooldownMs;
    this.emit({ type: 'incident_rescued', t: this.now, wardId: ward.id });
    return OK;
  }

  accuse(wardId: string): Result {
    if (this.outcome) return fail('game_over');

    const ward = this.wards.get(wardId);
    if (!ward) return fail('unknown_ward');
    if (ward.accused) return fail('already_accused');
    if (ward.status !== 'alive') return fail('ward_not_alive');

    ward.accused = true;

    if (ward.isSaboteur) {
      ward.status = 'caught';
      this.emit({ type: 'saboteur_caught', t: this.now, wardId: ward.id });
      for (const incident of [...this.incidents.values()]) {
        if (incident.saboteur === ward) {
          this.incidents.delete(incident.target.id);
          this.emit({ type: 'incident_cancelled', t: this.now, wardId: incident.target.id });
        }
      }
      const saboteursLeft = [...this.wards.values()].some((w) => w.isSaboteur && w.status === 'alive');
      if (!saboteursLeft) {
        this.finish('rescuer', 'saboteur_caught');
      }
      return OK;
    }

    this.wrongAccusations += 1;
    this.emit({ type: 'wrong_accusation', t: this.now, wardId: ward.id });
    if (this.wrongAccusations >= this.balance.wrongAccusationsToLose) {
      this.finish('saboteurs', 'too_many_wrong_accusations');
    }
    return OK;
  }

  /** Состояние для спасателя. Каждый вызов возвращает новый объект без ссылок на внутренности игры. */
  getPublicState(): PublicState {
    const wards = [...this.wards.values()];
    return {
      time: this.now,
      timeLeftMs: Math.max(0, this.balance.roundDurationMs - this.now),
      wards: wards.map((w) => ({ id: w.id, status: w.status, accused: w.accused })),
      incidents: [...this.incidents.values()].map((incident) => ({
        wardId: incident.target.id,
        kind: incident.kind,
        startedAt: incident.startedAt,
        remainingMs: incident.deadline - this.now,
      })),
      deaths: this.deaths,
      wrongAccusations: this.wrongAccusations,
      rescueCooldownLeftMs: Math.max(0, this.rescueReadyAt - this.now),
      isOver: this.outcome !== null,
      winner: this.outcome?.winner ?? null,
      endReason: this.outcome?.reason ?? null,
      saboteurIds: this.outcome ? wards.filter((w) => w.isSaboteur).map((w) => w.id) : null,
    };
  }

  /** Отдаёт накопленные события в порядке возникновения и очищает список. */
  drainEvents(): GameEvent[] {
    const drained = this.events;
    this.events = [];
    return drained;
  }

  /** Несчастный случай с самым ранним дедлайном; при равенстве — тот, что начался раньше. */
  private nextDeadline(): Incident | undefined {
    let next: Incident | undefined;
    for (const incident of this.incidents.values()) {
      if (!next || incident.deadline < next.deadline) {
        next = incident;
      }
    }
    return next;
  }

  private killTarget(incident: Incident): void {
    this.incidents.delete(incident.target.id);
    incident.target.status = 'dead';
    this.deaths += 1;
    this.emit({ type: 'ward_died', t: this.now, wardId: incident.target.id });
    if (this.deaths >= this.balance.deathsToLose) {
      this.finish('saboteurs', 'too_many_deaths');
    }
  }

  private finish(winner: Winner, reason: GameOverReason): void {
    this.outcome = { winner, reason };
    this.emit({ type: 'game_over', t: this.now, winner, reason });
  }

  private emit(event: GameEvent): void {
    this.events.push(event);
  }
}
