/** Whole years between an ISO date of birth and `today` (UTC). */
export function ageInYears(dateOfBirth: string, today: Date = new Date()): number {
  const [y, m, d] = dateOfBirth.split('-').map(Number) as [number, number, number];
  let age = today.getUTCFullYear() - y;
  const beforeBirthday = today.getUTCMonth() + 1 < m || (today.getUTCMonth() + 1 === m && today.getUTCDate() < d);
  if (beforeBirthday) age -= 1;
  return age;
}

export const AGE_OF_MAJORITY = 18;

export function isMinor(dateOfBirth: string, today: Date = new Date()): boolean {
  return ageInYears(dateOfBirth, today) < AGE_OF_MAJORITY;
}
