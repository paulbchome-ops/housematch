import React, { useEffect, useMemo, useState } from 'react';
import AuthModal from './components/AuthModal.jsx';
import ListingForm from './components/ListingForm.jsx';
import { fallbackListings } from './data/fallbackListings.js';
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
  query: '',
};

function formatPrice(listing) {
  return listing.listing_type === 'rent'
    ? `$${listing.price.toLocaleString()} / month`
    : `$${listing.price.toLocaleString()}`;
}

function normalizeText(value) {
  return value.trim().toLowerCase();
}

export default function App() {
  const [listings, setListings] = useState(fallbackListings);
  const [filters, setFilters] = useState(defaultFilters);
  const [session, setSession] = useState(null);
  const [authOpen, setAuthOpen] = useState(false);
  const [listingFormOpen, setListingFormOpen] = useState(false);
  const [authMessage, setAuthMessage] = useState('');
  const [status, setStatus] = useState(hasSupabaseConfig ? 'Loading live listings…' : 'Using demo data until Supabase is configured.');
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!supabase) return;

    async function loadInitialData() {
      const [{ data: authData }, { data, error }] = await Promise.all([
        supabase.auth.getSession(),
        supabase.from('listings').select('*').eq('is_published', true).order('created_at', { ascending: false }),
      ]);

      setSession(authData.session);
      if (error) {
        setStatus(`Could not load live listings: ${error.message}`);
        return;
      }
      setListings(data);
      setStatus(data.length ? 'Live listings loaded from Supabase.' : 'No live listings yet.');
    }

    loadInitialData();

    const { data: subscription } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
    });

    return () => subscription.subscription.unsubscribe();
  }, []);

  const filteredListings = useMemo(() => {
    return listings.filter((listing) => {
      const matchesListingType =
        filters.listingType === 'all' || listing.listing_type === filters.listingType;
      const matchesPropertyType =
        filters.propertyType === 'all' || listing.property_type === filters.propertyType;
      const matchesBedrooms =
        filters.bedrooms === 'all' || listing.bedrooms >= Number(filters.bedrooms);
      const matchesBudget =
        filters.budget === 'all' || listing.price <= Number(filters.budget);
      const query = normalizeText(filters.query);
      const matchesQuery =
        !query ||
        normalizeText(listing.title).includes(query) ||
        normalizeText(listing.city).includes(query);

      return matchesListingType && matchesPropertyType && matchesBedrooms && matchesBudget && matchesQuery;
    });
  }, [filters, listings]);

  async function signIn(credentials) {
    if (!supabase) return setAuthMessage('Add your Supabase project values first.');
    const { error } = await supabase.auth.signInWithPassword(credentials);
    setAuthMessage(error ? error.message : 'Logged in successfully.');
    if (!error) setAuthOpen(false);
  }

  async function signUp(credentials) {
    if (!supabase) return setAuthMessage('Add your Supabase project values first.');
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
              <input
                type="text"
                placeholder="Search by city or neighborhood"
                value={filters.query}
                onChange={(event) => updateFilter('query', event.target.value)}
              />
              <p className="search-meta">{filteredListings.length} matching listings</p>
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
            {filteredListings.map((listing) => (
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
