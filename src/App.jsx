import {useState,useEffect} from 'react'
import { supabase } from './supabaseClient.js'
import LoginPage from './loginPage.jsx'
import HomePage from './Home.jsx'
import WalletPage from './Wallet.jsx'
import './App.css'
import Layout from './Layout.jsx'
import CirclePage from './circlePage.jsx'
import AuditPage from './AuditPage.jsx'
import ResetPasswordPage from './ResetPasswordPage.jsx'

  function App() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [fullName, setFullName] = useState('')
  const [session, setSession] = useState(null)
  const [page, setPage] = useState('signup')
  const [loading, setLoading] = useState(true)
  const [selectedCircle, setSelectedCircle] = useState(null)
  const [circleToOpen, setCircleToOpen] = useState(null)
  const [signupError, setSignupError] = useState(null)
  const [signupLoading, setSignupLoading] = useState(false)

  useEffect(() => {
     supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      setLoading(false)
    })
  }, [])

  function goToPage(pageId) {
    if (pageId === 'circle') {
      setSelectedCircle(null);
    }
    setPage(pageId);
  }

 async function handleSignup() {
    setSignupError(null)

    if (!email || !password || !fullName) {
      setSignupError('Please fill in all fields.')
      return
    }

    if (password.length < 6) {
      setSignupError('Password must be at least 6 characters.')
      return
    }

    setSignupLoading(true)

    const { data, error } = await supabase.auth.signUp({
      email: email,
      password: password,
      options: {
        data: {
          full_name: fullName
        }
      }
    })

   if(error){
    console.log('Error signing up:', error.message)
    if(error.message.includes('already registered')) {
      setSignupError('You already have an account. Please log in instead.');
    }else{
      setSignupError('Something went wrong. Please try again later.');
    }
   } else {
    console.log('signed up successfully:', data)
    setSession(data.session)
   }

    setSignupLoading(false)
 }

  if (window.location.pathname === '/reset-password') {
    return <ResetPasswordPage />
  }

   if (loading)  return null
return (
  <div className="App">
    {session ? (
     <Layout page={page} setPage={goToPage}>
  {page === 'circle' ? (
    <CirclePage
      session={session}
      selectedCircle={selectedCircle}
      setSelectedCircle={setSelectedCircle}
      circleToOpen={circleToOpen}
      setCircleToOpen={setCircleToOpen}
    />
  ) : page === 'wallet' ? (
    <WalletPage session={session} />
  ) : page === 'audit' ? (
    selectedCircle ? (
      <AuditPage circleId={selectedCircle.id} />
    ) : (
      <p className="dashboard-sub" style={{ marginTop: '20px' }}>Open a circle first to view its audit log.</p>
    )
  ) : (
    <HomePage
      session={session}
      setSession={setSession}
      setPage={setPage}
      setCircleToOpen={setCircleToOpen}
    />
  )}
</Layout>
    ) : page === 'signup' ? (
      <div className="auth-wrapper">
        <div className="auth-card">
          <h1 className="auth-title">Create your Ajo account</h1>
          <p className="auth-subtitle">Start your savings circle</p>
          <input
            className="auth-input"
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <input
            className="auth-input"
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <input
            className="auth-input"
            type="text"
            placeholder="Full Name"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
          />
          {signupError && (
            <p style={{ color: '#e53935', fontSize: '14px', marginTop: '-8px', marginBottom: '12px' }}>
              {signupError}
            </p>
          )}
          <button className="auth-button" onClick={handleSignup} disabled={signupLoading}>
            {signupLoading ? 'Signing up...' : 'Sign Up'}
          </button>
          <div className="auth-switch">
            Already have an account? <button onClick={() => setPage('login')}>Log in</button>
          </div>
        </div>
      </div>
    ) : (
      <div className="auth-wrapper">
        <LoginPage setSession={setSession} />
      </div>
    )}
  </div>
)

}

export default App;