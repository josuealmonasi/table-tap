"use client";

import { useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useT } from "@/lib/i18n/context";
import { useToast } from "@/components/ui/Toast";
import { BUCKET, DISH, fileError, itemPath, pathFromUrl } from "@/lib/images";
import { imageSize, resizeToSpec } from "@/lib/image-resize";
import DishImage from "@/components/customer/DishImage";

interface DishPhotoFieldProps {
  restaurantId: string;
  /** Current photo, if the dish has one. */
  value: string | null;
  onChange: (url: string | null) => void;
  /** Shown in the placeholder while there is no photo. */
  emoji: string;
  name: string;
}

/**
 * A dish's photo: upload, preview, remove.
 *
 * This replaced a free-text "image URL" box. That box let a menu point at any
 * host on the internet, which would have handed whoever ran it the IP of every
 * diner who opened the menu, and let the picture be changed after the owner
 * approved it. Uploading is the only way in now.
 *
 * The preview is the customer's own thumbnail at the size the menu draws it,
 * so an owner can see what a diner will see.
 */
export default function DishPhotoField({
  restaurantId,
  value,
  onChange,
  emoji,
  name,
}: DishPhotoFieldProps) {
  const t = useT();
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  async function choose(file: File): Promise<void> {
    const bad = fileError(file, DISH);
    if (bad) {
      toast(t(bad, { mb: String(Math.round(DISH.maxBytes / 1024 / 1024)) }), "error");
      return;
    }

    setBusy(true);
    const supabase = createClient();
    try {
      const { width } = await imageSize(file);
      if (width < DISH.minWidth) {
        toast(t("img.small", { w: String(width), min: String(DISH.minWidth) }));
      }

      const resized = await resizeToSpec(file, DISH);
      // A fresh id per upload: a dish being created has no id yet, and this
      // keeps replacing a photo from fighting a cached copy of the old one.
      const path = itemPath(restaurantId, crypto.randomUUID());
      const { error } = await supabase.storage
        .from(BUCKET)
        .upload(path, resized, { contentType: "image/webp" });
      if (error) {
        toast(t("img.failed"), "error");
        return;
      }

      const previous = value ? pathFromUrl(value) : null;
      const {
        data: { publicUrl },
      } = supabase.storage.from(BUCKET).getPublicUrl(path);
      onChange(publicUrl);
      // Only once the new one is safely in place.
      if (previous) await supabase.storage.from(BUCKET).remove([previous]);
    } catch {
      toast(t("img.failed"), "error");
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function remove(): Promise<void> {
    const previous = value ? pathFromUrl(value) : null;
    onChange(null);
    if (previous) await createClient().storage.from(BUCKET).remove([previous]);
  }

  return (
    <div className="tt-dish-photo">
      <div className="tt-dish-photo-preview">
        <DishImage url={value} emoji={emoji} name={name} />
      </div>
      <div className="tt-dish-photo-actions">
        <span className="tt-mod-label">{t("img.dishTitle")}</span>
        <p className="tt-muted" style={{ fontSize: 12, margin: "2px 0 8px" }}>
          {t("img.dishHint", { w: String(DISH.width) })}
        </p>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button
            type="button"
            className="tt-btn tt-btn-ghost tt-btn-sm"
            disabled={busy}
            onClick={() => fileRef.current?.click()}
          >
            {busy ? t("img.uploading") : value ? t("img.replace") : t("img.choose")}
          </button>
          {value && (
            <button
              type="button"
              className="tt-btn tt-btn-ghost tt-btn-sm"
              disabled={busy}
              onClick={remove}
            >
              {t("img.remove")}
            </button>
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
    </div>
  );
}
