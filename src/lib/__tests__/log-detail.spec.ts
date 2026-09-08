import { describe, expect, it } from "vitest";
import { entitiesNamedBy } from "@/lib/log-detail";

describe("searching by the name shown on the row", () => {
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

  it("finds the kind by its translated label", () => {
    expect(entitiesNamedBy("ajustes", es)).toEqual(["settings"]);
    expect(entitiesNamedBy("Cuenta", es)).toEqual(["bill"]);
  });

  it("demands neither accents nor capitals", () => {
    expect(entitiesNamedBy("cupon", es)).toEqual(["coupon"]);
    expect(entitiesNamedBy("PROMOCIÓN", es)).toEqual(["promotion"]);
  });

  it("accepts a prefix, which is how people type into a search box", () => {
    expect(entitiesNamedBy("desc", es)).toEqual(["discount"]);
  });

  it("returns every kind the text names rather than guessing one", () => {
    // "cu" is inside Cuenta, Cupón and desCUento: all three are searched, and the
    // search shows rows from all three instead of choosing on its own.
    expect(entitiesNamedBy("cu", es).sort()).toEqual(["bill", "coupon", "discount"]);
  });

  it("returns nothing when the text names no kind at all", () => {
    expect(entitiesNamedBy("demo@tabletap.dev", es)).toEqual([]);
    expect(entitiesNamedBy("   ", es)).toEqual([]);
  });
});
