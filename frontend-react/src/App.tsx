import { useEffect, useState } from 'react';
import { requestApi } from './api';
import { Dashboard } from './Dashboard';
import { LoginScreen } from './LoginScreen';
import { clearVisitSessionId, persistAuth, readStoredAuth } from './storage';
import type { AuthState, AuthUser } from './types';

function App() {
  const [auth, setAuth] = useState<AuthState | null>(() => readStoredAuth());
  const [initializing, setInitializing] = useState(true);

  useEffect(() => {
    const restoreAuth = async () => {
      const storedAuth = readStoredAuth();

      if (!storedAuth?.token) {
        setInitializing(false);
        return;
      }

      try {
        const user = await requestApi<AuthUser>('/auth/me', {}, storedAuth.token);
        const refreshedAuth = {
          token: storedAuth.token,
          user,
        };

        setAuth(refreshedAuth);
        persistAuth(refreshedAuth);
      } catch (restoreError) {
        console.error('Failed to restore session', restoreError);
        setAuth(null);
        persistAuth(null);
        clearVisitSessionId();
      } finally {
        setInitializing(false);
      }
    };

    restoreAuth().catch(() => setInitializing(false));
  }, []);

  const handleAuthChange = (nextAuth: AuthState) => {
    setAuth(nextAuth);
    persistAuth(nextAuth);
  };

  const handleLogout = () => {
    setAuth(null);
    persistAuth(null);
    clearVisitSessionId();
  };

  if (initializing) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center text-gray-500 font-sans">
        Carregando sessão...
      </div>
    );
  }

  return auth ? (
    <Dashboard auth={auth} onAuthChange={handleAuthChange} onLogout={handleLogout} />
  ) : (
    <LoginScreen onLoginSuccess={handleAuthChange} />
  );
}

export default App;
