/**
 * Все числа баланса игры. Логика в game.ts берёт значения только отсюда.
 * Тесты и сервер подставляют свой баланс через `new Game({ balance: { ... } })`.
 */
export interface Balance {
  /** Длительность раунда, мс. */
  readonly roundDurationMs: number;
  /** Сколько подопечных. */
  readonly wardCount: number;
  /** Сколько среди них саботажников. */
  readonly saboteurCount: number;
  /** До этого момента никто не может начать несчастный случай, мс. */
  readonly initialSabotageDelayMs: number;
  /** Кулдаун саботажника между попытками, считается от начала несчастного случая, мс. */
  readonly sabotageCooldownMs: number;
  /** Сколько времени есть на спасение, мс. */
  readonly incidentWindowMs: number;
  /** Кулдаун спасателя после успешного спасения, мс. */
  readonly rescueCooldownMs: number;
  /** Сколько смертей подопечных до поражения спасателя. */
  readonly deathsToLose: number;
  /** Сколько неверных обвинений до поражения спасателя. */
  readonly wrongAccusationsToLose: number;
  /** Виды несчастных случаев. */
  readonly incidentKinds: readonly string[];
}

export const defaultBalance: Balance = Object.freeze({
  roundDurationMs: 300_000, // длительность раунда
  wardCount: 8, // сколько подопечных
  saboteurCount: 1, // сколько среди них саботажников
  initialSabotageDelayMs: 10_000, // до этого момента никто не может начать несчастный случай
  sabotageCooldownMs: 20_000, // кулдаун саботажника между попытками
  incidentWindowMs: 8_000, // сколько времени есть на спасение
  rescueCooldownMs: 3_000, // кулдаун спасателя после успешного спасения
  deathsToLose: 3, // сколько смертей подопечных до поражения спасателя
  wrongAccusationsToLose: 2, // сколько неверных обвинений до поражения спасателя
  incidentKinds: Object.freeze(['fall', 'fire', 'flood']),
});

/**
 * Склеивает баланс по умолчанию с переопределениями и проверяет результат.
 * Поля со значением `undefined` не переопределяют значение по умолчанию.
 */
export function resolveBalance(overrides: Partial<Balance> = {}): Balance {
  const merged: { -readonly [K in keyof Balance]: Balance[K] } = { ...defaultBalance };
  for (const key of Object.keys(overrides) as (keyof Balance)[]) {
    const value = overrides[key];
    if (value !== undefined) {
      Object.assign(merged, { [key]: value });
    }
  }
  merged.incidentKinds = Object.freeze([...merged.incidentKinds]);
  validateBalance(merged);
  return Object.freeze(merged);
}

/** Бросает RangeError, если с таким балансом игра не имеет смысла. */
export function validateBalance(balance: Balance): void {
  const problems: string[] = [];

  const requireInteger = (name: keyof Balance, value: number, min: number): void => {
    if (!Number.isInteger(value) || value < min) {
      problems.push(`${name} должно быть целым числом не меньше ${min}, получено ${value}`);
    }
  };
  const requireDuration = (name: keyof Balance, value: number, allowZero: boolean): void => {
    const ok = Number.isFinite(value) && (allowZero ? value >= 0 : value > 0);
    if (!ok) {
      problems.push(`${name} должно быть конечным числом ${allowZero ? '≥ 0' : '> 0'}, получено ${value}`);
    }
  };

  requireDuration('roundDurationMs', balance.roundDurationMs, false);
  requireDuration('initialSabotageDelayMs', balance.initialSabotageDelayMs, true);
  requireDuration('sabotageCooldownMs', balance.sabotageCooldownMs, true);
  requireDuration('incidentWindowMs', balance.incidentWindowMs, false);
  requireDuration('rescueCooldownMs', balance.rescueCooldownMs, true);

  requireInteger('wardCount', balance.wardCount, 2);
  requireInteger('saboteurCount', balance.saboteurCount, 1);
  requireInteger('deathsToLose', balance.deathsToLose, 1);
  requireInteger('wrongAccusationsToLose', balance.wrongAccusationsToLose, 1);

  if (Number.isInteger(balance.wardCount) && balance.saboteurCount >= balance.wardCount) {
    problems.push(
      `saboteurCount (${balance.saboteurCount}) должно быть меньше wardCount (${balance.wardCount}): ` +
        'нужен хотя бы один подопечный, против которого можно устроить несчастный случай',
    );
  }
  if (balance.incidentKinds.length === 0) {
    problems.push('incidentKinds не может быть пустым');
  }

  if (problems.length > 0) {
    throw new RangeError(`Некорректный баланс:\n- ${problems.join('\n- ')}`);
  }
}
