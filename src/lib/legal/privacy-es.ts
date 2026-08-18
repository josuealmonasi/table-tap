import type { Clause } from "./terms-es";
import { TERMS_VERSION } from "@/lib/legal";
import doc from "./privacy-es.json";

/**
 * Aviso de privacidad, exigido por la LFPDPPP para tratar datos personales en
 * México. Cubre dos grupos distintos que conviene no mezclar: el dueño del
 * restaurante, cuyos datos tratamos como responsables, y sus comensales, cuyos
 * datos tratamos por cuenta del restaurante.
 *
 * El texto vive en `privacy-es.json`, que es de donde sale el PDF. Ver la nota
 * en `terms-es.ts`.
 */
export const PRIVACY_ES: Clause[] = doc.clauses;

export const PRIVACY_ES_META = {
  title: doc.title,
  intro: doc.intro,
  version: `Versión vigente: ${TERMS_VERSION}`,
};
