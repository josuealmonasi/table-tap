import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isRateLimited } from "@/lib/rate-limit";
import { TOKEN_SHAPE } from "@/lib/printing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * CloudPRNT — la impresora nos habla a nosotros.
 *
 * Un navegador no puede abrir un socket ni hablar Bluetooth clásico, así que la
 * página nunca podrá mandarle nada a una impresora térmica. Estas la invierten:
 * el aparato se queda en el wifi del restaurante y nos sondea por HTTPS. No
 * corre nada en el local, no hay puente, no necesitamos su IP.
 *
 *   POST   ¿hay algo para mí?      → { jobReady }
 *   GET    dame el trabajo          → el texto de la comanda
 *   DELETE ya lo imprimí            → se cierra
 *
 * El token de la URL es toda la credencial, porque una impresora no puede
 * iniciar sesión. Por eso no compra nada más: sólo ve los trabajos de SU
 * impresora y sólo puede cerrarlos. Ver docs/printing.md.
 */

/** Cuánto puede tener una comanda reclamada antes de volver a la cola. */
const CLAIM_MINUTES = 2;

async function printerFor(token: string) {
  if (!TOKEN_SHAPE.test(token)) return null;
  const db = createAdminClient();
  const { data } = await db
    .from("printers")
    .select("id, restaurant_id, active")
    .eq("token", token)
    .maybeSingle();
  return data?.active ? data : null;
}

/** ¿Hay trabajo? Y de paso, cómo dice la impresora que se encuentra. */
export async function POST(req: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  // Por token, no por IP: todas las impresoras de un local salen por la misma.
  if (await isRateLimited(`print:${token}`, 120, 60)) {
    return NextResponse.json({ jobReady: false }, { status: 429 });
  }
  const printer = await printerFor(token);
  if (!printer) return NextResponse.json({ jobReady: false }, { status: 404 });

  const body = (await req.json().catch(() => ({}))) as {
    printerMAC?: string;
    status?: string;
    statusCode?: string;
  };
  const db = createAdminClient();

  // Lo que reporta de sí misma: sin papel, tapa abierta, atascada. Se guarda
  // para que el dueño lo vea en Ajustes en vez de adivinar por qué no sale.
  const trouble = body.statusCode && body.statusCode !== "200 OK" ? body.statusCode : null;
  await db
    .from("printers")
    .update({ last_seen_at: new Date().toISOString(), mac: body.printerMAC ?? null, last_error: trouble })
    .eq("id", printer.id);

  // Lo que alguien reclamó y no imprimió vuelve a la cola antes de mirar.
  await db.rpc("requeue_stale_print_jobs", { p_minutes: CLAIM_MINUTES });

  const { data: job } = await db
    .from("print_jobs")
    .select("id")
    .eq("printer_id", printer.id)
    .eq("status", "queued")
    .order("created_at")
    .limit(1)
    .maybeSingle();

  return NextResponse.json({
    jobReady: Boolean(job),
    mediaTypes: ["text/plain"],
    jobToken: job?.id ?? "",
  });
}

/** Dame la comanda. Se marca reclamada al entregarla, no antes. */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const printer = await printerFor(token);
  if (!printer) return new NextResponse("", { status: 404 });

  const db = createAdminClient();
  const { data: job } = await db
    .from("print_jobs")
    .select("id, body, attempts")
    .eq("printer_id", printer.id)
    .eq("status", "queued")
    .order("created_at")
    .limit(1)
    .maybeSingle();

  if (!job) return new NextResponse("", { status: 200 });

  await db
    .from("print_jobs")
    .update({ status: "claimed", claimed_at: new Date().toISOString(), attempts: job.attempts + 1 })
    .eq("id", job.id);

  return new NextResponse(job.body, {
    status: 200,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}

/**
 * Ya salió.
 *
 * Si este aviso se pierde —el wifi se cae entre la hoja y el acuse— la comanda
 * vuelve a la cola y se imprime otra vez. Una hoja de más es barata; una que
 * falta le cuesta la comida a una mesa.
 */
export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const printer = await printerFor(token);
  if (!printer) return new NextResponse("", { status: 404 });

  const db = createAdminClient();
  await db
    .from("print_jobs")
    .update({ status: "printed", printed_at: new Date().toISOString() })
    .eq("printer_id", printer.id)
    .eq("status", "claimed");

  return new NextResponse("", { status: 200 });
}
