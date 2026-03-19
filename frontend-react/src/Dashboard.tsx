import {
  startTransition,
  useDeferredValue,
  useEffect,
  useState,
} from 'react';
import dashboardLogo from './assets/logo.png';
import { API_BASE_URL, requestApi } from './api';
import { InsightSlider } from './InsightSlider';
import { ProfilePanel } from './ProfilePanel';
import { clearVisitSessionId, getVisitSessionId } from './storage';
import type { AuthState, WeatherData } from './types';
import { WeatherChart } from './WeatherChart';

interface DashboardProps {
  auth: AuthState;
  onAuthChange: (auth: AuthState) => void;
  onLogout: () => void;
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleString();
}

function getWeatherStatus(item: WeatherData) {
  if (item.precipitation > 0) {
    return 'Piso molhado';
  }

  if (item.temp >= 30) {
    return 'Calor intenso';
  }

  if (item.temp >= 25) {
    return 'Tempo quente';
  }

  if (item.temp <= 15) {
    return 'Frente fria';
  }

  if (item.wind_speed > 20) {
    return 'Vento forte';
  }

  return 'Conforto estavel';
}

function FilterButton({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-2xl px-4 py-3 text-sm font-bold transition ${
        active
          ? 'bg-brand-primary text-white shadow-[0_16px_38px_-18px_rgba(15,159,143,0.85)]'
          : 'bg-white/80 text-brand-muted hover:bg-white hover:text-brand-dark'
      }`}
    >
      {label}
    </button>
  );
}

function MetricCard({
  eyebrow,
  value,
  description,
  tone,
}: {
  eyebrow: string;
  value: string;
  description: string;
  tone: string;
}) {
  return (
    <article className={`metric-panel p-5 ${tone}`}>
      <p className="section-kicker mb-3">{eyebrow}</p>
      <p className="font-display text-3xl font-bold text-brand-dark">{value}</p>
      <p className="mt-3 text-sm leading-6 text-brand-muted">{description}</p>
    </article>
  );
}

export function Dashboard({ auth, onAuthChange, onLogout }: DashboardProps) {
  const [weatherList, setWeatherList] = useState<WeatherData[]>([]);
  const [latest, setLatest] = useState<WeatherData | null>(null);
  const [limit, setLimit] = useState(45);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [isCustomFilter, setIsCustomFilter] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const deferredWeatherList = useDeferredValue(weatherList);

  const fetchData = async () => {
    let url = `${API_BASE_URL}/weather?limit=${limit}`;

    if (isCustomFilter && startDate && endDate) {
      url = `${API_BASE_URL}/weather?start=${startDate}:00&end=${endDate}:59&limit=0`;
    }

    try {
      const response = await fetch(url);
      const data = (await response.json()) as WeatherData[];

      startTransition(() => {
        setWeatherList(data);
        setLatest(data.length > 0 ? data[0] : null);
      });
    } catch (requestError) {
      console.error('Error fetching data:', requestError);
    }
  };

  useEffect(() => {
    fetchData().catch(() => undefined);
    const interval = setInterval(() => {
      if (!isCustomFilter) {
        fetchData().catch(() => undefined);
      }
    }, 5000);

    return () => clearInterval(interval);
  }, [limit, isCustomFilter, startDate, endDate]);

  useEffect(() => {
    const sessionId = getVisitSessionId();

    const sendPresence = async (mode: 'start' | 'heartbeat' | 'end') => {
      try {
        await requestApi(
          `/analytics/visits/${mode}`,
          {
            method: 'POST',
            body: JSON.stringify({
              sessionId,
              path: showProfile ? '/profile' : '/dashboard',
            }),
          },
          auth.token,
        );
      } catch (presenceError) {
        console.error(`Failed to send ${mode} presence`, presenceError);
      }
    };

    sendPresence('start').catch(() => undefined);

    const interval = setInterval(() => {
      sendPresence('heartbeat').catch(() => undefined);
    }, 30000);

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        sendPresence('heartbeat').catch(() => undefined);
      }
    };

    const handleBeforeUnload = () => {
      fetch(`${API_BASE_URL}/analytics/visits/end`, {
        method: 'POST',
        keepalive: true,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${auth.token}`,
        },
        body: JSON.stringify({
          sessionId,
          path: showProfile ? '/profile' : '/dashboard',
        }),
      }).catch(() => undefined);
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('beforeunload', handleBeforeUnload);
      sendPresence('end').catch(() => undefined);
    };
  }, [auth.token, showProfile]);

  const handleQuickFilter = (value: number) => {
    setIsCustomFilter(false);
    setLimit(value);
    setStartDate('');
    setEndDate('');
  };

  const handleDateFilter = () => {
    if (!startDate || !endDate) {
      return;
    }

    setIsCustomFilter(true);
    fetchData().catch(() => undefined);
  };

  const handleLogoutClick = async () => {
    try {
      await requestApi(
        '/analytics/visits/end',
        {
          method: 'POST',
          body: JSON.stringify({
            sessionId: getVisitSessionId(),
            path: showProfile ? '/profile' : '/dashboard',
          }),
        },
        auth.token,
      );
    } catch (logoutError) {
      console.error('Failed to end visit session', logoutError);
    } finally {
      clearVisitSessionId();
      onLogout();
    }
  };

  return (
    <div className="min-h-screen px-4 pb-10 pt-6 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-[1500px] space-y-6">
        <section className="grid gap-4 xl:grid-cols-[1.05fr_1.95fr]">
          <div className="glass-panel soft-grid overflow-hidden p-6 sm:p-8">
            <div className="mb-8 flex items-start justify-between gap-4">
              <div className="flex items-center gap-4">
                <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white shadow-sm ring-1 ring-slate-200/80">
                  <img src={dashboardLogo} alt="GDASH Logo" className="h-9 w-9 object-contain" />
                </div>
                <div>
                  <p className="section-kicker mb-2">GDASH Control Center</p>
                  <h1 className="font-display text-3xl font-bold text-brand-dark sm:text-4xl">
                    Weather Analytics
                  </h1>
                </div>
              </div>

              <span className="rounded-full border border-brand-primary/15 bg-brand-primary/10 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.22em] text-brand-secondary">
                online
              </span>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <p className="text-sm font-semibold text-brand-dark">{auth.user.name}</p>
                <p className="mt-1 text-sm text-brand-muted">{auth.user.email}</p>
              </div>
              <div className="text-sm leading-6 text-brand-muted sm:text-right">
                Coleta em tempo quase real, IA em janelas de 20 minutos e fallback entre ciclos.
              </div>
            </div>
          </div>

          <div className="glass-panel overflow-hidden p-4 sm:p-5">
            <div className="grid gap-4 lg:grid-cols-[auto_1fr_auto] lg:items-end">
              <div className="overflow-x-auto pb-1">
                <div className="flex min-w-max gap-2">
                  <FilterButton active={!isCustomFilter && limit === 45} label="15m" onClick={() => handleQuickFilter(45)} />
                  <FilterButton active={!isCustomFilter && limit === 180} label="1h" onClick={() => handleQuickFilter(180)} />
                  <FilterButton active={!isCustomFilter && limit === 1080} label="6h" onClick={() => handleQuickFilter(1080)} />
                  <FilterButton active={!isCustomFilter && limit === 0} label="Todos" onClick={() => handleQuickFilter(0)} />
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-[1fr_auto_1fr_auto] sm:items-center">
                <input
                  type="datetime-local"
                  className="field-shell min-w-0"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                />
                <span className="hidden text-center text-sm font-semibold text-brand-muted sm:block">
                  ate
                </span>
                <input
                  type="datetime-local"
                  className="field-shell min-w-0"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                />
                <button
                  onClick={handleDateFilter}
                  className={`action-button rounded-2xl px-5 py-3 ${
                    isCustomFilter
                      ? 'bg-brand-secondary text-white'
                      : 'bg-slate-100 text-brand-muted hover:bg-slate-200'
                  }`}
                >
                  Buscar
                </button>
              </div>

              <div className="flex flex-wrap items-center gap-2 lg:justify-end">
                <a
                  href={`${API_BASE_URL}/weather/export/csv`}
                  target="_blank"
                  rel="noreferrer"
                  className="action-button rounded-2xl border border-slate-200 bg-white text-brand-muted hover:bg-slate-50"
                >
                  CSV
                </a>
                <a
                  href={`${API_BASE_URL}/weather/export/xlsx`}
                  target="_blank"
                  rel="noreferrer"
                  className="action-button rounded-2xl border border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
                >
                  Excel
                </a>
                <button
                  onClick={() => setShowProfile((previousValue) => !previousValue)}
                  className="action-button rounded-2xl border border-slate-200 bg-white text-brand-dark hover:bg-slate-50"
                >
                  {showProfile ? 'Fechar Perfil' : 'Meu Perfil'}
                </button>
                <button
                  onClick={handleLogoutClick}
                  className="action-button rounded-2xl border border-rose-200 bg-rose-50 text-rose-600 hover:bg-rose-100"
                >
                  Sair
                </button>
              </div>
            </div>
          </div>
        </section>

        {showProfile ? <ProfilePanel auth={auth} onAuthChange={onAuthChange} /> : null}

        {latest ? (
          <>
            <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
              <MetricCard
                eyebrow="Temperatura"
                value={`${latest.temp.toFixed(1)}°C`}
                description={latest.is_day === 1 ? 'Leitura atual durante o periodo diurno.' : 'Leitura atual durante o periodo noturno.'}
                tone="bg-[radial-gradient(circle_at_top_left,rgba(249,115,22,0.12),transparent_35%)]"
              />
              <MetricCard
                eyebrow="Umidade"
                value={`${latest.humidity}%`}
                description="Indicador importante para conforto, visibilidade e percepcao termica."
                tone="bg-[radial-gradient(circle_at_top_left,rgba(15,159,143,0.12),transparent_35%)]"
              />
              <MetricCard
                eyebrow="Vento"
                value={`${latest.wind_speed.toFixed(1)} km/h`}
                description="Util para avaliar dispersao, sensacao termica e risco operacional."
                tone="bg-[radial-gradient(circle_at_top_left,rgba(124,108,255,0.12),transparent_35%)]"
              />
              <MetricCard
                eyebrow="Chuva"
                value={`${latest.precipitation.toFixed(1)} mm`}
                description={latest.precipitation > 0 ? 'Ha precipitacao registrada no momento.' : 'Sem chuva relevante no ultimo ciclo.'}
                tone="bg-[radial-gradient(circle_at_top_left,rgba(24,107,130,0.12),transparent_35%)]"
              />
            </section>

            <section className="grid gap-4 xl:grid-cols-[1.55fr_1fr]">
              <article
                className={`glass-panel relative overflow-hidden p-6 sm:p-8 ${
                  latest.is_day === 1
                    ? 'bg-[linear-gradient(135deg,rgba(46,119,227,0.96),rgba(106,176,255,0.92))] text-white'
                    : 'bg-[linear-gradient(135deg,rgba(30,41,94,0.96),rgba(93,63,211,0.92))] text-white'
                }`}
              >
                <div className="absolute inset-0 opacity-30">
                  <div className="soft-grid h-full w-full" />
                </div>
                <div className="relative z-10">
                  <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="text-[0.72rem] font-bold uppercase tracking-[0.28em] text-white/70">
                        {isCustomFilter
                          ? 'Analise Historica'
                          : latest.is_day === 1
                            ? 'Insights para o Dia'
                            : 'Insights para a Noite'}
                      </p>
                      <h2 className="mt-3 font-display text-2xl font-bold sm:text-3xl">
                        Leitura assistida para decisao rapida.
                      </h2>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-full border border-white/15 bg-white/10 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.22em]">
                        {latest.insight_source === 'ai' ? 'Insight IA' : 'Fallback local'}
                      </span>
                      <span className="rounded-full border border-white/15 bg-white/10 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.22em]">
                        {latest.has_active_viewer ? 'Viewer ativo' : 'Sem viewer ativo'}
                      </span>
                    </div>
                  </div>

                  <InsightSlider text={latest.insight || 'Processando dados meteorologicos...'} />
                </div>
              </article>

              <article className="metric-panel p-6 sm:p-7">
                <p className="section-kicker mb-3">Contexto atual</p>
                <div className="flex items-end justify-between gap-4">
                  <div>
                    <p className="font-display text-6xl font-bold leading-none text-brand-dark">
                      {latest.temp.toFixed(1)}°
                    </p>
                    <p className="mt-3 text-sm text-brand-muted">Juiz de Fora, MG</p>
                  </div>
                  <span className="rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
                    {latest.is_day === 1 ? 'Periodo diurno' : 'Periodo noturno'}
                  </span>
                </div>

                <div className="mt-6 grid gap-3 sm:grid-cols-2">
                  {[
                    ['Status operacional', getWeatherStatus(latest)],
                    ['Umidade', `${latest.humidity}%`],
                    ['Vento', `${latest.wind_speed.toFixed(1)} km/h`],
                    ['Precipitacao', `${latest.precipitation.toFixed(1)} mm`],
                  ].map(([label, value]) => (
                    <div key={label} className="rounded-2xl border border-slate-200/80 bg-white/75 px-4 py-4">
                      <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-brand-muted">
                        {label}
                      </p>
                      <p className="mt-2 text-sm font-semibold text-brand-dark">{value}</p>
                    </div>
                  ))}
                </div>
              </article>
            </section>
          </>
        ) : null}

        {deferredWeatherList.length > 0 ? (
          <WeatherChart data={deferredWeatherList} />
        ) : (
          <div className="glass-panel flex h-48 items-center justify-center text-sm text-brand-muted">
            Sem dados suficientes para montar o grafico neste periodo.
          </div>
        )}

        <section className="glass-panel overflow-hidden">
          <div className="flex flex-col gap-4 border-b border-slate-200/80 px-5 py-5 sm:flex-row sm:items-end sm:justify-between sm:px-7">
            <div>
              <p className="section-kicker mb-2">Auditoria operacional</p>
              <h3 className="font-display text-2xl font-bold text-brand-dark">Registros detalhados</h3>
            </div>
            <span className="self-start rounded-full border border-slate-200 bg-white/85 px-3 py-1 text-xs font-semibold text-brand-muted">
              {deferredWeatherList.length} logs carregados
            </span>
          </div>

          <div className="md:hidden">
            <div className="space-y-3 p-4">
              {deferredWeatherList.map((item) => (
                <article key={item._id} className="metric-panel p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-sm font-semibold text-brand-dark">{formatDateTime(item.collected_at)}</p>
                      <p className="mt-1 text-xs uppercase tracking-[0.18em] text-brand-muted">
                        {item.insight_source === 'ai' ? 'IA' : 'Fallback'}
                      </p>
                    </div>
                    <span className="rounded-full border border-slate-200 bg-white/90 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.2em] text-brand-muted">
                      {item.is_day === 1 ? 'Dia' : 'Noite'}
                    </span>
                  </div>

                  <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <p className="text-brand-muted">Temperatura</p>
                      <p className="font-semibold text-brand-dark">{item.temp.toFixed(1)}°C</p>
                    </div>
                    <div>
                      <p className="text-brand-muted">Umidade</p>
                      <p className="font-semibold text-brand-dark">{item.humidity}%</p>
                    </div>
                    <div>
                      <p className="text-brand-muted">Vento</p>
                      <p className="font-semibold text-brand-dark">{item.wind_speed.toFixed(1)} km/h</p>
                    </div>
                    <div>
                      <p className="text-brand-muted">Chuva</p>
                      <p className="font-semibold text-brand-dark">{item.precipitation.toFixed(1)} mm</p>
                    </div>
                  </div>

                  <div className="mt-4 rounded-2xl border border-slate-200/80 bg-white/80 p-4 text-sm leading-6 text-brand-muted">
                    {item.insight || '-'}
                  </div>
                </article>
              ))}
            </div>
          </div>

          <div className="hidden overflow-x-auto md:block">
            <table className="w-full min-w-[880px] border-collapse">
              <thead className="bg-slate-50/85 text-left text-[11px] font-bold uppercase tracking-[0.24em] text-brand-muted">
                <tr>
                  <th className="px-6 py-4">Horario</th>
                  <th className="px-6 py-4">Temperatura</th>
                  <th className="px-6 py-4">Umidade</th>
                  <th className="px-6 py-4">Vento</th>
                  <th className="px-6 py-4">Chuva</th>
                  <th className="px-6 py-4">Origem</th>
                  <th className="px-6 py-4">Insight</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-sm text-brand-muted">
                {deferredWeatherList.map((item) => (
                  <tr key={item._id} className="transition hover:bg-white/75">
                    <td className="px-6 py-4 font-mono text-xs">{formatDateTime(item.collected_at)}</td>
                    <td className="px-6 py-4 font-semibold text-brand-dark">{item.temp.toFixed(1)}°C</td>
                    <td className="px-6 py-4">{item.humidity}%</td>
                    <td className="px-6 py-4">{item.wind_speed.toFixed(1)} km/h</td>
                    <td className="px-6 py-4">{item.precipitation.toFixed(1)} mm</td>
                    <td className="px-6 py-4">
                      <span
                        className={`rounded-full px-3 py-1 text-[11px] font-bold uppercase tracking-[0.18em] ${
                          item.insight_source === 'ai'
                            ? 'bg-cyan-50 text-cyan-700 ring-1 ring-cyan-100'
                            : 'bg-slate-100 text-slate-600 ring-1 ring-slate-200'
                        }`}
                      >
                        {item.insight_source === 'ai' ? 'IA' : 'Fallback'}
                      </span>
                    </td>
                    <td className="px-6 py-4 leading-6">{item.insight || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}
