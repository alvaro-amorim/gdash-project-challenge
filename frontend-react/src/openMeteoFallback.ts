import type { CityOption, LiveWeatherData, WeatherHistoryPoint, WeatherHistoryResponse } from './types';

type HistoryRequestOptions = {
  startDate?: string;
  endDate?: string;
  days?: number;
};

const LIVE_FIELDS =
  'temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,wind_speed_10m,is_day';
const DAILY_FIELDS = 'temperature_2m_max,temperature_2m_min,precipitation_sum';
const HOURLY_FIELDS = 'temperature_2m,relative_humidity_2m,precipitation,wind_speed_10m,is_day';

function toNumber(value: unknown, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function formatMetric(value: unknown) {
  return toNumber(value).toFixed(1).replace('.0', '');
}

function toDateString(date: Date) {
  return date.toISOString().slice(0, 10);
}

function buildFallbackInsights(location: CityOption, current: Record<string, unknown>) {
  const temp = toNumber(current.temperature_2m);
  const humidity = toNumber(current.relative_humidity_2m);
  const wind = toNumber(current.wind_speed_10m);
  const rain = toNumber(current.precipitation);
  const isDay = toNumber(current.is_day) === 1;
  const insights: string[] = [];

  const addInsight = (value: string) => {
    if (!insights.includes(value)) {
      insights.push(value);
    }
  };

  if (rain > 0) {
    addInsight(`Chuva: ${location.cityName} tem ${formatMetric(rain)} mm neste momento; vale redobrar a atencao.`);
  } else if (temp >= 30) {
    addInsight(`Calor: ${location.cityName} opera com ${formatMetric(temp)} C e pede hidratacao reforcada.`);
  } else if (temp <= 15) {
    addInsight(`Frio: ${location.cityName} marca ${formatMetric(temp)} C e pede leitura mais cautelosa.`);
  } else {
    addInsight(`Estavel: ${location.cityName} segue com ${formatMetric(temp)} C e leitura operacional consistente.`);
  }

  if (humidity >= 85) {
    addInsight(`Umidade: ${formatMetric(humidity)}% indica ar mais pesado e maior sensacao de abafamento.`);
  } else if (humidity <= 35) {
    addInsight(`Umidade: ${formatMetric(humidity)}% aponta ar seco e necessidade de hidratacao.`);
  } else {
    addInsight(`Umidade: ${formatMetric(humidity)}% mantem uma faixa moderada para a cidade.`);
  }

  if (wind >= 20) {
    addInsight(`Vento: ${formatMetric(wind)} km/h pode afetar deslocamentos e areas expostas.`);
  } else {
    addInsight(
      isDay
        ? 'Periodo diurno com vento controlado favorece uma leitura mais previsivel.'
        : 'Periodo noturno com vento controlado favorece uma janela mais tranquila.',
    );
  }

  return insights.slice(0, 3);
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    headers: {
      Accept: 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(`Open-Meteo request failed with status ${response.status}`);
  }

  return (await response.json()) as T;
}

export async function requestOpenMeteoLive(location: CityOption): Promise<LiveWeatherData> {
  const url = new URL('https://api.open-meteo.com/v1/forecast');
  url.searchParams.set('latitude', String(location.latitude));
  url.searchParams.set('longitude', String(location.longitude));
  url.searchParams.set('current', LIVE_FIELDS);
  url.searchParams.set('daily', DAILY_FIELDS);
  url.searchParams.set('forecast_days', '1');
  url.searchParams.set('timezone', location.timezone);

  const data = await fetchJson<Record<string, any>>(url.toString());
  const current = data.current || {};
  const insights = buildFallbackInsights(location, current);

  return {
    ...location,
    temp: toNumber(current.temperature_2m),
    humidity: toNumber(current.relative_humidity_2m),
    wind_speed: toNumber(current.wind_speed_10m),
    precipitation: toNumber(current.precipitation),
    is_day: toNumber(current.is_day),
    collected_at: current.time ? String(current.time) : new Date().toISOString(),
    insight: insights[0] || '',
    insights,
    insight_source: 'fallback',
    has_active_viewer: false,
    ai_generated_at: null,
  };
}

export async function requestOpenMeteoHistory(
  location: CityOption,
  options: HistoryRequestOptions = {},
): Promise<WeatherHistoryResponse> {
  const endDate = options.endDate || toDateString(new Date());
  const startDate =
    options.startDate ||
    toDateString(new Date(Date.now() - (options.days || 30) * 24 * 60 * 60 * 1000));

  const url = new URL('https://archive-api.open-meteo.com/v1/archive');
  url.searchParams.set('latitude', String(location.latitude));
  url.searchParams.set('longitude', String(location.longitude));
  url.searchParams.set('start_date', startDate);
  url.searchParams.set('end_date', endDate);
  url.searchParams.set('hourly', HOURLY_FIELDS);
  url.searchParams.set('timezone', location.timezone);

  const data = await fetchJson<Record<string, any>>(url.toString());
  const hourly = data.hourly || {};
  const times = Array.isArray(hourly.time) ? hourly.time : [];

  const points: WeatherHistoryPoint[] = times.map((collectedAt: string, index: number) => ({
    collected_at: collectedAt,
    temp: toNumber(hourly.temperature_2m?.[index]),
    humidity: toNumber(hourly.relative_humidity_2m?.[index]),
    wind_speed: toNumber(hourly.wind_speed_10m?.[index]),
    precipitation: toNumber(hourly.precipitation?.[index]),
    is_day: toNumber(hourly.is_day?.[index]),
  }));

  return {
    location,
    range: {
      startDate,
      endDate,
      pointCount: points.length,
    },
    points,
  };
}
