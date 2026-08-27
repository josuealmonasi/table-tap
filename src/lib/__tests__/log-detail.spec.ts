import { describe, expect, it } from "vitest";
import { entitiesNamedBy } from "@/lib/log-detail";

describe("buscar por el nombre que se ve en la fila", () => {
  // The column stores "settings"; the row shows "Ajustes". Without this, typing
  // what is on screen found nothing.
  const es = (entity: string) =>
    ({
      staff: "Equipo",
      order: "Pedido",
      bill: "Cuenta",
      discount: "Descuento",
      coupon: "Cupón",
      promotion: "Promoción",
      settings: "Ajustes",
      menu: "Menú",
    })[entity] ?? entity;

  it("encuentra el tipo por su rótulo traducido", () => {
    expect(entitiesNamedBy("ajustes", es)).toEqual(["settings"]);
    expect(entitiesNamedBy("Cuenta", es)).toEqual(["bill"]);
  });

  it("no exige acentos ni mayúsculas", () => {
    expect(entitiesNamedBy("cupon", es)).toEqual(["coupon"]);
    expect(entitiesNamedBy("PROMOCIÓN", es)).toEqual(["promotion"]);
  });

  it("acepta un prefijo, que es como se escribe en un buscador", () => {
    expect(entitiesNamedBy("desc", es)).toEqual(["discount"]);
  });

  it("devuelve todos los que el texto nombra, no adivina uno", () => {
    // "cu" is inside Cuenta, Cupón and desCUento: all three are searched, and the
    // search shows rows from all three instead of choosing on its own.
    expect(entitiesNamedBy("cu", es).sort()).toEqual(["bill", "coupon", "discount"]);
  });

  it("no devuelve nada cuando el texto no nombra ningún tipo", () => {
    expect(entitiesNamedBy("demo@tabletap.dev", es)).toEqual([]);
    expect(entitiesNamedBy("   ", es)).toEqual([]);
  });
});
