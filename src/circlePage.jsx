import { useState,useEffect } from "react";
import { supabase } from "./supabaseClient";

function CirclePage({ session }) {
const [circles , setCircles] = useState([]);
const [selectedCircle, setSelectedCircle] = useState(null);
const [members, setMembers] = useState([]);
const [inviteEmail, setInviteEmail] = useState('');
const [paidUserIds, setPaidUserIds] = useState([]);
const [walletBalance, setWalletBalance] = useState(null);
const [myDebts, setMyDebts] = useState([]);

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

async function handleSettleDebt(debt) {
  if (walletBalance < debt.amount) {
    alert('Insufficient balance to settle this debt.');
    return;
  }

  const { error: debitError } = await supabase.rpc('add_ledger_entry', {
    p_wallet_id: session.user.id,
    p_amount: debt.amount,
    p_direction: 'debit',
    p_description: `Debt settlement - Cycle ${debt.cycle_number}`
  });

  if (debitError) {
    console.log('error debiting debtor wallet', debitError.message);
    alert('Could not process debt payment.');
    return;
  }

  const { error: creditError } = await supabase.rpc('add_ledger_entry', {
    p_wallet_id: debt.creditor_id,
    p_amount: debt.amount,
    p_direction: 'credit',
    p_description: `Debt received - Cycle ${debt.cycle_number}`
  });

  if (creditError) {
    console.log('error crediting creditor wallet', creditError.message);
    alert('Payment taken but could not reach the creditor. Contact support.');
    return;
  }

  await supabase
    .from('debts')
    .update({ status: 'settled' })
    .eq('id', debt.id);

  alert('Debt settled successfully!');
  fetchMyDebts(selectedCircle.id);
  fetchWalletBalance();
}

async function checkForMissedPayments(circle) {
  if (!circle.current_cycle_due_date) return;

  const isOverdue = new Date() > new Date(circle.current_cycle_due_date);
  if (!isOverdue) return;

  if (circle.missed_payments_processed_cycle === circle.current_cycle) {
    return; // already handled this cycle
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
    return; // everyone paid, nothing missed
  }

  const position = ((circle.current_cycle - 1) % memberRows.length) + 1;
  const collector = memberRows.find((m) => m.payout_position === position);

  if (!collector) {
    console.log('no collector found, cannot process missed payments');
    return;
  }

  for (const missed of missedMembers) {
    if (missed.user_id === collector.user_id) continue; // collector can't owe themselves

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
    const trimmedEmail = inviteEmail.trim().toLowerCase();

    if (!trimmedEmail) {
      alert('Please enter an email address');
      return;
    }

    if (members.length >= selectedCircle.target_member_count) {
      alert('This circle is already full');
      return;
    }

    const {data:foundProfile,error} = await supabase
    .from('profiles')
    .select('id')
    .eq('email', trimmedEmail)
    .maybeSingle();

    if(!foundProfile){
      alert('Sorry we could not find a user with that email');
      return;
    }

    if (foundProfile.id === session.user.id) {
      alert("You can't invite yourself");
      return;
    }

    const isAlreadyMember = members.some((m) => m.user_id === foundProfile.id);
    if (isAlreadyMember) {
      alert('This user is already a member of this circle');
      return;
    }

    const {data:existingInvite} = await supabase
    .from('circle_invites')
    .select('id')
    .eq('circle_id', selectedCircle.id)
    .eq('invited_user_id', foundProfile.id)
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
      invited_user_id: foundProfile.id,
      invited_by: session.user.id
    });

    if(inviteError){
      console.log('could not send invite', inviteError.message);
      alert('Could not send invite. They may already have a pending invite.');
      return;
    }

    alert('Invite sent!');
    setInviteEmail('');
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

  console.log('payout check — memberCount:', memberCount, 'target:', circleData.target_member_count);

  if (memberCount < circleData.target_member_count) {
    console.log('STOPPED: circle not full yet');
    return;
  }

  const {count:paidCount}=await supabase
  .from("contributions")
  .select('*',{count:'exact',head:true})
  .eq('circle_id',circleId)
  .eq('cycle_number',cycleNumber);

  console.log('payout check — paidCount:', paidCount, 'forceOverride:', forceOverride);

  if(paidCount< memberCount && !forceOverride){
    console.log('STOPPED: not everyone paid and not forcing');
    return;
  }

  const position = ((cycleNumber - 1) % memberCount) + 1;
  console.log('cycle:', cycleNumber, 'memberCount:', memberCount, 'position:', position);

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

  let payoutAmount = circleData.contribution_amount * paidCount;

  const { data: collectorDebts } = await supabase
    .from('debts')
    .select('*')
    .eq('circle_id', circleId)
    .eq('debtor_id', collector.user_id)
    .eq('status', 'outstanding')
    .order('created_at', { ascending: true });

  for (const debt of (collectorDebts || [])) {
    if (payoutAmount <= 0) break;
    if (debt.amount <= payoutAmount) {
      const { error: debtCreditError } = await supabase.rpc('add_ledger_entry', {
        p_wallet_id: debt.creditor_id,
        p_amount: debt.amount,
        p_direction: 'credit',
        p_description: `Debt settled from ${circleData.name} payout - Cycle ${debt.cycle_number}`
      });

      if (!debtCreditError) {
        await supabase.from('debts').update({ status: 'settled' }).eq('id', debt.id);
        payoutAmount -= debt.amount;
      }
    }
  }

  if (payoutAmount > 0) {
    const {error: payoutError} = await supabase.rpc('add_ledger_entry',{
    p_wallet_id: collector.user_id,
    p_amount: payoutAmount,
    p_direction: 'credit',
    p_description: `Payout for ${circleData.name} - Cycle ${cycleNumber}`
    });

    if(payoutError){
      console.log('STOPPED: Error adding payout entry', payoutError.message);
      alert('Payout failed. Please contact support.');
      return;
    }
  }

  const nextDueDate = new Date(Date.now() + circleData.cycle_duration_days * 24 * 60 * 60 * 1000).toISOString();

  await supabase
  .from('circles')
  .update({ current_cycle: cycleNumber + 1, current_cycle_due_date: nextDueDate })
  .eq('id', circleId)

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

  if (walletBalance < selectedCircle.contribution_amount) {
    alert('Insufficient balance. Please fund your wallet.');
    return;
  }

  const {error: ledgerError} = await supabase.rpc('add_ledger_entry',{
    p_wallet_id: session.user.id,
    p_amount: selectedCircle.contribution_amount,
    p_direction: 'debit',
    p_description: `Contribution for ${selectedCircle.name} - Cycle ${selectedCircle.current_cycle}`
  });

  if(ledgerError){
    console.log('Error deducting from wallet', ledgerError.message);
    alert('Payment failed. Please check your wallet balance.');
    return;
  }

  const {error: contributionError} = await supabase
    .from('contributions')
    .insert({
      circle_id: selectedCircle.id,
      user_id: session.user.id,
      cycle_number: selectedCircle.current_cycle,
      amount: selectedCircle.contribution_amount
    });

  if (contributionError) {
    console.log('Error inserting contribution', contributionError.message);
    alert('Payment deducted from wallet but failed to record contribution. Please contact support.');
    return;
  }

  alert('Contribution paid successfully!');
  fetchContributions(selectedCircle.id, selectedCircle.current_cycle);
  fetchWalletBalance();
  checkAndTriggerPayouts(selectedCircle.id, selectedCircle.current_cycle);
}



return (
  <div className="dashboard">
    {selectedCircle ? (
      <div>
        <button onClick={() => setSelectedCircle(null)}>&larr; Back</button>
        {selectedCircle.created_by === session.user.id && (
          <button
            onClick={handleDeleteCircle}
            style={{ marginLeft: '12px', color: 'red', background: 'none', border: '1px solid red', borderRadius: '6px', padding: '6px 12px', cursor: 'pointer' }}
          >
            Delete Circle
          </button>
        )}
        <h1 className="dashboard-greeting">{selectedCircle.name}</h1>
        <p className="dashboard-sub">₦{selectedCircle.contribution_amount.toLocaleString()} per cycle</p>
        <p className="dashboard-sub">{members.length} of {selectedCircle.target_member_count} members</p>
        {selectedCircle.current_cycle_due_date && (
          <p className="dashboard-sub">Due: {new Date(selectedCircle.current_cycle_due_date).toLocaleDateString()}</p>
        )}

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

        {members.length >= selectedCircle.target_member_count && (
          <div style={{ position: 'relative', width: '260px', height: '260px', margin: '30px auto' }}>
            {members.map((member, i) => {
              const angle = (i / members.length) * 2 * Math.PI - Math.PI / 2;
              const radius = 100;
              const center = 130;
              const x = center + radius * Math.cos(angle) - 22;
              const y = center + radius * Math.sin(angle) - 22;

              const position = ((selectedCircle.current_cycle - 1) % members.length) + 1;
              const isCollector = member.payout_position === position;
              const hasPaid = paidUserIds.includes(member.user_id);

              return (
                <div
                  key={member.user_id}
                  style={{
                    position: 'absolute',
                    left: `${x}px`,
                    top: `${y}px`,
                    width: '44px',
                    height: '44px',
                    borderRadius: '50%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '14px',
                    fontWeight: '500',
                    background: isCollector ? '#dbeafe' : '#f3f4f6',
                    color: isCollector ? '#1d4ed8' : '#333',
                    border: isCollector ? '2px solid #3b82f6' : '1px solid #ccc'
                  }}
                >
                  {member.full_name.slice(0, 2).toUpperCase()}
                  <div style={{
                    position: 'absolute',
                    bottom: '-2px',
                    right: '-2px',
                    width: '12px',
                    height: '12px',
                    borderRadius: '50%',
                    background: hasPaid ? 'green' : '#fff',
                    border: '2px solid #fff'
                  }} />
                </div>
              );
            })}
            <div style={{
              position: 'absolute',
              top: '50%',
              left: '50%',
              transform: 'translate(-50%, -50%)',
              textAlign: 'center',
              width: '140px'
            }}>
              <p style={{ fontSize: '12px', color: '#666', margin: 0 }}>Next to collect</p>
              <p style={{ fontSize: '18px', fontWeight: '500', margin: '4px 0 0' }}>
                {members.find((m) => m.payout_position === ((selectedCircle.current_cycle - 1) % members.length) + 1)?.full_name || '—'}
              </p>
            </div>
          </div>
        )}

        {members.length < selectedCircle.target_member_count ? (
          <p style={{ marginTop: '20px', color: '#999' }}>Waiting for more members to join before payments can start.</p>
        ) : (
          <button
            className="auth-button"
            style={{ marginTop: '20px' }}
            onClick={handlePayContribution}
            disabled={paidUserIds.includes(session.user.id)}
          >
            {paidUserIds.includes(session.user.id) ? 'Already Paid' : `Pay ₦${selectedCircle.contribution_amount.toLocaleString()} from wallet`}
          </button>
        )}

        <div className="circle-list" style={{ marginTop: '20px' }}>
          {members.map((member, index) => (
            <div key={member.user_id} className="circle-card">
              <div>
                <p className="circle-card-name">{member.full_name}{member.user_id === session.user.id ? ' (You)' : ''}</p>
                <p className="circle-card-role">{member.role}</p>
                <p style={{ color: paidUserIds.includes(member.user_id) ? 'green' : '#999', fontSize: '13px' }}>
                  {paidUserIds.includes(member.user_id) ? 'Paid' : 'Not Paid'}
                </p>
              </div>
              {selectedCircle.created_by === session.user.id && member.role !== 'creator' && (
                <button
                  onClick={() => handleDeleteMember(member.user_id)}
                  style={{ color: 'red', background: 'none', border: '1px solid red', borderRadius: '6px', padding: '4px 10px', cursor: 'pointer' }}
                >
                  Remove
                </button>
              )}
            </div>
          ))}
        </div>

        {selectedCircle.created_by === session.user.id && (
        <div style={{ marginTop: '21px' }}>
          <input
          className="auth-input"
            type="email"
            placeholder="Invite member by email"
            value={inviteEmail}
            onChange={(e) => setInviteEmail(e.target.value)}
          />
          <button className ="auth-button" onClick ={handleInvite}>Invite</button>
        </div>
        )}
      </div>
    ) : (
      <>
        <h1 className="dashboard-greeting">Circles</h1>
        <p className="dashboard-sub">This is where your circles will live.</p>
        <button className="auth-button" onClick={handleCreateCircle}>
          + Create Circle
        </button>
        <div className="circle-list">
          {circles.map((item) => (
            <div
              key={item.circles.id}
              className="circle-card"
              onClick={() => openCircle(item.circles.id)}
            >
              <div>
                <p className="circle-card-name">{item.circles.name}</p>
                <p className="circle-card-role">{item.role}</p>
              </div>
              <div className="circle-card-amount">
                ₦{item.circles.contribution_amount.toLocaleString()}
              </div>
            </div>
          ))}
        </div>
      </>
    )}
  </div>
);
}
export default CirclePage;