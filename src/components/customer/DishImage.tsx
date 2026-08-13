import Image from "next/image";
import { DISH } from "@/lib/images";

interface DishImageProps {
  url: string | null | undefined;
  emoji: string | null | undefined;
  name: string;
  /** The thumbnail on a row, or the wide strip at the top of the detail screen. */
  variant?: "thumb" | "hero";
}

/**
 * A dish's picture, or the emoji standing in for it.
 *
 * Both containers are a fixed size with `overflow: hidden`, so swapping an
 * emoji for a photograph cannot change the height of a row — which is what
 * keeps the list and its skeleton the same shape either way.
 */
export default function DishImage({ url, emoji, name, variant = "thumb" }: DishImageProps) {
  if (!url) return <>{emoji || "🍽️"}</>;

  return (
    <Image
      className="tt-dish-img"
      src={url}
      alt={name}
      width={DISH.width}
      height={DISH.height}
      // The thumbnail is ~104px and the hero is the full column width. Asking
      // for the right one keeps a phone off a desktop-sized file.
      sizes={variant === "hero" ? "(max-width: 1024px) 100vw, 460px" : "120px"}
    />
  );
}
