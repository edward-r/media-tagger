export const l2Norm = (a: readonly number[]): number => {
  let s = 0;
  for (let i = 0; i < a.length; i += 1) {
    const x = a[i] ?? 0;
    s += x * x;
  }
  return Math.sqrt(s);
};

export const normalize = (a: readonly number[]): readonly number[] => {
  const n = l2Norm(a);
  if (n === 0) return a.slice();
  return a.map((x) => x / n);
};

export const dot = (a: readonly number[], b: readonly number[]): number => {
  const n = Math.min(a.length, b.length);
  let s = 0;
  for (let i = 0; i < n; i += 1) {
    s += (a[i] ?? 0) * (b[i] ?? 0);
  }
  return s;
};
