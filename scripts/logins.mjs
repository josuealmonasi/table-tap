// Every login on the platform, however many there are.
//
// `auth.admin.listUsers` answers one page and says nothing about the rest.
// The checks looked a login up among the first 200: past 200 logins — about
// forty cafés — prod-check would have reported the demo logins missing, and
// the api gate would have tried to create a login that already existed and
// left its signup's test login behind. Pages until one comes back empty and
// throws on a failed page, like `everyLogin` in src/lib/logins.ts.
const PER_PAGE = 1000;

export async function everyLogin(admin) {
  const users = [];
  for (let page = 1; ; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: PER_PAGE });
    if (error) throw new Error(`Could not list the logins: ${error.message}`);
    if (!data.users.length) return users;
    users.push(...data.users);
  }
}

/** The login with this email, or null. */
export async function loginByEmail(admin, email) {
  return (await everyLogin(admin)).find(u => u.email === email) ?? null;
}
