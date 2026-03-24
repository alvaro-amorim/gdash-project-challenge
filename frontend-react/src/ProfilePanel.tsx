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
      setError('Não foi possível atualizar o perfil.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mb-8 space-y-6">
      <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
        <div className="glass-panel-dark relative overflow-hidden p-6 sm:p-7">
          <div className="soft-grid absolute inset-0 opacity-20" />
          <div className="relative z-10">
            <p className="section-kicker text-white/55">Perfil do operador</p>
            <h2 className="mt-3 font-display text-3xl font-bold text-white">Sua identidade dentro do painel</h2>
            <p className="mt-3 max-w-xl text-sm leading-7 text-white/75">
              Nome, e-mail e cidade preferida ficam centralizados aqui para facilitar ajustes rápidos.
            </p>

            <div className="mt-6 grid gap-4 sm:grid-cols-3">
              <div className="rounded-[26px] border border-white/10 bg-white/10 p-5">
                <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-white/50">Perfil</p>
                <p className="mt-3 text-lg font-semibold text-white">
                  {auth.user.role === 'admin' ? 'Administrador' : 'Usuário'}
                </p>
              </div>
              <div className="rounded-[26px] border border-white/10 bg-white/10 p-5">
                <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-white/50">Provedor</p>
                <p className="mt-3 text-lg font-semibold text-white">{auth.user.provider}</p>
              </div>
              <div className="rounded-[26px] border border-white/10 bg-white/10 p-5">
                <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-white/50">Verificação</p>
                <p className="mt-3 text-lg font-semibold text-white">
                  {auth.user.emailVerified ? 'Concluída' : 'Pendente'}
                </p>
              </div>
            </div>
          </div>
        </div>

        <div className="glass-panel p-6 sm:p-7">
          <div className="mb-6 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="section-kicker mb-2">Edição rápida</p>
            <h2 className="font-display text-2xl font-bold text-brand-dark">Meu Perfil</h2>
            <p className="mt-2 text-sm leading-6 text-brand-muted">
              Gerencie seus dados e acompanhe seu acesso.
            </p>
          </div>
          <div className="status-pill border-slate-200 bg-white/85 text-brand-muted">
            {auth.user.role === 'admin' ? 'Administrador' : 'Usuário'}
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
            <button type="submit" disabled={saving} className="primary-button rounded-[22px] px-5 py-3 disabled:opacity-50">
              {saving ? 'Salvando...' : 'Salvar Perfil'}
            </button>
            <div className="text-sm text-brand-muted">
              Provedor: <span className="font-semibold text-brand-dark">{auth.user.provider}</span> |
              E-mail verificado:{' '}
              <span className="font-semibold text-brand-dark">
                {auth.user.emailVerified ? 'sim' : 'não'}
              </span>
            </div>
          </div>
        </form>

        <div className="mt-5 rounded-3xl border border-slate-200/80 bg-white/80 px-4 py-4">
          <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-brand-muted">
            Cidade padrão do painel
          </p>
          <p className="mt-2 text-sm font-semibold text-brand-dark">
            {auth.user.preferredCityName
              ? [
                  auth.user.preferredCityName,
                  auth.user.preferredStateCode || auth.user.preferredStateName || 'Brasil',
                ].join(', ')
              : 'Juiz de Fora, MG'}
          </p>
          <p className="mt-2 text-sm text-brand-muted">
            A cidade pode ser trocada no topo do painel. A seleção fica salva no seu perfil.
          </p>
        </div>

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
      </div>

      {auth.user.role === 'admin' ? <AdminPanel token={auth.token} /> : null}
    </div>
  );
}
