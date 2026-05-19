# HouseMatch

HouseMatch is a React + Supabase starter app for a Greater Vancouver rental and property marketplace.

## What is included

- React app shell with live listings UI
- Supabase client setup
- Email/password authentication flow
- Listing filters
- Authenticated listing creation flow
- SQL migration with Row Level Security policies
- Database-backed listing reads and realtime refreshes from Supabase

## Connect Supabase

1. Create a Supabase project.
2. Copy `.env.example` to `.env`.
3. Fill in:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_PUBLISHABLE_KEY`
4. Run the SQL in `supabase/migrations/202605170001_create_housematch_schema.sql`.
5. Create at least one user in Supabase Auth, then optionally run `supabase/seed.sql` to insert a starter listing owned by that first user.

## Run locally

```bash
npm install
npm run dev
```

## Notes

- The browser app uses the publishable key only.
- Database access is protected with Row Level Security.
- `.env` is intentionally ignored so local credentials are not committed.
- External listing ingestion uses `SUPABASE_SERVICE_ROLE_KEY` and must run only in a trusted server or scheduled job.
- Facebook Marketplace, Craigslist, REALTOR.ca, and Apartments.com are seeded as disabled sources because their terms or published guidance restrict automated scraping without permission. Enable a source only when you have authorization, an approved API, or a licensed data feed.

## External listing ingestion

Run the external ingestion job from a server environment after applying the migrations:

```bash
npm run scrape:listings
```

The job reads enabled rows from `external_listing_sources`, records each attempt in `external_listing_import_runs`, and upserts normalized rows into `external_listings`.

When a visitor starts or refreshes a property search, the app calls the `search-listings` Supabase Edge Function. The function scrapes enabled authorized sources, upserts fresh external listings, queries matching first-party and external rows, and returns those matches to the browser.

```bash
supabase functions deploy search-listings
```

The function needs these server-side secrets:

```bash
supabase secrets set SUPABASE_URL=...
supabase secrets set SUPABASE_SERVICE_ROLE_KEY=...
```

The browser never receives the service-role key. It only invokes the Edge Function; the function performs external fetching and database upserts.
- Listings are loaded from `public.listings`; without Supabase environment values the listing area will stay empty.
