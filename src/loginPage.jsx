import { useState } from 'react';
import { supabase } from './supabaseClient.js';

function LoginPage( { setSession } ) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  async function handleLogin() {
    const { data, error } = await supabase.auth.signInWithPassword({
      email: email,
      password: password
    })

    if (error){
      if(error.message.includes('already registered')){
        console.error('you already have an account - try logging in instead');
      } else {
        console.error('Error logging in:', error.message);
      }
    } else {
      console.log('logged in successfully:', data);
      setSession(data.session);
    }
  }

  return (
    <div className="auth-card">
      <h1 className="auth-title">Welcome back</h1>
      <p className="auth-subtitle">Log in to your Ajo circle</p>
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
      <button className="auth-button" onClick={handleLogin}>Login</button>
    </div>
  );
}

export default LoginPage;