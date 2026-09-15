import { useState } from 'react';
import { supabase } from './supabaseClient.js';

function PinModal({ userId, onSuccess, onCancel }) {
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');

  async function handleConfirm() {
    setError('');

    const { data, error: rpcError } = await supabase.rpc('verify_pin', {
      p_user_id: userId,
      p_pin: pin
    });

    if (rpcError) {
      setError(rpcError.message);
      return;
    }

    if (data === true) {
      onSuccess();
    } else {
      setError('Incorrect PIN. Please try again.');
      setPin('');
    }
  }

  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
      background: 'rgba(0,0,0,0.5)', display: 'flex',
      alignItems: 'center', justifyContent: 'center', zIndex: 1000
    }}>
      <div style={{ background: 'white', borderRadius: '12px', padding: '24px', width: '280px' }}>
        <p style={{ fontWeight: '500', marginBottom: '12px' }}>Enter your PIN to confirm</p>
        <input
          className="auth-input"
          type="password"
          inputMode="numeric"
          maxLength={6}
          autoFocus
          value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
        />
        {error && <p style={{ color: '#b91c1c', fontSize: '13px', marginTop: '4px' }}>{error}</p>}
        <button className="auth-button" style={{ marginTop: '12px' }} onClick={handleConfirm}>Confirm</button>
        <button
          onClick={onCancel}
          style={{ background: 'none', border: 'none', textDecoration: 'underline', cursor: 'pointer', marginTop: '8px', display: 'block' }}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

export default PinModal;