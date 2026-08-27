import { TERMS_VERSION } from "@/lib/legal";
import doc from "./terms-es.json";

export interface Clause {
  title: string;
  paragraphs: string[];
}

/**
 * Los términos, en español, que es la versión que rige.
 *
 * En trato de usted y registro formal, que es el que corresponde a un contrato
 * entre dos negocios. Formal no quiere decir ilegible: siguen siendo frases
 * cortas y sin "el Usuario reconoce y acepta por medio del presente
 * instrumento". Un contrato que nadie lee no protege a nadie.
 *
 * El texto vive en `terms-es.json` porque de ahí se arma también el PDF que la
 * gente descarga. Dos copias del mismo contrato es un contrato que tarde o
 * temprano dice dos cosas distintas: se edita el JSON y se corre
 * `node scripts/legal-pdf.mjs`.
 */
export const TERMS_ES: Clause[] = doc.clauses;

export const TERMS_ES_META = {
  title: doc.title,
  intro: doc.intro,
  version: `Versión vigente: ${TERMS_VERSION}`,
};
