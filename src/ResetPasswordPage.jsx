import { useState } from 'react';
import { supabase } from './supabaseClient.js';

function ResetPasswordPage() {
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [resetError, setResetError] = useState(null);
  const [resetLoading, setResetLoading] = useState(false);
  const [resetDone, setResetDone] = useState(false);

  async function handleResetPassword() {
    setResetError(null);

    if (!newPassword || !confirmPassword) {
      setResetError('Please fill in both fields.');
      return;
    }

    if (newPassword.length < 6) {
      setResetError('Password must be at least 6 characters.');
      return;
    }

    if (newPassword !== confirmPassword) {
      setResetError('Passwords do not match.');
      return;
    }

    setResetLoading(true);

    const { error } = await supabase.auth.updateUser({ password: newPassword });

    if (error) {
      console.error('Error resetting password:', error.message);
      setResetError('Something went wrong. Please try again or request a new link.');
    } else {
      setResetDone(true);
    }

    setResetLoading(false);
  }

  if (resetDone) {
    return (
      <div className="auth-wrapper">
        <div className="auth-card">
          <h1 className="auth-title">Password updated</h1>
          <p className="auth-subtitle">You can now log in with your new password.</p>
          <button className="auth-button" onClick={() => window.location.href = '/'}>
            Go to login
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="auth-wrapper">
      <div className="auth-card">
        <h1 className="auth-title">Set a new password</h1>
        <p className="auth-subtitle">Choose something you haven't used before</p>
        <input
          className="auth-input"
          type="password"
          placeholder="New password"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
        />
        <input
          className="auth-input"
          type="password"
          placeholder="Confirm new password"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
        />
        {resetError && (
          <p style={{ color: '#e53935', fontSize: '14px', marginTop: '-8px', marginBottom: '12px' }}>
            {resetError}
          </p>
        )}
        <button className="auth-button" onClick={handleResetPassword} disabled={resetLoading}>
          {resetLoading ? 'Updating...' : 'Update password'}
        </button>
      </div>
    </div>
  );
}

export default ResetPasswordPage;