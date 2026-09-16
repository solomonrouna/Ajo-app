import { useState, useEffect } from 'react';
import { supabase } from './supabaseClient.js';
import PinModal from './PinModal.jsx';
import AmountModal from './AmountModal.jsx';

function WalletPage({ session }) {
  const [balance, setBalance] = useState(null);
  const [transactions, setTransactions] = useState([]);
  const [hasPin, setHasPin] = useState(false);
  const [showSetPin, setShowSetPin] = useState(false);
  const [newPin, setNewPin] = useState('');
  const [forgotPin, setForgotPin] = useState(false);
  const [showPinModal, setShowPinModal] = useState(false);
  const [pendingWithdrawAmount, setPendingWithdrawAmount] = useState(null);
  const [amountModalMode, setAmountModalMode] = useState(null);
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
    const { data } = await supabase
      .from('profiles')
      .select('pin_hash')
      .eq('id', session.user.id)
      .single();

    setHasPin(!!(data && data.pin_hash));
  }

  async function handleSetPin() {
    if (newPin.length < 4) {
      alert('PIN must be at least 4 digits');
      return;
    }

    if (hasPin && !forgotPin) {
      const currentPin = prompt('Enter your current PIN to confirm this change');
      if (!currentPin) return;

      const { data: verified, error: verifyError } = await supabase.rpc('verify_pin', {
        p_user_id: session.user.id,
        p_pin: currentPin
      });

      if (verifyError) {
        alert(verifyError.message);
        return;
      }

      if (!verified) {
        alert('Current PIN is incorrect.');
        return;
      }
    }

    if (forgotPin) {
      const password = prompt('Enter your account password to confirm this change');
      if (!password) return;

      const { error: authError } = await supabase.auth.signInWithPassword({
        email: session.user.email,
        password: password
      });

      if (authError) {
        alert('Incorrect password.');
        return;
      }
    }

    const { error } = await supabase.rpc('set_pin', {
      p_user_id: session.user.id,
      p_pin: newPin
    });

    if (error) {
      console.log('error setting pin', error.message);
      alert('Could not set PIN. Please try again.');
      return;
    }

    alert('PIN set successfully!');
    setNewPin('');
    setShowSetPin(false);
    setForgotPin(false);
    setHasPin(true);
  }

  async function confirmFund(amount) {
    setAmountModalMode(null);
    const { error } = await supabase.rpc('add_ledger_entry', {
      p_wallet_id: session.user.id,
      p_amount: amount,
      p_direction: 'credit',
      p_description: 'Wallet funding'
    });

    if (error) {
      console.log('Error funding wallet', error.message);
      setBanner({ type: 'error', message: 'Could not fund wallet. Please try again.' });
    } else {
      setBanner({ type: 'success', message: `₦${amount.toLocaleString()} added to your wallet.` });
      fetchBalance();
      fetchTransactions();
    }
  }

  function confirmWithdrawAmount(amount) {
    setAmountModalMode(null);
    setPendingWithdrawAmount(amount);
    setShowPinModal(true);
  }

  async function completeWithdraw() {
    setShowPinModal(false);
    const { error } = await supabase.rpc('add_ledger_entry', {
      p_wallet_id: session.user.id,
      p_amount: pendingWithdrawAmount,
      p_direction: 'debit',
      p_description: 'Wallet withdrawn'
    });

    if (error) {
      console.log('Error withdrawing', error.message);
      setBanner({
        type: 'error',
        message: error.message.includes('Insufficient') ? 'Insufficient balance.' : 'Withdrawal failed.'
      });
    } else {
      setBanner({ type: 'success', message: `₦${pendingWithdrawAmount.toLocaleString()} withdrawn.` });
      fetchBalance();
      fetchTransactions();
    }
    setPendingWithdrawAmount(null);
  }

  return (
    <div className="dashboard">
      <h1 className="dashboard-greeting">Wallet</h1>

      {banner && (
        <div style={{
          marginTop: '12px',
          padding: '12px 16px',
          borderRadius: '10px',
          background: banner.type === 'success' ? '#ecfdf5' : '#fef2f2',
          color: banner.type === 'success' ? '#065f46' : '#b91c1c',
          fontSize: '14px'
        }}>
          {banner.message}
        </div>
      )}

      <div className="passbook-entry ajo-hero-card" style={{ marginTop: '20px' }}>
        <p className="passbook-label">Available balance</p>
        <p className="passbook-amount">
          ₦{balance !== null ? balance.toLocaleString() : '···'}
        </p>
        <div className="passbook-actions">
          <button className="passbook-action primary" onClick={() => setAmountModalMode('fund')}>+ Fund wallet</button>
          <button className="passbook-action secondary" onClick={() => setAmountModalMode('withdraw')}>Withdraw</button>
        </div>
      </div>

      <p style={{ fontWeight: '500', marginTop: '24px' }}>Statement</p>

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
            <button className="auth-button" onClick={handleSetPin}>Save PIN</button>
            <button
              onClick={() => { setShowSetPin(false); setNewPin(''); setForgotPin(false); }}
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

      {amountModalMode === 'fund' && (
        <AmountModal
          title="How much would you like to fund?"
          onConfirm={confirmFund}
          onCancel={() => setAmountModalMode(null)}
        />
      )}

      {amountModalMode === 'withdraw' && (
        <AmountModal
          title="How much would you like to withdraw?"
          onConfirm={confirmWithdrawAmount}
          onCancel={() => setAmountModalMode(null)}
        />
      )}

      {showPinModal && (
        <PinModal
          userId={session.user.id}
          onSuccess={completeWithdraw}
          onCancel={() => { setShowPinModal(false); setPendingWithdrawAmount(null); }}
        />
      )}
    </div>
  );
}

export default WalletPage;