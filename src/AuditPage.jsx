import { useState, useEffect } from "react";
import { supabase } from "./supabaseClient";

const ACTION_LABELS = {
  debt_created: (details) =>
    `Debt of ₦${details.amount.toLocaleString()} recorded — Cycle ${details.cycle_number}`
};

function AuditPage({ circleId }) {
  const [entries, setEntries] = useState([]);
  const [circleName, setCircleName] = useState('');

  useEffect(() => {
    if (!circleId) return;
    fetchCircleName();
    fetchAuditLog();
  }, [circleId]);

  async function fetchCircleName() {
    const { data, error } = await supabase
      .from('circles')
      .select('name')
      .eq('id', circleId)
      .single();

    if (data) setCircleName(data.name);
  }

  async function fetchAuditLog() {
    const { data: logRows, error } = await supabase
      .from('audit_log')
      .select('id, actor_id, action_type, target_id, details, created_at')
      .eq('circle_id', circleId)
      .order('created_at', { ascending: false });

    if (error) {
      console.log('error fetching audit log', error.message);
      return;
    }

    const actorIds = logRows
      .map((row) => row.actor_id)
      .filter((id) => id !== null);

    let profileRows = [];
    if (actorIds.length > 0) {
      const { data, error: profileError } = await supabase
        .from('profiles')
        .select('id, full_name')
        .in('id', actorIds);

      if (profileError) {
        console.log('error fetching profiles', profileError.message);
      } else {
        profileRows = data;
      }
    }

    const combined = logRows.map((row) => {
      const actorName = row.actor_id
        ? (profileRows.find((p) => p.id === row.actor_id)?.full_name || 'Unknown')
        : 'System';

      const describe = ACTION_LABELS[row.action_type];
      const description = describe ? describe(row.details) : row.action_type;

      return {
        id: row.id,
        actorName,
        description,
        created_at: row.created_at
      };
    });

    setEntries(combined);
  }

  return (
    <div className="dashboard">
      <h1 className="dashboard-greeting">Audit log</h1>
      <p className="dashboard-sub">
        Every admin action on {circleName || 'this circle'}. Nothing here can be edited or removed.
      </p>

      <div className="circle-list" style={{ marginTop: '20px' }}>
        {entries.length > 0 ? (
          entries.map((entry, index) => (
            <div key={entry.id} className="circle-card" style={{ flexDirection: 'column', alignItems: 'flex-start' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%' }}>
                <p className="circle-card-name">{entry.actorName}</p>
                <p style={{ color: '#999', fontSize: '13px' }}>
                  {new Date(entry.created_at).toLocaleString()}
                </p>
              </div>
              <p style={{ margin: '4px 0' }}>{entry.description}</p>
              <p style={{ color: '#999', fontSize: '12px' }}>
                immutable · entry #{entries.length - index}
              </p>
            </div>
          ))
        ) : (
          <p className="dashboard-sub" style={{ marginTop: '20px' }}>No audit entries yet</p>
        )}
      </div>
    </div>
  );
}

export default AuditPage;