const homeIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 10.5 12 3l9 7.5" /><path d="M5 9.5V20h14V9.5" />
  </svg>
);
const usersIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M16 19v-1a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v1" /><circle cx="9" cy="7" r="3" />
    <path d="M22 19v-1a4 4 0 0 0-3-3.87M16 4.13a4 4 0 0 1 0 7.75" />
  </svg>
);
const walletIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M19 7V5a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h14a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H5a2 2 0 0 1-2-2V6" /><circle cx="16" cy="13" r="1" />
  </svg>
);
const auditIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M9 3h6a1 1 0 0 1 1 1v2H8V4a1 1 0 0 1 1-1Z" /><rect x="5" y="6" width="14" height="15" rx="2" />
    <path d="M9 12h6M9 16h6" />
  </svg>
);
const leafIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
    <path d="M20 4c-8 0-16 4-16 14 10 0 14-8 14-14Z" />
    <path d="M4 18c4-6 9-9 16-10" />
  </svg>
);

function Layout({ page, setPage, children }) {
  const navItems = [
    { id: 'home', label: 'Home', icon: homeIcon },
    { id: 'circle', label: 'Circles', icon: usersIcon },
    { id: 'wallet', label: 'Wallet', icon: walletIcon },
    { id: 'audit', label: 'Audit', icon: auditIcon },
  ];

  return (
    <div className="app-shell">
      <aside className="app-sidebar">
        <div className="sidebar-brand">
          <div className="ajo-logo"><span></span></div>
          <span className="sidebar-brand-name">Ajo</span>
        </div>
        {navItems.map((item) => (
          <button
            key={item.id}
            className={`nav-item ${page === item.id ? 'active' : ''}`}
            onClick={() => setPage(item.id)}
          >
            {item.icon}
            {item.label}
          </button>
        ))}

        <div className="ajo-plant-panel">
          {leafIcon}
          <h4>Small steps.<br />Big goals.</h4>
          <p>Save together, grow together.</p>
        </div>
      </aside>

      <main className="app-main">{children}</main>

      <nav className="app-bottomnav">
        {navItems.map((item) => (
          <button
            key={item.id}
            className={`nav-item ${page === item.id ? 'active' : ''}`}
            onClick={() => setPage(item.id)}
          >
            {item.icon}
            {item.label}
          </button>
        ))}
      </nav>
    </div>
  );
}

export default Layout;