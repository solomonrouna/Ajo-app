import { useState } from 'react';
import { supabase } from './supabaseClient.js';

function LoginPage( { setSession } ) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loginError, setLoginError] = useState(null);
  const [loginLoading, setLoginLoading] = useState(false);
  const [showForgotPassword, setShowForgotPassword] = useState(false);
  const [resetEmail, setResetEmail] = useState('');
  const [resetMessage, setResetMessage] = useState(null);
  const [resetLoading, setResetLoading] = useState(false);

  async function handleLogin() {
    setLoginError(null);

    if (!email || !password) {
      setLoginError('Please fill in both fields.');
      return;
    }

    setLoginLoading(true);

    const { data, error } = await supabase.auth.signInWithPassword({
      email: email,
      password: password
    })

    if (error){
      console.error('Error logging in:', error.message);
      if (error.message.includes('Invalid login credentials')) {
        setLoginError('Incorrect email or password.');
      } else {
        setLoginError('Something went wrong. Please try again later.');
      }
    } else {
      console.log('logged in successfully:', data);
      setSession(data.session);
    }

    setLoginLoading(false);
  }

  async function handleForgotPassword() {
    setResetMessage(null);

    if (!resetEmail) {
      setResetMessage({ type: 'error', text: 'Please enter your email.' });
      return;
    }

    setResetLoading(true);

    const { error } = await supabase.auth.resetPasswordForEmail(resetEmail, {
      redirectTo: window.location.origin + '/reset-password'
    });

    if (error) {
      console.error('Error sending reset email:', error.message);
      setResetMessage({ type: 'error', text: 'Something went wrong. Please try again later.' });
    } else {
      setResetMessage({ type: 'success', text: 'Check your email for a password reset link.' });
    }

    setResetLoading(false);
  }

  if (showForgotPassword) {
    return (
      <div className="auth-card">
        <h1 className="auth-title">Reset your password</h1>
        <p className="auth-subtitle">We'll email you a reset link</p>
        <input
          className="auth-input"
          type="email"
          placeholder="Email"
          value={resetEmail}
          onChange={(e) => setResetEmail(e.target.value)}
        />
        {resetMessage && (
          <p style={{
            color: resetMessage.type === 'error' ? '#e53935' : '#2e7d32',
            fontSize: '14px',
            marginTop: '-8px',
            marginBottom: '12px'
          }}>
            {resetMessage.text}
          </p>
        )}
        <button className="auth-button" onClick={handleForgotPassword} disabled={resetLoading}>
          {resetLoading ? 'Sending...' : 'Send reset link'}
        </button>
        <div className="auth-switch">
          <button onClick={() => { setShowForgotPassword(false); setResetMessage(null); }}>Back to login</button>
        </div>
      </div>
    );
  }

  return (
    <div className="auth-card">
      <h1 className="auth-title">Welcome back</h1>
      <p className="auth-subtitle">Log in to your Ajo circle</p>
      <input
        className="auth-input"
        type="email"
        placeholder="Email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />
      <input
        className="auth-input"
        type="password"
        placeholder="Password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
      />
      {loginError && (
        <p style={{ color: '#e53935', fontSize: '14px', marginTop: '-8px', marginBottom: '12px' }}>
          {loginError}
        </p>
      )}
      <button className="auth-button" onClick={handleLogin} disabled={loginLoading}>
        {loginLoading ? 'Logging in...' : 'Login'}
      </button>
      <div className="auth-switch">
        <button onClick={() => setShowForgotPassword(true)}>Forgot password?</button>
      </div>
    </div>
  );
}

export default LoginPage;