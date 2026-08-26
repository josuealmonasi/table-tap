import { redirect } from "next/navigation";
import { getMembership, MANAGES, SETTLES, type Membership } from "@/lib/membership";

/**
 * Quién puede estar en cada pantalla del panel, dicho una sola vez.
 *
 * Estaba escrito a mano en nueve páginas y en dos versiones distintas: unas
 * pedían `currentUser()` y luego la membresía, otras sólo la membresía; unas
 * mandaban a `/login` y otras a `/dashboard`. Ninguna estaba mal —todas
 * negaban— pero nueve copias de una regla de permisos son nueve sitios donde
 * la próxima se escribe distinta, y esa es la forma exacta de todos los bugs
 * de este repo: dos lugares que debían coincidir sin nadie comprobándolo.
 *
 * `currentUser()` sobraba: `getMembership()` ya devuelve null sin sesión.
 *
 * Cada una devuelve la membresía ya comprobada, así que la página sigue con
 * `membership.restaurant` sin volver a preguntar — `getMembership` va en caché
 * por petición y no cuesta otro viaje.
 */

/** Sesión y restaurante. Sin eso no hay panel que enseñar. */
export async function requireMembership(): Promise<Membership> {
  const membership = await getMembership();
  if (!membership) redirect("/login");
  return membership;
}

/** Menús, mesas, promociones, ajustes, analíticas: dueño y gerente. */
export async function requireManager(): Promise<Membership> {
  const membership = await requireMembership();
  if (!MANAGES(membership.role)) redirect("/dashboard/orders");
  return membership;
}

/** Cobrar y ver cuentas: todo el piso, nadie de la cocina. */
export async function requireSettles(): Promise<Membership> {
  const membership = await requireMembership();
  if (!SETTLES(membership.role)) redirect("/dashboard/orders");
  return membership;
}

/** Accesos del equipo y la suscripción: del dueño y de nadie más. */
export async function requireOwner(): Promise<Membership> {
  const membership = await requireMembership();
  if (membership.role !== "owner") redirect("/dashboard");
  return membership;
}
