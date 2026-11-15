/** Restore a demo login without replacing its identity or healthy sessions. */
export async function ensureDemoUser(pg, admin, email, name, password) {
  // pgcrypto can live in public or extensions. Check the password rather than
  // resetting it every seed: GoTrue revokes sessions on a password update.
  const { rows: [crypto] } = await pg.query(`select n.nspname from pg_extension e
    join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pgcrypto'`);
  if (!crypto) throw new Error("pgcrypto missing — cannot check demo passwords");
  const namespace = '"' + crypto.nspname.replaceAll('"', '""') + '"';
  const { rows: [user] } = await pg.query(`select id,
    coalesce(encrypted_password = ${namespace}.crypt($2, encrypted_password), false) as password_matches
    from auth.users where email = $1`, [email, password]);
  let userId = user?.id;
  if (!userId) {
    const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (error) throw new Error(`${email}: ${error.message}`);
    userId = data.user.id;
  } else {
    if (!user.password_matches) {
      const { error } = await admin.auth.admin.updateUserById(userId, { password });
      if (error) throw new Error(`${email}: ${error.message}`);
    }
    // Metadata updates through GoTrue merge keys. A seed must also remove keys
    // and bans a case added, just as recreating this demo-only login did.
    await pg.query(`update auth.users set raw_user_meta_data = '{}'::jsonb,
      raw_app_meta_data = '{"provider":"email","providers":["email"]}'::jsonb,
      role = 'authenticated', banned_until = null, email_confirmed_at = coalesce(email_confirmed_at, now()),
      updated_at = now()
      where id = $1 and (raw_user_meta_data is distinct from '{}'::jsonb
        or raw_app_meta_data is distinct from '{"provider":"email","providers":["email"]}'::jsonb
        or role is distinct from 'authenticated' or banned_until is not null or email_confirmed_at is null)`, [userId]);
  }
  // Recreating the login also removed any accidental platform-admin grant.
  await pg.query("delete from platform_admins where user_id = $1", [userId]);
  if (name) {
    await pg.query(
      `insert into profiles (user_id, full_name, updated_at)
       values ($1, $2, now())
       on conflict (user_id) do update set full_name = $2
       where profiles.full_name is distinct from excluded.full_name`,
      [userId, name],
    );
  }
  return userId;
}
