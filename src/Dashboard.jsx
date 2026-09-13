import {useState,useEffect} from 'react'
import { supabase } from './supabaseClient.js'

function Dashboard({ session , setSession}) {
    const [balance, setBalance] = useState(null);
    const [invites, setInvites] = useState([]);
    const [showInvites, setShowInvites] = useState(false);

    useEffect(() => {
        if (!session) return;
        supabase
            .from('wallets')
            .select('balance')
            .eq('id', session.user.id)
            .single()
            .then(({ data, error }) => {
                if (data) {
                    setBalance(data.balance);
                }
            });
    }, []);

    async function handleLogout(){
        await supabase.auth.signOut();
        setSession(null);
    }

    async function fetchInvites() {
      const { data, error } = await supabase
        .from('circle_invites')
        .select('id, circles(id, name, contribution_amount)')
        .eq('invited_user_id', session.user.id)
        .eq('status', 'pending');

      if (data) setInvites(data);
    }

    useEffect(() => {
      if (!session) return;
      fetchInvites();
    }, []);

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
    }

    async function handleFundwallet(){
       const amount = prompt('Please Enter amount to fund your wallet');
       if (amount) {
         const {error} = await supabase.rpc('add_ledger_entry',{
           p_wallet_id: session.user.id,
           p_amount: Number(amount),
           p_direction: 'credit',
           p_description: 'Wallet funding'
         })
          if (error){
            console.log('Error funding wallet', error.message)
          }else{
            console.log('wallet  funded successfully')
            fetchBalance()
          }
     }
    }

    async function handleWithdraw(){
       const amount = prompt('Please Enter amount to withdraw');
       if(amount){
        if (Number(amount)>balance){
          console.log('insufficient funds')
        }else{
          const{error} = await supabase.rpc('add_ledger_entry',{
           p_wallet_id: session.user.id,
           p_amount: Number(amount),
           p_direction: 'debit',
           p_description: 'Wallet withdrawn'
          })
          if (error){
            console.log('Error withdrawing..','error.message')
          }else{
            console.log('withdrawn successful')
            fetchBalance()
          }
          }
        }
    }

    function fetchBalance(){
      supabase
      .from('wallets')
      .select('balance')
      .eq('id',session.user.id)
      .single()
      .then(({data,error}) =>{
        if(data){
          setBalance(data.balance)
        }
      })
    }

    useEffect(()=>{
      if(!session)return;
      fetchBalance()
    },[])

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
                  <button
                    className="auth-button"
                    onClick={() => respondToInvite(invite.id, invite.circles.id, true)}
                  >
                    Accept
                  </button>
                  <button
                    className="auth-button"
                    style={{ background: '#ccc' }}
                    onClick={() => respondToInvite(invite.id, invite.circles.id, false)}
                  >
                    Decline
                  </button>
                </div>
              </div>
            ))
          ) : (
            <p className="dashboard-sub" style={{ marginTop: '20px' }}>No pending invites</p>
          )}
        </div>
      )
    }

    return (
      <div className="dashboard">
        <div className="ajo-header">
          <div className="ajo-header-left">
            <div className="ajo-logo"><span></span></div>
            <div>
              <p className="ajo-wordmark">Ajo</p>
              <p className="ajo-tagline">Thrift & savings circles</p>
            </div>
          </div>
          <div className="ajo-header-right">
            <div
              className="ajo-bell"
              style={{ position: 'relative', cursor: 'pointer' }}
              onClick={() => setShowInvites(true)}
            >
              {invites.length > 0 && (
                <span style={{
                  position: 'absolute',
                  top: '-2px',
                  right: '-2px',
                  width: '8px',
                  height: '8px',
                  borderRadius: '50%',
                  background: 'red'
                }}></span>
              )}
            </div>
            <div className="ajo-avatar">
              {session.user.email?.[0]?.toUpperCase() || 'U'}
            </div>
          </div>
        </div>

        <div className="passbook-entry">
          <p className="passbook-label">Wallet Balance</p>
          <p className="passbook-amount">
            ₦{balance !== null ? balance.toLocaleString() : '···'}
          </p>
          <div className="passbook-actions">
            <button className="passbook-action primary" onClick={handleFundwallet}>+ Fund wallet</button>
            <button className="passbook-action secondary" onClick={handleWithdraw}> withdraw</button>
          </div>
          <div className="passbook-stamp">Last updated just now</div>
        </div>
        <button className="auth-switch" onClick={handleLogout} style ={{background:'none',border:'none',textDecoration:'underline',cursor:'pointer',marginTop:'20px'}}>
          Logout
        </button>
      </div>
    )
}
export default Dashboard;