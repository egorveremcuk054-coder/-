/// <reference types="vite/client" />
import { describe, expect, it } from 'vitest';

// Исходники игры как текст: проверяем правила задания статически, по коду, а не только по поведению.
const sources = import.meta.glob('../src/**/*.ts', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

function stripComments(code: string): string {
  return code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

describe('правила для исходного кода', () => {
  it('исходники найдены', () => {
    expect(Object.keys(sources)).toEqual(
      expect.arrayContaining(['../src/game.ts', '../src/balance.ts', '../src/types.ts']),
    );
  });

  it('в коде игры нет Date.now, Math.random, setTimeout, setInterval и других часов', () => {
    const forbidden = /\b(Date\.now|Math\.random|setTimeout|setInterval|performance\.now|new Date)\b/;
    for (const [file, code] of Object.entries(sources)) {
      expect(stripComments(code), file).not.toMatch(forbidden);
    }
  });

  it('в логике игры нет магических чисел: всё, кроме 0 и 1, берётся из balance.ts', () => {
    const code = stripComments(sources['../src/game.ts'] ?? '');
    const numbers = code.match(/(?<![\w$.])\d[\d_]*(?:\.\d+)?(?![\w$])/g) ?? [];
    expect(numbers.filter((n) => n !== '0' && n !== '1')).toEqual([]);
  });
});
