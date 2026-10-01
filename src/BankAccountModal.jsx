import { useState, useEffect } from 'react';
import { supabase } from './supabaseClient.js';

async function callBankAccount(body) {
  const { data, error } = await supabase.functions.invoke('bank-account', { body });
  if (error) {
    let message = 'Something went wrong. Please try again.';
    try {
      const details = await error.context.json();
      if (details?.error) message = details.error;
    } catch {
      // keep the default message
    }
    return { data: null, message };
  }
  return { data, message: null };
}

function BankAccountModal({ onSaved, onCancel }) {
  const [banks, setBanks] = useState([]);
  const [bankCode, setBankCode] = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  const [accountName, setAccountName] = useState('');
  const [checking, setChecking] = useState(false);
  const [pin, setPin] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    loadBanks();
  }, []);

  async function loadBanks() {
    const { data, message } = await callBankAccount({ action: 'banks' });
    if (message) {
      setError(message);
      return;
    }
    setBanks(data.banks || []);
  }

  useEffect(() => {
    setAccountName('');
    if (accountNumber.length !== 10 || !bankCode) return;

    let cancelled = false;
    setChecking(true);
    setError('');

    callBankAccount({ action: 'resolve', account_number: accountNumber, bank_code: bankCode })
      .then(({ data, message }) => {
        if (cancelled) return;
        setChecking(false);
        if (message) setError(message);
        else setAccountName(data.account_name);
      });

    return () => {
      cancelled = true;
    };
  }, [accountNumber, bankCode]);

  async function handleSave() {
    setError('');
    setSaving(true);
    const { data, message } = await callBankAccount({
      action: 'save',
      account_number: accountNumber,
      bank_code: bankCode,
      pin,
    });
    setSaving(false);

    if (message) {
      setError(message);
      setPin('');
      return;
    }
    onSaved(data);
  }

  const canSave = accountName && pin.length >= 4 && !saving;

  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
      background: 'rgba(0,0,0,0.5)', display: 'flex',
      alignItems: 'center', justifyContent: 'center', zIndex: 1000
    }}>
      <div style={{ background: 'white', borderRadius: '12px', padding: '24px', width: '320px', maxHeight: '90vh', overflowY: 'auto' }}>
        <p style={{ fontWeight: '500', marginBottom: '12px' }}>Add your bank account</p>

        <select
          className="auth-input"
          value={bankCode}
          onChange={(e) => setBankCode(e.target.value)}
        >
          <option value="">{banks.length ? 'Choose your bank' : 'Loading banks…'}</option>
          {banks.map((b) => (
                        <option key={`${b.code}-${b.name}`} value={b.code}>{b.name}</option>
          ))}
        </select>

        <input
          className="auth-input"
          type="text"
          inputMode="numeric"
          maxLength={10}
          placeholder="10-digit account number"
          value={accountNumber}
          onChange={(e) => setAccountNumber(e.target.value.replace(/\D/g, ''))}
        />

        {checking && <p style={{ fontSize: '13px', color: '#666' }}>Checking account…</p>}
        {accountName && (
          <p style={{ fontSize: '14px', color: '#065f46' }}>
            Account name: <strong>{accountName}</strong>
          </p>
        )}

        {accountName && (
          <input
            className="auth-input"
            type="password"
            inputMode="numeric"
            maxLength={6}
           autoComplete="new-password"
            name="ajo-withdrawal-pin"
            placeholder="Your withdrawal PIN"
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
          />
        )}

        {error && <p style={{ color: '#b91c1c', fontSize: '13px', marginTop: '4px' }}>{error}</p>}

        <button
          className="auth-button"
          style={{ marginTop: '12px' }}
          onClick={handleSave}
          disabled={!canSave}
        >
          {saving ? 'Saving…' : 'Save account'}
        </button>
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

export default BankAccountModal;