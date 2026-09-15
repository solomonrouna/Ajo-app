function Layout({ page, setPage, children }) {
  const navItems = [
    { id: 'home', label: 'Home' },
    { id: 'circle', label: 'Circle' },
    { id: 'wallet', label: 'Wallet' },
    { id: 'audit', label: 'Audit' },
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
            onClick={() => (item.id === 'home' || item.id === 'circle' || item.id === 'audit' || item.id === 'wallet') && setPage(item.id)}
            disabled={item.id !== 'home' && item.id !== 'circle' && item.id !== 'audit' && item.id !== 'wallet'}
          >
            <span className="nav-dot"></span>
            {item.label}
          </button>
        ))}
      </aside>

      <main className="app-main">{children}</main>

      <nav className="app-bottomnav">
        {navItems.map((item) => (
          <button
            key={item.id}
            className={`nav-item ${page === item.id ? 'active' : ''}`}
            onClick={() => (item.id === 'home' || item.id === 'circle' || item.id === 'audit' || item.id === 'wallet') && setPage(item.id)}
            disabled={item.id !== 'home' && item.id !== 'circle' && item.id !== 'audit' && item.id !== 'wallet'}
          >
            <span className="nav-dot"></span>
            {item.label}
          </button>
        ))}
      </nav>
    </div>
  );
}

export default Layout;