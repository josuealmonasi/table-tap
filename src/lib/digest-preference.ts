/** Management eligibility comes from membership. Only the preference is user-editable. */
export function digestEnabled(role: string, preference: unknown): boolean {
  if (role === "owner") return preference !== false;
  return role === "manager" && preference === true;
}
