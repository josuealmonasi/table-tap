import ts from "typescript";
import { expect, it } from "vitest";
import { read, walk } from "./helpers";

const TABLES = new Set(["restaurants", "menus", "categories", "menu_items", "item_addons", "promotions",
  "promotion_items", "dietary_tags", "icon_groups", "icon_group_items", "loyalty_programs", "plan_limits"]);
const RPCS = new Set(["duplicate_menu_v1", "save_product_addons_v1", "recount_stock", "delete_dietary_tag_v1",
  "save_promotion_v1", "admin_delete_restaurant"]);
function failures(file: string, code: string): string[] {
  const source = ts.createSourceFile(file, code, ts.ScriptTarget.Latest, true);
  const errors: string[] = [];
  function visit(node: ts.Node): void {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const method = node.expression.name.text;
      if (["insert", "update", "upsert", "delete", "rpc"].includes(method)) {
        const chain = node.getText(source);
        const table = /\.from\(["']([^"']+)["']\)/.exec(chain)?.[1];
        const rpc = method === "rpc" && node.arguments[0] && ts.isStringLiteral(node.arguments[0]) ? node.arguments[0].text : "";
        if ((table && TABLES.has(table)) || RPCS.has(rpc)) {
          // New random restaurant IDs cannot have an old menu entry. Never
          // exempt edits/deletes or caller-chosen IDs with this creation rule.
          const creation = table === "restaurants" && method === "insert" &&
            ["src/app/api/signup/route.ts", "src/app/api/admin/users/route.ts"].includes(file) && !/\bid\s*:/.test(chain);
          let owner: ts.Node | undefined = node.parent;
          while (owner && !ts.isFunctionLike(owner)) owner = owner.parent;
          const body = owner?.getText(source) ?? "";
          if (!creation && !/\binvalidatePublicMenu\(/.test(body)) {
            errors.push(`${file}:${source.getLineAndCharacterOfPosition(node.getStart()).line + 1}: ${table ?? rpc}`);
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return errors;
}

it("every public-menu route writer clears its restaurant tag", () => {
  const files = [...walk("src/app/api"), "src/lib/promotion-save.ts", "src/lib/subscription-sync.ts", "src/lib/admin-plan.ts", "src/lib/stripe-connect.ts"];
  const errors = files.flatMap(file => failures(file, read(file)));
  expect(errors, `public menu writers without invalidation:\n${errors.join("\n")}`).toEqual([]);
});

it("detects a missing invalidation rather than merely an imported name", () => {
  const file = "src/app/api/products/route.ts";
  expect(failures(file, read(file).replace(/invalidatePublicMenu\(actor.restaurantId\);/g, ""))).not.toEqual([]);
});

it("keeps both diner pages dynamic and their skeletons unchanged", () => {
  for (const file of ["src/app/r/[restaurantId]/page.tsx", "src/app/r/[restaurantId]/t/[tableId]/page.tsx"]) {
    expect(read(file)).toContain('dynamic = "force-dynamic"');
    expect(read(file)).toMatch(/Suspense fallback={<MenuSkeleton[^>]*cover={cover} loyalty={loyalty}/);
  }
});
