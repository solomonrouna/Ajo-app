import { useState, useEffect } from 'react';
import { supabase } from './supabaseClient.js';
import PinModal from './PinModal.jsx';
import AmountModal from './AmountModal.jsx';

function HomePage({ session, setSession, setPage, setCircleToOpen }) {
  const [circles, setCircles] = useState([]);
  const [balance, setBalance] = useState(null);
  const [invites, setInvites] = useState([]);
  const [showInvites, setShowInvites] = useState(false);
  const [amountModalMode, setAmountModalMode] = useState(null);
  const [showPinModal, setShowPinModal] = useState(false);
  const [pendingWithdrawAmount, setPendingWithdrawAmount] = useState(null);
  const [banner, setBanner] = useState(null);

  useEffect(() => {
    if (!session) return;
    fetchBalance();
    fetchCirclesWithProgress();
    fetchInvites();
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
      .then(({ data }) => {
        if (data) setBalance(data.balance);
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
    return sum + c.contribution_amount * (30 / c.cycle_duration_days);
  }, 0);

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
      <div className="home-grid">
        <div className="home-left">
          <div className="ajo-header">
            <div className="ajo-header-left">
              <div className="ajo-logo"><span></span></div>
              <div>
                <p className="ajo-wordmark">Ajo</p>
                <p className="ajo-tagline">Thrift & savings circles</p>
              </div>
            </div>
            <div className="ajo-header-right">
              <div className="ajo-bell" style={{ position: 'relative', cursor: 'pointer' }} onClick={() => setShowInvites(true)}>
                {invites.length > 0 && (
                  <span style={{ position: 'absolute', top: '-2px', right: '-2px', width: '8px', height: '8px', borderRadius: '50%', background: 'red' }}></span>
                )}
              </div>
              <div className="ajo-avatar">
                {session.user.email?.[0]?.toUpperCase() || 'U'}
              </div>
            </div>
          </div>

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

          <div className="passbook-entry ajo-hero-card" style={{ marginTop: '16px' }}>
            <div className="passbook-top">
              <div className="passbook-info">
                <p className="passbook-label">Wallet balance</p>
                <p className="passbook-amount">₦{balance !== null ? balance.toLocaleString() : '···'}</p>
              </div>
              <div className="passbook-actions">
                <button className="passbook-action primary" onClick={() => setAmountModalMode('fund')}>+ Fund wallet</button>
                <button className="passbook-action secondary" onClick={() => setAmountModalMode('withdraw')}>Withdraw</button>
              </div>
            </div>
            <p className="passbook-trust">Your funds are safe and secure</p>
          </div>

          <div style={{ display: 'flex', gap: '12px', marginTop: '16px' }}>
            <div className="circle-card" style={{ flex: 1, flexDirection: 'column', alignItems: 'flex-start' }}>
              <div className="ajo-chip ajo-chip--blue">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="6" width="18" height="13" rx="2"/><path d="M3 10h18"/><circle cx="17" cy="14" r="1"/></svg>
              </div>
              <p className="stat-amount">₦{Math.round(committedPerMonth).toLocaleString()}</p>
              <p className="dashboard-sub">Committed / mo</p>
            </div>
            <div className="circle-card" style={{ flex: 1, flexDirection: 'column', alignItems: 'flex-start' }}>
              <div className="ajo-chip ajo-chip--green">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="9" cy="7" r="3"/><path d="M2 20c0-3 3-5 7-5s7 2 7 5"/><circle cx="17" cy="8" r="2.5"/><path d="M16 13c2.5 0 5 1.5 5 4"/></svg>
              </div>
              <p className="stat-amount">{circles.length}</p>
              <p className="dashboard-sub">Circles</p>
            </div>
          </div>

          <div className="home-logout">
            <button
              onClick={handleLogout}
              style={{ background: 'none', border: 'none', textDecoration: 'underline', cursor: 'pointer', color: 'inherit', fontSize: '14px', padding: 0 }}
            >
              Logout
            </button>
          </div>
        </div>

        <div className="home-right">
          <p style={{ fontWeight: '500' }}>Active circles</p>

          <div className="circle-list" style={{ marginTop: '12px' }}>
            {circles.length > 0 ? circles.map((circle) => {
              const left = daysUntil(circle.current_cycle_due_date);
              const percent = Math.round((circle.paidCount / circle.target_member_count) * 100);
              return (
                <div key={circle.id} className="circle-card" onClick={() => openCircleFromHome(circle.id)} style={{ flexDirection: 'column', alignItems: 'flex-start', cursor: 'pointer' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', alignItems: 'flex-start' }}>
                    <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-start' }}>
                      <div className="ajo-chip ajo-chip--purple" style={{ marginBottom: 0 }}>
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="9" cy="7" r="3"/><path d="M2 20c0-3 3-5 7-5s7 2 7 5"/></svg>
                      </div>
                      <div>
                        <p className="circle-card-name">{circle.name}</p>
                        <p className="circle-card-role">
                          {circle.target_member_count} members · ₦{circle.contribution_amount.toLocaleString()} / cycle · {cycleLabel(circle.cycle_duration_days)}
                        </p>
                      </div>
                    </div>
                    <span className={`ajo-badge ${circle.hasPaid ? 'ajo-badge--success' : ''}`}>
                      {circle.hasPaid ? "You've paid" : 'Active'}
                    </span>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', width: '100%', marginTop: '10px' }}>
                    <div className="ajo-progress" style={{ flex: 1 }}>
                      <div className="ajo-progress__fill" style={{ width: `${percent}%` }}></div>
                    </div>
                    <span className="dashboard-sub" style={{ whiteSpace: 'nowrap' }}>{percent}%</span>
                  </div>

                  <p className="dashboard-sub" style={{ marginTop: '4px' }}>
                    {circle.paidCount} of {circle.target_member_count} paid · Cycle {circle.current_cycle} of {circle.target_member_count}
                    {left !== null && !circle.hasPaid ? ` · Due in ${left} day${left === 1 ? '' : 's'}` : ''}
                  </p>
                </div>
              );
            }) : (
              <p className="dashboard-sub">No circles yet</p>
            )}
          </div>
        </div>
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

export default HomePage;