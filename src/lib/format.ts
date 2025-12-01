// src/lib/format.ts

/** Денежное форматирование.
 * По умолчанию копейки скрыты (0 знаков после запятой).
 * При необходимости можно переопределить количеством дробных разрядов через minimumFractionDigits/maximumFractionDigits.
 */
export function fmtMoney(
  value: number | null | undefined,
  {
    currency = 'RUB',
    locale = 'ru-RU',
    minimumFractionDigits,
    maximumFractionDigits,
  }: {
    currency?: string;
    locale?: string;
    minimumFractionDigits?: number;
    maximumFractionDigits?: number;
  } = {},
): string {
  const n = Number(value ?? 0);

  // Если дробные разряды не заданы — по умолчанию показываем 0 (без копеек).
  const hasMin = minimumFractionDigits != null;
  const hasMax = maximumFractionDigits != null;
  const minFD = hasMin ? Number(minimumFractionDigits) : 0;
  const maxFD = hasMax ? Number(maximumFractionDigits) : minFD;

  const nf = new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    minimumFractionDigits: minFD,
    maximumFractionDigits: maxFD,
  });

  return nf.format(n);
}

/** Обычное число с разделителями тысяч. */
export function fmtNumber(
  value: number | null | undefined,
  { locale = 'ru-RU', fractionDigits }: { locale?: string; fractionDigits?: number } = {},
): string {
  const n = Number(value ?? 0);
  const nf = new Intl.NumberFormat(locale, {
    ...(fractionDigits != null ? { minimumFractionDigits: fractionDigits, maximumFractionDigits: fractionDigits } : {}),
  });
  return nf.format(n);
}

/** Проценты из значения в диапазоне [0..100]. Возвращает строку вида `12,3 %`. */
export function fmtPercent(
  value: number | null | undefined,
  { locale = 'ru-RU', digits = 1 }: { locale?: string; digits?: number } = {},
): string {
  const n = Number(value ?? 0);
  const nf = new Intl.NumberFormat(locale, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
  return `${nf.format(n)} %`;
}

/** Дата ISO (YYYY-MM-DD) → DD.MM.YYYY. Пустое значение вернёт '—'. */
export function fmtDateISO(iso?: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yy = d.getFullYear();
  return `${dd}.${mm}.${yy}`;
}
