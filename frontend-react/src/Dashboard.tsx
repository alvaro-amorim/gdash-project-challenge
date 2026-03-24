import { startTransition, useDeferredValue, useEffect, useState } from 'react';
import dashboardLogo from './assets/logo.png';
import { API_BASE_URL, requestApi } from './api';
import { CitySearchInput } from './CitySearchInput';
import { InsightSlider } from './InsightSlider';
import { requestOpenMeteoHistory, requestOpenMeteoLive } from './openMeteoFallback';
import { ProfilePanel } from './ProfilePanel';
import { clearVisitSessionId, getVisitSessionId } from './storage';
import type {
  AuthState,
  AuthUser,
  CityOption,
  LiveWeatherData,
  WeatherHistoryPoint,
  WeatherHistoryResponse,
} from './types';
import { WeatherChart } from './WeatherChart';

interface DashboardProps {
  auth: AuthState;
  onAuthChange: (auth: AuthState) => void;
  onLogout: () => void;
}

type RangeFilter = '24h' | '7d' | '30d' | 'custom';

const DEFAULT_LOCATION: CityOption = {
  cityName: 'Juiz de Fora',
  stateName: 'Minas Gerais',
  stateCode: 'MG',
  latitude: -21.7642,
  longitude: -43.3503,
  timezone: 'America/Sao_Paulo',
  displayName: 'Juiz de Fora, MG, Brasil',
};

function formatDateTime(value: string) {
  return new Date(value).toLocaleString('pt-BR');
}

function buildLocationFromUser(user: AuthUser): CityOption {
  if (
    user.preferredCityName &&
    user.preferredLatitude !== null &&
    user.preferredLatitude !== undefined &&
    user.preferredLongitude !== null &&
    user.preferredLongitude !== undefined
  ) {
    return {
      cityName: user.preferredCityName,
      stateName: user.preferredStateName || null,
      stateCode: user.preferredStateCode || null,
      latitude: user.preferredLatitude,
      longitude: user.preferredLongitude,
      timezone: user.preferredTimezone || DEFAULT_LOCATION.timezone,
      displayName: [
        user.preferredCityName,
        user.preferredStateCode || user.preferredStateName || 'Brasil',
        'Brasil',
      ]
        .filter(Boolean)
        .join(', '),
    };
  }

  return DEFAULT_LOCATION;
}

function getWeatherStatus(item: Pick<WeatherHistoryPoint, 'precipitation' | 'temp' | 'wind_speed'>) {
  if (item.precipitation > 0) return 'Piso molhado';
  if (item.temp >= 30) return 'Calor intenso';
  if (item.temp >= 25) return 'Tempo quente';
  if (item.temp <= 15) return 'Frente fria';
  if (item.wind_speed > 20) return 'Vento forte';
  return 'Conforto estável';
}

function isLiveWeatherData(value: LiveWeatherData | WeatherHistoryPoint | null): value is LiveWeatherData {
  return Boolean(value && 'insights' in value && Array.isArray(value.insights));
}

function filterHistory(points: WeatherHistoryPoint[], filter: Exclude<RangeFilter, 'custom'>) {
  if (filter === '30d') return points;

  const latestTimestamp = points.length
    ? new Date(points[points.length - 1].collected_at).getTime()
    : Date.now();
  const windowMs = filter === '24h' ? 24 * 60 * 60 * 1000 : 7 * 24 * 60 * 60 * 1000;

  return points.filter(
    (item) => new Date(item.collected_at).getTime() >= latestTimestamp - windowMs,
  );
}

function RangeChip({
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
      type="button"
      onClick={onClick}
      className={`action-button min-w-[82px] rounded-full px-4 py-3 text-xs uppercase tracking-[0.22em] ${
        active
          ? 'bg-brand-primary text-white shadow-[0_18px_36px_-22px_rgba(12,168,154,0.85)]'
          : 'border border-white/10 bg-white/5 text-white/75 hover:bg-white/10'
      }`}
    >
      {label}
    </button>
  );
}

export function Dashboard({ auth, onAuthChange, onLogout }: DashboardProps) {
  const [selectedLocation, setSelectedLocation] = useState<CityOption>(() =>
    buildLocationFromUser(auth.user),
  );
  const [liveWeather, setLiveWeather] = useState<LiveWeatherData | null>(null);
  const [historyBase, setHistoryBase] = useState<WeatherHistoryPoint[]>([]);
  const [historyData, setHistoryData] = useState<WeatherHistoryPoint[]>([]);
  const [rangeFilter, setRangeFilter] = useState<RangeFilter>('30d');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [showProfile, setShowProfile] = useState(false);
  const [loadingLive, setLoadingLive] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [savingCity, setSavingCity] = useState(false);
  const [cityMessage, setCityMessage] = useState('');
  const [dataError, setDataError] = useState('');
  const deferredHistoryData = useDeferredValue(historyData);

  const locationParams = new URLSearchParams({
    latitude: String(selectedLocation.latitude),
    longitude: String(selectedLocation.longitude),
    cityName: selectedLocation.cityName,
    timezone: selectedLocation.timezone,
  });

  if (selectedLocation.stateName) locationParams.set('stateName', selectedLocation.stateName);
  if (selectedLocation.stateCode) locationParams.set('stateCode', selectedLocation.stateCode);

  const locationQuery = locationParams.toString();
  const latestReading = liveWeather || deferredHistoryData[deferredHistoryData.length - 1] || null;
  const exportParams = new URLSearchParams(locationQuery);
  const exportStart = deferredHistoryData[0]?.collected_at?.slice(0, 10);
  const exportEnd = deferredHistoryData[deferredHistoryData.length - 1]?.collected_at?.slice(0, 10);

  if (exportStart) exportParams.set('startDate', exportStart);
  if (exportEnd) exportParams.set('endDate', exportEnd);

  const exportQuery = exportParams.toString();
  const timelineRows = [...deferredHistoryData].slice(-18).reverse();
  const temperatures = deferredHistoryData.map((item) => item.temp);
  const humidities = deferredHistoryData.map((item) => item.humidity);
  const winds = deferredHistoryData.map((item) => item.wind_speed);
  const rainPoints = deferredHistoryData.map((item) => item.precipitation);
  const avgTemp = temperatures.length
    ? temperatures.reduce((sum, value) => sum + value, 0) / temperatures.length
    : 0;
  const peakHumidity = humidities.length ? Math.max(...humidities) : 0;
  const peakWind = winds.length ? Math.max(...winds) : 0;
  const totalRain = rainPoints.length ? rainPoints.reduce((sum, value) => sum + value, 0) : 0;
  const rainyMoments = rainPoints.filter((value) => value > 0).length;

  useEffect(() => {
    setSelectedLocation(buildLocationFromUser(auth.user));
  }, [auth.user]);

  useEffect(() => {
    const fetchLiveWeather = async () => {
      setLoadingLive(true);
      setDataError('');
      try {
        const response = await requestApi<LiveWeatherData>(`/weather/live?${locationQuery}`, {}, auth.token);
        setLiveWeather(response);
      } catch (requestError) {
        console.error('Backend live weather failed, falling back to browser request.', requestError);

        try {
          const fallbackResponse = await requestOpenMeteoLive(selectedLocation);
          setLiveWeather(fallbackResponse);
          setDataError('');
        } catch (fallbackError) {
          console.error(fallbackError);
          setDataError('Não foi possível carregar a leitura atual desta cidade.');
        }
      } finally {
        setLoadingLive(false);
      }
    };

    fetchLiveWeather().catch(() => undefined);
    const interval = setInterval(() => {
      fetchLiveWeather().catch(() => undefined);
    }, 60000);

    return () => clearInterval(interval);
  }, [auth.token, locationQuery]);

  useEffect(() => {
    const fetchDefaultHistory = async () => {
      setLoadingHistory(true);
      setDataError('');
      try {
        const response = await requestApi<WeatherHistoryResponse>(
          `/weather/history?${locationQuery}&days=30`,
          {},
          auth.token,
        );

        startTransition(() => {
          setHistoryBase(response.points);
          setHistoryData(response.points);
          setRangeFilter('30d');
          setStartDate('');
          setEndDate('');
        });
      } catch (requestError) {
        console.error('Backend history failed, falling back to browser request.', requestError);

        try {
          const fallbackResponse = await requestOpenMeteoHistory(selectedLocation, { days: 30 });
          startTransition(() => {
            setHistoryBase(fallbackResponse.points);
            setHistoryData(fallbackResponse.points);
            setRangeFilter('30d');
            setStartDate('');
            setEndDate('');
          });
          setDataError('');
        } catch (fallbackError) {
          console.error(fallbackError);
          setDataError('Não foi possível carregar o histórico da cidade selecionada.');
        }
      } finally {
        setLoadingHistory(false);
      }
    };

    fetchDefaultHistory().catch(() => undefined);
  }, [auth.token, locationQuery]);

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

    return () => {
      clearInterval(interval);
      sendPresence('end').catch(() => undefined);
    };
  }, [auth.token, showProfile]);

  const handleQuickFilter = (value: Exclude<RangeFilter, 'custom'>) => {
    setRangeFilter(value);
    setStartDate('');
    setEndDate('');
    startTransition(() => {
      setHistoryData(filterHistory(historyBase, value));
    });
  };

  const handleDateFilter = async () => {
    if (!startDate || !endDate) return;

    setLoadingHistory(true);
    setDataError('');

    try {
      const params = new URLSearchParams(locationQuery);
      params.set('startDate', startDate);
      params.set('endDate', endDate);
      const response = await requestApi<WeatherHistoryResponse>(`/weather/history?${params.toString()}`, {}, auth.token);
      startTransition(() => {
        setRangeFilter('custom');
        setHistoryData(response.points);
      });
    } catch (requestError) {
      console.error('Backend custom history failed, falling back to browser request.', requestError);

      try {
        const fallbackResponse = await requestOpenMeteoHistory(selectedLocation, { startDate, endDate });
        startTransition(() => {
          setRangeFilter('custom');
          setHistoryData(fallbackResponse.points);
        });
        setDataError('');
      } catch (fallbackError) {
        console.error(fallbackError);
        setDataError('Não foi possível buscar o recorte solicitado.');
      }
    } finally {
      setLoadingHistory(false);
    }
  };

  const handleCitySelect = async (city: CityOption) => {
    setSelectedLocation(city);
    setSavingCity(true);
    setCityMessage('Salvando a cidade no seu perfil...');

    try {
      const updatedUser = await requestApi<AuthUser>(
        '/auth/me',
        {
          method: 'PATCH',
          body: JSON.stringify({
            preferredCityName: city.cityName,
            preferredStateName: city.stateName,
            preferredStateCode: city.stateCode,
            preferredLatitude: city.latitude,
            preferredLongitude: city.longitude,
            preferredTimezone: city.timezone,
          }),
        },
        auth.token,
      );

      onAuthChange({ ...auth, user: updatedUser });
      setCityMessage('Cidade salva. O painel passa a abrir com esse local por padrão.');
    } catch (requestError) {
      console.error(requestError);
      setCityMessage('Não foi possível salvar a cidade no perfil, mas a visualização local foi atualizada.');
    } finally {
      setSavingCity(false);
    }
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
    <div className="min-h-screen px-4 pb-8 pt-4 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-[1600px] space-y-6">
        <section className="grid gap-6 xl:grid-cols-[310px_minmax(0,1fr)]">
          <aside className="glass-panel-dark relative overflow-hidden p-6 sm:p-7">
            <div className="soft-grid absolute inset-0 opacity-30" />
            <div className="absolute -right-20 top-8 h-40 w-40 rounded-full bg-brand-primary/20 blur-3xl" />
            <div className="absolute -bottom-16 left-8 h-36 w-36 rounded-full bg-brand-accent/15 blur-3xl" />

            <div className="relative z-10 space-y-6">
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-center gap-4">
                  <div className="flex h-14 w-14 items-center justify-center rounded-[22px] border border-white/12 bg-white/10 shadow-[0_16px_40px_-20px_rgba(12,24,40,0.7)]">
                    <img src={dashboardLogo} alt="GDASH Logo" className="h-9 w-9 object-contain" />
                  </div>
                  <div>
                    <p className="section-kicker text-white/60">Painel climático</p>
                    <h1 className="mt-2 font-display text-3xl font-bold text-white">GDASH</h1>
                  </div>
                </div>
                <span className="status-pill border-emerald-400/18 bg-emerald-400/10 text-emerald-100">
                  <span className="halo-dot" />
                  online
                </span>
              </div>

              <div className="rounded-[28px] border border-white/10 bg-white/10 p-5">
                <p className="text-xs uppercase tracking-[0.24em] text-white/50">Operador</p>
                <p className="mt-3 text-lg font-semibold text-white">{auth.user.name}</p>
                <p className="mt-1 text-sm text-white/60">{auth.user.email}</p>
                <div className="mt-4 flex flex-wrap gap-2">
                  <span className="status-pill border-white/10 bg-white/10 text-white/70">
                    {auth.user.role === 'admin' ? 'admin' : 'usuário'}
                  </span>
                  <span className="status-pill border-white/10 bg-white/10 text-white/70">
                    {auth.user.emailVerified ? 'verificado' : 'pendente'}
                  </span>
                </div>
              </div>

              <div className="rounded-[28px] border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.08),rgba(255,255,255,0.04))] p-5">
                <p className="section-kicker text-white/55">Cidade principal</p>
                <p className="mt-3 text-xl font-semibold text-white">{selectedLocation.cityName}</p>
                <p className="mt-1 text-sm text-white/60">
                  {selectedLocation.stateCode || selectedLocation.stateName || 'Brasil'}
                </p>
                <div className="mt-5 grid grid-cols-2 gap-3 text-sm">
                  <div className="rounded-[24px] border border-white/10 bg-white/5 px-4 py-4">
                    <p className="text-[11px] font-bold uppercase tracking-[0.24em] text-white/50">Coleta</p>
                    <p className="mt-3 text-base font-semibold text-white">30 dias</p>
                  </div>
                  <div className="rounded-[24px] border border-white/10 bg-white/5 px-4 py-4">
                    <p className="text-[11px] font-bold uppercase tracking-[0.24em] text-white/50">Atualização</p>
                    <p className="mt-3 text-base font-semibold text-white">20 min</p>
                  </div>
                </div>
              </div>

              <div className="space-y-3">
                <button
                  type="button"
                  onClick={() => setShowProfile((previousValue) => !previousValue)}
                  className="dark-button w-full justify-between rounded-[22px] px-5 py-4"
                >
                  <span>{showProfile ? 'Fechar perfil' : 'Abrir perfil'}</span>
                  <span className="text-white/45">{showProfile ? 'close' : 'open'}</span>
                </button>
                <button
                  type="button"
                  onClick={handleLogoutClick}
                  className="dark-button w-full justify-between rounded-[22px] border-rose-400/20 bg-rose-400/10 px-5 py-4 text-rose-50 hover:bg-rose-400/15"
                >
                  <span>Sair da sessão</span>
                  <span className="text-rose-100/60">exit</span>
                </button>
              </div>

              {cityMessage ? (
                <div className="rounded-[24px] border border-white/10 bg-white/10 px-4 py-4 text-sm leading-6 text-white/70">
                  {cityMessage}
                </div>
              ) : null}

              {dataError ? (
                <div className="rounded-[24px] border border-rose-300/20 bg-rose-400/10 px-4 py-4 text-sm leading-6 text-rose-50">
                  {dataError}
                </div>
              ) : null}
            </div>
          </aside>

          <div className="space-y-6">
            <section className="glass-panel-dark relative p-5 sm:p-6">
              <div className="soft-grid absolute inset-0 opacity-20" />
              <div className="relative z-10 space-y-5">
                <div className="flex flex-col gap-4 2xl:flex-row 2xl:items-end 2xl:justify-between">
                  <div>
                    <p className="section-kicker text-white/55">Filtros do painel</p>
                    <h2 className="mt-3 font-display text-3xl font-bold text-white">
                      Escolha a cidade e atualize a leitura do painel em tempo real.
                    </h2>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <RangeChip active={rangeFilter === '24h'} label="24h" onClick={() => handleQuickFilter('24h')} />
                    <RangeChip active={rangeFilter === '7d'} label="7d" onClick={() => handleQuickFilter('7d')} />
                    <RangeChip active={rangeFilter === '30d'} label="30d" onClick={() => handleQuickFilter('30d')} />
                  </div>
                </div>

                <div className="grid gap-3 xl:grid-cols-[1.25fr_0.85fr_0.85fr_auto_auto_auto]">
                  <CitySearchInput
                    key={selectedLocation.displayName}
                    selectedLabel={selectedLocation.displayName}
                    onSelect={handleCitySelect}
                    disabled={savingCity}
                  />
                  <input
                    type="date"
                    className="field-shell min-w-0"
                    value={startDate}
                    onChange={(event) => setStartDate(event.target.value)}
                  />
                  <input
                    type="date"
                    className="field-shell min-w-0"
                    value={endDate}
                    onChange={(event) => setEndDate(event.target.value)}
                  />
                  <button
                    type="button"
                    onClick={handleDateFilter}
                    className={`primary-button rounded-[22px] px-5 py-3.5 ${
                      rangeFilter === 'custom' ? 'bg-brand-secondary hover:bg-brand-secondary' : ''
                    }`}
                  >
                    Buscar
                  </button>
                  <a
                    href={`${API_BASE_URL}/weather/export/csv?${exportQuery}`}
                    target="_blank"
                    rel="noreferrer"
                    className="secondary-button rounded-[22px] px-5 py-3.5"
                  >
                    CSV
                  </a>
                  <a
                    href={`${API_BASE_URL}/weather/export/xlsx?${exportQuery}`}
                    target="_blank"
                    rel="noreferrer"
                    className="secondary-button rounded-[22px] px-5 py-3.5"
                  >
                    Excel
                  </a>
                </div>
              </div>
            </section>

            {showProfile ? <ProfilePanel auth={auth} onAuthChange={onAuthChange} /> : null}

            {latestReading ? (
              <>
                <section className="grid gap-6 2xl:grid-cols-[minmax(0,1.55fr)_360px]">
                  <article className="glass-panel-dark relative overflow-hidden p-6 sm:p-8">
                    <div className="absolute -left-16 top-16 h-44 w-44 rounded-full bg-brand-primary/20 blur-3xl" />
                    <div className="absolute bottom-0 right-0 h-52 w-52 rounded-full bg-brand-accent/16 blur-3xl" />
                    <div className="soft-grid absolute inset-0 opacity-20" />

                    <div className="relative z-10">
                      <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
                        <div>
                          <p className="section-kicker text-white/55">
                            {rangeFilter === 'custom' ? 'Resumo do período' : 'Panorama da cidade'}
                          </p>
                          <h2 className="mt-3 max-w-2xl font-display text-3xl font-bold text-white sm:text-[2.65rem] sm:leading-[1.05]">
                            A leitura principal acompanha a cidade selecionada, com dados recentes e contexto local.
                          </h2>
                        </div>

                        <div className="grid gap-2 text-right text-sm text-white/70">
                          <span>Atualizado em {formatDateTime(latestReading.collected_at)}</span>
                          <span>
                            {isLiveWeatherData(latestReading) && latestReading.ai_generated_at
                              ? `Atualizado em ${formatDateTime(latestReading.ai_generated_at)}`
                              : 'Leitura sincronizada'}
                          </span>
                        </div>
                      </div>

                      <div className="mt-8 grid gap-6 xl:grid-cols-[260px_minmax(0,1fr)]">
                        <div className="rounded-[28px] border border-white/10 bg-white/10 p-5">
                          <p className="text-xs uppercase tracking-[0.24em] text-white/50">Agora em</p>
                          <p className="mt-3 font-display text-6xl font-bold text-white">
                            {latestReading.temp.toFixed(1)}
                          </p>
                          <div className="mt-2 flex items-center gap-2 text-white/70">
                            <span className="text-xl">°C</span>
                            <span>{selectedLocation.displayName}</span>
                          </div>
                          <div className="mt-6 flex flex-wrap gap-2">
                            <span className="status-pill border-white/10 bg-white/10 text-white/70">
                              {latestReading.is_day === 1 ? 'período diurno' : 'período noturno'}
                            </span>
                            <span className="status-pill border-white/10 bg-white/10 text-white/70">
                              {getWeatherStatus(latestReading)}
                            </span>
                          </div>
                        </div>

                        <div className="rounded-[30px] border border-white/10 bg-white/10 p-6">
                          <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
                            <div>
                              <p className="text-xs uppercase tracking-[0.22em] text-white/50">
                                Leituras em destaque
                              </p>
                              <p className="mt-2 text-sm text-white/70">
                                Três observações curtas para destacar o que mais importa agora.
                              </p>
                            </div>

                            {isLiveWeatherData(latestReading) ? (
                              <div className="flex flex-wrap gap-2">
                                <span className="status-pill border-white/10 bg-white/10 text-white/70">
                                  {latestReading.insight_source === 'ai' ? 'síntese automática' : 'base local'}
                                </span>
                                <span className="status-pill border-white/10 bg-white/10 text-white/70">
                                  {latestReading.has_active_viewer ? 'usuário ativo' : 'sem usuário ativo'}
                                </span>
                              </div>
                            ) : null}
                          </div>

                          <InsightSlider
                            key={
                              isLiveWeatherData(latestReading)
                                ? latestReading.insights.join('|')
                                : 'history-insights'
                            }
                            insights={
                              isLiveWeatherData(latestReading)
                                ? latestReading.insights
                                : ['Histórico carregado para o período selecionado.']
                            }
                          />
                        </div>
                      </div>
                    </div>
                  </article>

                  <div className="space-y-4">
                    <article className="glass-panel p-6">
                      <p className="section-kicker mb-3">Painel de leitura</p>
                      <h3 className="font-display text-2xl font-bold text-brand-dark">Leitura operacional</h3>
                      <div className="mt-5 space-y-3">
                        {[
                          ['Status atual', getWeatherStatus(latestReading)],
                          ['Umidade', `${latestReading.humidity.toFixed(0)}%`],
                          ['Vento', `${latestReading.wind_speed.toFixed(1)} km/h`],
                          ['Precipitação', `${latestReading.precipitation.toFixed(1)} mm`],
                        ].map(([label, value]) => (
                          <div
                            key={label}
                            className="flex items-center justify-between rounded-[22px] border border-slate-200/75 bg-white/70 px-4 py-4"
                          >
                            <span className="text-xs font-bold uppercase tracking-[0.22em] text-brand-muted">
                              {label}
                            </span>
                            <span className="text-sm font-semibold text-brand-dark">{value}</span>
                          </div>
                        ))}
                      </div>
                    </article>

                    <article className="glass-panel p-6">
                      <p className="section-kicker mb-3">Período atual</p>
                      <h3 className="font-display text-2xl font-bold text-brand-dark">Resumo do recorte</h3>
                      <div className="mt-5 grid grid-cols-2 gap-3">
                        {[
                          ['Registros', `${deferredHistoryData.length}`],
                          ['Pico de umidade', `${peakHumidity.toFixed(0)}%`],
                          ['Pico de vento', `${peakWind.toFixed(1)} km/h`],
                          ['Chuva acumulada', `${totalRain.toFixed(1)} mm`],
                        ].map(([label, value]) => (
                          <div key={label} className="rounded-[22px] border border-slate-200/75 bg-white/70 px-4 py-4">
                            <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-brand-muted">
                              {label}
                            </p>
                            <p className="mt-3 font-display text-2xl font-bold text-brand-dark">{value}</p>
                          </div>
                        ))}
                      </div>
                    </article>
                  </div>
                </section>

                <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                  <div className="metric-panel overflow-hidden p-5">
                    <div className="absolute inset-x-5 top-0 h-1 rounded-b-full bg-[linear-gradient(90deg,#f08a32,#ffb36a)]" />
                    <p className="section-kicker mb-3">Temperatura média</p>
                    <p className="font-display text-3xl font-bold text-brand-dark">{avgTemp.toFixed(1)} °C</p>
                    <p className="mt-3 text-sm leading-6 text-brand-muted">
                      Média do período exibido para comparar a leitura atual com a tendência recente.
                    </p>
                  </div>
                  <div className="metric-panel overflow-hidden p-5">
                    <div className="absolute inset-x-5 top-0 h-1 rounded-b-full bg-[linear-gradient(90deg,#0ca89a,#61d0bf)]" />
                    <p className="section-kicker mb-3">Momentos de chuva</p>
                    <p className="font-display text-3xl font-bold text-brand-dark">{rainyMoments}</p>
                    <p className="mt-3 text-sm leading-6 text-brand-muted">
                      Quantidade de registros com precipitação acima de zero no recorte atual.
                    </p>
                  </div>
                  <div className="metric-panel overflow-hidden p-5">
                    <div className="absolute inset-x-5 top-0 h-1 rounded-b-full bg-[linear-gradient(90deg,#153a59,#2873a6)]" />
                    <p className="section-kicker mb-3">Cidade ativa</p>
                    <p className="font-display text-3xl font-bold text-brand-dark">{selectedLocation.cityName}</p>
                    <p className="mt-3 text-sm leading-6 text-brand-muted">
                      Cada acesso abre com os últimos 30 dias da cidade salva no perfil.
                    </p>
                  </div>
                  <div className="metric-panel overflow-hidden p-5">
                    <div className="absolute inset-x-5 top-0 h-1 rounded-b-full bg-[linear-gradient(90deg,#705cf6,#9d94ff)]" />
                    <p className="section-kicker mb-3">Pico de vento</p>
                    <p className="font-display text-3xl font-bold text-brand-dark">{peakWind.toFixed(1)} km/h</p>
                    <p className="mt-3 text-sm leading-6 text-brand-muted">
                      Maior valor observado no recorte atual para leitura rápida de risco.
                    </p>
                  </div>
                </section>
              </>
            ) : null}

            <WeatherChart
              data={deferredHistoryData}
              cityLabel={selectedLocation.displayName}
              loading={loadingHistory || loadingLive}
            />

            <section className="glass-panel overflow-hidden">
              <div className="flex flex-col gap-4 border-b border-slate-200/80 px-5 py-5 sm:flex-row sm:items-end sm:justify-between sm:px-7">
                <div>
                  <p className="section-kicker mb-2">Linha do tempo</p>
                  <h3 className="font-display text-2xl font-bold text-brand-dark">
                    Momentos mais recentes do período filtrado
                  </h3>
                  <p className="mt-2 max-w-2xl text-sm leading-6 text-brand-muted">
                    Os registros abaixo ajudam a revisar rapidamente as mudanças mais recentes do período.
                  </p>
                </div>
                <span className="status-pill self-start border-slate-200 bg-white/85 text-brand-muted">
                  {timelineRows.length} amostras
                </span>
              </div>

              <div className="grid gap-4 p-4 lg:hidden">
                {timelineRows.map((item) => (
                  <article key={item.collected_at} className="metric-panel p-5">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <p className="text-sm font-semibold text-brand-dark">{formatDateTime(item.collected_at)}</p>
                        <p className="mt-1 text-xs uppercase tracking-[0.18em] text-brand-muted">
                          {item.is_day === 1 ? 'Dia' : 'Noite'}
                        </p>
                      </div>
                      <span className="status-pill border-slate-200 bg-white/80 text-brand-muted">
                        {getWeatherStatus(item)}
                      </span>
                    </div>

                    <div className="mt-5 grid grid-cols-2 gap-3">
                      {[
                        ['Temperatura', `${item.temp.toFixed(1)} °C`],
                        ['Umidade', `${item.humidity.toFixed(0)}%`],
                        ['Vento', `${item.wind_speed.toFixed(1)} km/h`],
                        ['Chuva', `${item.precipitation.toFixed(1)} mm`],
                      ].map(([label, value]) => (
                        <div key={label} className="rounded-[20px] border border-slate-200/70 bg-white/75 px-4 py-3">
                          <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-brand-muted">
                            {label}
                          </p>
                          <p className="mt-2 text-sm font-semibold text-brand-dark">{value}</p>
                        </div>
                      ))}
                    </div>
                  </article>
                ))}
              </div>

              <div className="hidden overflow-x-auto lg:block">
                <table className="w-full min-w-[880px] border-collapse">
                  <thead className="bg-[#f2ede5]/85 text-left text-[11px] font-bold uppercase tracking-[0.24em] text-brand-muted">
                    <tr>
                      <th className="px-6 py-4">Horário</th>
                      <th className="px-6 py-4">Temperatura</th>
                      <th className="px-6 py-4">Umidade</th>
                      <th className="px-6 py-4">Vento</th>
                      <th className="px-6 py-4">Chuva</th>
                      <th className="px-6 py-4">Período</th>
                      <th className="px-6 py-4">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-sm text-brand-muted">
                    {timelineRows.map((item) => (
                      <tr key={item.collected_at} className="transition hover:bg-white/75">
                        <td className="px-6 py-4 font-mono text-xs">{formatDateTime(item.collected_at)}</td>
                        <td className="px-6 py-4 font-semibold text-brand-dark">{item.temp.toFixed(1)} °C</td>
                        <td className="px-6 py-4">{item.humidity.toFixed(0)}%</td>
                        <td className="px-6 py-4">{item.wind_speed.toFixed(1)} km/h</td>
                        <td className="px-6 py-4">{item.precipitation.toFixed(1)} mm</td>
                        <td className="px-6 py-4">{item.is_day === 1 ? 'Dia' : 'Noite'}</td>
                        <td className="px-6 py-4">
                          <span className="status-pill border-slate-200 bg-white/80 text-brand-muted">
                            {getWeatherStatus(item)}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </div>
        </section>
      </div>
    </div>
  );
}
