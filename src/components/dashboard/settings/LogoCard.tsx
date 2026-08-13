"use client";

import { useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useT } from "@/lib/i18n/context";
import { useToast } from "@/components/ui/Toast";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { useSettings } from "@/hooks/useSettings";
import { BUCKET, LOGO, fileError, logoPath } from "@/lib/images";
import { imageSize, resizeToSpec } from "@/lib/image-resize";
import RestaurantMark from "@/components/ui/RestaurantMark";
import type { Restaurant } from "@/lib/types";

/**
 * The restaurant's own mark: upload, preview, remove.
 *
 * The preview is the same avatar the customer sees, at the size it appears
 * over the cover, so an owner can tell whether their logo survives being that
 * small before a diner finds out.
 */
export default function LogoCard({ restaurant }: { restaurant: Restaurant }) {
  const t = useT();
  const toast = useToast();
  const confirm = useConfirm();
  const { save } = useSettings();
  const fileRef = useRef<HTMLInputElement>(null);

  const [url, setUrl] = useState(restaurant.logo_url ?? null);
  const [busy, setBusy] = useState(false);

  async function choose(file: File): Promise<void> {
    const bad = fileError(file, LOGO);
    if (bad) {
      toast(t(bad, { mb: String(Math.round(LOGO.maxBytes / 1024 / 1024)) }), "error");
      return;
    }

    setBusy(true);
    try {
      const { width } = await imageSize(file);
      if (width < LOGO.minWidth) {
        toast(t("img.small", { w: String(width), min: String(LOGO.minWidth) }));
      }

      const resized = await resizeToSpec(file, LOGO);
      const path = logoPath(restaurant.id);
      const supabase = createClient();
      const { error } = await supabase.storage
        .from(BUCKET)
        .upload(path, resized, { contentType: "image/webp", upsert: true });
      if (error) {
        toast(t("img.failed"), "error");
        return;
      }

      const {
        data: { publicUrl },
      } = supabase.storage.from(BUCKET).getPublicUrl(path);
      // One logo per restaurant, so the path repeats and a replacement would
      // otherwise sit behind a cached copy.
      const busted = `${publicUrl}?v=${Date.now()}`;
      if (await save({ logo_url: busted })) setUrl(busted);
    } catch {
      toast(t("img.failed"), "error");
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function removeLogo(): Promise<void> {
    const ok = await confirm({
      title: t("img.logoRemoveConfirm"),
      message: t("img.logoRemoveMsg"),
      confirmLabel: t("common.remove"),
      danger: true,
    });
    if (!ok) return;

    setBusy(true);
    try {
      await createClient().storage.from(BUCKET).remove([logoPath(restaurant.id)]);
      if (await save({ logo_url: null })) setUrl(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="tt-section">
      <div className="tt-section-head">
        <h3 className="tt-serif" style={{ margin: 0 }}>
          {t("img.logoTitle")}
        </h3>
        <span className="tt-muted" style={{ fontSize: 12 }}>
          {t("img.logoHint")}
        </span>
      </div>

      <div className="tt-logo-row">
        {/* The avatar exactly as the menu draws it, so its size is honest. */}
        <div className="tt-logo-preview">
          <RestaurantMark
            logoUrl={url}
            emoji={restaurant.logo}
            name={restaurant.name}
            size={84}
          />
        </div>
        <div>
          <p className="tt-muted" style={{ fontSize: 12, margin: "0 0 4px" }}>
            {t("img.logoSize", { min: String(LOGO.minWidth) })}
          </p>
          {!url && (
            <p className="tt-muted" style={{ fontSize: 12, margin: 0 }}>
              {t("img.logoOrIcon")}
            </p>
          )}
        </div>
      </div>

      <input
        ref={fileRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        style={{ display: "none" }}
        onChange={e => {
          const file = e.target.files?.[0];
          if (file) choose(file);
        }}
      />

      <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
        <button
          type="button"
          className="tt-btn tt-btn-primary tt-btn-sm"
          disabled={busy}
          onClick={() => fileRef.current?.click()}
        >
          {busy ? t("img.uploading") : url ? t("img.replace") : t("img.choose")}
        </button>
        {url && (
          <button
            type="button"
            className="tt-btn tt-btn-ghost tt-btn-sm"
            disabled={busy}
            onClick={removeLogo}
          >
            {t("img.remove")}
          </button>
        )}
      </div>
    </div>
  );
}
