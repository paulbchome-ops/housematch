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

const args = new Set(process.argv.slice(2));
const pollIntervalMs = Number(process.env.SCRAPER_POLL_INTERVAL_MS || 15000);

function textBetween(value, start, end) {
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

function toInteger(value, fallback = 0) {
  const numberValue = Number(String(value ?? '').replace(/[^\d]/g, ''));
  return Number.isFinite(numberValue) ? numberValue : fallback;
}

function normalizeListing(raw, source) {
  const sourceConfig = source.config ?? {};
  const sourceName = raw.source_name || source.name;
  const sourceUrl = raw.source_url || raw.url || raw.link;
  const externalId = raw.external_id || raw.id || sourceUrl || `${source.name}-${raw.title}`;

  return {
    source_id: source.id,
    external_id: String(externalId),
    source_name: sourceName,
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

function getByPath(value, path) {
  return path.split('.').reduce((current, key) => current?.[key], value);
}

function buildSourceUrl(source, searchFilters = {}) {
  const template = source.config?.search_url_template;
  if (!template) return source.base_url;

  const replacements = {
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

async function fetchSource(source, searchFilters = {}) {
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

function parseJsonListings(payload, source) {
  const config = source.config ?? {};
  const items = Array.isArray(payload)
    ? payload
    : getByPath(payload, config.items_path || 'items') || [];

  return items.map((item) => ({
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

function parseRssListings(xml, source) {
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

function parseHtmlListings(html, source) {
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

async function createRun(source) {
  const { data, error } = await supabase
    .from('external_listing_import_runs')
    .insert({ source_id: source.id, status: 'running' })
    .select()
    .single();

  if (error) throw error;
  return data;
}

async function finishRun(run, values) {
  const { error } = await supabase
    .from('external_listing_import_runs')
    .update({ ...values, finished_at: new Date().toISOString() })
    .eq('id', run.id);

  if (error) throw error;
}

async function scrapeSource(source, searchFilters = {}) {
  if (source.requires_permission) {
    throw new Error(`Source "${source.name}" requires permission before automated collection.`);
  }

  const payload = await fetchSource(source, searchFilters);
  const parsed =
    source.source_type === 'json'
      ? parseJsonListings(payload, source)
      : source.source_type === 'rss'
        ? parseRssListings(payload, source)
        : parseHtmlListings(payload, source);

  const listings = parsed.map((listing) => normalizeListing(listing, source));

  if (!listings.length) {
    return { found: 0, upserted: 0 };
  }

  const { error } = await supabase
    .from('external_listings')
    .upsert(listings, { onConflict: 'source_id,external_id' });

  if (error) throw error;

  await supabase
    .from('external_listing_sources')
    .update({ last_run_at: new Date().toISOString() })
    .eq('id', source.id);

  return { found: listings.length, upserted: listings.length };
}

async function getEnabledSources() {
  const { data: sources, error } = await supabase
    .from('external_listing_sources')
    .select('*')
    .eq('is_enabled', true);

  if (error) throw error;
  return sources ?? [];
}

async function scrapeEnabledSources(searchFilters = {}) {
  const sources = await getEnabledSources();

  if (!sources?.length) {
    console.log('No enabled external listing sources found.');
    return { found: 0, upserted: 0 };
  }

  let totalFound = 0;
  let totalUpserted = 0;

  for (const source of sources) {
    const run = await createRun(source);
    try {
      const result = await scrapeSource(source, searchFilters);
      await finishRun(run, {
        status: 'completed',
        listings_found: result.found,
        listings_upserted: result.upserted,
      });
      totalFound += result.found;
      totalUpserted += result.upserted;
      console.log(`${source.name}: ${result.upserted} listings upserted.`);
    } catch (errorForSource) {
      await finishRun(run, {
        status: 'failed',
        error_message: errorForSource.message,
      });
      console.error(`${source.name}: ${errorForSource.message}`);
    }
  }

  return { found: totalFound, upserted: totalUpserted };
}

async function claimNextSearchRequest() {
  const { data: queuedRequest, error: selectError } = await supabase
    .from('external_listing_search_requests')
    .select('*')
    .eq('status', 'queued')
    .order('requested_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (selectError) throw selectError;
  if (!queuedRequest) return null;

  const { data: claimedRequest, error: updateError } = await supabase
    .from('external_listing_search_requests')
    .update({ status: 'running', started_at: new Date().toISOString(), error_message: null })
    .eq('id', queuedRequest.id)
    .eq('status', 'queued')
    .select()
    .maybeSingle();

  if (updateError) throw updateError;
  return claimedRequest;
}

async function finishSearchRequest(request, values) {
  const { error } = await supabase
    .from('external_listing_search_requests')
    .update({ ...values, finished_at: new Date().toISOString() })
    .eq('id', request.id);

  if (error) throw error;
}

async function processOneSearchRequest() {
  const request = await claimNextSearchRequest();
  if (!request) return false;

  try {
    const result = await scrapeEnabledSources(request.filters ?? {});
    await finishSearchRequest(request, { status: 'completed' });
    console.log(`Search request ${request.id}: ${result.upserted} listings upserted.`);
  } catch (errorForRequest) {
    await finishSearchRequest(request, {
      status: 'failed',
      error_message: errorForRequest.message,
    });
    console.error(`Search request ${request.id}: ${errorForRequest.message}`);
  }

  return true;
}

async function processPendingSearchRequests() {
  let processedAny = false;

  while (await processOneSearchRequest()) {
    processedAny = true;
  }

  if (!processedAny) {
    console.log('No queued external listing search requests found.');
  }
}

async function watchSearchRequests() {
  console.log(`Watching for external listing search requests every ${pollIntervalMs}ms.`);

  while (true) {
    await processPendingSearchRequests();
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }
}

async function main() {
  if (args.has('--watch')) {
    await watchSearchRequests();
    return;
  }

  if (args.has('--pending')) {
    await processPendingSearchRequests();
    return;
  }

  await scrapeEnabledSources();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
