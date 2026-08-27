/**
 * Qué formas de pagar tiene delante un comensal, y por qué faltan las que faltan.
 *
 * Vive aparte y sin IO porque lo consultan dos lados que tienen que decir lo
 * mismo: el carrito, que pinta los botones y el renglón de abajo, y Ajustes,
 * que le explica al dueño qué está viendo su cliente. Cuando cada uno lo
 * decidía por su cuenta, el carrito acabó prometiendo "Paga ahora con tarjeta"
 * debajo de una pantalla que no tenía ningún botón para pagar con tarjeta.
 */

export interface PaymentContext {
  /** Hay cuenta de Stripe conectada y habilitada para cobrar. */
  cardsEnabled: boolean;
  /** El interruptor de "que las mesas paguen al final". */
  allowPayLater: boolean;
  /** El interruptor de "que paguen en la caja", que es del QR general. */
  allowCounterPayment: boolean;
  /** Escaneó el QR de una mesa, o el general del restaurante. */
  atTable: boolean;
}

export interface PaymentOptions {
  /** Pagar con tarjeta ahora mismo. */
  payNow: boolean;
  /** Ordenar y dejar la cuenta abierta. Sólo en mesa: sin mesa no hay a quién cobrarle. */
  payLater: boolean;
  /** Ordenar y pagar en la caja. Sólo sin mesa: en mesa lo retiene la cuenta. */
  payCounter: boolean;
}

export function paymentOptions(ctx: PaymentContext): PaymentOptions {
  return {
    payNow: ctx.cardsEnabled,
    // Dejar la cuenta abierta necesita una mesa contra la cual dejarla.
    payLater: ctx.atTable && ctx.allowPayLater,
    // Y la caja sólo tiene sentido donde no hay mesa que retenga el pedido.
    payCounter: !ctx.atTable && ctx.allowCounterPayment,
  };
}

/** ¿Le queda alguna forma de ordenar? Si no, el carrito es un callejón sin salida. */
export function canOrder(options: PaymentOptions): boolean {
  return options.payNow || options.payLater || options.payCounter;
}

/**
 * Qué decir bajo los botones — nombrando sólo lo que de verdad está ahí.
 *
 * Es una clave de traducción y no una frase: quien pinta la tiene traducida, y
 * lo que aquí se decide es cuál corresponde, que es lo que se estaba fallando.
 */
export function paymentHintKey(options: PaymentOptions): string {
  const { payNow, payLater, payCounter } = options;
  if (!canOrder(options)) return "cart.noCardYet";
  // Las dos juntas: es el caso que el restaurante quiere, y el único en el que
  // se puede prometer tarjeta y cuenta abierta en la misma línea.
  if (payNow && payLater) return "cart.payNowHint";
  if (payNow && payCounter) return "cart.counterHint";
  // Sólo tarjeta: se cobra aquí y no hay nada que dejar abierto.
  if (payNow) return "cart.securedBy";
  // Sin tarjeta conectada, prometerla sería mentir. Se dice lo que sí pasa.
  if (payLater) return "cart.payLaterOnlyHint";
  return "cart.counterOnlyHint";
}

/**
 * Lo que el dueño necesita saber de su propia configuración.
 *
 * `null` cuando no hay nada que advertir. Cuando lo hay, es porque un
 * interruptor que él encendió no está haciendo lo que promete su rótulo.
 */
export function ownerWarningKey(ctx: PaymentContext): string | null {
  if (ctx.cardsEnabled) return null;
  // Sin Stripe no hay pago en línea en ninguna pantalla. Lo que cambia es qué
  // tan grave es, y eso depende de lo que quede encendido.
  if (!ctx.allowPayLater && !ctx.allowCounterPayment) return "dash.noPaymentAtAll";
  return "dash.noCardsConnected";
}
