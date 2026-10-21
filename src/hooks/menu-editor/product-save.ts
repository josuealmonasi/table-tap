import type { EditorContext, ProductInput } from "./types";

/** Never send a form's opening count as part of a description or price edit. */
export async function saveProduct(
  ctx: EditorContext,
  id: string,
  input: Partial<ProductInput & { category_id: string | null }>,
): Promise<void> {
  if (!ctx.ready()) throw new Error("Menu has not loaded");
  const { stock, expectedStock, expectedEpoch, ...changes } = input;
  async function send(method: string, body: object): Promise<void> {
    let message = ctx.t("write.updateProduct");
    try {
      const response = await fetch("/api/products", {
        method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      if (response.ok) return;
      const data = await response.json();
      message = data.error || message;
      if (response.status === 409) await ctx.reload();
    } catch {
      // A failed send keeps the editor open and says it did not save.
    }
    ctx.toast(message, "error");
    throw new Error(message);
  }
  // Only a form that deliberately changed the count supplies its opening
  // values. Older callers carrying unchanged stock cannot overwrite a sale.
  if (stock !== undefined && expectedStock !== undefined && expectedEpoch !== undefined) {
    await send("POST", { id, stock, expectedStock, expectedEpoch });
  }
  if (Object.keys(changes).length) await send("PATCH", { id, changes });
  ctx.toast(ctx.t("done.productUpdated"));
  await ctx.reload();
}
