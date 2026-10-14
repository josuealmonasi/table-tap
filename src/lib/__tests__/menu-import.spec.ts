import { describe, expect, it } from "vitest";
import { parseCsv, toCsv } from "@/lib/csv";
import { planImport, readPrice, sectionsOf } from "@/lib/menu-import";

/**
 * A café switching over asked to bring its menu from a spreadsheet. Whatever
 * the spreadsheet saved, each line either becomes a product or says why not —
 * and nothing is written until the owner has read that list.
 */

describe("a CSV file", () => {
  it("reads quotes, commas and line breaks inside a cell, CRLF, and a byte order mark", () => {
    const text = '﻿nombre,precio,descripcion\r\n"Latte, grande",55,"Con ""leche""\nde almendra"\r\n\r\nAmericano,35,\r\n';
    expect(parseCsv(text)).toEqual([
      ["nombre", "precio", "descripcion"],
      ["Latte, grande", "55", 'Con "leche"\nde almendra'],
      ["Americano", "35", ""],
    ]);
  });

  it("reads the semicolons Excel writes in Spanish", () => {
    expect(parseCsv("nombre;precio\nCapuchino;48,50")).toEqual([["nombre", "precio"], ["Capuchino", "48,50"]]);
  });

  it("writes back what it reads", () => {
    const rows = [["nombre", "precio"], ["Latte, grande", "55"], ['Té "chai"', "40"]];
    expect(parseCsv(toCsv(rows))).toEqual(rows);
  });
});

describe("a price as people type it", () => {
  it("reads pesos, cents, signs and both decimal marks", () => {
    expect(readPrice("35")).toBe(35);
    expect(readPrice("$35.50")).toBe(35.5);
    expect(readPrice("48,50")).toBe(48.5);
    expect(readPrice("1,250.00")).toBe(1250);
    expect(readPrice("1,250")).toBe(1250);
    expect(readPrice("35 MXN")).toBe(35);
    expect(readPrice("0")).toBe(0);
  });

  it("refuses what is not one", () => {
    for (const bad of ["", "gratis", "-5", "3.505", "1e3", "200000"]) expect(readPrice(bad)).toBeNull();
  });
});

describe("a sheet planned for import", () => {
  const sheet = (text: string) => parseCsv(text);

  it("finds its columns in Spanish or English, with or without accents", () => {
    const plan = planImport(sheet("Categoría,Nombre,Precio,Descripción,Emoji\nCafés,Latte,55,Leche entera,☕"), []);
    expect(plan.rows).toEqual([{ line: 2, category: "Cafés", name: "Latte", price: 55, description: "Leche entera", emoji: "☕" }]);
    const english = planImport(sheet("name,price,category\nCroissant,38,Bakery"), []);
    expect(english.rows[0]).toMatchObject({ name: "Croissant", price: 38, category: "Bakery", emoji: "🍽️" });
  });

  it("says when the sheet names no name or price column", () => {
    expect(planImport(sheet("producto_x,costo\nLatte,55"), []).missingColumns).toBe(true);
  });

  it("refuses each bad line with its reason and keeps the good ones", () => {
    const plan = planImport(
      sheet("nombre,precio\nLatte,55\n,20\nMocha,cincuenta\nlatte,60\nAmericano,35"),
      ["Americano"],
    );
    expect(plan.rows.map(r => r.name)).toEqual(["Latte"]);
    expect(plan.problems).toEqual([
      { line: 3, name: "", reason: "noName" },
      { line: 4, name: "Mocha", reason: "badPrice" },
      { line: 5, name: "latte", reason: "duplicate" },
      { line: 6, name: "Americano", reason: "exists" },
    ]);
  });

  it("names each section once, in the order the sheet does", () => {
    const plan = planImport(sheet("categoria,nombre,precio\nCafés,Latte,55\nPan,Concha,20\ncafes,Mocha,60\n,Agua,15"), []);
    expect(sectionsOf(plan.rows)).toEqual(["Cafés", "Pan"]);
  });
});

describe("the café template", () => {
  it("imports whole in both languages, every line a product", async () => {
    const { en } = await import("@/lib/i18n/en");
    const { es } = await import("@/lib/i18n/es");
    for (const csv of [en.menuImport.cafeCsv, es.menuImport.cafeCsv]) {
      const plan = planImport(parseCsv(csv), []);
      expect(plan.missingColumns).toBe(false);
      expect(plan.problems).toEqual([]);
      expect(plan.rows).toHaveLength(15);
    }
  });
});
