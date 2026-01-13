export type TopK<T> = Readonly<{
  offer: (x: T) => void;
  valuesSortedDesc: () => readonly T[];
}>;

export const createTopK = <T>(
  k: number,
  scoreOf: (x: T) => number,
): TopK<T> => {
  const cap = Number.isFinite(k) ? Math.max(1, Math.floor(k)) : 1;
  let items: T[] = [];

  const offer = (x: T): void => {
    if (items.length < cap) {
      items = [...items, x];
      if (items.length === cap)
        items = items.slice().sort((a, b) => scoreOf(a) - scoreOf(b));
      return;
    }

    const min = items[0];
    if (!min) return;
    if (scoreOf(x) <= scoreOf(min)) return;

    const rest = items.slice(1);
    const next = insertSortedAsc(rest, x, scoreOf);
    items = next.length > cap ? next.slice(next.length - cap) : next;
  };

  const valuesSortedDesc = (): readonly T[] =>
    items.slice().sort((a, b) => scoreOf(b) - scoreOf(a));

  return { offer, valuesSortedDesc };
};

const insertSortedAsc = <T>(
  arr: readonly T[],
  x: T,
  scoreOf: (x: T) => number,
): T[] => {
  const out: T[] = [];
  let inserted = false;

  for (const it of arr) {
    if (!inserted && scoreOf(x) <= scoreOf(it)) {
      out.push(x);
      inserted = true;
    }
    out.push(it);
  }

  if (!inserted) out.push(x);
  return out;
};
