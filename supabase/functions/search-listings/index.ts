import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const supabaseUrl = Deno.env.get('SUPABASE_URL');
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.');
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false },
});

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'content-type': 'application/json' },
  });
}

function textBetween(value: string, start: string, end: string) {
  const startIndex = value.indexOf(start);
  if (startIndex === -1) return '';
  const contentStart = startIndex + start.length;
  const endIndex = value.indexOf(end, contentStart);
  return endIndex === -1 ? '' : value.slice(contentStart, endIndex);
}

function stripTags(value = '') {
  return value
    .replace(/<!\[CDATA\[/g, '')
    .replace(/\]\]>/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

function toInteger(value: unknown, fallback = 0) {
  const numberValue = Number(String(value ?? '').replace(/[^\d]/g, ''));
  return Number.isFinite(numberValue) ? numberValue : fallback;
}

function toNumber(value: unknown) {
  const numberValue = Number(value);
  return value === '' || value === 'all' || Number.isNaN(numberValue) ? null : numberValue;
}

function getByPath(value: Record<string, unknown>, path: string) {
  return path.split('.').reduce<unknown>((current, key) => {
    if (!current || typeof current !== 'object') return undefined;
    return (current as Record<string, unknown>)[key];
  }, value);
}

function buildSourceUrl(source: Record<string, any>, searchFilters: Record<string, string>) {
  const template = source.config?.search_url_template;
  if (!template) return source.base_url;

  const replacements: Record<string, string> = {
    query: searchFilters.query || '',
    city: searchFilters.city || searchFilters.workLocation || '',
    listing_type: searchFilters.listingType === 'all' ? '' : searchFilters.listingType || '',
    property_type: searchFilters.propertyType === 'all' ? '' : searchFilters.propertyType || '',
    bedrooms: searchFilters.bedrooms === 'all' ? '' : searchFilters.bedrooms || '',
    max_price: searchFilters.maxPrice || searchFilters.budget || '',
  };

  return Object.entries(replacements).reduce(
    (url, [key, value]) => url.replaceAll(`{${key}}`, encodeURIComponent(value)),
    template,
  );
}

async function fetchSource(source: Record<string, any>, searchFilters: Record<string, string>) {
  const sourceUrl = buildSourceUrl(source, searchFilters);
  const response = await fetch(sourceUrl, {
    headers: {
      'user-agent': 'HouseMatchBot/1.0 (+contact: support@housematchvancouver.ca)',
      accept: source.source_type === 'json' ? 'application/json' : 'text/html, application/rss+xml, application/xml',
    },
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} from ${sourceUrl}`);
  }

  return source.source_type === 'json' ? response.json() : response.text();
}

function parseJsonListings(payload: any, source: Record<string, any>) {
  const config = source.config ?? {};
  const items = Array.isArray(payload)
    ? payload
    : getByPath(payload, config.items_path || 'items') || [];

  return (items as Record<string, unknown>[]).map((item) => ({
    external_id: getByPath(item, config.id_path || 'id'),
    title: getByPath(item, config.title_path || 'title'),
    price: getByPath(item, config.price_path || 'price'),
    listing_type: getByPath(item, config.listing_type_path || 'listing_type'),
    property_type: getByPath(item, config.property_type_path || 'property_type'),
    bedrooms: getByPath(item, config.bedrooms_path || 'bedrooms'),
    bathrooms: getByPath(item, config.bathrooms_path || 'bathrooms'),
    area_sqft: getByPath(item, config.area_sqft_path || 'area_sqft'),
    city: getByPath(item, config.city_path || 'city'),
    image_url: getByPath(item, config.image_url_path || 'image_url'),
    source_url: getByPath(item, config.source_url_path || 'source_url'),
    source_name: source.name,
  }));
}

function parseRssListings(xml: string, source: Record<string, any>) {
  return xml
    .split(/<item\b/i)
    .slice(1)
    .map((chunk) => {
      const item = chunk.split(/<\/item>/i)[0];
      const title = stripTags(textBetween(item, '<title>', '</title>'));
      const link = stripTags(textBetween(item, '<link>', '</link>'));
      const description = stripTags(textBetween(item, '<description>', '</description>'));
      const priceMatch = `${title} ${description}`.match(/\$[\d,]+/);
      const bedroomMatch = `${title} ${description}`.match(/(\d+)\s*(?:bed|br|bedroom)/i);
      const sqftMatch = `${title} ${description}`.match(/([\d,]+)\s*(?:sq\.?\s*ft|sqft)/i);

      return {
        external_id: stripTags(textBetween(item, '<guid', '</guid>')) || link,
        title,
        price: priceMatch?.[0],
        bedrooms: bedroomMatch?.[1],
        area_sqft: sqftMatch?.[1],
        source_url: link,
        source_name: source.name,
      };
    })
    .filter((listing) => listing.title && listing.source_url);
}

function parseHtmlListings(html: string, source: Record<string, any>) {
  const config = source.config ?? {};
  if (!config.item_regex) {
    throw new Error(`Source "${source.name}" needs config.item_regex for generic HTML parsing.`);
  }

  const itemRegex = new RegExp(config.item_regex, 'gis');
  const listings = [];
  let match;

  while ((match = itemRegex.exec(html)) !== null) {
    listings.push({
      external_id: match.groups?.id,
      title: stripTags(match.groups?.title),
      price: match.groups?.price,
      bedrooms: match.groups?.bedrooms,
      bathrooms: match.groups?.bathrooms,
      area_sqft: match.groups?.area_sqft,
      city: match.groups?.city,
      image_url: match.groups?.image_url,
      source_url: match.groups?.source_url,
      source_name: source.name,
    });
  }

  return listings.filter((listing) => listing.title && listing.source_url);
}

function normalizeListing(raw: Record<string, any>, source: Record<string, any>) {
  const sourceConfig = source.config ?? {};
  const sourceUrl = raw.source_url || raw.url || raw.link;
  const externalId = raw.external_id || raw.id || sourceUrl || `${source.name}-${raw.title}`;

  return {
    source_id: source.id,
    external_id: String(externalId),
    source_name: raw.source_name || source.name,
    source_url: sourceUrl,
    title: raw.title || 'Untitled listing',
    price: toInteger(raw.price),
    listing_type: raw.listing_type || sourceConfig.listing_type || 'rent',
    property_type: raw.property_type || sourceConfig.property_type || 'condo',
    bedrooms: toInteger(raw.bedrooms),
    bathrooms: toInteger(raw.bathrooms),
    area_sqft: toInteger(raw.area_sqft || raw.sqft),
    city: raw.city || sourceConfig.city || 'Vancouver',
    image_url: raw.image_url || raw.image || null,
    raw_payload: raw,
    last_seen_at: new Date().toISOString(),
    is_active: true,
  };
}

async function createRun(source: Record<string, any>) {
  const { data, error } = await supabase
    .from('external_listing_import_runs')
    .insert({ source_id: source.id, status: 'running' })
    .select()
    .single();

  if (error) throw error;
  return data;
}

async function finishRun(run: Record<string, any>, values: Record<string, unknown>) {
  const { error } = await supabase
    .from('external_listing_import_runs')
    .update({ ...values, finished_at: new Date().toISOString() })
    .eq('id', run.id);

  if (error) throw error;
}

async function scrapeEnabledSources(searchFilters: Record<string, string>) {
  const { data: sources, error } = await supabase
    .from('external_listing_sources')
    .select('*')
    .eq('is_enabled', true)
    .eq('requires_permission', false);

  if (error) throw error;

  const errors = [];
  let upserted = 0;

  for (const source of sources ?? []) {
    const run = await createRun(source);

    try {
      const payload = await fetchSource(source, searchFilters);
      const parsed =
        source.source_type === 'json'
          ? parseJsonListings(payload, source)
          : source.source_type === 'rss'
            ? parseRssListings(payload, source)
            : parseHtmlListings(payload, source);
      const listings = parsed.map((listing) => normalizeListing(listing, source));

      if (listings.length) {
        const { error: upsertError } = await supabase
          .from('external_listings')
          .upsert(listings, { onConflict: 'source_id,external_id' });

        if (upsertError) throw upsertError;
      }

      await supabase
        .from('external_listing_sources')
        .update({ last_run_at: new Date().toISOString() })
        .eq('id', source.id);

      upserted += listings.length;
      await finishRun(run, {
        status: 'completed',
        listings_found: listings.length,
        listings_upserted: listings.length,
      });
    } catch (sourceError) {
      const message = sourceError instanceof Error ? sourceError.message : String(sourceError);
      errors.push({ source: source.name, message });
      await finishRun(run, { status: 'failed', error_message: message });
    }
  }

  return { upserted, errors };
}

function listingMatchesFilters(listing: Record<string, any>, filters: Record<string, string>) {
  const minPrice = toNumber(filters.minPrice);
  const maxPrice = toNumber(filters.maxPrice || filters.budget);
  const minSqft = toNumber(filters.minSqft);
  const maxSqft = toNumber(filters.maxSqft);
  const query = (filters.query || '').trim().toLowerCase();

  return (
    (filters.listingType === 'all' || !filters.listingType || listing.listing_type === filters.listingType) &&
    (filters.propertyType === 'all' || !filters.propertyType || listing.property_type === filters.propertyType) &&
    (filters.bedrooms === 'all' || !filters.bedrooms || listing.bedrooms >= Number(filters.bedrooms)) &&
    (filters.budget === 'all' || !filters.budget || listing.price <= Number(filters.budget)) &&
    (minPrice === null || listing.price >= minPrice) &&
    (maxPrice === null || listing.price <= maxPrice) &&
    (minSqft === null || listing.area_sqft >= minSqft) &&
    (maxSqft === null || listing.area_sqft <= maxSqft) &&
    (!query || listing.title.toLowerCase().includes(query) || listing.city.toLowerCase().includes(query))
  );
}

async function getMatchingListings(filters: Record<string, string>) {
  const [ownedResult, externalResult] = await Promise.all([
    supabase.from('listings').select('*').eq('is_published', true).order('created_at', { ascending: false }),
    supabase.from('external_listings').select('*').eq('is_active', true).order('last_seen_at', { ascending: false }),
  ]);

  if (ownedResult.error || externalResult.error) {
    throw ownedResult.error || externalResult.error;
  }

  return [
    ...(ownedResult.data ?? []).map((listing) => ({
      ...listing,
      source_name: 'HouseMatch',
      source_url: null,
      is_external: false,
    })),
    ...(externalResult.data ?? []).map((listing) => ({
      ...listing,
      id: `external-${listing.id}`,
      image_url: listing.image_url || 'https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?q=80&w=1200&auto=format&fit=crop',
      is_external: true,
    })),
  ].filter((listing) => listingMatchesFilters(listing, filters));
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (request.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed.' }, 405);
  }

  try {
    const body = await request.json().catch(() => ({}));
    const filters = body.filters ?? {};
    const scrape = body.scrape !== false;
    const scrapeResult = scrape ? await scrapeEnabledSources(filters) : { upserted: 0, errors: [] };
    const listings = await getMatchingListings(filters);

    return jsonResponse({ listings, scrape: scrapeResult });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return jsonResponse({ error: message }, 500);
  }
});
