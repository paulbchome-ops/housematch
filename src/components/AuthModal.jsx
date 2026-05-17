import { useState } from 'react';

export default function AuthModal({ isOpen, onClose, onSignIn, onSignUp, authMessage }) {
  const [mode, setMode] = useState('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  if (!isOpen) return null;

  async function handleSubmit(event) {
    event.preventDefault();
    if (mode === 'signin') {
      await onSignIn({ email, password });
    } else {
      await onSignUp({ email, password });
    }
  }

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="modal-card" role="dialog" aria-modal="true" aria-labelledby="auth-title">
        <button className="modal-close" onClick={onClose} aria-label="Close">
          ×
        </button>
        <p className="eyebrow-dark">{mode === 'signin' ? 'Welcome back' : 'Create account'}</p>
        <h2 id="auth-title">{mode === 'signin' ? 'Login' : 'Sign up'}</h2>
        <form onSubmit={handleSubmit}>
          <label>
            Email
            <input value={email} onChange={(event) => setEmail(event.target.value)} type="email" required />
          </label>
          <label>
            Password
            <input value={password} onChange={(event) => setPassword(event.target.value)} type="password" minLength={6} required />
          </label>
          <button className="button primary wide" type="submit">
            {mode === 'signin' ? 'Login' : 'Create account'}
          </button>
        </form>
        {authMessage ? <p className="status-message">{authMessage}</p> : null}
        <button className="text-button" onClick={() => setMode(mode === 'signin' ? 'signup' : 'signin')}>
          {mode === 'signin' ? 'Need an account? Sign up' : 'Already have an account? Login'}
        </button>
      </section>
    </div>
  );
}
