/**
 * On production, a kept demo login keeps nothing a stranger gave it (audit of
 * #648). Before logins were kept, a reset deleted the users, which revoked all
 * of this; now it is revoked here instead. MFA factors go through GoTrue's
 * admin API, so their challenges go with them. GoTrue has no admin "sign out
 * by user", so sessions and refresh tokens are deleted by user id, and a
 * pending email change is cleared, scoped to this one demo user.
 */
export async function revokeDemoAccess(pg, admin, userId) {
  const { data, error } = await admin.auth.admin.mfa.listFactors({ userId });
  if (error) throw new Error(`demo login ${userId}: ${error.message}`);
  for (const factor of data?.factors ?? []) {
    const { error: deleteError } = await admin.auth.admin.mfa.deleteFactor({ id: factor.id, userId });
    if (deleteError) throw new Error(`demo login ${userId}: ${deleteError.message}`);
  }
  await pg.query("delete from auth.refresh_tokens where user_id = $1::text", [userId]);
  await pg.query("delete from auth.sessions where user_id = $1", [userId]);
  await pg.query(`update auth.users set email_change = '', email_change_token_new = '',
    email_change_token_current = '', email_change_confirm_status = 0, email_change_sent_at = null
    where id = $1`, [userId]);
}

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
