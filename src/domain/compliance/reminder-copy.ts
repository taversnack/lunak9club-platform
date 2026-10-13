/** Dashboard copy for the reminder days configured on the active vaccination requirements (D75). */
export function reminderDaysCopy(
  requirements: readonly { active: boolean; reminderDays: readonly number[] }[],
): string {
  const days = [...new Set(requirements.filter((r) => r.active).flatMap((r) => r.reminderDays))].sort((a, b) => b - a);
  if (days.length === 0) return 'No automatic reminders are set up.';
  const list = days.length === 1 ? `${days[0]}` : `${days.slice(0, -1).join(', ')} and ${days.at(-1)}`;
  return `Customers are reminded automatically ${list} ${days.length === 1 && days[0] === 1 ? 'day' : 'days'} before.`;
}
