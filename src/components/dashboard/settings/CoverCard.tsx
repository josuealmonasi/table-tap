"use client";

import { useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useT } from "@/lib/i18n/context";
import { useToast } from "@/components/ui/Toast";
import { useConfirm } from "@/components/ui/ConfirmDialog";
import { useSettings } from "@/hooks/useSettings";
import { BUCKET, COVER, coverPath, fileError } from "@/lib/images";
import { imageSize, resizeToSpec } from "@/lib/image-resize";
import CoverBanner from "@/components/customer/CoverBanner";
import type { Restaurant } from "@/lib/types";

/**
 * The owner's cover photo control: switch, upload, and a preview.
 *
 * The preview is the customer's own banner component rather than a mock-up, so
 * what is shown here is what a diner gets.
 */
export default function CoverCard({ restaurant }: { restaurant: Restaurant }) {
  const t = useT();
  const toast = useToast();
  const confirm = useConfirm();
  const { save } = useSettings();
  const fileRef = useRef<HTMLInputElement>(null);

  const [url, setUrl] = useState(restaurant.cover_url ?? null);
  const [enabled, setEnabled] = useState(Boolean(restaurant.cover_enabled));
  const [busy, setBusy] = useState(false);

  async function choose(file: File): Promise<void> {
    const bad = fileError(file, COVER);
    if (bad) {
      toast(t(bad, { mb: String(Math.round(COVER.maxBytes / 1024 / 1024)) }), "error");
      return;
    }

    setBusy(true);
    try {
      const { width } = await imageSize(file);
      if (width < COVER.minWidth) {
        // A warning, not a refusal — a slightly small photo still beats none.
        toast(t("img.small", { w: String(width), min: String(COVER.minWidth) }));
      }

      const resized = await resizeToSpec(file, COVER);
      const path = coverPath(restaurant.id);
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
      // One cover per restaurant, so the path repeats and a cached copy would
      // otherwise stay on screen after a replacement.
      const busted = `${publicUrl}?v=${Date.now()}`;

      // Uploading a photo is the act of wanting one shown, so this turns the
      // switch on rather than leaving the owner to wonder why nothing changed.
      if (await save({ cover_url: busted, cover_enabled: true })) {
        setUrl(busted);
        setEnabled(true);
      }
    } catch {
      toast(t("img.failed"), "error");
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function toggle(next: boolean): Promise<void> {
    setEnabled(next);
    if (!(await save({ cover_enabled: next }))) setEnabled(!next);
  }

  async function removeCover(): Promise<void> {
    const ok = await confirm({
      title: t("img.removeConfirm"),
      message: t("img.removeConfirmMsg"),
      confirmLabel: t("common.remove"),
      danger: true,
    });
    if (!ok) return;

    setBusy(true);
    try {
      await createClient().storage.from(BUCKET).remove([coverPath(restaurant.id)]);
      if (await save({ cover_url: null, cover_enabled: false })) {
        setUrl(null);
        setEnabled(false);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="tt-section">
      <div className="tt-section-head">
        <h3 className="tt-serif" style={{ margin: 0 }}>
          {t("img.coverTitle")}
        </h3>
        <span className="tt-muted" style={{ fontSize: 12 }}>
          {t("img.coverHint")}
        </span>
      </div>

      {/* Same switch the rest of Settings uses. */}
      <label className="tt-settings-toggle">
        <span>
          <strong>{t("img.show")}</strong>
          {!enabled && (
            <span className="tt-muted" style={{ display: "block", fontSize: 12 }}>
              {t("img.showOff")}
            </span>
          )}
        </span>
        <span className="tt-switch">
          <input
            type="checkbox"
            checked={enabled}
            disabled={busy || !url}
            onChange={e => toggle(e.target.checked)}
          />
          <span className="tt-switch-track" />
        </span>
      </label>

      <p className="tt-muted" style={{ fontSize: 12, marginTop: 4 }}>
        {t("img.size", { w: String(COVER.width), h: String(COVER.height) })}
      </p>

      <div className="tt-cover-preview">
        <div className="tt-mod-label">{t("img.preview")}</div>
        {url ? (
          <CoverBanner url={url} enabled name={restaurant.name} />
        ) : (
          <div className="tt-cover-empty" style={{ aspectRatio: `${COVER.width} / ${COVER.height}` }}>
            <span className="tt-muted" style={{ fontSize: 13 }}>
              {t("img.previewEmpty")}
            </span>
          </div>
        )}
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
            onClick={removeCover}
          >
            {t("img.remove")}
          </button>
        )}
      </div>
    </div>
  );
}
