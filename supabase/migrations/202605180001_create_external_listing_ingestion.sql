create table if not exists public.external_listing_sources (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  base_url text not null,
  source_type text not null default 'html' check (source_type in ('html', 'json', 'rss', 'api')),
  is_enabled boolean not null default false,
  requires_permission boolean not null default true,
  adapter text not null default 'generic',
  config jsonb not null default '{}'::jsonb,
  notes text,
  last_run_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.external_listing_import_runs (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references public.external_listing_sources(id) on delete cascade,
  status text not null check (status in ('running', 'completed', 'failed')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  listings_found integer not null default 0,
  listings_upserted integer not null default 0,
  error_message text
);

create table if not exists public.external_listings (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references public.external_listing_sources(id) on delete cascade,
  external_id text not null,
  source_name text not null,
  source_url text not null,
  title text not null,
  price integer not null check (price >= 0),
  listing_type text not null check (listing_type in ('sale', 'rent')),
  property_type text not null default 'condo' check (property_type in ('condo', 'townhouse', 'detached_house', 'basement_suite')),
  bedrooms integer not null default 0 check (bedrooms >= 0),
  bathrooms integer not null default 0 check (bathrooms >= 0),
  area_sqft integer not null default 0 check (area_sqft >= 0),
  city text not null,
  image_url text,
  raw_payload jsonb not null default '{}'::jsonb,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  is_active boolean not null default true,
  unique (source_id, external_id)
);

alter table public.external_listing_sources enable row level security;
alter table public.external_listing_import_runs enable row level security;
alter table public.external_listings enable row level security;

create policy "External listing sources are viewable by everyone"
on public.external_listing_sources
for select
to anon, authenticated
using (true);

create policy "External listings are viewable by everyone"
on public.external_listings
for select
to anon, authenticated
using (is_active = true);

create policy "External import runs are viewable by authenticated users"
on public.external_listing_import_runs
for select
to authenticated
using (true);

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'external_listings'
  ) then
    alter publication supabase_realtime add table public.external_listings;
  end if;
end $$;

insert into public.external_listing_sources (name, base_url, source_type, adapter, is_enabled, requires_permission, notes)
values
  (
    'Facebook Marketplace',
    'https://www.facebook.com/marketplace',
    'html',
    'permission_required',
    false,
    true,
    'Disabled by default. Meta states automated collection of Facebook data requires permission.'
  ),
  (
    'Craigslist',
    'https://vancouver.craigslist.org',
    'rss',
    'permission_required',
    false,
    true,
    'Disabled by default. Craigslist terms prohibit automated collection without permission.'
  ),
  (
    'REALTOR.ca',
    'https://www.realtor.ca',
    'api',
    'permission_required',
    false,
    true,
    'Disabled by default. REALTOR.ca prohibits scraping/data collection without authorization.'
  ),
  (
    'Apartments.com',
    'https://www.apartments.com',
    'html',
    'permission_required',
    false,
    true,
    'Disabled by default. Use only with written permission or an approved data feed.'
  )
on conflict (name) do update
set
  base_url = excluded.base_url,
  source_type = excluded.source_type,
  adapter = excluded.adapter,
  is_enabled = excluded.is_enabled,
  requires_permission = excluded.requires_permission,
  notes = excluded.notes;
