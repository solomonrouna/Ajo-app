import { useState } from 'react';

function AmountModal({ title, onConfirm, onCancel }) {
  const [amount, setAmount] = useState('');

  function handleConfirm() {
    const num = Number(amount);
    if (!amount || num <= 0) return;
    onConfirm(num);
  }

  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
      background: 'rgba(0,0,0,0.5)', display: 'flex',
      alignItems: 'center', justifyContent: 'center', zIndex: 1000
    }}>
      <div style={{ background: 'white', borderRadius: '12px', padding: '24px', width: '280px' }}>
        <p style={{ fontWeight: '500', marginBottom: '12px' }}>{title}</p>
        <input
          className="auth-input"
          type="number"
          inputMode="numeric"
          autoFocus
          placeholder="₦0"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
        <button className="auth-button" onClick={handleConfirm}>Continue</button>
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

export default AmountModal;