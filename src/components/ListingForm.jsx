import React, { useState } from 'react';

const initialForm = {
  title: '',
  price: '',
  listing_type: 'sale',
  property_type: 'condo',
  bedrooms: '1',
  bathrooms: '1',
  area_sqft: '',
  city: '',
  image_url: '',
};

export default function ListingForm({ isOpen, onClose, onSubmit, isSubmitting }) {
  const [form, setForm] = useState(initialForm);

  if (!isOpen) return null;

  function updateField(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  async function handleSubmit(event) {
    event.preventDefault();
    await onSubmit({
      ...form,
      price: Number(form.price),
      bedrooms: Number(form.bedrooms),
      bathrooms: Number(form.bathrooms),
      area_sqft: Number(form.area_sqft),
    });
    setForm(initialForm);
  }

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="modal-card listing-form-card" role="dialog" aria-modal="true" aria-labelledby="listing-title">
        <button className="modal-close" onClick={onClose} aria-label="Close">
          ×
        </button>
        <p className="eyebrow-dark">Create listing</p>
        <h2 id="listing-title">Post a property</h2>
        <form onSubmit={handleSubmit} className="listing-form-grid">
          <label>
            Title
            <input value={form.title} onChange={(event) => updateField('title', event.target.value)} required />
          </label>
          <label>
            Price
            <input value={form.price} onChange={(event) => updateField('price', event.target.value)} type="number" min="0" required />
          </label>
          <label>
            Listing type
            <select value={form.listing_type} onChange={(event) => updateField('listing_type', event.target.value)}>
              <option value="sale">For Sale</option>
              <option value="rent">For Rent</option>
            </select>
          </label>
          <label>
            Property type
            <select value={form.property_type} onChange={(event) => updateField('property_type', event.target.value)}>
              <option value="condo">Condo</option>
              <option value="townhouse">Townhouse</option>
              <option value="detached_house">Detached House</option>
              <option value="basement_suite">Basement Suite</option>
            </select>
          </label>
          <label>
            Bedrooms
            <input value={form.bedrooms} onChange={(event) => updateField('bedrooms', event.target.value)} type="number" min="0" required />
          </label>
          <label>
            Bathrooms
            <input value={form.bathrooms} onChange={(event) => updateField('bathrooms', event.target.value)} type="number" min="0" required />
          </label>
          <label>
            Area (sqft)
            <input value={form.area_sqft} onChange={(event) => updateField('area_sqft', event.target.value)} type="number" min="0" required />
          </label>
          <label>
            City
            <input value={form.city} onChange={(event) => updateField('city', event.target.value)} required />
          </label>
          <label className="full-width">
            Image URL
            <input value={form.image_url} onChange={(event) => updateField('image_url', event.target.value)} type="url" required />
          </label>
          <button className="button primary wide full-width" type="submit" disabled={isSubmitting}>
            {isSubmitting ? 'Posting…' : 'Post listing'}
          </button>
        </form>
      </section>
    </div>
  );
}
