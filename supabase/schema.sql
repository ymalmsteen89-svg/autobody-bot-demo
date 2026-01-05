-- supabase/schema.sql

create extension if not exists "pgcrypto";

create table if not exists public.shop_profile (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text,
  address text,
  updated_at timestamptz not null default now(),
  unique (name)
);

insert into public.shop_profile (name, phone, address)
values ('Your Store', '303-555-7777', '1701 Mile High Stadium Cir, Denver, CO 80204')
on conflict (name) do nothing;

create table if not exists public.leads (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),

  source text not null default 'website-chat',
  intent text not null, -- estimate | book_inspection | tow_help
  status text not null default 'new',

  drivable text, -- yes | no | not_sure
  insurance text, -- yes | no | not_sure
  claim_number text,

  vehicle_year text,
  vehicle_make text,
  vehicle_model text,
  vin text,

  damage_areas text[] default '{}'::text[],
  incident_description text,
  zip text,

  contact_preference text, -- text | call | email
  name text,
  phone text,
  email text,
  text_consent boolean default false,

  photo_urls text[] default '{}'::text[],

  preferred_next_step text, -- book_inspection | call_back
  preferred_time_window text, -- e.g. tomorrow_afternoon
  notes text,

  meta jsonb not null default '{}'::jsonb
);

create index if not exists leads_created_at_idx on public.leads (created_at desc);
create index if not exists leads_status_idx on public.leads (status);
create index if not exists leads_intent_idx on public.leads (intent);

-- (Optional) RLS off for demo simplicity:
alter table public.leads disable row level security;
