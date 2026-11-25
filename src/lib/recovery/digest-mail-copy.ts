import type { Locale } from "@/lib/i18n";

export const digestCopy = {
  en: {
    headline: "How yesterday went",
    sales: "Sales",
    orders: "Orders · average ticket",
    split: (dineIn: number, toGo: number) => `${dineIn} dine-in · ${toGo} to go`,
    compare: (weekday: string) => `vs. last ${weekday}`,
    noComparison: "No sales on the same day last week",
    card: "Card",
    cash: "Cash",
    tips: "Tips",
    discounts: "Discounts and promotions",
    refunds: "Refunds",
    attention: "Needs your attention",
    discountRequests: (n: number) => n === 1 ? "1 discount requested by staff awaits your approval" : `${n} discounts requested by staff await your approval`,
    writeOffs: (n: number) => n === 1 ? "1 write-off request awaits your approval" : `${n} write-off requests await your approval`,
    offline: (n: number) => n === 1 ? "1 sale collected offline is held for review" : `${n} sales collected offline are held for review`,
    accounts: (n: number, total: string) => `${n} ${n === 1 ? "customer owes" : "customers owe"} ${total} on open accounts`,
    stock: (n: number, names: string) => `${n} ${n === 1 ? "item" : "items"} sold out: ${names}`,
    due: (n: number) => n === 1 ? "1 refund still needs to be issued" : `${n} refunds still need to be issued`,
    dishes: "Most ordered",
    dashboard: "Open the dashboard",
    footer: (name: string, owner: boolean, guest = false) => guest
      ? `You get this digest because the owner of ${name} added your address and you confirmed it.`
      : owner
      ? `You get this digest because you own ${name}.`
      : `You get this digest because you opted in as a manager at ${name}.`,
    stop: "Stop receiving this digest",
  },
  es: {
    headline: "Así te fue ayer",
    sales: "Ventas",
    orders: "Pedidos · ticket promedio",
    split: (dineIn: number, toGo: number) => `${dineIn} en mesa · ${toGo} para llevar`,
    compare: (weekday: string) => `vs. el ${weekday} pasado`,
    noComparison: "Sin ventas el mismo día de la semana pasada",
    card: "Tarjeta",
    cash: "Efectivo",
    tips: "Propinas",
    discounts: "Descuentos y promociones",
    refunds: "Reembolsos",
    attention: "Necesita tu atención",
    discountRequests: (n: number) => n === 1 ? "1 descuento que pidieron los meseros espera tu aprobación" : `${n} descuentos que pidieron los meseros esperan tu aprobación`,
    writeOffs: (n: number) => n === 1 ? "1 solicitud para cancelar una cuenta espera tu aprobación" : `${n} solicitudes para cancelar cuentas esperan tu aprobación`,
    offline: (n: number) => n === 1 ? "1 venta cobrada sin conexión está guardada para revisión" : `${n} ventas cobradas sin conexión están guardadas para revisión`,
    accounts: (n: number, total: string) => `${n} ${n === 1 ? "cliente debe" : "clientes deben"} ${total} en cuentas abiertas`,
    stock: (n: number, names: string) => n === 1 ? `1 producto se agotó: ${names}` : `${n} productos se agotaron: ${names}`,
    due: (n: number) => n === 1 ? "1 reembolso sigue pendiente" : `${n} reembolsos siguen pendientes`,
    dishes: "Lo que más se pidió",
    dashboard: "Abrir el panel",
    footer: (name: string, owner: boolean, guest = false) => guest
      ? `Recibes este resumen porque el dueño de ${name} agregó tu correo y tú lo confirmaste.`
      : owner
      ? `Recibes este resumen porque eres dueño de ${name}.`
      : `Recibes este resumen porque lo activaste como gerente de ${name}.`,
    stop: "Dejar de recibir este resumen",
  },
} satisfies Record<Locale, object>;
