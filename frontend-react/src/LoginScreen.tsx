import { useState, type FormEvent } from 'react';
import loginLogo from './assets/logo2.png';
import { GOOGLE_CLIENT_ID, requestApi } from './api';
import { GoogleLoginButton } from './GoogleLoginButton';
import type { AuthApiResponse, AuthState } from './types';

interface LoginScreenProps {
  onLoginSuccess: (auth: AuthState) => void;
}

export function LoginScreen({ onLoginSuccess }: LoginScreenProps) {
  const [phase, setPhase] = useState<'request' | 'verify'>('request');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [devCode, setDevCode] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSendCode = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    setInfo('');
    setDevCode('');

    try {
      const response = await requestApi<{ sent: boolean; devCode?: string }>(
        '/auth/request-login-code',
        {
          method: 'POST',
          body: JSON.stringify({ email }),
        },
      );

      setPhase('verify');
      setInfo(
        response.sent
          ? 'Enviamos um codigo para o seu email.'
          : 'SMTP nao configurado. O backend liberou um codigo de desenvolvimento para facilitar o teste local.',
      );
      setDevCode(response.devCode || '');
    } catch (requestError) {
      console.error(requestError);
      setError('Nao foi possivel enviar o codigo. Confira se o usuario existe.');
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyCode = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const response = await requestApi<AuthApiResponse>('/auth/verify-login-code', {
        method: 'POST',
        body: JSON.stringify({ email, code }),
      });

      onLoginSuccess({
        token: response.access_token,
        user: response.user,
      });
    } catch (requestError) {
      console.error(requestError);
      setError('Codigo invalido ou expirado. Tente solicitar um novo.');
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleCredential = async (credential: string) => {
    setLoading(true);
    setError('');
    setInfo('');

    try {
      const response = await requestApi<AuthApiResponse>('/auth/google', {
        method: 'POST',
        body: JSON.stringify({ credential }),
      });

      onLoginSuccess({
        token: response.access_token,
        user: response.user,
      });
    } catch (requestError) {
      console.error(requestError);
      setError('Falha ao autenticar com Google. Verifique a configuracao do cliente OAuth.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen px-4 py-10 sm:px-6 lg:px-8">
      <div className="mx-auto grid min-h-[calc(100vh-5rem)] max-w-6xl items-center gap-8 lg:grid-cols-[1.05fr_0.95fr]">
        <section className="hidden lg:block">
          <div className="glass-panel soft-grid relative overflow-hidden p-8 xl:p-10">
            <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-brand-primary via-cyan-400 to-brand-secondary" />
            <div className="mb-12 flex items-center gap-4">
              <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-white shadow-sm ring-1 ring-slate-200/70">
                <img src={loginLogo} alt="GDASH Logo" className="h-10 w-10 object-contain" />
              </div>
              <div>
                <p className="section-kicker mb-2">Climate Intelligence Workspace</p>
                <h1 className="font-display text-4xl font-bold text-brand-dark">
                  Dados ao vivo, leitura clara e acoes rapidas.
                </h1>
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-3">
              {[
                ['Coleta continua', 'Clima atualizado em pequenos intervalos para o dashboard seguir vivo.'],
                ['IA sob demanda', 'Insights so aparecem quando ha alguem online e respeitam a janela de 20 minutos.'],
                ['Operacao simples', 'Sem Google Cloud obrigatorio: email em modo dev ou SMTP quando voce quiser.'],
              ].map(([title, description]) => (
                <article key={title} className="metric-panel p-5">
                  <p className="section-kicker mb-3">{title}</p>
                  <p className="text-sm leading-6 text-brand-muted">{description}</p>
                </article>
              ))}
            </div>

            <div className="mt-8 rounded-[24px] bg-brand-dark px-6 py-5 text-slate-100 shadow-[0_18px_50px_-24px_rgba(15,23,42,0.8)]">
              <p className="section-kicker mb-3 text-slate-300">Nota rapida sobre SMTP</p>
              <p className="text-sm leading-6 text-slate-200">
                Para Gmail, use senha de app, nao a senha normal da conta.
              </p>
            </div>
          </div>
        </section>

        <div className="glass-panel mx-auto w-full max-w-xl overflow-hidden">
          <div className="border-b border-slate-200/70 bg-white/70 px-8 py-7 sm:px-10">
            <div className="mb-6 flex items-center justify-between gap-4">
              <div className="flex items-center gap-4">
                <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-white shadow-sm ring-1 ring-slate-200/70">
                  <img src={loginLogo} alt="GDASH Logo" className="h-10 w-10 object-contain" />
                </div>
                <div>
                  <p className="section-kicker mb-2">Portal GDASH</p>
                  <h2 className="font-display text-3xl font-bold text-brand-dark">Bem-vindo</h2>
                </div>
              </div>
              <span className="rounded-full border border-brand-primary/15 bg-brand-primary/10 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.22em] text-brand-secondary">
                {phase === 'request' ? 'Acesso' : 'Validacao'}
              </span>
            </div>

            <p className="max-w-md text-sm leading-6 text-brand-muted">
              Entre com o email do seu perfil e valide o codigo temporario.
            </p>
          </div>

          <div className="p-8 sm:p-10">
            <form onSubmit={phase === 'request' ? handleSendCode : handleVerifyCode} className="space-y-6">
              <div>
                <label className="mb-2 block text-xs font-bold uppercase tracking-[0.22em] text-brand-muted">
                  Email Corporativo
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="field-shell"
                  placeholder="admin@gdash.io"
                  required
                />
              </div>

              {phase === 'verify' ? (
                <div>
                  <label className="mb-2 block text-xs font-bold uppercase tracking-[0.22em] text-brand-muted">
                    Codigo de Verificacao
                  </label>
                  <input
                    type="text"
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    className="field-shell tracking-[0.35em]"
                    placeholder="123456"
                    maxLength={6}
                    required
                  />
                </div>
              ) : null}

              {info ? (
                <div className="rounded-3xl border border-emerald-200 bg-emerald-50/85 p-4 text-center text-sm text-emerald-700">
                  {info}
                  {devCode ? (
                    <div className="mt-2 font-mono text-base tracking-[0.28em] text-emerald-900">
                      {devCode}
                    </div>
                  ) : null}
                </div>
              ) : null}

              {error ? (
                <div className="rounded-3xl border border-rose-200 bg-rose-50/90 p-4 text-center text-sm text-rose-700">
                  {error}
                </div>
              ) : null}

              <button
                type="submit"
                disabled={loading}
                className="action-button w-full rounded-3xl bg-brand-primary px-5 py-4 text-white shadow-[0_16px_40px_-18px_rgba(15,159,143,0.8)] hover:bg-brand-secondary disabled:opacity-50"
              >
                {loading
                  ? 'Processando...'
                  : phase === 'request'
                    ? 'Receber Codigo por Email'
                    : 'Entrar com Codigo'}
              </button>

              {phase === 'verify' ? (
                <button
                  type="button"
                  onClick={() => {
                    setPhase('request');
                    setCode('');
                    setInfo('');
                    setDevCode('');
                  }}
                  className="action-button w-full rounded-3xl border border-slate-200 bg-white text-brand-muted hover:bg-slate-50"
                >
                  Alterar email
                </button>
              ) : null}
            </form>

            <div className="my-8 soft-divider" />

            <div>
              <p className="mb-4 text-center text-xs font-bold uppercase tracking-[0.28em] text-brand-muted">
                ou entre com Google
              </p>
              <GoogleLoginButton
                disabled={loading}
                onCredential={handleGoogleCredential}
                onError={setError}
              />
              {!GOOGLE_CLIENT_ID ? (
                <p className="mt-4 text-center text-xs leading-5 text-brand-muted">
                  Login Google sera exibido assim que o client ID for configurado.
                </p>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
