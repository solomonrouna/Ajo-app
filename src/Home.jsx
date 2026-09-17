import { useState, useEffect, useRef } from 'react';
import { supabase } from './supabaseClient.js';
import PinModal from './PinModal.jsx';
import AmountModal from './AmountModal.jsx';

const walletIcon = (
  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M19 7V5a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h14a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H5a2 2 0 0 1-2-2V6" /><circle cx="16" cy="13" r="1" />
  </svg>
);
const usersIcon = (
  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M16 19v-1a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v1" /><circle cx="9" cy="7" r="3" />
    <path d="M22 19v-1a4 4 0 0 0-3-3.87M16 4.13a4 4 0 0 1 0 7.75" />
  </svg>
);
const bellIcon = (
  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.7 21a2 2 0 0 1-3.4 0" />
  </svg>
);

function timeOfDayGreeting() {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

function HomePage({ session, setSession, setPage, setCircleToOpen }) {
  const [circles, setCircles] = useState([]);
  const [balance, setBalance] = useState(null);
  const [fullName, setFullName] = useState(null);
  const [invites, setInvites] = useState([]);
  const [showInvites, setShowInvites] = useState(false);
  const [amountModalMode, setAmountModalMode] = useState(null);
  const [showPinModal, setShowPinModal] = useState(false);
  const [pendingWithdrawAmount, setPendingWithdrawAmount] = useState(null);
  const [banner, setBanner] = useState(null);
  const [showPeek, setShowPeek] = useState(false);
  const heroRef = useRef(null);

  useEffect(() => {
    if (!session) return;
    window.scrollTo(0, 0);
    fetchBalance();
    fetchProfile();
    fetchCirclesWithProgress();
    fetchInvites();
  }, []);

  useEffect(() => {
    if (!banner) return;
    const timer = setTimeout(() => setBanner(null), 4000);
    return () => clearTimeout(timer);
  }, [banner]);

  // Show a slim balance bar once the full card scrolls out of view,
  // instead of pinning the whole card (which would hide the greeting/stats).
  // Observer start is deferred to the next animation frame so it can't
  // fire off a reading before the initial layout has settled.
  useEffect(() => {
    const el = heroRef.current;
    if (!el || !('IntersectionObserver' in window)) return;
    const io = new IntersectionObserver(
      ([entry]) => setShowPeek(!entry.isIntersecting),
      { threshold: 0.05, rootMargin: '0px' }
    );
    const raf = requestAnimationFrame(() => io.observe(el));
    return () => {
      cancelAnimationFrame(raf);
      io.disconnect();
    };
  }, []);

  function fetchBalance() {
    supabase
      .from('wallets')
      .select('balance')
      .eq('id', session.user.id)
      .single()
      .then(({ data }) => {
        if (data) setBalance(data.balance);
      });
  }

  function fetchProfile() {
    supabase
      .from('profiles')
      .select('full_name')
      .eq('id', session.user.id)
      .single()
      .then(({ data }) => {
        if (data && data.full_name) setFullName(data.full_name);
      });
  }

  async function fetchInvites() {
    const { data } = await supabase
      .from('circle_invites')
      .select('id, circles(id, name, contribution_amount)')
      .eq('invited_user_id', session.user.id)
      .eq('status', 'pending');

    if (data) setInvites(data.filter((invite) => invite.circles !== null));
  }

  async function respondToInvite(inviteId, circleId, accept) {
    if (accept) {
      const { count } = await supabase
        .from('circle_members')
        .select('*', { count: 'exact', head: true })
        .eq('circle_id', circleId);

      const { data: circleData, error: circleError } = await supabase
        .from('circles')
        .select('target_member_count')
        .eq('id', circleId)
        .maybeSingle();

      if (circleError || !circleData) {
        console.log('error fetching circle for invite', circleError?.message);
        alert('Could not process this invite. Please try again.');
        return;
      }

      if (count >= circleData.target_member_count) {
        alert('This circle is already full. You cannot join.');
        return;
      }

      const { error: memberError } = await supabase
        .from('circle_members')
        .insert({
          circle_id: circleId,
          user_id: session.user.id,
          role: 'member',
          payout_position: (count || 0) + 1
        });

      if (memberError) {
        console.log('error joining circle', memberError.message);
        alert('Could not join circle. Please try again.');
        return;
      }
    }

    const { error: updateError } = await supabase
      .from('circle_invites')
      .update({ status: accept ? 'accepted' : 'declined' })
      .eq('id', inviteId);

    if (updateError) {
      console.log('error updating invite', updateError.message);
      return;
    }

    fetchInvites();
    fetchCirclesWithProgress();
  }

  async function fetchCirclesWithProgress() {
    const { data: memberRows, error } = await supabase
      .from('circle_members')
      .select('role, circles(id, name, contribution_amount, target_member_count, current_cycle, cycle_duration_days, current_cycle_due_date)')
      .eq('user_id', session.user.id);

    if (error || !memberRows) {
      console.log('error fetching circles', error?.message);
      return;
    }

    const validRows = memberRows.filter((row) => row.circles !== null);

    const withProgress = await Promise.all(
      validRows.map(async (row) => {
        const circle = row.circles;

        const { count: paidCount } = await supabase
          .from('contributions')
          .select('*', { count: 'exact', head: true })
          .eq('circle_id', circle.id)
          .eq('cycle_number', circle.current_cycle);

        const { data: myContribution } = await supabase
          .from('contributions')
          .select('id')
          .eq('circle_id', circle.id)
          .eq('cycle_number', circle.current_cycle)
          .eq('user_id', session.user.id)
          .maybeSingle();

        return {
          ...circle,
          paidCount: paidCount || 0,
          hasPaid: !!myContribution
        };
      })
    );

    setCircles(withProgress);
  }

  function cycleLabel(days) {
    if (days === 7) return 'weekly';
    if (days === 30) return 'monthly';
    return `every ${days} days`;
  }

  function daysUntil(dateString) {
    if (!dateString) return null;
    const diff = new Date(dateString) - new Date();
    return Math.max(0, Math.ceil(diff / (1000 * 60 * 60 * 24)));
  }

  const committedPerMonth = circles.reduce((sum, c) => {
    if (!c.cycle_duration_days) return sum;
    return sum + c.contribution_amount * (30 / c.cycle_duration_days);
  }, 0);

  const committedDisplay = Number.isFinite(committedPerMonth)
    ? Math.round(committedPerMonth).toLocaleString()
    : '0';

  async function handleLogout(){
    await supabase.auth.signOut();
    setSession(null);
  }

  function openCircleFromHome(circleId) {
    setCircleToOpen(circleId);
    setPage('circle');
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
      fetchCirclesWithProgress();
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
    }
    setPendingWithdrawAmount(null);
  }

  const displayName = fullName || session.user.email?.split('@')[0] || 'there';

  if (showInvites) {
    return (
      <div className="dashboard">
        <button onClick={() => setShowInvites(false)}>&larr; Back</button>
        <h1 className="dashboard-greeting">Notifications</h1>
        {invites.length > 0 ? (
          invites.map((invite) => (
            <div key={invite.id} className="circle-card" style={{ marginBottom: '12px', marginTop: '20px' }}>
              <div>
                <p className="circle-card-name">{invite.circles.name}</p>
                <p className="circle-card-role">
                  ₦{invite.circles.contribution_amount.toLocaleString()} per cycle
                </p>
              </div>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button className="auth-button" onClick={() => respondToInvite(invite.id, invite.circles.id, true)}>Accept</button>
                <button className="auth-button" style={{ background: '#ccc' }} onClick={() => respondToInvite(invite.id, invite.circles.id, false)}>Decline</button>
              </div>
            </div>
          ))
        ) : (
          <p className="dashboard-sub" style={{ marginTop: '20px' }}>No pending invites</p>
        )}
      </div>
    );
  }

  return (
    <div className="dashboard home-layout">
      <div className="ajo-header">
        <div className="ajo-header-left">
          <div className="ajo-logo"><span></span></div>
          <div>
            <p className="ajo-wordmark">Ajo</p>
            <p className="ajo-tagline">Thrift & savings circles</p>
          </div>
        </div>
        <div className="ajo-header-right">
          <button className="ajo-bell" aria-label="Notifications" onClick={() => setShowInvites(true)}>
            {bellIcon}
          </button>
          <div className="ajo-avatar">
            {session.user.email?.[0]?.toUpperCase() || 'U'}
          </div>
        </div>
      </div>

      {/* slim balance bar — hidden until the full card below scrolls out of view */}
      <div className={`balance-peek${showPeek ? ' is-visible' : ''}`} aria-hidden={!showPeek}>
        <span className="balance-peek-label">Balance</span>
        <span className="balance-peek-amount">₦{balance !== null ? balance.toLocaleString() : '···'}</span>
        <button
          className="balance-peek-action"
          onClick={() => setAmountModalMode('fund')}
          tabIndex={showPeek ? 0 : -1}
        >
          Fund
        </button>
      </div>

      <div className="dashboard-header">
        <h2 className="dashboard-greeting">{timeOfDayGreeting()}, {displayName} 👋</h2>
        <p className="dashboard-sub">Here's a quick look at your savings and active circles.</p>
      </div>

      {banner && (
        <div style={{
          marginBottom: '12px',
          padding: '12px 16px',
          borderRadius: '10px',
          background: banner.type === 'success' ? '#ecfdf5' : '#fef2f2',
          color: banner.type === 'success' ? '#065f46' : '#b91c1c',
          fontSize: '14px'
        }}>
          {banner.message}
        </div>
      )}

      <div className="passbook-entry" ref={heroRef}>
        <div className="passbook-top">
          <div className="passbook-head">
            <div className="passbook-icon">{walletIcon}</div>
            <div>
              <p className="passbook-label">Wallet balance</p>
              <p className="passbook-amount">₦{balance !== null ? balance.toLocaleString() : '···'}</p>
              <p className="passbook-trust">Your funds are safe and secure</p>
            </div>
          </div>
          <div className="passbook-actions">
            <button className="passbook-action primary" onClick={() => setAmountModalMode('fund')}>+ Fund wallet</button>
            <button className="passbook-action secondary" onClick={() => setAmountModalMode('withdraw')}>Withdraw</button>
          </div>
        </div>
      </div>

      <div className="stat-row">
        <div className="stat-card">
          <span className="ajo-chip ajo-chip--blue">{walletIcon}</span>
          <div className="stat-text">
            <p className="stat-label">Committed</p>
            <p className="stat-amount">₦{committedDisplay}</p>
            <p className="stat-note">Per month</p>
          </div>
        </div>
        <div className="stat-card">
          <span className="ajo-chip ajo-chip--green">{usersIcon}</span>
          <div className="stat-text">
            <p className="stat-label">Circles</p>
            <p className="stat-amount">{circles.length}</p>
            <p className="stat-note">Currently active</p>
          </div>
        </div>
      </div>

      <div className="section-head">
        <h3 className="section-title">Active circles</h3>
      </div>

      <div className="circle-list">
        {circles.length > 0 ? circles.map((circle) => {
          const left = daysUntil(circle.current_cycle_due_date);
          const percent = Math.round((circle.paidCount / circle.target_member_count) * 100);
          return (
            <div key={circle.id} className="circle-card" onClick={() => openCircleFromHome(circle.id)}>
              <span className="ajo-chip ajo-chip--purple">{usersIcon}</span>

              <div className="circle-main">
                <p className="circle-card-name">{circle.name}</p>
                <div className="circle-card-meta">
                  <span>{circle.target_member_count} members</span>
                  <span className="circle-card-amount">₦{circle.contribution_amount.toLocaleString()}</span>
                  <span>{cycleLabel(circle.cycle_duration_days)}</span>
                </div>
              </div>

              <div className="circle-bottom">
                <div className="circle-progress-row">
                  <div className="ajo-progress">
                    <div className="ajo-progress__fill" style={{ width: `${percent}%` }}></div>
                  </div>
                  <span className="circle-progress-pct">{percent}%</span>
                </div>
                <p className="circle-footnote">
                  {circle.paidCount} of {circle.target_member_count} paid · Cycle {circle.current_cycle} of {circle.target_member_count}
                  {left !== null && !circle.hasPaid ? ` · Due in ${left} day${left === 1 ? '' : 's'}` : ''}
                </p>
              </div>

              <span className={`ajo-badge ${circle.hasPaid ? 'ajo-badge--success' : ''}`}>
                {circle.hasPaid ? "You've paid" : 'Active'}
              </span>
            </div>
          );
        }) : (
          <p className="dashboard-sub">No circles yet</p>
        )}
      </div>

      <button className="home-logout" onClick={handleLogout}>Logout</button>

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

export default HomePage;