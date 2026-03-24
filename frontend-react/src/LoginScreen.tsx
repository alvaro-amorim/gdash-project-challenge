import { useEffect, useState, type FormEvent } from 'react';
import loginLogo from './assets/logo2.png';
import {
  GOOGLE_CLIENT_ID,
  fetchPublicAuthConfig,
  getErrorMessage,
  getRuntimeConfigWarnings,
  requestApi,
} from './api';
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
  const [googleClientId, setGoogleClientId] = useState(GOOGLE_CLIENT_ID);
  const [emailLoginEnabled, setEmailLoginEnabled] = useState(true);
  const configWarnings = getRuntimeConfigWarnings();

  useEffect(() => {
    let active = true;

    fetchPublicAuthConfig()
      .then((config) => {
        if (!active) {
          return;
        }

        if (!GOOGLE_CLIENT_ID && config.googleClientId) {
          setGoogleClientId(config.googleClientId);
        }

        setEmailLoginEnabled(config.emailLoginEnabled);
      })
      .catch(() => undefined);

    return () => {
      active = false;
    };
  }, []);

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
      setError(
        getErrorMessage(
          requestError,
          'Nao foi possivel enviar o codigo. Confira se o usuario existe.',
        ),
      );
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
      setError(
        getErrorMessage(requestError, 'Codigo invalido ou expirado. Tente solicitar um novo.'),
      );
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
      setError(
        getErrorMessage(
          requestError,
          'Falha ao autenticar com Google. Verifique a configuracao do cliente OAuth.',
        ),
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen px-4 py-8 sm:px-6 lg:px-8">
      <div className="mx-auto grid min-h-[calc(100vh-4rem)] max-w-7xl items-center gap-8 xl:grid-cols-[1.15fr_0.85fr]">
        <section className="glass-panel-dark relative overflow-hidden p-8 xl:p-10">
          <div className="soft-grid absolute inset-0 opacity-20" />
          <div className="absolute -left-10 top-10 h-40 w-40 rounded-full bg-brand-primary/20 blur-3xl" />
          <div className="absolute -right-10 bottom-0 h-56 w-56 rounded-full bg-brand-accent/18 blur-3xl" />

          <div className="relative z-10">
            <div className="mb-10 flex items-center gap-4">
              <div className="flex h-16 w-16 items-center justify-center rounded-[24px] border border-white/12 bg-white/10 shadow-[0_16px_40px_-20px_rgba(12,24,40,0.7)]">
                <img src={loginLogo} alt="GDASH Logo" className="h-10 w-10 object-contain" />
              </div>
              <div>
                <p className="section-kicker text-white/60">Climate intelligence workspace</p>
                <h1 className="mt-2 font-display text-4xl font-bold text-white sm:text-5xl">
                  Um painel que parece produto, nao prototipo.
                </h1>
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-3">
              {[
                ['Leitura viva', 'Clima atual, historico e cidade do usuario integrados em um unico fluxo.'],
                ['IA em pacotes', 'A interface gira os insights em vez de travar um texto unico e cansativo.'],
                ['Deploy leve', 'Frontend pode ir para Vercel e backend continuar separado sem custo alto.'],
              ].map(([title, description]) => (
                <article key={title} className="rounded-[28px] border border-white/10 bg-white/10 p-5">
                  <p className="section-kicker text-white/55">{title}</p>
                  <p className="mt-4 text-sm leading-6 text-white/70">{description}</p>
                </article>
              ))}
            </div>

            <div className="mt-8 grid gap-4 lg:grid-cols-[1.15fr_0.85fr]">
              <div className="rounded-[30px] border border-white/10 bg-white/10 p-6">
                <p className="section-kicker text-white/55">Como entrar</p>
                <p className="mt-3 max-w-xl text-lg leading-8 text-white/90">
                  O acesso continua simples: email, codigo temporario e opcionalmente Google.
                  O que muda aqui e a experiencia visual, nao a friccao.
                </p>
              </div>
              <div className="rounded-[30px] border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.12),rgba(255,255,255,0.05))] p-6">
                <p className="section-kicker text-white/55">SMTP</p>
                <p className="mt-3 text-sm leading-7 text-white/80">
                  Para Gmail, use senha de app. Nao use a senha normal da conta.
                </p>
              </div>
            </div>
          </div>
        </section>

        <div className="glass-panel mx-auto w-full max-w-xl overflow-hidden">
          <div className="border-b border-slate-200/70 bg-white/60 px-8 py-7 sm:px-10">
            <div className="mb-6 flex items-center justify-between gap-4">
              <div className="flex items-center gap-4">
                <div className="flex h-16 w-16 items-center justify-center rounded-[24px] bg-white shadow-sm ring-1 ring-slate-200/70">
                  <img src={loginLogo} alt="GDASH Logo" className="h-10 w-10 object-contain" />
                </div>
                <div>
                  <p className="section-kicker mb-2">Portal GDASH</p>
                  <h2 className="font-display text-3xl font-bold text-brand-dark">Entrar no painel</h2>
                </div>
              </div>
              <span className="status-pill border-brand-primary/15 bg-brand-primary/10 text-brand-secondary">
                {phase === 'request' ? 'acesso' : 'validacao'}
              </span>
            </div>

            <p className="max-w-md text-sm leading-6 text-brand-muted">
              Use o email do seu perfil para receber o codigo de acesso e liberar o workspace.
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

              {configWarnings.length > 0 ? (
                <div className="rounded-3xl border border-amber-200 bg-amber-50/90 p-4 text-sm text-amber-800">
                  {configWarnings.map((warning) => (
                    <p key={warning}>{warning}</p>
                  ))}
                </div>
              ) : null}

              {!emailLoginEnabled && phase === 'request' ? (
                <div className="rounded-3xl border border-amber-200 bg-amber-50/90 p-4 text-sm text-amber-800">
                  {googleClientId
                    ? 'Este deploy nao tem envio de email configurado. Use o login Google abaixo para acessar sem custo.'
                    : 'Este deploy nao tem envio de email configurado. Ative Google OAuth, Resend ou SMTP no backend para liberar o acesso.'}
                </div>
              ) : null}

              <button
                type="submit"
                disabled={loading || (phase === 'request' && !emailLoginEnabled)}
                className="primary-button w-full rounded-[24px] px-5 py-4 disabled:opacity-50"
              >
                {loading
                  ? 'Processando...'
                  : phase === 'request'
                    ? emailLoginEnabled
                      ? 'Receber Codigo por Email'
                      : 'Email indisponivel neste deploy'
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
                  className="secondary-button w-full rounded-[24px] py-4"
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
                clientId={googleClientId}
                disabled={loading}
                onCredential={handleGoogleCredential}
                onError={setError}
              />
              {!googleClientId ? (
                <p className="mt-4 text-center text-xs leading-5 text-brand-muted">
                  Login Google sera exibido assim que o client ID for configurado no backend ou no frontend.
                </p>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
