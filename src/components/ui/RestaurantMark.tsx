import Image from "next/image";
import { LOGO } from "@/lib/images";

interface RestaurantMarkProps {
  logoUrl: string | null | undefined;
  /** The emoji fallback, itself optional. */
  emoji: string | null | undefined;
  name: string;
  /** Rendered size in CSS pixels; the avatar is 64 on a phone, 84 on desktop. */
  size?: number;
}

/**
 * Whatever stands for the restaurant: its uploaded mark, else the emoji it
 * picked, else nothing at all.
 *
 * That order lives here rather than at each of the three places this appears,
 * so a restaurant can't end up showing its logo on the menu and an emoji in
 * the navbar.
 *
 * Returns null when there is neither, which is a real state — the icon is
 * optional, and callers use that to drop the surrounding avatar entirely
 * rather than draw an empty disc.
 */
export default function RestaurantMark({
  logoUrl,
  emoji,
  name,
  size = 64,
}: RestaurantMarkProps) {
  if (logoUrl) {
    return (
      <Image
        className="tt-mark-img"
        src={logoUrl}
        alt={name}
        width={LOGO.width}
        height={LOGO.height}
        sizes={`${size}px`}
      />
    );
  }
  if (emoji) return <>{emoji}</>;
  return null;
}

/** Does this restaurant have anything to show? Keeps the check in one place. */
export function hasMark(
  logoUrl: string | null | undefined,
  emoji: string | null | undefined,
): boolean {
  return Boolean(logoUrl || emoji);
}
