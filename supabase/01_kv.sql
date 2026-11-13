-- APC Cloud-Abgleich (Variante A): eine Tabelle mit den Speicherblöcken der App, pro Familien-Login.
-- Einmal im Supabase-Dashboard unter «SQL Editor» ausführen (zuerst im Projekt apc-beta).

create table if not exists public.kv (
  user_id    uuid        not null default auth.uid() references auth.users(id) on delete cascade,
  key        text        not null check (key like 'apc.%' and length(key) <= 100),
  value      text        not null check (length(value) <= 2000000),
  device     text,
  updated_at timestamptz not null default now(),
  primary key (user_id, key)
);

-- updated_at bei jeder Änderung vom Server setzen (nicht von der Geräte-Uhr)
create or replace function public.kv_touch() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;
drop trigger if exists kv_touch on public.kv;
create trigger kv_touch before insert or update on public.kv
for each row execute function public.kv_touch();

create index if not exists kv_user_updated on public.kv (user_id, updated_at);

-- Row Level Security: jede Familie sieht und ändert nur ihre eigenen Zeilen
alter table public.kv enable row level security;
drop policy if exists "kv eigene lesen"   on public.kv;
drop policy if exists "kv eigene anlegen" on public.kv;
drop policy if exists "kv eigene ändern"  on public.kv;
drop policy if exists "kv eigene löschen" on public.kv;
create policy "kv eigene lesen"   on public.kv for select to authenticated using ((select auth.uid()) = user_id);
create policy "kv eigene anlegen" on public.kv for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "kv eigene ändern"  on public.kv for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "kv eigene löschen" on public.kv for delete to authenticated using ((select auth.uid()) = user_id);

-- Freigabe für die Data API (neue Tabellen werden nicht automatisch freigegeben): nur für angemeldete Nutzer, nie für anon
revoke all on public.kv from anon;
grant select, insert, update, delete on public.kv to authenticated;
