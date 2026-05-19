import React, { useEffect, useMemo, useRef, useState } from 'react';
import AuthModal from './components/AuthModal.jsx';
import ListingForm from './components/ListingForm.jsx';
import { hasSupabaseConfig, supabase } from './lib/supabase.js';

const cities = [
  'Vancouver',
  'Burnaby',
  'Richmond',
  'Surrey',
  'Coquitlam',
  'New Westminster',
  'North Vancouver',
  'West Vancouver',
  'Delta',
  'Langley',
];

const defaultFilters = {
  listingType: 'all',
  propertyType: 'all',
  bedrooms: 'all',
  budget: 'all',
  minPrice: '',
  maxPrice: '',
  minSqft: '',
  maxSqft: '',
  maxSkyTrainKm: '',
  workLocation: 'Vancouver',
  maxWorkKm: '',
  query: '',
};

const defaultWeights = {
  price: 25,
  squareFootage: 25,
  skyTrain: 25,
  work: 25,
};

const defaultSort = {
  key: 'score',
  direction: 'desc',
};

const skyTrainDistanceByCity = {
  Vancouver: 0.4,
  Burnaby: 0.7,
  Richmond: 0.9,
  Surrey: 1.1,
  Coquitlam: 1.3,
  'New Westminster': 0.5,
  'North Vancouver': 5.8,
  'West Vancouver': 10.5,
  Delta: 9.4,
  Langley: 4.8,
};

const cityCoordinates = {
  Vancouver: { lat: 49.2827, lng: -123.1207 },
  Burnaby: { lat: 49.2488, lng: -122.9805 },
  Richmond: { lat: 49.1666, lng: -123.1336 },
  Surrey: { lat: 49.1913, lng: -122.849 },
  Coquitlam: { lat: 49.2838, lng: -122.7932 },
  'New Westminster': { lat: 49.2057, lng: -122.911 },
  'North Vancouver': { lat: 49.3201, lng: -123.0724 },
  'West Vancouver': { lat: 49.3286, lng: -123.1602 },
  Delta: { lat: 49.0847, lng: -123.0586 },
  Langley: { lat: 49.1044, lng: -122.6604 },
};

function formatPrice(listing) {
  return listing.listing_type === 'rent'
    ? `$${listing.price.toLocaleString()} / month`
    : `$${listing.price.toLocaleString()}`;
}

function formatDistance(value) {
  return `${value.toFixed(1)} km`;
}

function formatScore(value) {
  return `${Math.round(value)}`;
}

function formatOptionalRange(min, max, unit = '') {
  if (min !== null && max !== null) return `${min.toLocaleString()}${unit} - ${max.toLocaleString()}${unit}`;
  if (min !== null) return `${min.toLocaleString()}${unit}+`;
  if (max !== null) return `up to ${max.toLocaleString()}${unit}`;
  return 'no limit';
}

function normalizeText(value) {
  return value.trim().toLowerCase();
}

function toNumber(value) {
  const numberValue = Number(value);
  return value === '' || value === 'all' || Number.isNaN(numberValue) ? null : numberValue;
}

function clampScore(value) {
  return Math.max(0, Math.min(100, value));
}

function distanceBetweenCities(fromCity, toCity) {
  const from = cityCoordinates[fromCity];
  const to = cityCoordinates[toCity];
  if (!from || !to) return 25;

  const latKm = (from.lat - to.lat) * 111;
  const lngKm = (from.lng - to.lng) * 111 * Math.cos(((from.lat + to.lat) / 2) * (Math.PI / 180));
  return Math.sqrt(latKm ** 2 + lngKm ** 2);
}

function calculateRangeScore(value, min, max, preferHigher = false) {
  if (min !== null && max !== null && max > min) {
    const normalized = ((value - min) / (max - min)) * 100;
    return clampScore(preferHigher ? normalized : 100 - normalized);
  }

  if (max !== null && max > 0) {
    return clampScore(preferHigher ? (value / max) * 100 : 100 - (value / max) * 100);
  }

  if (min !== null && min > 0) {
    return clampScore(preferHigher ? Math.min((value / min) * 100, 100) : 100);
  }

  return 100;
}

function calculateProximityScore(distance, maxDistance) {
  if (maxDistance !== null && maxDistance > 0) {
    return clampScore(100 - (distance / maxDistance) * 100);
  }

  return clampScore(100 - distance * 8);
}

function mapOwnedListing(listing) {
  return {
    ...listing,
    source_name: 'BC Home Match',
    source_url: null,
    is_external: false,
  };
}

function mapExternalListing(listing) {
  return {
    ...listing,
    id: listing.id?.startsWith?.('external-') ? listing.id : `external-${listing.id}`,
    image_url: listing.image_url || 'https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?q=80&w=1200&auto=format&fit=crop',
    source_name: listing.source_name,
    source_url: listing.source_url,
    is_external: true,
  };
}

export default function App() {
  const [route, setRoute] = useState(window.location.hash === '#search' ? 'search' : 'home');
  const [searchStep, setSearchStep] = useState(0);
  const [listings, setListings] = useState([]);
  const [filters, setFilters] = useState(defaultFilters);
  const [weights, setWeights] = useState(defaultWeights);
  const [sort, setSort] = useState(defaultSort);
  const [session, setSession] = useState(null);
  const [authOpen, setAuthOpen] = useState(false);
  const [listingFormOpen, setListingFormOpen] = useState(false);
  const [authMessage, setAuthMessage] = useState('');
  const lastSearchRequestKey = useRef('');
  const [isSearching, setIsSearching] = useState(false);
  const [status, setStatus] = useState(
    hasSupabaseConfig
      ? 'Loading listings...'
      : 'Database is not connected.',
  );
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    function syncRoute() {
      setRoute(window.location.hash === '#search' ? 'search' : 'home');
    }

    window.addEventListener('hashchange', syncRoute);
    return () => window.removeEventListener('hashchange', syncRoute);
  }, []);

  useEffect(() => {
    if (!supabase) {
      setListings([]);
      setStatus('Database is not connected.');
      return undefined;
    }

    let isMounted = true;

    async function loadListings() {
      const [ownedResult, externalResult] = await Promise.all([
        supabase
          .from('listings')
          .select('*')
          .eq('is_published', true)
          .order('created_at', { ascending: false }),
        supabase
          .from('external_listings')
          .select('*')
          .eq('is_active', true)
          .order('last_seen_at', { ascending: false }),
      ]);

      if (!isMounted) return;

      if (ownedResult.error || externalResult.error) {
        setListings([]);
        setStatus(`Could not load listings: ${ownedResult.error?.message || externalResult.error?.message}`);
        return;
      }

      const mergedListings = [
        ...(ownedResult.data ?? []).map(mapOwnedListing),
        ...(externalResult.data ?? []).map(mapExternalListing),
      ];

      setListings(mergedListings);
      setStatus(mergedListings.length ? 'Listings loaded.' : 'No published listings found.');
    }

    async function loadInitialData() {
      const { data: authData } = await supabase.auth.getSession();
      if (isMounted) setSession(authData.session);
      await loadListings();
    }

    loadInitialData();

    const { data: authSubscription } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
    });

    const listingsChannel = supabase
      .channel('public:listings')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'listings' }, loadListings)
      .subscribe();

    const externalListingsChannel = supabase
      .channel('public:external_listings')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'external_listings' }, loadListings)
      .subscribe();

    return () => {
      isMounted = false;
      authSubscription.subscription.unsubscribe();
      supabase.removeChannel(listingsChannel);
      supabase.removeChannel(externalListingsChannel);
    };
  }, []);

  useEffect(() => {
    if (route === 'search') {
      runListingSearch();
    }
  }, [route]);

  const scoredListings = useMemo(() => {
    const minPrice = toNumber(filters.minPrice);
    const maxPrice = toNumber(filters.maxPrice || filters.budget);
    const minSqft = toNumber(filters.minSqft);
    const maxSqft = toNumber(filters.maxSqft);
    const maxSkyTrainKm = toNumber(filters.maxSkyTrainKm);
    const maxWorkKm = toNumber(filters.maxWorkKm);
    const totalWeight = Object.values(weights).reduce((sum, value) => sum + Number(value), 0);
    const effectiveTotalWeight = totalWeight || Object.keys(weights).length;

    return listings
      .filter((listing) => {
      const matchesListingType =
        filters.listingType === 'all' || listing.listing_type === filters.listingType;
      const matchesPropertyType =
        filters.propertyType === 'all' || listing.property_type === filters.propertyType;
      const matchesBedrooms =
        filters.bedrooms === 'all' || listing.bedrooms >= Number(filters.bedrooms);
      const matchesBudget =
        filters.budget === 'all' || listing.price <= Number(filters.budget);
      const matchesPriceRange =
        (minPrice === null || listing.price >= minPrice) && (maxPrice === null || listing.price <= maxPrice);
      const matchesSquareFootage =
        (minSqft === null || listing.area_sqft >= minSqft) && (maxSqft === null || listing.area_sqft <= maxSqft);
      const skyTrainDistance = skyTrainDistanceByCity[listing.city] ?? 6;
      const workDistance = distanceBetweenCities(listing.city, filters.workLocation);
      const matchesSkyTrain = maxSkyTrainKm === null || skyTrainDistance <= maxSkyTrainKm;
      const matchesWork = maxWorkKm === null || workDistance <= maxWorkKm;
      const query = normalizeText(filters.query);
      const matchesQuery =
        !query ||
        normalizeText(listing.title).includes(query) ||
        normalizeText(listing.city).includes(query);

      return (
        matchesListingType &&
        matchesPropertyType &&
        matchesBedrooms &&
        matchesBudget &&
        matchesPriceRange &&
        matchesSquareFootage &&
        matchesSkyTrain &&
        matchesWork &&
        matchesQuery
      );
    })
    .map((listing) => {
      const skyTrainDistance = skyTrainDistanceByCity[listing.city] ?? 6;
      const workDistance = distanceBetweenCities(listing.city, filters.workLocation);
      const scoreBreakdown = {
        price: calculateRangeScore(listing.price, minPrice, maxPrice),
        squareFootage: calculateRangeScore(listing.area_sqft, minSqft, maxSqft, true),
        skyTrain: calculateProximityScore(skyTrainDistance, maxSkyTrainKm),
        work: calculateProximityScore(workDistance, maxWorkKm),
      };
      const score =
        Object.entries(scoreBreakdown).reduce((sum, [key, value]) => {
          const weight = totalWeight ? Number(weights[key]) : 1;
          return sum + value * weight;
        }, 0) / effectiveTotalWeight;

      return {
        ...listing,
        skyTrainDistance,
        workDistance,
        score: Math.round(score),
        scoreBreakdown,
      };
    })
    .sort((a, b) => b.score - a.score);
  }, [filters, listings, weights]);

  const sortedListings = useMemo(() => {
    const getSortValue = (listing) => {
      switch (sort.key) {
        case 'title':
          return listing.title;
        case 'price':
          return listing.price;
        case 'area_sqft':
          return listing.area_sqft;
        case 'skyTrainDistance':
          return listing.skyTrainDistance;
        case 'workDistance':
          return listing.workDistance;
        case 'score':
        default:
          return listing.score;
      }
    };

    return [...scoredListings].sort((a, b) => {
      const first = getSortValue(a);
      const second = getSortValue(b);
      const direction = sort.direction === 'asc' ? 1 : -1;

      if (typeof first === 'string' || typeof second === 'string') {
        return String(first).localeCompare(String(second)) * direction;
      }

      return (Number(first) - Number(second)) * direction;
    });
  }, [scoredListings, sort]);

  async function signIn(credentials) {
    if (!supabase) return setAuthMessage('Database not configured.');
    const { error } = await supabase.auth.signInWithPassword(credentials);
    setAuthMessage(error ? error.message : 'Logged in successfully.');
    if (!error) setAuthOpen(false);
  }

  async function signUp(credentials) {
    if (!supabase) return setAuthMessage('Database not configured.');
    const { error } = await supabase.auth.signUp(credentials);
    setAuthMessage(error ? error.message : 'Account created. Check your email if confirmation is enabled.');
  }

  async function signOut() {
    if (!supabase) return;
    await supabase.auth.signOut();
  }

  async function createListing(values) {
    if (!supabase || !session?.user) return;
    setIsSubmitting(true);
    const { data, error } = await supabase
      .from('listings')
      .insert({ ...values, owner_id: session.user.id })
      .select()
      .single();
    setIsSubmitting(false);

    if (error) {
      setStatus(`Could not create listing: ${error.message}`);
      return;
    }

    setListings((current) => [mapOwnedListing(data), ...current]);
    setListingFormOpen(false);
    setStatus('Listing posted.');
  }

  function updateFilter(field, value) {
    setFilters((current) => ({ ...current, [field]: value }));
  }

  function updateWeight(field, value) {
    setWeights((current) => ({ ...current, [field]: Number(value) }));
  }

  function updateSort(key) {
    setSort((current) => ({
      key,
      direction: current.key === key && current.direction === 'desc' ? 'asc' : 'desc',
    }));
  }

  function sortLabel(key) {
    if (sort.key !== key) return 'Sort';
    return sort.direction === 'asc' ? 'Ascending' : 'Descending';
  }

  function getSearchRequestFilters() {
    return {
      listingType: filters.listingType,
      propertyType: filters.propertyType,
      bedrooms: filters.bedrooms,
      budget: filters.budget,
      minPrice: filters.minPrice,
      maxPrice: filters.maxPrice,
      minSqft: filters.minSqft,
      maxSqft: filters.maxSqft,
      maxSkyTrainKm: filters.maxSkyTrainKm,
      workLocation: filters.workLocation,
      maxWorkKm: filters.maxWorkKm,
      query: filters.query,
    };
  }

  async function runListingSearch(force = false) {
    if (!supabase) {
      setStatus('Database is not connected.');
      return;
    }

    const searchFilters = getSearchRequestFilters();
    const searchKey = JSON.stringify(searchFilters);

    if (!force && lastSearchRequestKey.current === searchKey) return;

    lastSearchRequestKey.current = searchKey;
    setIsSearching(true);
    setStatus('Searching fresh listing sources...');

    const { data, error } = await supabase.functions.invoke('search-listings', {
      body: { filters: searchFilters, scrape: true },
    });

    setIsSearching(false);

    if (error) {
      setStatus(`Could not search external listing sources: ${error.message}`);
      return;
    }

    if (data?.error) {
      setStatus(`Could not search external listing sources: ${data.error}`);
      return;
    }

    const nextListings = (data?.listings ?? []).map((listing) => (
      listing.is_external ? mapExternalListing(listing) : mapOwnedListing(listing)
    ));

    setListings(nextListings);
    setStatus(`Search complete. ${nextListings.length} listings found after refreshing external sources.`);
  }

  function openSearchPage(event) {
    event.preventDefault();
    window.location.hash = 'search';
    setRoute('search');
    runListingSearch();
  }

  function goHome() {
    window.location.hash = '';
    setRoute('home');
  }

  const searchSteps = ['Basics', 'Priorities', 'Results'];
  const featuredListings = scoredListings.slice(0, 4);

  function renderScoreBreakdown(listing) {
    const minPrice = toNumber(filters.minPrice);
    const maxPrice = toNumber(filters.maxPrice || filters.budget);
    const minSqft = toNumber(filters.minSqft);
    const maxSqft = toNumber(filters.maxSqft);
    const maxSkyTrainKm = toNumber(filters.maxSkyTrainKm);
    const maxWorkKm = toNumber(filters.maxWorkKm);

    return (
      <div className="score-popover" role="tooltip">
        <strong>Overall {listing.score}/100</strong>
        <p>Weighted average of the four category scores.</p>
        <dl>
          <div>
            <dt>Price</dt>
            <dd>
              {formatScore(listing.scoreBreakdown.price)}/100 · weight {weights.price}% · {formatPrice(listing)} against {formatOptionalRange(minPrice, maxPrice)}
            </dd>
          </div>
          <div>
            <dt>Sqft</dt>
            <dd>
              {formatScore(listing.scoreBreakdown.squareFootage)}/100 · weight {weights.squareFootage}% · {listing.area_sqft.toLocaleString()} sqft against {formatOptionalRange(minSqft, maxSqft, ' sqft')}
            </dd>
          </div>
          <div>
            <dt>Transit</dt>
            <dd>
              {formatScore(listing.scoreBreakdown.skyTrain)}/100 · weight {weights.skyTrain}% · {formatDistance(listing.skyTrainDistance)} from SkyTrain{maxSkyTrainKm ? `, target ${formatDistance(maxSkyTrainKm)}` : ''}
            </dd>
          </div>
          <div>
            <dt>Work</dt>
            <dd>
              {formatScore(listing.scoreBreakdown.work)}/100 · weight {weights.work}% · {formatDistance(listing.workDistance)} from {filters.workLocation}{maxWorkKm ? `, target ${formatDistance(maxWorkKm)}` : ''}
            </dd>
          </div>
        </dl>
        <small>Lower price and shorter distances score higher. More square footage scores higher.</small>
      </div>
    );
  }

  async function advanceSearchStep() {
    if (searchStep >= searchSteps.length - 2) {
      await runListingSearch(searchStep === searchSteps.length - 1);
    }

    setSearchStep((current) => Math.min(searchSteps.length - 1, current + 1));
  }

  return (
    <div className="page-shell">
      <header className="site-header">
        <div className="container nav-wrap">
          <div>
            <h1>BC Home Match</h1>
            <p>Greater Vancouver Rental &amp; Property Marketplace</p>
          </div>
          <nav>
            <a href="#" onClick={goHome}>Home</a>
            <a href="#search">Search</a>
            <a href="#listings">Listings</a>
            <a href="#cities">Cities</a>
            <a href="#agents">Agents</a>
            <a href="#contact">Contact</a>
          </nav>
          <div className="button-row">
            {session ? (
              <>
                <span className="session-pill">{session.user.email}</span>
                <button className="button ghost" onClick={signOut}>Logout</button>
              </>
            ) : (
              <button className="button ghost" onClick={() => setAuthOpen(true)}>Login</button>
            )}
            <button
              className="button primary"
              onClick={() => (session ? setListingFormOpen(true) : setAuthOpen(true))}
            >
              Post Listing
            </button>
          </div>
        </div>
      </header>

      <main>
        {route === 'search' ? (
          <section className="container search-page">
            <div className="search-page-header">
              <button className="text-button" type="button" onClick={goHome}>Back to home</button>
              <h2>Guided Property Search</h2>
              <p>{scoredListings.length} listings match your current search.</p>
            </div>

            <div className="step-shell">
              <div className="step-rail" aria-label="Search progress">
                {searchSteps.map((step, index) => (
                  <button
                    className={index === searchStep ? 'step-tab active' : 'step-tab'}
                    key={step}
                    type="button"
                    onClick={() => setSearchStep(index)}
                  >
                    <span>{index + 1}</span>
                    {step}
                  </button>
                ))}
              </div>

              <section className="guided-card">
                {searchStep === 0 && (
                  <>
                    <div className="guided-heading">
                      <p className="eyebrow-dark">Step 1</p>
                      <h3>Start with the property basics</h3>
                    </div>
                    <div className="form-grid">
                      <select value={filters.listingType} onChange={(event) => updateFilter('listingType', event.target.value)}>
                        <option value="all">Buy or Rent (optional)</option>
                        <option value="sale">Buy</option>
                        <option value="rent">Rent</option>
                      </select>
                      <select value={filters.propertyType} onChange={(event) => updateFilter('propertyType', event.target.value)}>
                        <option value="all">Property Type (optional)</option>
                        <option value="condo">Condo</option>
                        <option value="townhouse">Townhouse</option>
                        <option value="detached_house">Detached House</option>
                        <option value="basement_suite">Basement Suite</option>
                      </select>
                      <select value={filters.bedrooms} onChange={(event) => updateFilter('bedrooms', event.target.value)}>
                        <option value="all">Bedrooms (optional)</option>
                        <option value="1">1+</option>
                        <option value="2">2+</option>
                        <option value="3">3+</option>
                        <option value="4">4+</option>
                      </select>
                      <select value={filters.budget} onChange={(event) => updateFilter('budget', event.target.value)}>
                        <option value="all">Quick Budget (optional)</option>
                        <option value="3000">$3,000 max</option>
                        <option value="750000">$750,000 max</option>
                        <option value="1500000">$1,500,000 max</option>
                      </select>
                    </div>
                    <div className="criteria-grid">
                      <label>
                        <span>Price range</span>
                        <div className="range-pair">
                          <input type="number" min="0" placeholder="Min" value={filters.minPrice} onChange={(event) => updateFilter('minPrice', event.target.value)} />
                          <input type="number" min="0" placeholder="Max" value={filters.maxPrice} onChange={(event) => updateFilter('maxPrice', event.target.value)} />
                        </div>
                      </label>
                      <label>
                        <span>Square footage</span>
                        <div className="range-pair">
                          <input type="number" min="0" placeholder="Min" value={filters.minSqft} onChange={(event) => updateFilter('minSqft', event.target.value)} />
                          <input type="number" min="0" placeholder="Max" value={filters.maxSqft} onChange={(event) => updateFilter('maxSqft', event.target.value)} />
                        </div>
                      </label>
                    </div>
                  </>
                )}

                {searchStep === 1 && (
                  <>
                    <div className="guided-heading">
                      <p className="eyebrow-dark">Step 2</p>
                      <h3>Set commute needs and scoring weights</h3>
                    </div>
                    <div className="criteria-grid">
                      <label>
                        <span>Max SkyTrain distance</span>
                        <input type="number" min="0" step="0.1" placeholder="Kilometres" value={filters.maxSkyTrainKm} onChange={(event) => updateFilter('maxSkyTrainKm', event.target.value)} />
                      </label>
                      <label>
                        <span>Work location</span>
                        <select value={filters.workLocation} onChange={(event) => updateFilter('workLocation', event.target.value)}>
                          {cities.map((city) => <option key={city} value={city}>{city}</option>)}
                        </select>
                      </label>
                      <label>
                        <span>Max work distance</span>
                        <input type="number" min="0" step="0.1" placeholder="Kilometres" value={filters.maxWorkKm} onChange={(event) => updateFilter('maxWorkKm', event.target.value)} />
                      </label>
                      <label>
                        <span>Search by city or neighborhood</span>
                        <input type="text" placeholder="Vancouver, Burnaby, etc." value={filters.query} onChange={(event) => updateFilter('query', event.target.value)} />
                      </label>
                    </div>
                    <div className="weight-panel">
                      <label className="weight-control">How important is each factor to you?</label>
                      {Object.entries({
                        price: 'Price',
                        squareFootage: 'Square footage',
                        skyTrain: 'SkyTrain proximity',
                        work: 'Work proximity',
                      }).map(([key, label]) => (
                        <label className="weight-control" key={key}>
                          <span>{label}</span>
                          <input type="range" min="0" max="100" value={weights[key]} onChange={(event) => updateWeight(key, event.target.value)} />
                          <strong>{weights[key]}%</strong>
                        </label>
                      ))}
                    </div>
                  </>
                )}

                {searchStep === 2 && (
                  <>
                    <div className="guided-heading">
                      <p className="eyebrow-dark">Step 3</p>
                      <h3>Review ranked matches</h3>
                    </div>
                    <div className="results-table-wrap compact-table">
                      <table className="results-table">
                        <thead>
                          <tr>
                            <th>
                              <button className="sort-button" type="button" onClick={() => updateSort('title')}>
                                Listing <span>{sortLabel('title')}</span>
                              </button>
                            </th>
                            <th>
                              <button className="sort-button" type="button" onClick={() => updateSort('price')}>
                                Price <span>{sortLabel('price')}</span>
                              </button>
                            </th>
                            <th>
                              <button className="sort-button" type="button" onClick={() => updateSort('area_sqft')}>
                                Sqft <span>{sortLabel('area_sqft')}</span>
                              </button>
                            </th>
                            <th>
                              <button className="sort-button" type="button" onClick={() => updateSort('skyTrainDistance')}>
                                SkyTrain <span>{sortLabel('skyTrainDistance')}</span>
                              </button>
                            </th>
                            <th>
                              <button className="sort-button" type="button" onClick={() => updateSort('workDistance')}>
                                Work <span>{sortLabel('workDistance')}</span>
                              </button>
                            </th>
                            <th>
                              <button className="sort-button" type="button" onClick={() => updateSort('score')}>
                                Overall score <span>{sortLabel('score')}</span>
                              </button>
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {sortedListings.map((listing) => (
                            <tr key={listing.id}>
                              <td>
                                <strong>{listing.title}</strong>
                                <span>{listing.city} · {listing.bedrooms} beds · {listing.bathrooms} baths · {listing.source_name}</span>
                              </td>
                              <td>{formatPrice(listing)}</td>
                              <td>{listing.area_sqft.toLocaleString()}</td>
                              <td>{formatDistance(listing.skyTrainDistance)}</td>
                              <td>{formatDistance(listing.workDistance)}</td>
                              <td>
                                <div className="score-hover" tabIndex="0">
                                  <span className="score-pill">{listing.score}</span>
                                  {renderScoreBreakdown(listing)}
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </>
                )}

                <div className="step-actions">
                  <button className="button ghost" type="button" onClick={() => setSearchStep((current) => Math.max(0, current - 1))} disabled={searchStep === 0}>
                    Back
                  </button>
                  <button className="button primary" type="button" onClick={advanceSearchStep} disabled={isSearching}>
                    {isSearching ? 'Searching...' : searchStep === searchSteps.length - 1 ? 'Refresh matches' : 'Next'}
                  </button>
                </div>
              </section>
            </div>
          </section>
        ) : (
        <>
        <section className="hero">
          <div className="container hero-grid">
            <div>
              <span className="eyebrow">Serving Greater Vancouver Communities</span>
              <h2>Find Your Perfect Home in Greater Vancouver</h2>
              <p>
                Search rental apartments, condos, townhouses, and homes for sale across
                Vancouver, Burnaby, Richmond, Surrey, Coquitlam, and nearby cities.
              </p>
              <div className="button-row hero-buttons">
                <a href="#listings" className="button light">Browse Listings</a>
                <a href="#agents" className="button outline-light">Connect With Realtors</a>
              </div>
            </div>

            <aside className="search-card">
              <h3>Quick Search</h3>
              <p>Start with the basics, then fine-tune your match.</p>
              <form onSubmit={openSearchPage}>
                <input
                  type="text"
                  placeholder="City or neighborhood"
                  value={filters.query}
                  onChange={(event) => updateFilter('query', event.target.value)}
                />
                <div className="form-grid compact-form-grid">
                  <select value={filters.listingType} onChange={(event) => updateFilter('listingType', event.target.value)}>
                    <option value="all">Buy or Rent (optional)</option>
                    <option value="sale">Buy</option>
                    <option value="rent">Rent</option>
                  </select>
                  <select value={filters.bedrooms} onChange={(event) => updateFilter('bedrooms', event.target.value)}>
                    <option value="all">Bedrooms (optional)</option>
                    <option value="1">1+</option>
                    <option value="2">2+</option>
                    <option value="3">3+</option>
                    <option value="4">4+</option>
                  </select>
                </div>
                <button className="button primary wide quick-search-button" type="submit">
                  Continue Search
                </button>
              </form>
              <p className="search-meta">{scoredListings.length} matching listings</p>
            </aside>
          </div>
        </section>

        <section className="container stats">
          <article><strong>{listings.length}</strong><span>Active Listings</span></article>
          <article><strong>{listings.filter((listing) => listing.listing_type === 'rent').length}</strong><span>Rental Homes</span></article>
          <article><strong>{listings.filter((listing) => listing.listing_type === 'sale').length}</strong><span>Homes for Sale</span></article>
          <article><strong>35+</strong><span>Partner Realtors</span></article>
        </section>

        <section id="listings" className="container section">
          <div className="section-heading">
            <div>
              <h3>Featured Listings</h3>
              <p>{status}</p>
            </div>
          </div>
          <div className="listing-grid">
            {featuredListings.map((listing) => (
              <article className="listing-card" key={listing.id}>
                <img src={listing.image_url} alt={listing.title} />
                <span>{listing.listing_type === 'rent' ? 'For Rent' : 'For Sale'}</span>
                <div>
                  <strong>{formatPrice(listing)}</strong>
                  <h4>{listing.title}</h4>
                  <p>{listing.city} · {listing.source_name}</p>
                  <footer>
                    <em>{listing.bedrooms} Beds</em>
                    <em>{listing.bathrooms} Baths</em>
                    <em>{listing.area_sqft} sqft</em>
                  </footer>
                  <p className="listing-score">Score {listing.score} · SkyTrain {formatDistance(listing.skyTrainDistance)} · Work {formatDistance(listing.workDistance)}</p>
                  <div className="score-hover card-score-hover" tabIndex="0">
                    <button className="score-detail-trigger" type="button">Score details</button>
                    {renderScoreBreakdown(listing)}
                  </div>
                  {listing.source_url ? (
                    <a className="button dark" href={listing.source_url} target="_blank" rel="noreferrer">View Source</a>
                  ) : (
                    <button className="button dark">View Details</button>
                  )}
                </div>
              </article>
            ))}
          </div>
        </section>

        <section id="cities" className="cities">
          <div className="container section">
            <div className="centered-heading">
              <h3>Explore Greater Vancouver Cities</h3>
              <p>Search homes by neighborhood and municipality.</p>
            </div>
            <div className="city-grid">
              {cities.map((city) => <span key={city}>{city}</span>)}
            </div>
          </div>
        </section>

        <section className="container features">
          <article><h4>Advanced Property Matching</h4><p>AI-powered matching helps renters and buyers find properties that fit their budget, commute, and lifestyle.</p></article>
          <article><h4>Verified Listings</h4><p>Property listings are reviewed to reduce scams and improve transparency for renters and home buyers.</p></article>
          <article><h4>Local Realtor Network</h4><p>Connect with licensed Greater Vancouver real estate professionals and rental agents.</p></article>
        </section>

        <section id="agents" className="container realtor-cta">
          <div>
            <h3>Are You a Realtor or Property Manager?</h3>
            <p>Join BC Home Match to market your listings, connect with qualified renters and buyers, and manage leads in one place.</p>
          </div>
          <button className="button primary" onClick={() => (session ? setListingFormOpen(true) : setAuthOpen(true))}>
            Become a Partner
          </button>
        </section>
        </>
        )}
      </main>

      <footer id="contact" className="footer">
        <div className="container footer-grid">
          <div>
            <h4>BC Home Match</h4>
            <p>A modern home search platform for Greater Vancouver renters, buyers, realtors, and property managers.</p>
          </div>
          <div><h5>Company</h5><p>About Us<br />Careers<br />Partner Program<br />Press</p></div>
          <div><h5>Resources</h5><p>Rental Guide<br />Buying Guide<br />Mortgage Calculator<br />Market Reports</p></div>
          <div><h5>Contact</h5><p>Burnaby, British Columbia<br />support@bchomeonline.ca</p></div>
        </div>
        <small>© 2026 BC Home Match. All rights reserved.</small>
      </footer>

      <AuthModal
        isOpen={authOpen}
        onClose={() => setAuthOpen(false)}
        onSignIn={signIn}
        onSignUp={signUp}
        authMessage={authMessage}
      />
      <ListingForm
        isOpen={listingFormOpen}
        onClose={() => setListingFormOpen(false)}
        onSubmit={createListing}
        isSubmitting={isSubmitting}
      />
    </div>
  );
}
