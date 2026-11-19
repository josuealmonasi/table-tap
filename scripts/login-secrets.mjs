// Read after the caller loads its env file. Import-time constants kept the
// previous target's password when a reset rebuilt both environments.
/** @param {string} name @param {Record<string, string | undefined>} env */
export function loginSecret(name, env = process.env, file = process.argv.includes("--prod") ? ".env.production.local" : ".env.development.local") {
  const value = env[name];
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${name} is not set. Put it in ${file}; login passwords have no default.`);
  }
  return value;
}
