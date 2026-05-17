create extension if not exists pgcrypto;

create table if not exists public.listings (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  price integer not null check (price >= 0),
  listing_type text not null check (listing_type in ('sale', 'rent')),
  property_type text not null check (property_type in ('condo', 'townhouse', 'detached_house', 'basement_suite')),
  bedrooms integer not null check (bedrooms >= 0),
  bathrooms integer not null check (bathrooms >= 0),
  area_sqft integer not null check (area_sqft >= 0),
  city text not null,
  image_url text not null,
  is_published boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.listings enable row level security;

create policy "Published listings are viewable by everyone"
on public.listings
for select
to anon, authenticated
using (is_published = true or owner_id = auth.uid());

create policy "Users can create their own listings"
on public.listings
for insert
to authenticated
with check (owner_id = auth.uid());

create policy "Users can update their own listings"
on public.listings
for update
to authenticated
using (owner_id = auth.uid())
with check (owner_id = auth.uid());

create policy "Users can delete their own listings"
on public.listings
for delete
to authenticated
using (owner_id = auth.uid());
