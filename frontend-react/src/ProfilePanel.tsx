import { useEffect, useState, type FormEvent } from 'react';
import { requestApi } from './api';
import { AdminPanel } from './AdminPanel';
import type { AuthState, AuthUser } from './types';

interface ProfilePanelProps {
  auth: AuthState;
  onAuthChange: (auth: AuthState) => void;
}

export function ProfilePanel({ auth, onAuthChange }: ProfilePanelProps) {
  const [name, setName] = useState(auth.user.name);
  const [email, setEmail] = useState(auth.user.email);
  const [avatarUrl, setAvatarUrl] = useState(auth.user.avatarUrl || '');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    setName(auth.user.name);
    setEmail(auth.user.email);
    setAvatarUrl(auth.user.avatarUrl || '');
  }, [auth.user]);

  const handleProfileSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setMessage('');
    setError('');

    try {
      const updatedUser = await requestApi<AuthUser>(
        '/auth/me',
        {
          method: 'PATCH',
          body: JSON.stringify({
            name,
            email,
            avatarUrl,
          }),
        },
        auth.token,
      );

      const updatedAuth = {
        ...auth,
        user: updatedUser,
      };

      onAuthChange(updatedAuth);
      setMessage('Perfil atualizado com sucesso.');
    } catch (saveError) {
      console.error(saveError);
      setError('Nao foi possivel atualizar o perfil.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6 mb-8">
      <div className="glass-panel p-6 sm:p-7">
        <div className="mb-6 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="section-kicker mb-2">Perfil do usuario</p>
            <h2 className="font-display text-2xl font-bold text-brand-dark">Meu Perfil</h2>
            <p className="mt-2 text-sm leading-6 text-brand-muted">
              Gerencie seus dados e acompanhe seu acesso.
            </p>
          </div>
          <div className="rounded-full border border-slate-200 bg-white/85 px-3 py-1 text-xs font-bold uppercase tracking-[0.22em] text-brand-muted">
            {auth.user.role === 'admin' ? 'Administrador' : 'Usuario'}
          </div>
        </div>

        <form onSubmit={handleProfileSubmit} className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <div>
            <label className="mb-2 block text-xs font-bold uppercase tracking-[0.22em] text-brand-muted">
              Nome
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="field-shell"
              required
            />
          </div>

          <div>
            <label className="mb-2 block text-xs font-bold uppercase tracking-[0.22em] text-brand-muted">
              Email
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="field-shell"
              required
            />
          </div>

          <div>
            <label className="mb-2 block text-xs font-bold uppercase tracking-[0.22em] text-brand-muted">
              Avatar URL
            </label>
            <input
              type="url"
              value={avatarUrl}
              onChange={(e) => setAvatarUrl(e.target.value)}
              className="field-shell"
              placeholder="https://..."
            />
          </div>

          <div className="md:col-span-3 flex flex-col gap-3 md:flex-row md:items-center">
            <button
              type="submit"
              disabled={saving}
              className="action-button rounded-2xl bg-brand-primary px-5 py-3 text-white shadow-[0_16px_38px_-18px_rgba(15,159,143,0.85)] hover:bg-brand-secondary disabled:opacity-50"
            >
              {saving ? 'Salvando...' : 'Salvar Perfil'}
            </button>
            <div className="text-sm text-brand-muted">
              Provedor: <span className="font-semibold text-brand-dark">{auth.user.provider}</span> |
              Email verificado:{' '}
              <span className="font-semibold text-brand-dark">
                {auth.user.emailVerified ? 'sim' : 'nao'}
              </span>
            </div>
          </div>
        </form>

        {message ? (
          <div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50/85 p-3 text-sm text-emerald-700">
            {message}
          </div>
        ) : null}
        {error ? (
          <div className="mt-4 rounded-2xl border border-rose-200 bg-rose-50/90 p-3 text-sm text-rose-700">
            {error}
          </div>
        ) : null}
      </div>

      {auth.user.role === 'admin' ? <AdminPanel token={auth.token} /> : null}
    </div>
  );
}
