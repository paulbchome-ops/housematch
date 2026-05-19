import React, { useEffect, useMemo, useState } from 'react';
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

export default function App() {
  const [listings, setListings] = useState([]);
  const [filters, setFilters] = useState(defaultFilters);
  const [weights, setWeights] = useState(defaultWeights);
  const [session, setSession] = useState(null);
  const [authOpen, setAuthOpen] = useState(false);
  const [listingFormOpen, setListingFormOpen] = useState(false);
  const [authMessage, setAuthMessage] = useState('');
  const [status, setStatus] = useState(
    hasSupabaseConfig
      ? 'Loading listings...'
      : 'Database is not connected.',
  );
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!supabase) {
      setListings([]);
      setStatus('Database is not connected.');
      return undefined;
    }

    let isMounted = true;

    async function loadListings() {
      const { data, error } = await supabase
        .from('listings')
        .select('*')
        .eq('is_published', true)
        .order('created_at', { ascending: false });

      if (!isMounted) return;

      if (error) {
        setListings([]);
        setStatus(`Could not load listings: ${error.message}`);
        return;
      }

      setListings(data ?? []);
      setStatus(data?.length ? 'Listings loaded.' : 'No published listings found.');
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

    return () => {
      isMounted = false;
      authSubscription.subscription.unsubscribe();
      supabase.removeChannel(listingsChannel);
    };
  }, []);

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

    setListings((current) => [data, ...current]);
    setListingFormOpen(false);
    setStatus('Listing posted.');
  }

  function updateFilter(field, value) {
    setFilters((current) => ({ ...current, [field]: value }));
  }

  function updateWeight(field, value) {
    setWeights((current) => ({ ...current, [field]: Number(value) }));
  }

  return (
    <div className="page-shell">
      <header className="site-header">
        <div className="container nav-wrap">
          <div>
            <h1>HouseMatch Vancouver</h1>
            <p>Greater Vancouver Rental &amp; Property Marketplace</p>
          </div>
          <nav>
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
              <h3>Property Search</h3>
              <p>Search rentals and homes for sale.</p>
              <div className="form-grid">
                <select value={filters.listingType} onChange={(event) => updateFilter('listingType', event.target.value)}>
                  <option value="all">Buy or Rent</option>
                  <option value="sale">Buy</option>
                  <option value="rent">Rent</option>
                </select>
                <select value={filters.propertyType} onChange={(event) => updateFilter('propertyType', event.target.value)}>
                  <option value="all">Property Type</option>
                  <option value="condo">Condo</option>
                  <option value="townhouse">Townhouse</option>
                  <option value="detached_house">Detached House</option>
                  <option value="basement_suite">Basement Suite</option>
                </select>
                <select value={filters.bedrooms} onChange={(event) => updateFilter('bedrooms', event.target.value)}>
                  <option value="all">Bedrooms</option>
                  <option value="1">1+</option>
                  <option value="2">2+</option>
                  <option value="3">3+</option>
                  <option value="4">4+</option>
                </select>
                <select value={filters.budget} onChange={(event) => updateFilter('budget', event.target.value)}>
                  <option value="all">Budget</option>
                  <option value="3000">$3,000 max</option>
                  <option value="750000">$750,000 max</option>
                  <option value="1500000">$1,500,000 max</option>
                </select>
              </div>
              <div className="criteria-grid">
                <label>
                  <span>Price range</span>
                  <div className="range-pair">
                    <input
                      type="number"
                      min="0"
                      placeholder="Min"
                      value={filters.minPrice}
                      onChange={(event) => updateFilter('minPrice', event.target.value)}
                    />
                    <input
                      type="number"
                      min="0"
                      placeholder="Max"
                      value={filters.maxPrice}
                      onChange={(event) => updateFilter('maxPrice', event.target.value)}
                    />
                  </div>
                </label>
                <label>
                  <span>Square footage</span>
                  <div className="range-pair">
                    <input
                      type="number"
                      min="0"
                      placeholder="Min"
                      value={filters.minSqft}
                      onChange={(event) => updateFilter('minSqft', event.target.value)}
                    />
                    <input
                      type="number"
                      min="0"
                      placeholder="Max"
                      value={filters.maxSqft}
                      onChange={(event) => updateFilter('maxSqft', event.target.value)}
                    />
                  </div>
                </label>
                <label>
                  <span>Max SkyTrain distance</span>
                  <input
                    type="number"
                    min="0"
                    step="0.1"
                    placeholder="Kilometres"
                    value={filters.maxSkyTrainKm}
                    onChange={(event) => updateFilter('maxSkyTrainKm', event.target.value)}
                  />
                </label>
                <label>
                  <span>Work location</span>
                  <select
                    value={filters.workLocation}
                    onChange={(event) => updateFilter('workLocation', event.target.value)}
                  >
                    {cities.map((city) => <option key={city} value={city}>{city}</option>)}
                  </select>
                </label>
                <label>
                  <span>Max work distance</span>
                  <input
                    type="number"
                    min="0"
                    step="0.1"
                    placeholder="Kilometres"
                    value={filters.maxWorkKm}
                    onChange={(event) => updateFilter('maxWorkKm', event.target.value)}
                  />
                </label>
              </div>
              <div className="weight-panel">
                {Object.entries({
                  price: 'Price',
                  squareFootage: 'Square footage',
                  skyTrain: 'SkyTrain proximity',
                  work: 'Work proximity',
                }).map(([key, label]) => (
                  <label className="weight-control" key={key}>
                    <span>{label}</span>
                    <input
                      type="range"
                      min="0"
                      max="100"
                      value={weights[key]}
                      onChange={(event) => updateWeight(key, event.target.value)}
                    />
                    <strong>{weights[key]}%</strong>
                  </label>
                ))}
              </div>
              <input
                type="text"
                placeholder="Search by city or neighborhood"
                value={filters.query}
                onChange={(event) => updateFilter('query', event.target.value)}
              />
              <p className="search-meta">{scoredListings.length} matching listings ranked by composite score</p>
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
          <div className="results-table-wrap">
            <table className="results-table">
              <thead>
                <tr>
                  <th>Listing</th>
                  <th>Price</th>
                  <th>Sqft</th>
                  <th>SkyTrain</th>
                  <th>Work</th>
                  <th>Overall score</th>
                </tr>
              </thead>
              <tbody>
                {scoredListings.map((listing) => (
                  <tr key={listing.id}>
                    <td>
                      <strong>{listing.title}</strong>
                      <span>{listing.city} · {listing.bedrooms} beds · {listing.bathrooms} baths</span>
                    </td>
                    <td>{formatPrice(listing)}</td>
                    <td>{listing.area_sqft.toLocaleString()}</td>
                    <td>{formatDistance(listing.skyTrainDistance)}</td>
                    <td>{formatDistance(listing.workDistance)}</td>
                    <td><span className="score-pill">{listing.score}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="listing-grid">
            {scoredListings.map((listing) => (
              <article className="listing-card" key={listing.id}>
                <img src={listing.image_url} alt={listing.title} />
                <span>{listing.listing_type === 'rent' ? 'For Rent' : 'For Sale'}</span>
                <div>
                  <strong>{formatPrice(listing)}</strong>
                  <h4>{listing.title}</h4>
                  <p>{listing.city}</p>
                  <footer>
                    <em>{listing.bedrooms} Beds</em>
                    <em>{listing.bathrooms} Baths</em>
                    <em>{listing.area_sqft} sqft</em>
                  </footer>
                  <p className="listing-score">Score {listing.score} · SkyTrain {formatDistance(listing.skyTrainDistance)} · Work {formatDistance(listing.workDistance)}</p>
                  <button className="button dark">View Details</button>
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
            <p>Join HouseMatch Vancouver to market your listings, connect with qualified renters and buyers, and manage leads in one place.</p>
          </div>
          <button className="button primary" onClick={() => (session ? setListingFormOpen(true) : setAuthOpen(true))}>
            Become a Partner
          </button>
        </section>
      </main>

      <footer id="contact" className="footer">
        <div className="container footer-grid">
          <div>
            <h4>HouseMatch Vancouver</h4>
            <p>A modern home search platform for Greater Vancouver renters, buyers, realtors, and property managers.</p>
          </div>
          <div><h5>Company</h5><p>About Us<br />Careers<br />Partner Program<br />Press</p></div>
          <div><h5>Resources</h5><p>Rental Guide<br />Buying Guide<br />Mortgage Calculator<br />Market Reports</p></div>
          <div><h5>Contact</h5><p>Burnaby, British Columbia<br />support@housematchvancouver.ca<br />+1 (604) 555-2026</p></div>
        </div>
        <small>© 2026 HouseMatch Vancouver. All rights reserved.</small>
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
