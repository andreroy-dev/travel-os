export const categoryLabel: Record<string, string> = {
  groceries: 'Food',
  transport: 'Transport',
  rent: 'Stay',
  utilities: 'Bills',
  fitness: 'Fitness',
  entertainment: 'Activities',
  other: 'Other',
};

export function money(amount: string | number | null | undefined) {
  if (amount === null || amount === undefined || amount === '') return null;
  const value = typeof amount === 'number' ? amount : Number(amount);
  if (!Number.isFinite(value)) return null;
  return value.toFixed(2);
}

export function addAmounts(values: (string | null | undefined)[]) {
  const cents = values.reduce((sum, value) => {
    if (!value) return sum;
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return sum;
    return sum + Math.round(parsed * 100);
  }, 0);
  return (cents / 100).toFixed(2);
}

export function monthName(date = new Date()) {
  return date.toLocaleString('en', { month: 'long' });
}

export function inMonth(spentOn: string | null | undefined, date = new Date()) {
  if (!spentOn) return false;
  const [year, month] = spentOn.split('-').map(Number);
  return year === date.getFullYear() && month === date.getMonth() + 1;
}

export function ratio(part: string | null | undefined, whole: string | null | undefined) {
  const spent = Number(part);
  const budget = Number(whole);
  if (!Number.isFinite(spent) || !Number.isFinite(budget) || budget <= 0) return 0;
  return Math.max(0, Math.min(1, spent / budget));
}
