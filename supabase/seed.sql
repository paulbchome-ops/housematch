insert into public.listings (
  owner_id,
  title,
  price,
  listing_type,
  property_type,
  bedrooms,
  bathrooms,
  area_sqft,
  city,
  image_url
)
select
  id,
  'Modern Condo in Burnaby',
  728000,
  'sale',
  'condo',
  2,
  2,
  950,
  'Burnaby',
  'https://images.unsplash.com/photo-1502672260266-1c1ef2d93688?q=80&w=1200&auto=format&fit=crop'
from auth.users
limit 1;
