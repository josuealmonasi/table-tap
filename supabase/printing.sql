-- ============================================================================
-- Impresión de comandas — CloudPRNT
--
-- En su propio archivo a propósito: esta rama vive sin fusionar y recibe `main`
-- cada semana, y meter esto en schema.sql —el archivo que más cambia— sería
-- pelearse con el mismo conflicto todos los lunes.
--
--   pnpm db:printing        (dev)
--   pnpm db:printing --prod
-- ============================================================================

-- Una impresora de un restaurante. El token es su única credencial: no puede
-- iniciar sesión, así que lo lleva en la URL que alguien teclea una vez.
create table if not exists printers (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references restaurants(id) on delete cascade,
  name          text not null,
  token         text not null unique,
  -- Lo que la impresora reporta de sí misma en cada sondeo.
  mac           text,
  last_seen_at  timestamptz,
  last_error    text,
  active        boolean not null default true,
  created_at    timestamptz not null default now()
);
create index if not exists printers_restaurant_idx on printers(restaurant_id);

alter table printers enable row level security;
drop policy if exists "team reads printers" on printers;
create policy "team reads printers" on printers for select
  using (has_role(restaurant_id, array['manager']));
-- Se crean y se borran por la API con la llave de servicio, que es la única
-- que llega al token. Nadie más lo lee.
revoke all on printers from anon, authenticated;
grant select (id, restaurant_id, name, mac, last_seen_at, last_error, active, created_at)
  on printers to authenticated;

-- La cola. Una fila por comanda y por impresora.
create table if not exists print_jobs (
  id            uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references restaurants(id) on delete cascade,
  printer_id    uuid not null references printers(id) on delete cascade,
  order_id      uuid references orders(id) on delete cascade,
  -- 'queued' espera, 'claimed' se la llevó una impresora, 'printed' se acabó.
  status        text not null default 'queued'
                check (status in ('queued', 'claimed', 'printed', 'failed')),
  body          text not null,
  attempts      int not null default 0,
  claimed_at    timestamptz,
  printed_at    timestamptz,
  created_at    timestamptz not null default now(),
  -- El mismo pedido no se encola dos veces para la misma impresora. Que lo
  -- diga la base y no una comprobación que alguien puede olvidar.
  unique (order_id, printer_id)
);
create index if not exists print_jobs_pending_idx
  on print_jobs(printer_id, status, created_at);

alter table print_jobs enable row level security;
drop policy if exists "team reads print jobs" on print_jobs;
create policy "team reads print jobs" on print_jobs for select
  using (has_role(restaurant_id, array['manager']));
revoke all on print_jobs from anon, authenticated;
grant select (id, restaurant_id, printer_id, order_id, status, attempts,
              claimed_at, printed_at, created_at) on print_jobs to authenticated;

-- Una comanda que alguien reclamó y nunca imprimió vuelve a la cola.
--
-- Es lo que pasa cuando la impresora se queda sin papel a media hoja, o cuando
-- el wifi se cae justo después de pedirla: sin esto el pedido se queda
-- "claimed" para siempre y la cocina nunca lo ve. Reimprimir de más es barato;
-- no imprimir le cuesta la comida a una mesa.
create or replace function public.requeue_stale_print_jobs(p_minutes int default 2)
returns int
language sql
security definer
set search_path = public
as $$
  with back as (
    update print_jobs
       set status = 'queued', claimed_at = null
     where status = 'claimed'
       and claimed_at < now() - make_interval(mins => p_minutes)
    returning 1
  )
  select count(*)::int from back;
$$;
revoke all on function public.requeue_stale_print_jobs(int) from public, anon, authenticated;
grant execute on function public.requeue_stale_print_jobs(int) to service_role;
