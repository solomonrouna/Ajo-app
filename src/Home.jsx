import { useState, useEffect } from 'react';
import { supabase } from './supabaseClient.js';

function HomePage({ session, setSession, setPage, setCircleToOpen }) {
  const [circles, setCircles] = useState([]);
  const [balance, setBalance] = useState(null);
  const [invites, setInvites] = useState([]);
  const [showInvites, setShowInvites] = useState(false);

  useEffect(() => {
    if (!session) return;
    fetchBalance();
    fetchCirclesWithProgress();
    fetchInvites();
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

  async function fetchInvites() {
    const { data } = await supabase
      .from('circle_invites')
      .select('id, circles(id, name, contribution_amount)')
      .eq('invited_user_id', session.user.id)
      .eq('status', 'pending');

    if (data) setInvites(data.filter((invite) => invite.circles !== null));
  }gi

  async function respondToInvite(inviteId, circleId, accept) {
    const { error: updateError } = await supabase
      .from('circle_invites')
      .update({ status: accept ? 'accepted' : 'declined' })
      .eq('id', inviteId);

    if (updateError) {
      console.log('error updating invite', updateError.message);
      return;
    }

    if (accept) {
      const { count } = await supabase
        .from('circle_members')
        .select('*', { count: 'exact', head: true })
        .eq('circle_id', circleId);

      const { data: circleData } = await supabase
        .from('circles')
        .select('target_member_count')
        .eq('id', circleId)
        .single();

      if (circleData && count >= circleData.target_member_count) {
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
      if (memberError) console.log('error joining circle', memberError.message);
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

          <div className="passbook-entry" style={{ marginTop: '16px' }}>
            <p className="passbook-label">Wallet balance</p>
            <p className="passbook-amount">₦{balance !== null ? balance.toLocaleString() : '···'}</p>
            <div className="passbook-actions">
              <button className="passbook-action primary" onClick={() => setPage('wallet')}>+ Fund wallet</button>
              <button className="passbook-action secondary" onClick={() => setPage('wallet')}>Withdraw</button>
            </div>
          </div>

          <div style={{ display: 'flex', gap: '12px', marginTop: '16px' }}>
            <div className="circle-card" style={{ flex: 1, flexDirection: 'column', alignItems: 'flex-start' }}>
              <p className="stat-amount">₦{Math.round(committedPerMonth).toLocaleString()}</p>
              <p className="dashboard-sub">Committed / mo</p>
            </div>
            <div className="circle-card" style={{ flex: 1, flexDirection: 'column', alignItems: 'flex-start' }}>
              <p className="stat-amount">{circles.length}</p>
              <p className="dashboard-sub">Circles</p>
            </div>
          </div>

          <button
            className="auth-switch"
            onClick={handleLogout}
            style={{ background: 'none', border: 'none', textDecoration: 'underline', cursor: 'pointer', marginTop: '20px' }}
          >
            Logout
          </button>
        </div>

        <div className="home-right">
          <p style={{ fontWeight: '500' }}>Active circles</p>

          <div className="circle-list" style={{ marginTop: '12px' }}>
            {circles.length > 0 ? circles.map((circle) => {
              const left = daysUntil(circle.current_cycle_due_date);
              return (
                <div key={circle.id} className="circle-card" onClick={() => openCircleFromHome(circle.id)} style={{ flexDirection: 'column', alignItems: 'flex-start', cursor: 'pointer' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%' }}>
                    <p className="circle-card-name">{circle.name}</p>
                    <span className="circle-card-role">{circle.hasPaid ? "You've paid" : (left !== null ? `Due in ${left} day${left === 1 ? '' : 's'}` : '')}</span>
                  </div>
                  <p className="circle-card-role">
                    {circle.target_member_count} members · ₦{circle.contribution_amount.toLocaleString()} / cycle · {cycleLabel(circle.cycle_duration_days)}
                  </p>
                  <div style={{ width: '100%', height: '6px', background: '#eee', borderRadius: '4px', marginTop: '8px' }}>
                    <div style={{ width: `${(circle.paidCount / circle.target_member_count) * 100}%`, height: '100%', background: '#3b82f6', borderRadius: '4px' }}></div>
                  </div>
                  <p className="dashboard-sub" style={{ marginTop: '4px' }}>
                    {circle.paidCount} of {circle.target_member_count} paid · Cycle {circle.current_cycle} of {circle.target_member_count}
                  </p>
                </div>
              );
            }) : (
              <p className="dashboard-sub">No circles yet</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default HomePage;