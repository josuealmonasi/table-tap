import { describe, expect, it } from "vitest";
import { apiCaseRegistrationErrors, read } from "./invariants/helpers";

const index = "scripts/api-cases.mjs";
const cash = "scripts/api-cases/cash.mjs";
const sabotage = (file: string, change: (source: string) => string): string[] =>
  apiCaseRegistrationErrors(name => name === file ? change(read(name)) : read(name));

describe("API case registration sabotage", () => {
  it("rejects an imported factory whose spread was dropped", () => {
    expect(sabotage(index, source => source.replace("    ...cashCases(fx),\n", "")))
      .toContain("cashCases: imported factory is not spread into cases");
  });

  it("rejects a dropped import even when its spread is also removed", () => {
    expect(sabotage(index, source => source
      .replace('import { cashCases } from "./api-cases/cash.mjs";\n', "")
      .replace("    ...cashCases(fx),\n", "")))
      .toContain(`${cash}: export cashCases is not imported`);
  });

  it("rejects an unused export in an imported part", () => {
    expect(sabotage(cash, source => `${source}\nexport function forgottenCases() { return []; }\n`))
      .toContain(`${cash}: export forgottenCases is not imported`);
  });

  it("accepts the restored registration", () => {
    expect(apiCaseRegistrationErrors()).toEqual([]);
  });
});
