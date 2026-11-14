-- APC 1.9: Login pro Familie mit Freigabe durch den Betreiber.
-- Einmal im Supabase-Dashboard unter «SQL Editor» ausführen (zuerst im Projekt apc-beta), nach 01_kv.sql.
--
-- Ablauf: Familie registriert sich in der App (Vorname, Name, E-Mail, Passwort) → Eintrag in
-- public.familien mit Status «wartend» → Betreiber setzt im Table Editor den Status auf «aktiv».
-- «deaktiviert» sperrt den Zugang wieder. Die Daten der Familie bleiben dabei erhalten.

create table if not exists public.familien (
  user_id         uuid        primary key references auth.users(id) on delete cascade,
  email           text        not null default '',
  vorname         text        not null default '' check (length(vorname)  <= 60),
  nachname        text        not null default '' check (length(nachname) <= 60),
  status          text        not null default 'wartend' check (status in ('wartend', 'aktiv', 'deaktiviert')),
  registriert_am  timestamptz not null default now(),
  status_geaendert_am timestamptz,
  notiz           text        not null default ''
);
comment on table public.familien is 'APC: registrierte Familien. Status hier ändern: wartend → aktiv (freischalten), aktiv → deaktiviert (sperren).';

-- Neue Registrierung → automatisch Eintrag mit Status «wartend»
create or replace function public.familien_neu() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.familien (user_id, email, vorname, nachname)
  values (new.id, coalesce(new.email, ''),
          left(trim(coalesce(new.raw_user_meta_data->>'vorname', '')), 60),
          left(trim(coalesce(new.raw_user_meta_data->>'nachname', '')), 60))
  on conflict (user_id) do nothing;
  return new;
end $$;
drop trigger if exists familien_neu on auth.users;
create trigger familien_neu after insert on auth.users
for each row execute function public.familien_neu();

-- Datum der Statusänderung automatisch setzen
create or replace function public.familien_status_datum() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.status is distinct from old.status then new.status_geaendert_am := now(); end if;
  return new;
end $$;
drop trigger if exists familien_status_datum on public.familien;
create trigger familien_status_datum before update on public.familien
for each row execute function public.familien_status_datum();

-- Bestehende Logins (z. B. das eigene Familien-Login) übernehmen und gleich freischalten
insert into public.familien (user_id, email, status, status_geaendert_am)
select id, coalesce(email, ''), 'aktiv', now() from auth.users
on conflict (user_id) do nothing;

-- Ist das angemeldete Login freigeschaltet?
create or replace function public.ist_aktiv() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.familien f where f.user_id = (select auth.uid()) and f.status = 'aktiv');
$$;
revoke all on function public.ist_aktiv() from public, anon;
grant execute on function public.ist_aktiv() to authenticated;

-- Row Level Security: jede Familie darf nur ihren eigenen Eintrag LESEN (für die Statusanzeige).
-- Ändern kann den Status nur der Betreiber im Dashboard – nie die Familie selbst.
alter table public.familien enable row level security;
drop policy if exists "familien eigene lesen" on public.familien;
create policy "familien eigene lesen" on public.familien for select to authenticated using ((select auth.uid()) = user_id);
revoke all on public.familien from anon, authenticated;
grant select on public.familien to authenticated;

-- Trainingsdaten (public.kv) nur für freigeschaltete Familien
drop policy if exists "kv eigene lesen"   on public.kv;
drop policy if exists "kv eigene anlegen" on public.kv;
drop policy if exists "kv eigene ändern"  on public.kv;
drop policy if exists "kv eigene löschen" on public.kv;
create policy "kv eigene lesen"   on public.kv for select to authenticated using ((select auth.uid()) = user_id and (select public.ist_aktiv()));
create policy "kv eigene anlegen" on public.kv for insert to authenticated with check ((select auth.uid()) = user_id and (select public.ist_aktiv()));
create policy "kv eigene ändern"  on public.kv for update to authenticated using ((select auth.uid()) = user_id and (select public.ist_aktiv())) with check ((select auth.uid()) = user_id and (select public.ist_aktiv()));
create policy "kv eigene löschen" on public.kv for delete to authenticated using ((select auth.uid()) = user_id and (select public.ist_aktiv()));
