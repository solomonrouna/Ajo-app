import { useState, useEffect } from 'react';
import { supabase } from './supabaseClient.js';
import AmountModal from './AmountModal.jsx';
import WithdrawModal from './WithdrawModal.jsx';

function WalletPage({ session }) {
  const [balance, setBalance] = useState(null);
  const [transactions, setTransactions] = useState([]);
  const [hasPin, setHasPin] = useState(false);
  const [showSetPin, setShowSetPin] = useState(false);
  const [newPin, setNewPin] = useState('');
  const [forgotPin, setForgotPin] = useState(false);
  const [pinError, setPinError] = useState('');
  const [savingPin, setSavingPin] = useState(false);
  const [showFund, setShowFund] = useState(false);
  const [showWithdraw, setShowWithdraw] = useState(false);
  const [banner, setBanner] = useState(null);

  useEffect(() => {
    if (!session) return;
    fetchBalance();
    fetchTransactions();
    checkPinStatus();
  }, []);

  useEffect(() => {
    if (!banner) return;
    const timer = setTimeout(() => setBanner(null), 4000);
    return () => clearTimeout(timer);
  }, [banner]);

  function fetchBalance() {
    supabase
      .from('wallets')
      .select('balance')
      .eq('id', session.user.id)
      .single()
      .then(({ data, error }) => {
        if (data) setBalance(data.balance);
      });
  }

  async function fetchTransactions() {
    const { data, error } = await supabase
      .from('ledger_entries')
      .select('id, amount, direction, description, created_at')
      .eq('wallet_id', session.user.id)
      .order('created_at', { ascending: false })
      .limit(20);

    if (data) setTransactions(data);
  }

  async function checkPinStatus() {
    const { data } = await supabase.rpc('has_pin');
    setHasPin(data === true);
  }

  async function handleSetPin() {
    setPinError('');

    if (newPin.length < 4) {
      setPinError('PIN must be at least 4 digits');
      return;
    }

    const body = { new_pin: newPin };
        if (hasPin && !forgotPin) {
      const currentPin = prompt('Enter your current PIN to confirm this change');
      if (!currentPin) return;
      body.current_pin = currentPin;
    }

    if (!hasPin || forgotPin) {
      const password = prompt('Enter your account password to confirm this change');
      if (!password) return;
      body.password = password;
    }


    setSavingPin(true);
    const { data, error } = await supabase.functions.invoke('pin-manage', { body });
    setSavingPin(false);

    if (error) {
      let message = 'Could not set PIN. Please try again.';
      try {
        const details = await error.context.json();
        if (details?.error) message = details.error;
      } catch {
        // keep the default message
      }
      setPinError(message);
      return;
    }

    setBanner({ type: 'success', message: 'PIN set successfully!' });
    setNewPin('');
    setShowSetPin(false);
    setForgotPin(false);
    setHasPin(true);
  }

  async function confirmFund(amount) {
    setShowFund(false);

    if (!Number.isInteger(amount)) {
      setBanner({ type: 'error', message: 'Please enter a whole amount in naira.' });
      return;
    }

    const { data, error } = await supabase.functions.invoke('fund-initialize', {
      body: { amount },
    });

    if (error) {
      let message = 'Could not start payment. Please try again.';
      try {
        const details = await error.context.json();
        if (details?.error) message = details.error;
      } catch {
        // keep the default message
      }
      setBanner({ type: 'error', message });
      return;
    }

    window.location.href = data.authorization_url;
  }

  function handleWithdrawDone(result) {
    setShowWithdraw(false);
    setBanner({
      type: 'success',
      message: `₦${Number(result?.receive ?? 0).toLocaleString()} is on its way to your bank.`
    });
    fetchBalance();
    fetchTransactions();
  }

  return (
    <div className="dashboard">
      <div className="sticky-summary">
        <p className="sticky-summary-greeting">Wallet</p>
        <div className="sticky-summary-row">
          <div>
            <p className="sticky-summary-label">Available balance</p>
            <p className="sticky-summary-amount">₦{balance !== null ? balance.toLocaleString() : '···'}</p>
          </div>
          <div className="sticky-summary-actions">
            <button className="primary" onClick={() => setShowFund(true)}>+ Fund</button>
            <button className="secondary" onClick={() => setShowWithdraw(true)}>Withdraw</button>
          </div>
        </div>
      </div>

      {banner && (
        <div style={{
          marginTop: '12px',
          marginBottom: '4px',
          padding: '12px 16px',
          borderRadius: '10px',
          background: banner.type === 'success' ? '#ecfdf5' : '#fef2f2',
          color: banner.type === 'success' ? '#065f46' : '#b91c1c',
          fontSize: '14px'
        }}>
          {banner.message}
        </div>
      )}

      <p style={{ fontWeight: '500', marginTop: '20px' }}>Statement</p>

      <div className="circle-list" style={{ marginTop: '12px' }}>
        {transactions.length > 0 ? (
          transactions.map((tx) => (
            <div key={tx.id} className="circle-card">
              <div>
                <p className="circle-card-name">{tx.description}</p>
                <p className="circle-card-role">{new Date(tx.created_at).toLocaleString()}</p>
              </div>
              <div
                className="circle-card-amount"
                style={{ color: tx.direction === 'credit' ? 'green' : '#b91c1c' }}
              >
                {tx.direction === 'credit' ? '+' : '-'}₦{tx.amount.toLocaleString()}
              </div>
            </div>
          ))
        ) : (
          <p className="dashboard-sub">No transactions yet</p>
        )}
      </div>

      <div style={{ marginTop: '24px' }}>
        <p style={{ fontWeight: '500' }}>Security</p>
        {showSetPin ? (
          <div style={{ marginTop: '8px' }}>
            <input
              className="auth-input"
              type="password"
              inputMode="numeric"
              maxLength={6}
              placeholder="Enter new PIN"
              value={newPin}
              onChange={(e) => setNewPin(e.target.value.replace(/\D/g, ''))}
            />
            {pinError && <p style={{ color: '#b91c1c', fontSize: '13px', marginTop: '4px' }}>{pinError}</p>}
            <button className="auth-button" onClick={handleSetPin} disabled={savingPin}>
              {savingPin ? 'Saving…' : 'Save PIN'}
            </button>
            <button
              onClick={() => { setShowSetPin(false); setNewPin(''); setForgotPin(false); setPinError(''); }}
              style={{ background: 'none', border: 'none', textDecoration: 'underline', cursor: 'pointer', marginTop: '8px', display: 'block' }}
            >
              Cancel
            </button>
            {hasPin && !forgotPin && (
              <button
                onClick={() => setForgotPin(true)}
                style={{ background: 'none', border: 'none', textDecoration: 'underline', cursor: 'pointer', marginTop: '4px', display: 'block', fontSize: '13px', color: '#666' }}
              >
                Forgot your PIN?
              </button>
            )}
          </div>
        ) : (
          <button
            className="auth-switch"
            onClick={() => setShowSetPin(true)}
            style={{ background: 'none', border: 'none', textDecoration: 'underline', cursor: 'pointer', marginTop: '8px' }}
          >
            {hasPin ? 'Change PIN' : 'Set a PIN for withdrawals'}
          </button>
        )}
      </div>

      {showFund && (
        <AmountModal
          title="How much would you like to fund?"
          onConfirm={confirmFund}
          onCancel={() => setShowFund(false)}
        />
      )}

      {showWithdraw && (
        <WithdrawModal
          onDone={handleWithdrawDone}
          onCancel={() => setShowWithdraw(false)}
        />
      )}
    </div>
  );
}

export default WalletPage;