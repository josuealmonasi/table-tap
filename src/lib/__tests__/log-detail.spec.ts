import { describe, expect, it } from "vitest";
import { entitiesNamedBy } from "@/lib/log-detail";

describe("buscar por el nombre que se ve en la fila", () => {
  // La columna guarda "settings"; la fila enseña "Ajustes". Sin esto, escribir
  // lo que está en pantalla no encontraba nada.
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
    // "cu" está dentro de Cuenta, Cupón y desCUento: los tres se buscan, y el
    // buscador enseña las filas de los tres en vez de elegir por su cuenta.
    expect(entitiesNamedBy("cu", es).sort()).toEqual(["bill", "coupon", "discount"]);
  });

  it("no devuelve nada cuando el texto no nombra ningún tipo", () => {
    expect(entitiesNamedBy("demo@tabletap.dev", es)).toEqual([]);
    expect(entitiesNamedBy("   ", es)).toEqual([]);
  });
});
