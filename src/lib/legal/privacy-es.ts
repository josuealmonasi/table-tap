import type { Clause } from "./terms-es";
import { TERMS_VERSION } from "@/lib/legal";

/**
 * Aviso de privacidad, exigido por la LFPDPPP para tratar datos personales en
 * México. Cubre dos grupos distintos que conviene no mezclar: el dueño del
 * restaurante, cuyos datos tratamos como responsables, y sus comensales, cuyos
 * datos tratamos por cuenta del restaurante.
 */
export const PRIVACY_ES: Clause[] = [
  {
    title: "1. Quién es responsable",
    paragraphs: [
      "TableTap es responsable del tratamiento de los datos personales que recabamos de los restaurantes que contratan el servicio.",
      "Respecto de los datos de los comensales, el responsable es el restaurante: nosotros los tratamos como encargados, por su cuenta y siguiendo sus instrucciones.",
    ],
  },
  {
    title: "2. Qué datos tratamos",
    paragraphs: [
      "Del restaurante: nombre del negocio, nombre y correo de quien administra la cuenta, datos de contacto y datos fiscales cuando pides factura.",
      "Del equipo del restaurante: correo y rol, para dar acceso al panel.",
      "De los comensales: lo mínimo para que su pedido funcione — qué ordenaron, en qué mesa, si dejaron propina y su calificación del platillo si la dan. No pedimos su nombre, ni su teléfono, ni creamos cuentas de comensal.",
      "No guardamos datos de tarjetas bancarias. Los pagos los procesa Stripe con su propia política de privacidad.",
    ],
  },
  {
    title: "3. Para qué los usamos",
    paragraphs: [
      "Para prestar el servicio: mostrar el menú, tomar pedidos, mandarlos a la cocina, cobrar y generar los reportes del restaurante.",
      "Para facturarte, darte soporte y avisarte de cambios importantes en el servicio o en los precios.",
      "Para cuidar la seguridad de la plataforma y prevenir abusos.",
      "No vendemos datos personales, ni los usamos para publicidad de terceros.",
    ],
  },
  {
    title: "4. Con quién los compartimos",
    paragraphs: [
      "Con proveedores que hacen funcionar el servicio: alojamiento y base de datos, y Stripe para procesar pagos. Cada uno trata los datos únicamente para esa función.",
      "Con autoridades, cuando exista una obligación legal.",
    ],
  },
  {
    title: "5. Cuánto tiempo los conservamos",
    paragraphs: [
      "Mientras tu cuenta esté activa, y después el tiempo que exijan las obligaciones fiscales y legales aplicables.",
      "Los pedidos y sus importes se conservan porque son registro contable del restaurante.",
    ],
  },
  {
    title: "6. Tus derechos ARCO",
    paragraphs: [
      "Puedes solicitar el acceso, rectificación, cancelación u oposición al tratamiento de tus datos personales, así como revocar tu consentimiento.",
      "Para ejercerlos, escríbenos al correo de contacto publicado en el sitio. Te respondemos en los plazos que marca la ley.",
      "Si eres comensal de un restaurante que usa TableTap, dirige tu solicitud a ese restaurante; nosotros lo apoyamos para atenderla.",
    ],
  },
  {
    title: "7. Cambios a este aviso",
    paragraphs: [
      "Si cambia, publicamos la nueva versión en esta página y, cuando el cambio sea relevante, te lo mostramos al entrar al panel.",
    ],
  },
];

export const PRIVACY_ES_META = {
  title: "Aviso de Privacidad",
  intro:
    "Qué datos tratamos, para qué, y qué puedes pedirnos sobre ellos.",
  version: `Versión vigente: ${TERMS_VERSION}`,
};
