import { createHash } from "node:crypto";
import terms from "@/lib/legal/terms-es.json";

// Hash the complete source document in a stable encoding, not a rendered page.
export const TERMS_TEXT_HASH = createHash("sha256").update(JSON.stringify(terms)).digest("hex");
