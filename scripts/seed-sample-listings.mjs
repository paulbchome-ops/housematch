import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !serviceRoleKey) {
  console.error('Missing SUPABASE_URL/VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false },
});

const sampleListings = [
  {
    external_id: 'sample-burnaby-brentwood-condo-001',
    title: 'Brentwood 2 Bed Condo Near SkyTrain',
    price: 3150,
    listing_type: 'rent',
    property_type: 'condo',
    bedrooms: 2,
    bathrooms: 2,
    area_sqft: 875,
    city: 'Burnaby',
    image_url: 'https://images.unsplash.com/photo-1502672260266-1c1ef2d93688?q=80&w=1200&auto=format&fit=crop',
    source_url: 'https://example.com/listings/brentwood-2-bed-condo',
  },
  {
    external_id: 'sample-vancouver-kitsilano-garden-002',
    title: 'Kitsilano Garden Suite With Private Patio',
    price: 2650,
    listing_type: 'rent',
    property_type: 'basement_suite',
    bedrooms: 1,
    bathrooms: 1,
    area_sqft: 720,
    city: 'Vancouver',
    image_url: 'https://images.unsplash.com/photo-1560185127-6ed189bf02f4?q=80&w=1200&auto=format&fit=crop',
    source_url: 'https://example.com/listings/kitsilano-garden-suite',
  },
  {
    external_id: 'sample-richmond-oval-townhouse-003',
    title: 'Richmond Oval Townhouse With Garage',
    price: 1099000,
    listing_type: 'sale',
    property_type: 'townhouse',
    bedrooms: 3,
    bathrooms: 3,
    area_sqft: 1425,
    city: 'Richmond',
    image_url: 'https://images.unsplash.com/photo-1564013799919-ab600027ffc6?q=80&w=1200&auto=format&fit=crop',
    source_url: 'https://example.com/listings/richmond-oval-townhouse',
  },
  {
    external_id: 'sample-coquitlam-lafarge-condo-004',
    title: 'Coquitlam Centre Condo Facing Lafarge Lake',
    price: 748000,
    listing_type: 'sale',
    property_type: 'condo',
    bedrooms: 2,
    bathrooms: 2,
    area_sqft: 930,
    city: 'Coquitlam',
    image_url: 'https://images.unsplash.com/photo-1494526585095-c41746248156?q=80&w=1200&auto=format&fit=crop',
    source_url: 'https://example.com/listings/coquitlam-centre-condo',
  },
  {
    external_id: 'sample-new-west-quay-loft-005',
    title: 'New Westminster Quay Loft Steps to Transit',
    price: 2895,
    listing_type: 'rent',
    property_type: 'condo',
    bedrooms: 2,
    bathrooms: 1,
    area_sqft: 840,
    city: 'New Westminster',
    image_url: 'https://images.unsplash.com/photo-1522708323590-d24dbb6b0267?q=80&w=1200&auto=format&fit=crop',
    source_url: 'https://example.com/listings/new-west-quay-loft',
  },
  {
    external_id: 'sample-surrey-central-condo-006',
    title: 'Surrey Central High-Rise With Mountain Views',
    price: 642000,
    listing_type: 'sale',
    property_type: 'condo',
    bedrooms: 2,
    bathrooms: 2,
    area_sqft: 815,
    city: 'Surrey',
    image_url: 'https://images.unsplash.com/photo-1512917774080-9991f1c4c750?q=80&w=1200&auto=format&fit=crop',
    source_url: 'https://example.com/listings/surrey-central-high-rise',
  },
  {
    external_id: 'sample-north-van-lonsdale-007',
    title: 'Lower Lonsdale Apartment Near Seabus',
    price: 3350,
    listing_type: 'rent',
    property_type: 'condo',
    bedrooms: 2,
    bathrooms: 2,
    area_sqft: 910,
    city: 'North Vancouver',
    image_url: 'https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?q=80&w=1200&auto=format&fit=crop',
    source_url: 'https://example.com/listings/lower-lonsdale-apartment',
  },
  {
    external_id: 'sample-west-van-dundarave-house-008',
    title: 'Dundarave Family Home With Ocean Glimpses',
    price: 2988000,
    listing_type: 'sale',
    property_type: 'detached_house',
    bedrooms: 4,
    bathrooms: 3,
    area_sqft: 2680,
    city: 'West Vancouver',
    image_url: 'https://images.unsplash.com/photo-1600585154526-990dced4db0d?q=80&w=1200&auto=format&fit=crop',
    source_url: 'https://example.com/listings/dundarave-family-home',
  },
  {
    external_id: 'sample-delta-ladner-townhouse-009',
    title: 'Ladner Village Townhouse With Yard',
    price: 884000,
    listing_type: 'sale',
    property_type: 'townhouse',
    bedrooms: 3,
    bathrooms: 2,
    area_sqft: 1510,
    city: 'Delta',
    image_url: 'https://images.unsplash.com/photo-1570129477492-45c003edd2be?q=80&w=1200&auto=format&fit=crop',
    source_url: 'https://example.com/listings/ladner-village-townhouse',
  },
  {
    external_id: 'sample-langley-willoughby-rental-010',
    title: 'Willoughby Corner 3 Bed Rental',
    price: 3425,
    listing_type: 'rent',
    property_type: 'townhouse',
    bedrooms: 3,
    bathrooms: 3,
    area_sqft: 1360,
    city: 'Langley',
    image_url: 'https://images.unsplash.com/photo-1600607687939-ce8a6c25118c?q=80&w=1200&auto=format&fit=crop',
    source_url: 'https://example.com/listings/willoughby-corner-rental',
  },
  {
    external_id: 'sample-vancouver-yaletown-condo-011',
    title: 'Yaletown One Bedroom With Den',
    price: 799000,
    listing_type: 'sale',
    property_type: 'condo',
    bedrooms: 1,
    bathrooms: 1,
    area_sqft: 645,
    city: 'Vancouver',
    image_url: 'https://images.unsplash.com/photo-1484154218962-a197022b5858?q=80&w=1200&auto=format&fit=crop',
    source_url: 'https://example.com/listings/yaletown-one-bedroom-den',
  },
  {
    external_id: 'sample-burnaby-metrotown-rental-012',
    title: 'Metrotown Furnished Studio With Parking',
    price: 2250,
    listing_type: 'rent',
    property_type: 'condo',
    bedrooms: 0,
    bathrooms: 1,
    area_sqft: 505,
    city: 'Burnaby',
    image_url: 'https://images.unsplash.com/photo-1505693416388-ac5ce068fe85?q=80&w=1200&auto=format&fit=crop',
    source_url: 'https://example.com/listings/metrotown-furnished-studio',
  },
];

async function main() {
  const { data: source, error: sourceError } = await supabase
    .from('external_listing_sources')
    .upsert({
      name: 'HouseMatch Sample Data',
      base_url: 'https://example.com/housematch-samples',
      source_type: 'json',
      adapter: 'sample',
      is_enabled: false,
      requires_permission: false,
      notes: 'Sample listings for local development and demos.',
    }, { onConflict: 'name' })
    .select()
    .single();

  if (sourceError) throw sourceError;

  const now = new Date().toISOString();
  const rows = sampleListings.map((listing) => ({
    ...listing,
    source_id: source.id,
    source_name: source.name,
    raw_payload: listing,
    first_seen_at: now,
    last_seen_at: now,
    is_active: true,
  }));

  const { error } = await supabase
    .from('external_listings')
    .upsert(rows, { onConflict: 'source_id,external_id' });

  if (error) throw error;

  console.log(`Seeded ${rows.length} sample listings into external_listings.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
