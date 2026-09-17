import { useState,useEffect } from "react";
import { supabase } from "./supabaseClient";
import PinModal from "./PinModal.jsx";

const backIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="m15 18-6-6 6-6" />
  </svg>
);
const searchIcon = (
  <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" />
  </svg>
);
const usersIcon = (
  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M16 19v-1a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v1" /><circle cx="9" cy="7" r="3" />
    <path d="M22 19v-1a4 4 0 0 0-3-3.87M16 4.13a4 4 0 0 1 0 7.75" />
  </svg>
);

function CirclePage({ session, selectedCircle, setSelectedCircle, circleToOpen, setCircleToOpen }) {
const [circles , setCircles] = useState([]);
const [members, setMembers] = useState([]);
const [inviteEmail, setInviteEmail] = useState('');
const [emailMatch, setEmailMatch] = useState(null); // null | 'not_found' | { id, full_name }
const [checkingEmail, setCheckingEmail] = useState(false);
const [paidUserIds, setPaidUserIds] = useState([]);
const [walletBalance, setWalletBalance] = useState(null);
const [myDebts, setMyDebts] = useState([]);
const [showPinModal, setShowPinModal] = useState(false);
const [pendingDebt, setPendingDebt] = useState(null);
const [banner, setBanner] = useState(null);

async function fetchWalletBalance() {
  const { data, error } = await supabase
    .from('wallets')
    .select('balance')
    .eq('id', session.user.id)
    .single();

  if (data) setWalletBalance(data.balance);
}

useEffect(() => {
  if (!session) return;
  fetchCircles();
  fetchWalletBalance();
}, []);

useEffect(() => {
  if (circleToOpen) {
    openCircle(circleToOpen);
    setCircleToOpen(null);
  }
}, [circleToOpen]);

useEffect(() => {
  if (!banner) return;
  const timer = setTimeout(() => setBanner(null), 4000);
  return () => clearTimeout(timer);
}, [banner]);

useEffect(() => {
  const trimmed = inviteEmail.trim().toLowerCase();
  if (!trimmed.includes('@')) {
    setEmailMatch(null);
    return;
  }
  setCheckingEmail(true);
  const timer = setTimeout(async () => {
    const { data } = await supabase
      .from('profiles')
      .select('id, full_name')
      .eq('email', trimmed)
      .maybeSingle();
    setEmailMatch(data || 'not_found');
    setCheckingEmail(false);
  }, 400);
  return () => clearTimeout(timer);
}, [inviteEmail]);

async function handleCreateCircle(){
    const name = prompt('Circle name ?')
    if (!name)return;

    const amount = prompt ('Contribution amount per circle?');
    if(!amount)return

    const targetCount = prompt('How many members will this circle have?');
    if(!targetCount)return

    const durationDays = prompt('How many days per cycle? (e.g. 7 for weekly, 30 for monthly)');
    if(!durationDays)return

    const {data,error} = await supabase
    .from('circles')
    .insert({
        name :name,
        contribution_amount:Number(amount),
        created_by:session.user.id,
        target_member_count: Number(targetCount),
        cycle_duration_days: Number(durationDays),
        current_cycle_due_date: new Date(Date.now() + Number(durationDays) * 24 * 60 * 60 * 1000).toISOString()
    })
    .select()
    .single();

    if (error){
        console.log ('Error creating circle',error.message);
        return;
    }

    const {error:memberError}= await supabase
    .from('circle_members')
    .insert({
        circle_id:data.id,
        user_id :session.user.id,
        role:   'creator',
        payout_position:1,
    })

    if (memberError) {
      console.log('could not create row')
    } else {
      console.log('circle created')
      fetchCircles()
    }
}

async function handleDeleteCircle(){
  const { data: outstandingDebts } = await supabase
    .from('debts')
    .select('id')
    .eq('circle_id', selectedCircle.id)
    .eq('status', 'outstanding');

  if (outstandingDebts && outstandingDebts.length > 0) {
    alert('This circle has unsettled debts and cannot be deleted yet.');
    return;
  }

  const confirmed = confirm(`Delete "${selectedCircle.name}"? This cannot be undone.`);
  if (!confirmed) return;

  const { error } = await supabase
    .from('circles')
    .delete()
    .eq('id', selectedCircle.id);

  if (error) {
    console.log('error deleting circle', error.message);
    alert('Could not delete circle');
    return;
  }

  setSelectedCircle(null);
  fetchCircles();
}

function fetchCircles() {
  supabase
    .from('circle_members')
    .select('role, circles(id, name, contribution_amount, created_by, current_cycle, target_member_count, cycle_duration_days, current_cycle_due_date)')
    .eq('user_id', session.user.id)
    .then(({ data, error }) => {
      console.log('fetch result:', data, error);
      if (data) {
        setCircles(data);
      }
    });
}

async function fetchMyDebts(circleId) {
  const { data, error } = await supabase
    .from('debts')
    .select('id, creditor_id, amount, cycle_number')
    .eq('circle_id', circleId)
    .eq('debtor_id', session.user.id)
    .eq('status', 'outstanding')
    .order('created_at', { ascending: true });

  if (data) setMyDebts(data);
}

function handleSettleDebt(debt) {
  setPendingDebt(debt);
  setShowPinModal(true);
}

async function completeSettleDebt() {
  setShowPinModal(false);
  const debt = pendingDebt;

  const { error } = await supabase.rpc('settle_debt', {
    p_debt_id: debt.id,
    p_debtor_id: session.user.id,
    p_creditor_id: debt.creditor_id,
    p_amount: debt.amount,
    p_cycle_number: debt.cycle_number
  });

  if (error) {
    console.log('error settling debt', error.message);
    setBanner({
      type: 'error',
      message: error.message.includes('Insufficient') ? 'Insufficient balance to settle this debt.' : 'Could not process debt payment.'
    });
    setPendingDebt(null);
    return;
  }

  setBanner({ type: 'success', message: `₦${debt.amount.toLocaleString()} debt settled.` });
  fetchMyDebts(selectedCircle.id);
  fetchWalletBalance();
  setPendingDebt(null);
}

async function checkForMissedPayments(circle) {
  if (!circle.current_cycle_due_date) return;

  const isOverdue = new Date() > new Date(circle.current_cycle_due_date);
  if (!isOverdue) return;

  if (circle.missed_payments_processed_cycle === circle.current_cycle) {
    return;
  }

  const { data: memberRows } = await supabase
    .from('circle_members')
    .select('user_id, payout_position')
    .eq('circle_id', circle.id);

  const { data: paidRows } = await supabase
    .from('contributions')
    .select('user_id')
    .eq('circle_id', circle.id)
    .eq('cycle_number', circle.current_cycle);

  const paidIds = (paidRows || []).map((r) => r.user_id);
  const missedMembers = (memberRows || []).filter((m) => !paidIds.includes(m.user_id));

  if (missedMembers.length === 0) {
    return;
  }

  const position = ((circle.current_cycle - 1) % memberRows.length) + 1;
  const collector = memberRows.find((m) => m.payout_position === position);

  if (!collector) {
    console.log('no collector found, cannot process missed payments');
    return;
  }

  for (const missed of missedMembers) {
    if (missed.user_id === collector.user_id) continue;

    const { error: debtInsertError } = await supabase.from('debts').insert({
      circle_id: circle.id,
      debtor_id: missed.user_id,
      creditor_id: collector.user_id,
      cycle_number: circle.current_cycle,
      amount: circle.contribution_amount,
      status: 'outstanding'
    });

    if (debtInsertError) {
      console.log('FAILED to insert debt:', debtInsertError.message);
      continue;
    }

    await supabase.from('audit_log').insert({
      circle_id: circle.id,
      actor_id: null,
      action_type: 'debt_created',
      target_id: missed.user_id,
      details: { amount: circle.contribution_amount, cycle_number: circle.current_cycle }
    });
  }

  await supabase
    .from('circles')
    .update({ missed_payments_processed_cycle: circle.current_cycle })
    .eq('id', circle.id);

  checkAndTriggerPayouts(circle.id, circle.current_cycle, true);

  console.log('missed payments processed for cycle', circle.current_cycle);
}

async function openCircle(circleId) {
  const { data: freshCircle, error } = await supabase
    .from('circles')
    .select('id, name, contribution_amount, created_by, current_cycle, target_member_count, cycle_duration_days, current_cycle_due_date, missed_payments_processed_cycle')
    .eq('id', circleId)
    .single();

  if (error) {
    console.log('error fetching fresh circle', error.message);
    return;
  }

  setSelectedCircle(freshCircle);
  checkForMissedPayments(freshCircle);
  fetchMembers(freshCircle.id);
  fetchContributions(freshCircle.id, freshCircle.current_cycle);
  fetchMyDebts(freshCircle.id);
}

async function fetchMembers(circleId) {
  const { data: memberRows, error } = await supabase
    .from('circle_members')
    .select('role, user_id, payout_position')
    .eq('circle_id', circleId);

  if (error) {
    console.log('error fetching members', error.message);
    return;
  }

  const { data: profileRows, error: profileError } = await supabase
    .from('profiles')
    .select('id, full_name')
    .in('id', memberRows.map((m) => m.user_id));

  if (profileError) {
    console.log('error fetching profiles', profileError.message);
    return;
  }

  const combined = memberRows.map((member) => {
    const profile = profileRows.find((p) => p.id === member.user_id);
    return {
      role: member.role,
      full_name: profile ? profile.full_name : 'Unknown',
      user_id: member.user_id,
      payout_position: member.payout_position
    };
  });

  setMembers(combined);
}

async function handleDeleteMember(memberUserId){
  const { data: owedDebts } = await supabase
    .from('debts')
    .select('id')
    .eq('circle_id', selectedCircle.id)
    .eq('creditor_id', memberUserId)
    .eq('status', 'outstanding');

  if (owedDebts && owedDebts.length > 0) {
    alert('This member is owed money by someone in the circle. They must be paid before removal.');
    return;
  }

  const confirmed = confirm(`Remove this member? This cannot be undone.`);
  if (!confirmed) return;

  const { error } = await supabase
    .from('circle_members')
    .delete()
    .eq('user_id', memberUserId)
    .eq('circle_id', selectedCircle.id);

  if (error) {
    console.log('error deleting member', error.message);
    alert('Could not remove member');
    return;
  }

  alert('Member removed successfully');
  fetchMembers(selectedCircle.id);
}

async function handleInvite(){
    if (!emailMatch || emailMatch === 'not_found') return;

    if (members.length >= selectedCircle.target_member_count) {
      alert('This circle is already full');
      return;
    }

    if (emailMatch.id === session.user.id) {
      alert("You can't invite yourself");
      return;
    }

    const isAlreadyMember = members.some((m) => m.user_id === emailMatch.id);
    if (isAlreadyMember) {
      alert('This user is already a member of this circle');
      return;
    }

    const {data:existingInvite} = await supabase
    .from('circle_invites')
    .select('id')
    .eq('circle_id', selectedCircle.id)
    .eq('invited_user_id', emailMatch.id)
    .eq('status', 'pending')
    .maybeSingle();

    if (existingInvite) {
      alert('This user has already been invited to this circle.');
      return;
    }

    const {error:inviteError} = await supabase
    .from('circle_invites')
    .insert({
      circle_id: selectedCircle.id,
      invited_user_id: emailMatch.id,
      invited_by: session.user.id
    });

    if(inviteError){
      console.log('could not send invite', inviteError.message);
      alert('Could not send invite. They may already have a pending invite.');
      return;
    }

    alert('Invite sent!');
    setInviteEmail('');
    setEmailMatch(null);
}

async function fetchContributions(circleId, cycleNumber) {
  const { data, error } = await supabase
    .from('contributions')
    .select('user_id')
    .eq('circle_id', circleId)
    .eq('cycle_number', cycleNumber);

  if (data) {
    setPaidUserIds(data.map((c) => c.user_id));
  }
}

async function checkAndTriggerPayouts(circleId, cycleNumber, forceOverride = false) {

  const { data: circleData } = await supabase
    .from('circles')
    .select('name, contribution_amount, cycle_duration_days, target_member_count')
    .eq('id', circleId)
    .single();

  if (!circleData) {
    console.log('could not load circle data for payout check');
    return;
  }

  const {count:memberCount}= await supabase
  .from('circle_members')
  .select('*',{count:"exact",head:true})
  .eq('circle_id',circleId)

  if (memberCount < circleData.target_member_count) {
    console.log('STOPPED: circle not full yet');
    return;
  }

  const {count:paidCount}=await supabase
  .from("contributions")
  .select('*',{count:'exact',head:true})
  .eq('circle_id',circleId)
  .eq('cycle_number',cycleNumber);

  if(paidCount< memberCount && !forceOverride){
    console.log('STOPPED: not everyone paid and not forcing');
    return;
  }

  const position = ((cycleNumber - 1) % memberCount) + 1;

  const {data:collector} =await supabase
  .from('circle_members')
  .select('user_id')
  .eq('circle_id',circleId)
  .eq('payout_position', position)
  .maybeSingle();

  if(!collector){
    console.log('STOPPED: No collector found for this cycle');
    return;
  }

  const payoutAmount = circleData.contribution_amount * paidCount;
  const nextDueDate = new Date(Date.now() + circleData.cycle_duration_days * 24 * 60 * 60 * 1000).toISOString();

  const { error: payoutError } = await supabase.rpc('process_payout', {
    p_circle_id: circleId,
    p_cycle_number: cycleNumber,
    p_collector_id: collector.user_id,
    p_payout_amount: payoutAmount,
    p_circle_name: circleData.name,
    p_next_due_date: nextDueDate
  });

  if (payoutError) {
    console.log('STOPPED: Error processing payout', payoutError.message);
    alert('Payout failed. Please contact support.');
    return;
  }

  if (selectedCircle && selectedCircle.id === circleId) {
    setSelectedCircle({ ...selectedCircle, current_cycle: cycleNumber + 1, current_cycle_due_date: nextDueDate });
  }

  console.log('PAYOUT COMPLETE for cycle', cycleNumber);
  alert('Cycle complete! Payout has been processed.');
  fetchCircles();
  fetchContributions(circleId, cycleNumber + 1);
}

async function handlePayContribution(){
  const {data: existing} = await supabase
  .from('contributions')
  .select('id')
  .eq('circle_id', selectedCircle.id)
  .eq('user_id', session.user.id)
  .eq('cycle_number', selectedCircle.current_cycle)
  .maybeSingle();

  if(existing){
    alert('You have already paid your contribution for this cycle.');
    return;
  }

  const {error} = await supabase.rpc('pay_contribution', {
    p_circle_id: selectedCircle.id,
    p_user_id: session.user.id,
    p_cycle_number: selectedCircle.current_cycle,
    p_amount: selectedCircle.contribution_amount,
    p_description: `Contribution for ${selectedCircle.name} - Cycle ${selectedCircle.current_cycle}`
  });

  if (error) {
    console.log('Error paying contribution', error.message);
    alert(error.message.includes('Insufficient') ? 'Insufficient balance. Please fund your wallet.' : 'Payment failed. Please try again.');
    return;
  }

  alert('Contribution paid successfully!');
  fetchContributions(selectedCircle.id, selectedCircle.current_cycle);
  fetchWalletBalance();
  checkAndTriggerPayouts(selectedCircle.id, selectedCircle.current_cycle);
}

const nextCollectorName = selectedCircle && members.length
  ? members.find((m) => m.payout_position === ((selectedCircle.current_cycle - 1) % members.length) + 1)?.full_name || '—'
  : '—';

return (
  <div className="dashboard">
    {selectedCircle ? (
      <div>
        <button className="detail-back" onClick={() => setSelectedCircle(null)}>
          {backIcon} Back to circles
        </button>

        {selectedCircle.created_by === session.user.id && (
          <button
            onClick={handleDeleteCircle}
            style={{ marginLeft: '12px', color: 'red', background: 'none', border: '1px solid red', borderRadius: '6px', padding: '6px 12px', cursor: 'pointer' }}
          >
            Delete Circle
          </button>
        )}

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

        <div className="page-head" style={{ marginTop: '14px' }}>
          <h1 className="page-title">{selectedCircle.name}</h1>
          <p className="page-sub">
            ₦{selectedCircle.contribution_amount.toLocaleString()} per cycle · {members.length} of {selectedCircle.target_member_count} members
            {selectedCircle.current_cycle_due_date && ` · Due ${new Date(selectedCircle.current_cycle_due_date).toLocaleDateString()}`}
          </p>
        </div>

        {myDebts.length > 0 && (
          <div style={{ marginTop: '16px', padding: '12px', background: '#fef2f2', border: '1px solid #fca5a5', borderRadius: '8px' }}>
            <p style={{ margin: '0 0 8px', fontWeight: '500', color: '#b91c1c' }}>You owe money in this circle</p>
            {myDebts.map((debt) => (
              <div key={debt.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '8px' }}>
                <span>₦{debt.amount.toLocaleString()} — Cycle {debt.cycle_number}</span>
                <button
                  onClick={() => handleSettleDebt(debt)}
                  style={{ background: '#b91c1c', color: 'white', border: 'none', borderRadius: '6px', padding: '6px 12px', cursor: 'pointer' }}
                >
                  Pay now
                </button>
              </div>
            ))}
          </div>
        )}

        {members.length >= selectedCircle.target_member_count ? (
          <div className="collect-card">
            <p className="collect-label">Next to collect</p>
            <p className="collect-name">{nextCollectorName}</p>
            <div className="avatar-lg">{nextCollectorName.slice(0, 2).toUpperCase()}</div>
            <button
              className="btn-primary"
              style={{ width: '100%' }}
              onClick={handlePayContribution}
              disabled={paidUserIds.includes(session.user.id)}
            >
              {paidUserIds.includes(session.user.id) ? 'Already Paid' : `Pay ₦${selectedCircle.contribution_amount.toLocaleString()}`}
            </button>
          </div>
        ) : (
          <p className="dashboard-sub" style={{ marginTop: '20px' }}>
            Waiting for more members to join before payments can start.
          </p>
        )}

        <div className="section-head" style={{ marginTop: '28px' }}>
          <h3 className="section-title">Members</h3>
        </div>

        {selectedCircle.created_by === session.user.id && (
          <>
            <div className="member-search">
              {searchIcon}
              <input
                type="email"
                placeholder="Enter an email to invite"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
              />
              <button
                className="member-search-btn"
                onClick={handleInvite}
                disabled={!emailMatch || emailMatch === 'not_found'}
              >
                Invite
              </button>
            </div>
            <p className="member-search-hint">
              {checkingEmail
                ? 'Searching…'
                : emailMatch === 'not_found'
                  ? 'No user found with that email.'
                  : emailMatch
                    ? `Send an invite to ${emailMatch.full_name}`
                    : 'Name search is coming soon — email works for now'}
            </p>
            {!checkingEmail && emailMatch && emailMatch !== 'not_found' && (
              <div className="member-match-row">
                <span className="member-avatar">{emailMatch.full_name.slice(0, 2).toUpperCase()}</span>
                <div className="member-info">
                  <p className="member-name">{emailMatch.full_name}</p>
                </div>
              </div>
            )}
          </>
        )}

        <div className="member-list">
          {members.map((member) => (
            <div key={member.user_id} className="member-row">
              <span className="member-avatar">{member.full_name.slice(0, 2).toUpperCase()}</span>
              <div className="member-info">
                <p className="member-name">{member.full_name}{member.user_id === session.user.id ? ' (You)' : ''}</p>
                <p className="member-role">{member.role}</p>
              </div>
              <span className={`member-status ${paidUserIds.includes(member.user_id) ? 'member-status--paid' : 'member-status--pending'}`}>
                {paidUserIds.includes(member.user_id) ? 'Paid' : 'Pending'}
              </span>
              {selectedCircle.created_by === session.user.id && member.role !== 'creator' && (
                <button className="member-remove" onClick={() => handleDeleteMember(member.user_id)}>Remove</button>
              )}
            </div>
          ))}
        </div>
      </div>
    ) : (
      <>
        <div className="page-head">
          <h1 className="page-title">Circles</h1>
          <p className="page-sub">Every circle you've joined or created.</p>
        </div>
        <button className="btn-primary" style={{ width: '100%', marginBottom: '16px' }} onClick={handleCreateCircle}>
          + Create circle
        </button>
        <div className="circle-list">
          {circles.map((item) => (
            <div
              key={item.circles.id}
              className="circle-card"
              onClick={() => openCircle(item.circles.id)}
            >
              <span className="ajo-chip ajo-chip--purple">{usersIcon}</span>
              <div className="circle-main">
                <p className="circle-card-name">{item.circles.name}</p>
                <div className="circle-card-meta">
                  <span className="circle-card-role">{item.role}</span>
                  <span className="circle-card-amount">₦{item.circles.contribution_amount.toLocaleString()} / cycle</span>
                  <span>{item.circles.target_member_count} members</span>
                </div>
              </div>
              <span className={`ajo-badge${item.role === 'creator' ? '' : ' ajo-badge--muted'}`}>
                {item.role === 'creator' ? 'Creator' : 'Member'}
              </span>
            </div>
          ))}
        </div>
      </>
    )}

    {showPinModal && (
      <PinModal
        userId={session.user.id}
        onSuccess={completeSettleDebt}
        onCancel={() => { setShowPinModal(false); setPendingDebt(null); }}
      />
    )}
  </div>
);
}
export default CirclePage;