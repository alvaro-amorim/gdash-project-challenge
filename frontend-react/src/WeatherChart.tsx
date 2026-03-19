import {
  Area,
  Bar,
  Brush,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { WeatherHistoryPoint } from './types';

interface WeatherChartProps {
  data: WeatherHistoryPoint[];
  cityLabel: string;
  loading?: boolean;
}

function formatAxisLabel(value: string, resolution: 'hourly' | '3h' | 'daily') {
  const date = new Date(value);

  if (resolution === 'daily') {
    return date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
  }

  return date.toLocaleTimeString('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatTooltipLabel(value: string, resolution: 'hourly' | '3h' | 'daily') {
  const date = new Date(value);
  return resolution === 'daily'
    ? date.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit' })
    : date.toLocaleString('pt-BR');
}

function groupByDay(data: WeatherHistoryPoint[]) {
  const grouped = new Map<string, WeatherHistoryPoint[]>();

  for (const item of data) {
    const key = item.collected_at.slice(0, 10);
    const bucket = grouped.get(key) || [];
    bucket.push(item);
    grouped.set(key, bucket);
  }

  return Array.from(grouped.entries()).map(([key, items]) => {
    const temps = items.map((item) => item.temp);
    const humidities = items.map((item) => item.humidity);
    const winds = items.map((item) => item.wind_speed);
    const precipitations = items.map((item) => item.precipitation);
    const dayVotes = items.filter((item) => item.is_day === 1).length;

    return {
      collected_at: `${key}T12:00:00`,
      label: key,
      temp: temps.reduce((sum, value) => sum + value, 0) / temps.length,
      temp_min: Math.min(...temps),
      temp_max: Math.max(...temps),
      humidity: humidities.reduce((sum, value) => sum + value, 0) / humidities.length,
      wind_speed: Math.max(...winds),
      precipitation: precipitations.reduce((sum, value) => sum + value, 0),
      is_day: dayVotes >= items.length / 2 ? 1 : 0,
    };
  });
}

function groupByThreeHours(data: WeatherHistoryPoint[]) {
  const grouped = new Map<string, WeatherHistoryPoint[]>();

  for (const item of data) {
    const date = new Date(item.collected_at);
    date.setMinutes(0, 0, 0);
    date.setHours(Math.floor(date.getHours() / 3) * 3);
    const key = date.toISOString();
    const bucket = grouped.get(key) || [];
    bucket.push(item);
    grouped.set(key, bucket);
  }

  return Array.from(grouped.entries()).map(([key, items]) => {
    const temps = items.map((item) => item.temp);
    const humidities = items.map((item) => item.humidity);
    const winds = items.map((item) => item.wind_speed);
    const precipitations = items.map((item) => item.precipitation);
    const dayVotes = items.filter((item) => item.is_day === 1).length;

    return {
      collected_at: key,
      label: key,
      temp: temps.reduce((sum, value) => sum + value, 0) / temps.length,
      humidity: humidities.reduce((sum, value) => sum + value, 0) / humidities.length,
      wind_speed: Math.max(...winds),
      precipitation: precipitations.reduce((sum, value) => sum + value, 0),
      is_day: dayVotes >= items.length / 2 ? 1 : 0,
    };
  });
}

function toChartData(data: WeatherHistoryPoint[]) {
  if (data.length > 360) {
    return {
      resolution: 'daily' as const,
      points: groupByDay(data),
    };
  }

  if (data.length > 120) {
    return {
      resolution: '3h' as const,
      points: groupByThreeHours(data),
    };
  }

  return {
    resolution: 'hourly' as const,
    points: data.map((item) => ({
      ...item,
      label: item.collected_at,
    })),
  };
}

function CustomTooltip({
  active,
  payload,
  label,
  resolution,
}: {
  active?: boolean;
  payload?: Array<{ color: string; name: string; value: number; unit?: string }>;
  label?: string;
  resolution: 'hourly' | '3h' | 'daily';
}) {
  if (!active || !payload?.length || !label) {
    return null;
  }

  return (
    <div className="rounded-[22px] border border-slate-200/80 bg-white/95 p-4 shadow-[0_20px_45px_-25px_rgba(15,23,42,0.35)] backdrop-blur-xl">
      <p className="mb-3 font-mono text-[11px] uppercase tracking-[0.22em] text-brand-muted">
        {formatTooltipLabel(label, resolution)}
      </p>
      <div className="space-y-2">
        {payload.map((entry) => (
          <div key={`${entry.name}-${entry.color}`} className="flex items-center justify-between gap-5 text-sm">
            <div className="flex items-center gap-2 text-brand-muted">
              <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: entry.color }} />
              <span>{entry.name}</span>
            </div>
            <span className="font-semibold text-brand-dark">
              {Number(entry.value).toFixed(1)}
              {entry.unit || ''}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function WeatherChart({ data, cityLabel, loading = false }: WeatherChartProps) {
  const normalizedData = [...data].sort(
    (left, right) => new Date(left.collected_at).getTime() - new Date(right.collected_at).getTime(),
  );
  const { points, resolution } = toChartData(normalizedData);

  const temperatures = points.map((item) => item.temp);
  const humidities = points.map((item) => item.humidity);
  const winds = points.map((item) => item.wind_speed);
  const rain = points.map((item) => item.precipitation);

  const minTemp = temperatures.length ? Math.min(...temperatures) : 0;
  const maxTemp = temperatures.length ? Math.max(...temperatures) : 0;
  const avgHumidity = humidities.length
    ? humidities.reduce((sum, value) => sum + value, 0) / humidities.length
    : 0;
  const peakWind = winds.length ? Math.max(...winds) : 0;
  const totalRain = rain.length ? rain.reduce((sum, value) => sum + value, 0) : 0;

  return (
    <section className="glass-panel overflow-hidden p-5 sm:p-7">
      <div className="mb-6 flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <p className="section-kicker mb-2">Inteligencia visual</p>
          <h3 className="font-display text-2xl font-bold text-brand-dark">
            Tendencias climaticas com leitura mais rapida e profissional.
          </h3>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-brand-muted">
            O painel resume {cityLabel} em uma camada principal de temperatura e umidade e outra
            para chuva e vento, com agregacao automatica para manter a navegacao leve.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-5">
          {[
            ['Resolucao', resolution === 'daily' ? 'Diaria' : resolution === '3h' ? '3 horas' : 'Horaria'],
            ['Amplitude', `${(maxTemp - minTemp).toFixed(1)} C`],
            ['Umidade media', `${avgHumidity.toFixed(0)}%`],
            ['Pico de vento', `${peakWind.toFixed(1)} km/h`],
            ['Chuva total', `${totalRain.toFixed(1)} mm`],
          ].map(([label, value]) => (
            <div key={label} className="metric-panel min-w-[120px] px-4 py-3">
              <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-brand-muted">
                {label}
              </p>
              <p className="mt-2 font-display text-xl font-bold text-brand-dark">{value}</p>
            </div>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="flex h-[420px] items-center justify-center text-sm text-brand-muted">
          Carregando historico da cidade selecionada...
        </div>
      ) : (
        <div className="space-y-5">
          <div className="h-[320px] sm:h-[360px] xl:h-[400px]">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={points} syncId="weather-intelligence" margin={{ top: 12, right: 14, left: -18, bottom: 12 }}>
                <defs>
                  <linearGradient id="humidityFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#0f9f8f" stopOpacity={0.25} />
                    <stop offset="95%" stopColor="#0f9f8f" stopOpacity={0.03} />
                  </linearGradient>
                </defs>

                <CartesianGrid vertical={false} strokeDasharray="4 6" stroke="#d7e2ea" />
                <ReferenceLine yAxisId="temp" y={24} stroke="#f59e0b" strokeDasharray="4 6" strokeOpacity={0.3} />

                <XAxis
                  dataKey="collected_at"
                  tickFormatter={(value) => formatAxisLabel(value, resolution)}
                  stroke="#7a8ca1"
                  tick={{ fontSize: 11, fill: '#5f7288' }}
                  tickMargin={10}
                  minTickGap={24}
                  axisLine={false}
                  tickLine={false}
                />

                <YAxis
                  yAxisId="temp"
                  stroke="#7a8ca1"
                  tick={{ fontSize: 11, fill: '#5f7288' }}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(value) => `${value} C`}
                  width={48}
                />

                <YAxis
                  yAxisId="humidity"
                  orientation="right"
                  domain={[0, 100]}
                  stroke="#7a8ca1"
                  tick={{ fontSize: 11, fill: '#5f7288' }}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(value) => `${value}%`}
                  width={42}
                />

                <Tooltip
                  content={<CustomTooltip resolution={resolution} />}
                  cursor={{ stroke: '#94a3b8', strokeWidth: 1, strokeDasharray: '4 5', opacity: 0.4 }}
                />
                <Legend
                  wrapperStyle={{ paddingTop: '20px' }}
                  iconType="circle"
                  formatter={(value) => <span style={{ color: '#233345' }}>{value}</span>}
                />

                <Area
                  yAxisId="humidity"
                  type="monotone"
                  dataKey="humidity"
                  name="Umidade"
                  unit="%"
                  stroke="#0f9f8f"
                  fill="url(#humidityFill)"
                  strokeWidth={2.5}
                  activeDot={{ r: 5, fill: '#0b7f73', strokeWidth: 0 }}
                />

                <Line
                  yAxisId="temp"
                  type="monotone"
                  dataKey="temp"
                  name="Temperatura media"
                  unit=" C"
                  stroke="#f97316"
                  strokeWidth={3}
                  dot={false}
                  activeDot={{ r: 6, fill: '#ea580c', strokeWidth: 0 }}
                />

                {resolution === 'daily' ? (
                  <>
                    <Line
                      yAxisId="temp"
                      type="monotone"
                      dataKey="temp_max"
                      name="Temperatura maxima"
                      unit=" C"
                      stroke="#fb923c"
                      strokeWidth={1.8}
                      dot={false}
                      strokeDasharray="6 5"
                    />
                    <Line
                      yAxisId="temp"
                      type="monotone"
                      dataKey="temp_min"
                      name="Temperatura minima"
                      unit=" C"
                      stroke="#fdba74"
                      strokeWidth={1.8}
                      dot={false}
                      strokeDasharray="4 4"
                    />
                  </>
                ) : null}
              </ComposedChart>
            </ResponsiveContainer>
          </div>

          <div className="h-[190px] sm:h-[210px]">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={points} syncId="weather-intelligence" margin={{ top: 10, right: 14, left: -18, bottom: 0 }}>
                <defs>
                  <linearGradient id="rainFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#2f6fed" stopOpacity={0.85} />
                    <stop offset="100%" stopColor="#6ba4ff" stopOpacity={0.28} />
                  </linearGradient>
                </defs>

                <CartesianGrid vertical={false} strokeDasharray="4 6" stroke="#d7e2ea" />

                <XAxis
                  dataKey="collected_at"
                  tickFormatter={(value) => formatAxisLabel(value, resolution)}
                  stroke="#7a8ca1"
                  tick={{ fontSize: 11, fill: '#5f7288' }}
                  tickMargin={10}
                  minTickGap={24}
                  axisLine={false}
                  tickLine={false}
                />

                <YAxis
                  yAxisId="rain"
                  stroke="#7a8ca1"
                  tick={{ fontSize: 11, fill: '#5f7288' }}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(value) => `${value} mm`}
                  width={48}
                />

                <YAxis
                  yAxisId="wind"
                  orientation="right"
                  stroke="#7a8ca1"
                  tick={{ fontSize: 11, fill: '#5f7288' }}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(value) => `${value} km/h`}
                  width={58}
                />

                <Tooltip
                  content={<CustomTooltip resolution={resolution} />}
                  cursor={{ stroke: '#94a3b8', strokeWidth: 1, strokeDasharray: '4 5', opacity: 0.4 }}
                />

                <Bar
                  yAxisId="rain"
                  dataKey="precipitation"
                  name="Chuva"
                  unit=" mm"
                  barSize={resolution === 'daily' ? 18 : 10}
                  fill="url(#rainFill)"
                  radius={[10, 10, 0, 0]}
                />

                <Line
                  yAxisId="wind"
                  type="monotone"
                  dataKey="wind_speed"
                  name="Vento"
                  unit=" km/h"
                  stroke="#7c6cff"
                  strokeWidth={2.5}
                  dot={false}
                  activeDot={{ r: 5, fill: '#6956ff', strokeWidth: 0 }}
                />

                <Brush
                  dataKey="collected_at"
                  height={22}
                  stroke="#0f9f8f"
                  travellerWidth={10}
                  tickFormatter={(value) => formatAxisLabel(value, resolution)}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </section>
  );
}
