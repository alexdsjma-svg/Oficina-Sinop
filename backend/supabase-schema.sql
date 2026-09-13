-- Oficina Sinop V6 - estrutura Supabase
-- Preparado para autenticação, sincronização e regras por função.

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  name text not null,
  role text not null,
  active boolean not null default true,
  login_slug text not null unique,
  must_change_password boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.vehicles (
  id text primary key,
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id)
);

create table if not exists public.treatments (
  id text primary key,
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id)
);

create table if not exists public.catalog (
  id text primary key,
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id)
);

create table if not exists public.suggestions (
  id text primary key,
  author_id uuid references auth.users(id),
  status text not null default 'Nova',
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id)
);

create table if not exists public.month_closures (
  month text primary key,
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id)
);

create table if not exists public.app_settings (
  key text primary key,
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id)
);

create table if not exists public.audit_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id),
  user_name text,
  role text,
  changes jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;
alter table public.vehicles enable row level security;
alter table public.treatments enable row level security;
alter table public.catalog enable row level security;
alter table public.suggestions enable row level security;
alter table public.month_closures enable row level security;
alter table public.app_settings enable row level security;
alter table public.audit_log enable row level security;

create or replace function public.current_role()
returns text
language sql stable security definer
set search_path = public
as $$
  select coalesce((select role from public.profiles where user_id = auth.uid() and active), '');
$$;

create or replace function public.is_leader()
returns boolean
language sql stable security definer
set search_path = public
as $$
  select public.current_role() in ('ADMINISTRADOR / CRIADOR','CHEFE DE OFICINA','CONTROLE DE QUADRO');
$$;

create or replace function public.is_admin()
returns boolean
language sql stable security definer
set search_path = public
as $$
  select public.current_role() = 'ADMINISTRADOR / CRIADOR';
$$;

drop policy if exists profiles_read on public.profiles;
create policy profiles_read on public.profiles for select to authenticated using (true);
drop policy if exists profiles_admin_update on public.profiles;
create policy profiles_admin_update on public.profiles for update to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists vehicles_read on public.vehicles;
create policy vehicles_read on public.vehicles for select to authenticated using (true);
drop policy if exists vehicles_write on public.vehicles;
create policy vehicles_write on public.vehicles for all to authenticated
using (public.current_role() <> '')
with check (public.current_role() <> '');

drop policy if exists treatments_read on public.treatments;
create policy treatments_read on public.treatments for select to authenticated
using (public.current_role() in ('ADMINISTRADOR / CRIADOR','CHEFE DE OFICINA','CONTROLE DE QUADRO','CONSULTORA TÉCNICA','AGENDAMENTO','GARANTISTA'));
drop policy if exists treatments_write on public.treatments;
create policy treatments_write on public.treatments for all to authenticated
using (public.current_role() in ('ADMINISTRADOR / CRIADOR','CHEFE DE OFICINA','CONTROLE DE QUADRO','CONSULTORA TÉCNICA','AGENDAMENTO','GARANTISTA'))
with check (public.current_role() in ('ADMINISTRADOR / CRIADOR','CHEFE DE OFICINA','CONTROLE DE QUADRO','CONSULTORA TÉCNICA','AGENDAMENTO','GARANTISTA'));

drop policy if exists catalog_read on public.catalog;
create policy catalog_read on public.catalog for select to authenticated using (true);
drop policy if exists catalog_write on public.catalog;
create policy catalog_write on public.catalog for all to authenticated
using (public.is_leader()) with check (public.is_leader());

drop policy if exists suggestions_read on public.suggestions;
create policy suggestions_read on public.suggestions for select to authenticated
using (
  author_id = auth.uid()
  or public.is_leader()
  or status in ('Aprovada','Em implantação','Concluída')
);
drop policy if exists suggestions_insert on public.suggestions;
create policy suggestions_insert on public.suggestions for insert to authenticated
with check (author_id = auth.uid());
drop policy if exists suggestions_update on public.suggestions;
create policy suggestions_update on public.suggestions for update to authenticated
using (public.is_leader() or author_id = auth.uid())
with check (public.is_leader() or author_id = auth.uid());
drop policy if exists suggestions_delete on public.suggestions;
create policy suggestions_delete on public.suggestions for delete to authenticated
using (public.is_leader() or author_id = auth.uid());

drop policy if exists closures_read on public.month_closures;
create policy closures_read on public.month_closures for select to authenticated using (public.is_leader());
drop policy if exists closures_write on public.month_closures;
create policy closures_write on public.month_closures for all to authenticated
using (public.is_admin()) with check (public.is_admin());

drop policy if exists settings_read on public.app_settings;
create policy settings_read on public.app_settings for select to authenticated using (public.is_leader());
drop policy if exists settings_write on public.app_settings;
create policy settings_write on public.app_settings for all to authenticated
using (public.is_admin()) with check (public.is_admin());

drop policy if exists audit_insert on public.audit_log;
create policy audit_insert on public.audit_log for insert to authenticated with check (user_id = auth.uid());
drop policy if exists audit_read on public.audit_log;
create policy audit_read on public.audit_log for select to authenticated using (public.is_admin());

alter publication supabase_realtime add table public.vehicles;
alter publication supabase_realtime add table public.treatments;
alter publication supabase_realtime add table public.catalog;
alter publication supabase_realtime add table public.suggestions;
