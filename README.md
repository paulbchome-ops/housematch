# HouseMatch

HouseMatch is a React + Supabase starter app for a Greater Vancouver rental and property marketplace.

## What is included

- React app shell with live listings UI
- Supabase client setup
- Email/password authentication flow
- Listing filters
- Authenticated listing creation flow
- SQL migration with Row Level Security policies
- Demo fallback data when Supabase environment variables are not yet configured

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
