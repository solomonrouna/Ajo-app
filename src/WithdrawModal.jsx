import { useState, useEffect, useRef } from 'react';
import { supabase } from './supabaseClient.js';
import BankAccountModal from './BankAccountModal.jsx';

const WITHDRAWALS_ENABLED = false; // flip to true once Paystack business is upgraded

async function readError(error, fallback) {
  try {
    const details = await error.context.json();
    if (details?.error) return details.error;
  } catch {
    // keep the fallback
  }
  return fallback;
}

function WithdrawModal({ onDone, onCancel }) {
  const [account, setAccount] = useState(undefined); // undefined = loading, null = none saved
  const [showBank, setShowBank] = useState(false);
  const [amount, setAmount] = useState('');
  const [quote, setQuote] = useState(null);
  const [pin, setPin] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const busy = useRef(false);

  useEffect(() => {
    if (WITHDRAWALS_ENABLED) loadAccount();
  }, []);

  async function loadAccount() {
    const { data, error: fnError } = await supabase.functions.invoke('bank-account', {
      body: { action: 'mine' },
    });
    if (fnError) {
      setError(await readError(fnError, 'Could not load your bank account.'));
      setAccount(null);
      return;
    }
    setAccount(data?.account ?? null);
  }

  useEffect(() => {
    setQuote(null);
    const n = Number(amount);
    if (!amount || !Number.isInteger(n) || n < 1) return;

    let cancelled = false;
    const timer = setTimeout(async () => {
      const { data } = await supabase.rpc('withdrawal_quote', { p_amount_naira: n });
      if (!cancelled && data) setQuote(data);
    }, 300);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [amount]);

  async function handleConfirm() {
    if (busy.current) return;
    busy.current = true;
    setError('');
    setSubmitting(true);

    const { data, error: fnError } = await supabase.functions.invoke('withdraw-initiate', {
      body: { amount: Number(amount), pin },
    });

    setSubmitting(false);
    busy.current = false;

    if (fnError) {
      setError(await readError(fnError, 'Could not start your withdrawal. Please try again.'));
      setPin('');
      return;
    }

    // Only say "on its way" if the server gave us a real withdrawal reference.
    if (!data?.reference || !data?.processing) {
      setError('We could not confirm your withdrawal. Please check your wallet before trying again.');
      setPin('');
      return;
    }

    onDone(data);
  }

  const canConfirm = Boolean(account && quote && quote.receive > 0 && pin.length >= 4 && !submitting);

  return (
    <>
      <div style={{
        position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
        background: 'rgba(0,0,0,0.5)', display: 'flex',
        alignItems: 'center', justifyContent: 'center', zIndex: 1000
      }}>
        <div style={{ background: 'white', borderRadius: '12px', padding: '24px', width: '320px', maxHeight: '90vh', overflowY: 'auto' }}>
          <p style={{ fontWeight: '500', marginBottom: '12px' }}>Withdraw to your bank</p>

          {!WITHDRAWALS_ENABLED ? (
            <>
              <p style={{ fontSize: '14px', color: '#444', lineHeight: '1.5' }}>
                Withdrawals to your bank account are coming soon. Your wallet balance is safe — you'll be able to cash out as soon as this is turned on.
              </p>
              <button
                onClick={onCancel}
                className="auth-button"
                style={{ marginTop: '14px' }}
              >
                Got it
              </button>
            </>
          ) : (
            <>
              {account === undefined && <p style={{ fontSize: '14px', color: '#666' }}>Loading…</p>}

              {account === null && (
                <>
                  <p style={{ fontSize: '14px' }}>Add a bank account to withdraw.</p>
                  <button className="auth-button" onClick={() => setShowBank(true)}>Add bank account</button>
                </>
              )}

              {account && (
                <>
                  <div style={{ fontSize: '14px', marginBottom: '12px' }}>
                    <p style={{ margin: 0 }}>Paying to</p>
                    <p style={{ margin: '2px 0', fontWeight: '500' }}>
                      {account.bank_name} ····{account.account_last4}
                    </p>
                    <p style={{ margin: 0, color: '#666' }}>{account.account_name}</p>
                    <button
                      onClick={() => setShowBank(true)}
                      style={{ background: 'none', border: 'none', textDecoration: 'underline', cursor: 'pointer', padding: 0, marginTop: '4px', fontSize: '13px' }}
                    >
                      Change account
                    </button>
                  </div>

                  <input
                    className="auth-input"
                    type="text"
                    inputMode="numeric"
                    autoComplete="off"
                    placeholder="Amount in ₦"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value.replace(/\D/g, ''))}
                  />

                  {quote && (
                    <div style={{ fontSize: '14px', background: '#f5f7fb', borderRadius: '8px', padding: '10px 12px', margin: '8px 0' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                        <span>Fee</span>
                        <span>₦{Number(quote.fee).toLocaleString()}</span>
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: '500' }}>
                        <span>You receive</span>
                        <span>₦{Number(quote.receive).toLocaleString()}</span>
                      </div>
                    </div>
                  )}

                  <input
                    className="auth-input"
                    type="password"
                    name="ajo-withdrawal-pin"
                    inputMode="numeric"
                    maxLength={6}
                    autoComplete="new-password"
                    placeholder="Your withdrawal PIN"
                    value={pin}
                    onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
                  />

                  {error && <p style={{ color: '#b91c1c', fontSize: '13px', marginTop: '4px' }}>{error}</p>}

                  <button
                    className="auth-button"
                    style={{
                      marginTop: '12px',
                      opacity: canConfirm ? 1 : 0.45,
                      cursor: canConfirm ? 'pointer' : 'not-allowed'
                    }}
                    onClick={handleConfirm}
                    disabled={!canConfirm}
                  >
                    {submitting ? 'Sending…' : 'Confirm withdrawal'}
                  </button>
                </>
              )}

              {account !== undefined && !account && error && (
                <p style={{ color: '#b91c1c', fontSize: '13px' }}>{error}</p>
              )}

              <button
                onClick={onCancel}
                style={{ background: 'none', border: 'none', textDecoration: 'underline', cursor: 'pointer', marginTop: '8px', display: 'block' }}
              >
                Cancel
              </button>
            </>
          )}
        </div>
      </div>

      {showBank && (
        <BankAccountModal
          onSaved={(saved) => { setAccount(saved); setShowBank(false); }}
          onCancel={() => setShowBank(false)}
        />
      )}
    </>
  );
}

export default WithdrawModal;