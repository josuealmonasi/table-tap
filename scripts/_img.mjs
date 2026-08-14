import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";
const rd=f=>fs.existsSync(f)?fs.readFileSync(f,"utf8"):"";
const pick=t=>Object.fromEntries(t.split("\n").filter(l=>l.includes("=")).map(l=>[l.slice(0,l.indexOf("=")).trim(), l.slice(l.indexOf("=")+1).trim()]));
const dev=pick(rd(".env.local")+"\n"+rd(".env.development.local"));
const d=createClient(dev.NEXT_PUBLIC_SUPABASE_URL,dev.SUPABASE_SECRET_KEY);
const R="ef812e8a-2151-466d-b3bb-9fa080139934";
const base="https://vayymkzrvlepoksualku.supabase.co/storage/v1/object/public/menu/2be8e35b-18c5-4be6-bd07-74c82fb8788c/";
const urls={};
for (const f of ["cover.webp","logo.webp"]) {
  const buf = Buffer.from(await (await fetch(base+f)).arrayBuffer());
  const { error } = await d.storage.from("menu").upload(`${R}/${f}`, buf, { contentType:"image/webp", upsert:true });
  if (error) { console.error(f, error); continue; }
  urls[f] = d.storage.from("menu").getPublicUrl(`${R}/${f}`).data.publicUrl + "?v=" + Date.now();
}
const { error } = await d.from("restaurants").update({ cover_url: urls["cover.webp"], logo_url: urls["logo.webp"], cover_enabled: true }).eq("id", R);
console.log(error ?? urls);
