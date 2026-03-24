import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { requestApi } from './api';
import type { AdminOverview, AuthUser, VisitRecord } from './types';

interface AdminPanelProps {
  token: string;
}

export function AdminPanel({ token }: AdminPanelProps) {
  const [loading, setLoading] = useState(false);
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [users, setUsers] = useState<AuthUser[]>([]);
  const [visits, setVisits] = useState<VisitRecord[]>([]);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [newUserName, setNewUserName] = useState('');
  const [newUserEmail, setNewUserEmail] = useState('');
  const [newUserRole, setNewUserRole] = useState<'admin' | 'user'>('user');

  const loadAdminData = useCallback(async () => {
    setLoading(true);

    try {
      const [overviewResponse, usersResponse, visitsResponse] = await Promise.all([
        requestApi<AdminOverview>('/analytics/overview', {}, token),
        requestApi<AuthUser[]>('/users', {}, token),
        requestApi<VisitRecord[]>('/analytics/visits?limit=50', {}, token),
      ]);

      setOverview(overviewResponse);
      setUsers(usersResponse);
      setVisits(visitsResponse);
    } catch (loadError) {
      console.error(loadError);
      setError('Nao foi possivel carregar os dados administrativos.');
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    loadAdminData().catch(() => undefined);
  }, [loadAdminData]);

  const handleCreateUser = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setMessage('');

    try {
      await requestApi(
        '/users',
        {
          method: 'POST',
          body: JSON.stringify({
            name: newUserName,
            email: newUserEmail,
            role: newUserRole,
          }),
        },
        token,
      );

      setNewUserName('');
      setNewUserEmail('');
      setNewUserRole('user');
      setMessage('Usuario criado. Ele podera entrar solicitando codigo por email.');
      await loadAdminData();
    } catch (createError) {
      console.error(createError);
      setError('Nao foi possivel criar o usuario.');
    }
  };

  return (
    <>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-5">
        {[
          { label: 'Usuarios', value: overview?.totalUsers ?? 0 },
          { label: 'Verificados', value: overview?.verifiedUsers ?? 0 },
          { label: 'Ativos Agora', value: overview?.activeUsers ?? 0 },
          { label: 'Visitas', value: overview?.totalVisits ?? 0 },
          { label: 'Hoje', value: overview?.visitsToday ?? 0 },
        ].map((item) => (
          <div key={item.label} className="metric-panel overflow-hidden p-5">
            <div className="absolute inset-x-5 top-0 h-1 rounded-b-full bg-[linear-gradient(90deg,#153a59,#0ca89a)]" />
            <div className="mb-2 text-xs font-bold uppercase tracking-[0.22em] text-brand-muted">
              {item.label}
            </div>
            <div className="font-display text-3xl font-bold text-brand-dark">{item.value}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
        <div className="glass-panel-dark relative overflow-hidden p-6">
          <div className="soft-grid absolute inset-0 opacity-20" />
          <div className="relative z-10">
          <p className="section-kicker mb-2 text-white/55">Controle de acesso</p>
          <h3 className="mb-4 font-display text-2xl font-bold text-white">Criar Usuario</h3>
          <form onSubmit={handleCreateUser} className="space-y-4">
            <input
              type="text"
              value={newUserName}
              onChange={(e) => setNewUserName(e.target.value)}
              className="field-shell"
              placeholder="Nome"
              required
            />
            <input
              type="email"
              value={newUserEmail}
              onChange={(e) => setNewUserEmail(e.target.value)}
              className="field-shell"
              placeholder="email@empresa.com"
              required
            />
            <select
              value={newUserRole}
              onChange={(e) => setNewUserRole(e.target.value as 'admin' | 'user')}
              className="field-shell"
            >
              <option value="user">Usuario</option>
              <option value="admin">Administrador</option>
            </select>
            <button
              type="submit"
              className="primary-button w-full rounded-[22px] py-3"
            >
              Criar usuario
            </button>
          </form>
          {message ? (
            <div className="mt-4 rounded-2xl border border-emerald-300/20 bg-emerald-400/10 p-3 text-sm text-emerald-50">
              {message}
            </div>
          ) : null}
          {error ? (
            <div className="mt-4 rounded-2xl border border-rose-300/20 bg-rose-400/10 p-3 text-sm text-rose-50">
              {error}
            </div>
          ) : null}
          </div>
        </div>

        <div className="glass-panel xl:col-span-2 overflow-hidden">
          <div className="flex flex-col gap-3 border-b border-slate-200/80 p-5 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="section-kicker mb-2">Base atual</p>
              <h3 className="font-display text-2xl font-bold text-brand-dark">Usuarios cadastrados</h3>
            </div>
            <button
              type="button"
              onClick={() => loadAdminData().catch(() => undefined)}
              className="secondary-button self-start rounded-[22px]"
            >
              Atualizar
            </button>
          </div>
          <div className="overflow-x-auto max-h-[320px]">
            <table className="w-full text-left border-collapse">
              <thead className="sticky top-0 z-10 border-b border-slate-200 bg-slate-50/85 text-[10px] font-bold uppercase tracking-[0.22em] text-brand-muted">
                <tr>
                  <th className="p-4">Nome</th>
                  <th className="p-4">Email</th>
                  <th className="p-4">Perfil</th>
                  <th className="p-4">Verificado</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-sm text-brand-muted">
                {users.map((user) => (
                  <tr key={user.id} className="transition hover:bg-white/75">
                    <td className="p-4 font-semibold text-brand-dark">{user.name}</td>
                    <td className="p-4">{user.email}</td>
                    <td className="p-4 text-xs uppercase tracking-[0.18em]">{user.role}</td>
                    <td className="p-4">{user.emailVerified ? 'Sim' : 'Nao'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="glass-panel overflow-hidden">
        <div className="flex flex-col gap-3 border-b border-slate-200/80 p-5 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="section-kicker mb-2">Analitico de uso</p>
            <h3 className="font-display text-2xl font-bold text-brand-dark">Visitas ao app</h3>
          </div>
          {loading ? <span className="text-xs text-brand-muted">Carregando...</span> : null}
        </div>
        <div className="overflow-x-auto max-h-[320px]">
          <table className="w-full text-left border-collapse">
            <thead className="sticky top-0 z-10 border-b border-slate-200 bg-slate-50/85 text-[10px] font-bold uppercase tracking-[0.22em] text-brand-muted">
              <tr>
                <th className="p-4">Usuario</th>
                <th className="p-4">Sessao</th>
                <th className="p-4">Inicio</th>
                <th className="p-4">Ultimo Sinal</th>
                <th className="p-4">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-sm text-brand-muted">
              {visits.map((visit) => (
                <tr key={visit.id} className="transition hover:bg-white/75">
                  <td className="p-4">
                    <div className="font-semibold text-brand-dark">{visit.userName}</div>
                    <div className="text-xs text-brand-muted">{visit.userEmail}</div>
                  </td>
                  <td className="p-4 font-mono text-xs">{visit.sessionId.slice(0, 8)}...</td>
                  <td className="p-4">{new Date(visit.startedAt).toLocaleString()}</td>
                  <td className="p-4">{new Date(visit.lastSeenAt).toLocaleString()}</td>
                  <td className="p-4">
                    <span
                      className={`inline-flex items-center rounded-full px-3 py-1 text-[10px] font-bold uppercase tracking-[0.18em] ${
                        visit.active
                          ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100'
                          : 'bg-slate-100 text-slate-600 ring-1 ring-slate-200'
                      }`}
                    >
                      {visit.active ? 'Ativo' : 'Encerrado'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
