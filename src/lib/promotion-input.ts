import type { PromotionKind } from "@/lib/promotions";

export interface Body {
  kind?: PromotionKind;
  name?: string;
  emoji?: string;
  description?: string | null;
  comboPrice?: number | null;
  buyQty?: number | null;
  payQty?: number | null;
  tiers?: { qty: number; price: number }[] | null;
  items?: { itemId: string; qty: number }[];
}

