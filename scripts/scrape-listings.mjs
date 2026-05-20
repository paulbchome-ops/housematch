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
let puppeteer;

process.on('unhandledRejection', (error) => {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes('Target closed') || message.includes('process') || message.includes('Protocol error')) {
    console.error(`Puppeteer cleanup warning: ${message}`);
    return;
  }

  throw error;
});

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

async function getPuppeteer() {
  if (!puppeteer) {
    puppeteer = await import('puppeteer');
  }

  return puppeteer.default;
}

async function closeBrowser(browser) {
  try {
    await browser.close();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes('process') && !message.includes('Target closed')) {
      throw error;
    }
  }
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

async function fetchSourceWithPuppeteer(source, searchFilters = {}) {
  const sourceUrl = buildSourceUrl(source, searchFilters);
  const puppeteerModule = await getPuppeteer();
  console.log(`Puppeteer: launching browser for source ${source.name} -> ${sourceUrl}`);
  const browser = await puppeteerModule.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  console.log('Puppeteer: browser launched');

  try {
    const page = await browser.newPage();
    console.log('Puppeteer: creating page');
    await page.setUserAgent('HouseMatchBot/1.0 (+contact: support@housematchvancouver.ca)');
    await page.setViewport({ width: 1366, height: 900 });
    console.log(`Puppeteer: navigating to ${sourceUrl}`);
    try {
      await page.goto(sourceUrl, {
        waitUntil: source.config?.wait_until || 'networkidle2',
        timeout: Number(source.config?.timeout_ms || 45000),
      });
      console.log('Puppeteer: navigation complete');
    } catch (navErr) {
      console.error(`Puppeteer: navigation error for ${source.name}:`, navErr.message || navErr);
      throw navErr;
    }

    if (source.config?.wait_for_selector) {
      console.log(`Puppeteer: waiting for selector ${source.config.wait_for_selector}`);
      await page.waitForSelector(source.config.wait_for_selector, {
        timeout: Number(source.config?.selector_timeout_ms || 15000),
      });
      console.log('Puppeteer: selector present');
    }

    if (source.config?.scroll_to_bottom) {
      await page.evaluate(async () => {
        await new Promise((resolve) => {
          let totalHeight = 0;
          const distance = 500;
          const timer = setInterval(() => {
            const scrollHeight = document.body.scrollHeight;
            window.scrollBy(0, distance);
            totalHeight += distance;

            if (totalHeight >= scrollHeight) {
              clearInterval(timer);
              resolve();
            }
          }, 250);
        });
      });
      console.log('Puppeteer: auto-scroll complete');
    }

    const content = await page.content();
    console.log(`Puppeteer: fetched content for ${source.name} (length ${String(content?.length || 0)})`);
    return content;
  } finally {
    console.log('Puppeteer: closing browser');
    await closeBrowser(browser);
    console.log('Puppeteer: browser closed');
  }
}

async function fetchSource(source, searchFilters = {}) {
  if (source.adapter === 'puppeteer') {
    return fetchSourceWithPuppeteer(source, searchFilters);
  }

  const sourceUrl = buildSourceUrl(source, searchFilters);
  const response = await fetch(sourceUrl, {
    headers: {
      'user-agent': 'BCHomeMatchBot/1.0 (+contact: support@bchomeonline.ca)',
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
  if (source.adapter === 'puppeteer' && config.selectors) {
    throw new Error(`Source "${source.name}" uses Puppeteer selectors. Use parsePuppeteerListings instead.`);
  }

  // Helper: try craigslist HTML snippets
  function parseCraigslistHtml(htmlContent) {
    const listings = [];
    const rowRe = /<li\b[^>]*data-pid=["']?(?<pid>[^"'\s>]+)[\s\S]*?<a[^>]*href=["'](?<href>[^"']+)["'][^>]*>(?<title>[\s\S]*?)<\/a>[\s\S]*?(?<rest>[\s\S]*?)<\/li>/gi;
    let m;
    while ((m = rowRe.exec(htmlContent)) !== null) {
      const pid = m.groups?.pid;
      const href = m.groups?.href;
      const rawTitle = m.groups?.title || '';
      const rest = m.groups?.rest || '';
      const title = stripTags(rawTitle).trim();
      const priceMatch = rest.match(/class=["']?result-price["']?[^>]*>([^<]+)</i) || rest.match(/\$[\d,]+/);
      const price = priceMatch ? (priceMatch[1] || priceMatch[0]) : undefined;
      const hoodMatch = rest.match(/class=["']?result-hood["']?[^>]*>([^<]+)</i);
      const hood = hoodMatch ? stripTags(hoodMatch[1]).trim().replace(/^\s*-\s*/, '') : undefined;
      const housingMatch = rest.match(/class=["']?housing["']?[^>]*>([^<]+)</i);
      let bedrooms, area_sqft;
      if (housingMatch) {
        const housing = stripTags(housingMatch[1]);
        const b = housing.match(/(\d+)\s*br/);
        const s = housing.match(/([\d,]+)\s*(?:sq\.?\s*ft|sqft)/i);
        bedrooms = b ? b[1] : undefined;
        area_sqft = s ? s[1].replace(/,/g, '') : undefined;
      }
      const imgMatch = m[0].match(/<img[^>]+src=["']([^"']+)["']/i);
      const img = imgMatch ? imgMatch[1] : undefined;

      listings.push({
        external_id: pid || href,
        title,
        price,
        bedrooms,
        bathrooms: undefined,
        area_sqft,
        city: hood,
        image_url: img,
        source_url: href,
        source_name: source.name,
      });
    }

    return listings.filter((l) => l.title && l.source_url);
  }

  // Helper: try facebook marketplace from static HTML (best-effort)
  function parseFacebookHtml(htmlContent) {
    const listings = [];
    const anchorRe = /<a[^>]+href=["'](?<href>[^"']*marketplace\/item\/[^"]+)["'][^>]*>(?<inner>[\s\S]*?)<\/a>/gi;
    let m;
    const seen = new Set();
    while ((m = anchorRe.exec(htmlContent)) !== null) {
      const href = m.groups?.href;
      if (!href || seen.has(href)) continue;
      seen.add(href);
      const inner = m.groups?.inner || '';
      const title = stripTags(inner).trim();
      // try to find nearby img in the anchor
      const imgMatch = inner.match(/<img[^>]+src=["']([^"']+)["']/i);
      const img = imgMatch ? imgMatch[1] : undefined;
      listings.push({
        external_id: href,
        title,
        price: undefined,
        bedrooms: undefined,
        bathrooms: undefined,
        area_sqft: undefined,
        city: undefined,
        image_url: img,
        source_url: href,
        source_name: source.name,
      });
    }

    // Filter to likely rentals
    const looksLikeRental = (item) => {
      const title = (item.title || '').toLowerCase();
      const rentalKeywords = [' for rent', 'for rent', ' apartment', 'studio', 'room for rent', 'room', 'sublet', 'lease', 'rental'];
      return rentalKeywords.some((k) => title.includes(k));
    };

    return listings.filter((l) => l.title && l.source_url && looksLikeRental(l));
  }

  // If an item_regex exists, prefer the configured generic parser
  if (config.item_regex) {
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

  // No item_regex: try host-specific heuristics based on source base URL
  try {
    const sourceUrl = buildSourceUrl(source);
    const hostname = new URL(sourceUrl).hostname || '';
    if (hostname.includes('craigslist.org')) {
      return parseCraigslistHtml(html);
    }

    if (hostname.includes('facebook.com')) {
      return parseFacebookHtml(html);
    }
  } catch (err) {
    // fall through to generic failure
  }

  throw new Error(`Source "${source.name}" needs config.item_regex for generic HTML parsing, and no site-specific parser matched.`);
}

async function parsePuppeteerListings(source, searchFilters = {}) {
  const sourceUrl = buildSourceUrl(source, searchFilters);
  const selectors = source.config?.selectors;

  if (!selectors?.item) {
    throw new Error(`Source "${source.name}" needs config.selectors.item for Puppeteer parsing.`);
  }

  const puppeteerModule = await getPuppeteer();
  console.log(`Puppeteer(parse): launching browser for source ${source.name} -> ${sourceUrl}`);
  const browser = await puppeteerModule.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  console.log('Puppeteer(parse): browser launched');

  try {
    const page = await browser.newPage();
    await page.setUserAgent('HouseMatchBot/1.0 (+contact: support@housematchvancouver.ca)');
    await page.setViewport({ width: 1366, height: 900 });
    console.log(`Puppeteer(parse): navigating to ${sourceUrl}`);
    try {
      await page.goto(sourceUrl, {
        waitUntil: source.config?.wait_until || 'networkidle2',
        timeout: Number(source.config?.timeout_ms || 45000),
      });
      console.log('Puppeteer(parse): navigation complete');
    } catch (err) {
      console.error('Puppeteer(parse): navigation error:', err.message || err);
      throw err;
    }

    if (source.config?.wait_for_selector || selectors.item) {
      await page.waitForSelector(source.config?.wait_for_selector || selectors.item, {
        timeout: Number(source.config?.selector_timeout_ms || 15000),
      });
    }

    // Improved auto-scrolling: scroll until no new content or max iterations
    if (source.config?.scroll_to_bottom) {
      await page.evaluate(async () => {
        const distance = 600;
        const delay = (ms) => new Promise((r) => setTimeout(r, ms));
        let lastHeight = 0;
        let sameCount = 0;
        for (let i = 0; i < 30; i += 1) {
          window.scrollBy(0, distance);
          await delay(350);
          const newHeight = document.body.scrollHeight;
          if (newHeight === lastHeight) sameCount += 1; else sameCount = 0;
          lastHeight = newHeight;
          if (sameCount >= 3) break;
        }
      });
    }

    // Site-specific extraction for common sources
    const url = new URL(sourceUrl);
    const hostname = url.hostname || '';

    if (source.name === 'Craigslist') {
      // Craigslist: select result rows and extract fields
      return page.evaluate(() => {
        const rows = Array.from(document.querySelectorAll('li.result-row, .result-row, li[data-pid]'));
        return rows.map((row) => {
          const anchor = row.querySelector('a.result-title, a.result-image') || row.querySelector('a[href*="/search/"]');
          const title = anchor?.textContent?.trim();
          const source_url = anchor?.href;
          const pid = row.getAttribute('data-pid') || source_url;
          const price = row.querySelector('.result-price')?.textContent?.trim();
          const hood = row.querySelector('.result-hood')?.textContent?.trim()?.replace(/^\s*-\s*/, '');
          const housing = row.querySelector('.housing')?.textContent?.trim();
          let bedrooms, area_sqft;
          if (housing) {
            const b = housing.match(/(\d+)\s*br/);
            const s = housing.match(/([\d,]+)\s*(?:sq\.?\s*ft|sqft)/i);
            bedrooms = b ? b[1] : undefined;
            area_sqft = s ? s[1].replace(/,/g, '') : undefined;
          }
          const img = row.querySelector('img')?.getAttribute('data-src') || row.querySelector('img')?.src;
          return { external_id: pid, title, price, bedrooms, area_sqft, city: hood, image_url: img, source_url };
        }).filter((l) => l.title && l.source_url);
      });
    }

    if (source.name === 'Facebook Marketplace') {
      // Facebook Marketplace: look for article/marketplace items
      return page.evaluate(() => {
        const articles = Array.from(document.querySelectorAll('div[role="article"], div[data-testid^="marketplace_feed_item"], a[aria-label*="item for sale"]'));
        const seen = new Set();
        const results = [];
        for (const el of articles) {
          const anchor = el.querySelector('a[href*="/marketplace/item/"]') || el.closest('a[href*="/marketplace/item/"]') || el.querySelector('a[role="link"][href]');
          const href = anchor?.href;
          if (!href || seen.has(href)) continue;
          seen.add(href);
          const title = el.querySelector('[data-testid="marketplace_feed_item_title"]')?.textContent?.trim() || el.querySelector('h3')?.textContent?.trim() || el.querySelector('span')?.textContent?.trim();
          const price = el.querySelector('[aria-label*="price"]')?.textContent?.trim() || el.querySelector('span[dir]')?.textContent?.trim();
          const img = el.querySelector('img')?.src || el.querySelector('img')?.getAttribute('data-src');
          results.push({ external_id: href, title, price, bedrooms: undefined, area_sqft: undefined, city: undefined, image_url: img, source_url: href });
        }

        // Heuristic: keep items that look like housing rentals
        const looksLikeRental = (item) => {
          const title = (item.title || '').toLowerCase();
          const price = (item.price || '').toLowerCase();
          // price text indicating monthly rent
          if (price.includes('/mo') || price.includes('per month') || price.includes('month') && /\$/.test(price)) return true;
          // title keywords
          const rentalKeywords = [' for rent', 'for rent', ' apartment', 'studio', 'room for rent', 'room', 'sublet', 'lease', 'rental'];
          if (rentalKeywords.some((k) => title.includes(k))) return true;
          return false;
        };

        const filtered = results.filter((l) => l.title && l.source_url && looksLikeRental(l));
        return filtered;
      });
    }

      if (source.name === 'Apartments.com') {
        console.log('Puppeteer(parse): using apartments.com parser');
        const results = await page.evaluate(() => {
          const items = Array.from(document.querySelectorAll('a[href*="/property/"], a[href*="/rentals/"], article.placard, .placard'));
          const seen = new Set();
          const out = [];

          for (const el of items) {
            // anchor may be the element itself or a child
            const anchor = el.tagName === 'A' ? el : el.querySelector('a[href*="/property/"], a[href*="/rentals/"]');
            const href = anchor?.href;
            if (!href || seen.has(href)) continue;
            seen.add(href);
            // Title
            const title = (el.querySelector('h3, h2, .property-title, .placardTitle')?.textContent || anchor?.textContent || '').trim();
            // Price
            const price = (el.querySelector('.property-rent, .rent, .propertyPrice, .price')?.textContent || '').trim();
            // Bedrooms / sqft from metadata text
            const metaText = (el.querySelector('.property-beds, .beds, .units, .property-meta, .placardDetails')?.textContent || el.textContent || '').trim();
            let bedrooms;
            let area_sqft;
            const bMatch = metaText.match(/(\d+)\s*beds?|(\d+)\s*bd/i);
            if (bMatch) bedrooms = bMatch[1] || bMatch[2];
            const sMatch = metaText.match(/([\d,]+)\s*(?:sq\.?\s*ft|sqft|ft2)/i);
            if (sMatch) area_sqft = sMatch[1].replace(/,/g, '');
            const img = el.querySelector('img')?.src || el.querySelector('img')?.getAttribute('data-src');
            out.push({ external_id: href, title, price, bedrooms, area_sqft, city: undefined, image_url: img, source_url: href });
          }

          return out.filter((l) => l.title && l.source_url);
        });
        console.log(`Puppeteer(parse): apartments.com parser found ${results.length} items`);
        return results;
      }

    // Default generic selector-driven extraction
    if (selectors && selectors.item) {
      return page.$$eval(selectors.item, (items, selectorConfig) => {
        const readText = (root, selector) => {
          if (!selector) return undefined;
          return root.querySelector(selector)?.textContent?.trim();
        };
        const readAttribute = (root, selector, attribute) => {
          if (!selector) return undefined;
          return root.querySelector(selector)?.getAttribute(attribute);
        };

        return items.map((item) => ({
          external_id:
            readAttribute(item, selectorConfig.external_id, 'data-id') ||
            readAttribute(item, selectorConfig.source_url, 'href') ||
            readText(item, selectorConfig.title),
          title: readText(item, selectorConfig.title),
          price: readText(item, selectorConfig.price),
          bedrooms: readText(item, selectorConfig.bedrooms),
          bathrooms: readText(item, selectorConfig.bathrooms),
          area_sqft: readText(item, selectorConfig.area_sqft),
          city: readText(item, selectorConfig.city),
          image_url: readAttribute(item, selectorConfig.image_url, 'src'),
          source_url: readAttribute(item, selectorConfig.source_url, 'href'),
        }));
      }, selectors);
    }

    throw new Error(`No puppeteer selectors or site-specific parser available for source "${source.name}" (${hostname}).`);
    } finally {
    console.log('Puppeteer(parse): closing browser');
    await closeBrowser(browser);
    console.log('Puppeteer(parse): browser closed');
  }
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

  const payload = source.adapter === 'puppeteer' && source.config?.selectors
    ? null
    : await fetchSource(source, searchFilters);
  const parsed = source.adapter === 'puppeteer' && source.config?.selectors
    ? await parsePuppeteerListings(source, searchFilters)
    : source.source_type === 'json'
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
