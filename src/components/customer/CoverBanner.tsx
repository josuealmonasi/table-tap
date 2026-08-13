import Image from "next/image";

interface CoverBannerProps {
  url: string | null | undefined;
  enabled: boolean | undefined;
  /** Restaurant name — the photo is decoration, so the alt text names the place. */
  name: string;
  /** The owner's preview renders below the fold; the real menu is the LCP. */
  priority?: boolean;
}

/**
 * The photo above the menu header.
 *
 * Rendered by the customer menu and by the owner's preview in Settings, from
 * one component on purpose: a preview that can disagree with the real thing is
 * worse than no preview at all.
 *
 * The band reserves its aspect ratio before the photo arrives, so the menu
 * doesn't jump once it loads.
 */
export default function CoverBanner({
  url,
  enabled,
  name,
  priority = false,
}: CoverBannerProps) {
  if (!enabled || !url) return null;

  return (
    <div className="tt-cover">
      <Image
        src={url}
        alt={name}
        fill
        /* The column is 460px on a phone and 1080px from the desktop
           breakpoint up. Claiming 460 everywhere had the optimiser serve a
           phone-sized file to a desktop banner, which is a blurry one. */
        sizes="(max-width: 1024px) 100vw, 1080px"
        style={{ objectFit: "cover" }}
        priority={priority}
      />
    </div>
  );
}
