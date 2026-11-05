// Phone numbers are matched by their last nine digits, so "+221 77 000 00 00" and "77 000 00 00" are the same number.
export function phoneKey(phone: string | null | undefined): string | null {
  const digits = (phone ?? '').replace(/\D/g, '');
  if (digits.length === 0) return null;
  return digits.slice(-9);
}
