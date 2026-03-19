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
import type { WeatherData } from './types';

interface ChartProps {
  data: WeatherData[];
}

function formatTimestamp(value: string) {
  return new Date(value).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  });
}

function CustomTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ color: string; name: string; value: number; unit?: string }>;
  label?: string;
}) {
  if (!active || !payload?.length || !label) {
    return null;
  }

  return (
    <div className="rounded-[22px] border border-slate-200/80 bg-white/95 p-4 shadow-[0_20px_45px_-25px_rgba(15,23,42,0.35)] backdrop-blur-xl">
      <p className="mb-3 font-mono text-[11px] uppercase tracking-[0.22em] text-brand-muted">
        {new Date(label).toLocaleString()}
      </p>
      <div className="space-y-2">
        {payload.map((entry) => (
          <div key={`${entry.name}-${entry.color}`} className="flex items-center justify-between gap-5 text-sm">
            <div className="flex items-center gap-2 text-brand-muted">
              <span
                className="h-2.5 w-2.5 rounded-full"
                style={{ backgroundColor: entry.color }}
              />
              <span>{entry.name}</span>
            </div>
            <span className="font-semibold text-brand-dark">
              {entry.value}
              {entry.unit || ''}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function WeatherChart({ data }: ChartProps) {
  const chartData = [...data].reverse();
  const temperatures = chartData.map((item) => item.temp);
  const humidities = chartData.map((item) => item.humidity);
  const windSpeeds = chartData.map((item) => item.wind_speed);

  const minTemp = temperatures.length ? Math.min(...temperatures) : 0;
  const maxTemp = temperatures.length ? Math.max(...temperatures) : 0;
  const avgHumidity = humidities.length
    ? Math.round(humidities.reduce((sum, value) => sum + value, 0) / humidities.length)
    : 0;
  const peakWind = windSpeeds.length ? Math.max(...windSpeeds) : 0;

  return (
    <section className="glass-panel overflow-hidden p-5 sm:p-7">
      <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="section-kicker mb-2">Observabilidade ao vivo</p>
          <h3 className="font-display text-2xl font-bold text-brand-dark">
            Tendencias climaticas sem travar a leitura.
          </h3>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-brand-muted">
            O grafico acompanha o historico recente com foco em temperatura, umidade e vento,
            mantendo a interacao leve mesmo com polling continuo.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[
            ['Min', `${minTemp.toFixed(1)}°C`],
            ['Max', `${maxTemp.toFixed(1)}°C`],
            ['Umidade media', `${avgHumidity}%`],
            ['Pico de vento', `${peakWind.toFixed(1)} km/h`],
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

      <div className="h-[340px] sm:h-[400px] xl:h-[460px]">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={chartData} margin={{ top: 16, right: 8, left: -18, bottom: 14 }}>
            <defs>
              <linearGradient id="humidityFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#0f9f8f" stopOpacity={0.22} />
                <stop offset="95%" stopColor="#0f9f8f" stopOpacity={0.02} />
              </linearGradient>
              <linearGradient id="windFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#7c6cff" stopOpacity={0.42} />
                <stop offset="100%" stopColor="#7c6cff" stopOpacity={0.10} />
              </linearGradient>
            </defs>

            <CartesianGrid vertical={false} strokeDasharray="4 6" stroke="#d7e2ea" />
            <ReferenceLine yAxisId="temp" y={24} stroke="#f59e0b" strokeDasharray="4 6" strokeOpacity={0.35} />

            <XAxis
              dataKey="collected_at"
              tickFormatter={formatTimestamp}
              stroke="#7a8ca1"
              tick={{ fontSize: 11, fill: '#5f7288' }}
              tickMargin={10}
              minTickGap={26}
              axisLine={false}
              tickLine={false}
            />

            <YAxis
              yAxisId="temp"
              stroke="#7a8ca1"
              tick={{ fontSize: 11, fill: '#5f7288' }}
              tickLine={false}
              axisLine={false}
              tickFormatter={(value) => `${value}°`}
              width={38}
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
              content={<CustomTooltip />}
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
              name="Temperatura"
              unit="°C"
              stroke="#f97316"
              strokeWidth={3}
              dot={false}
              activeDot={{ r: 6, fill: '#ea580c', strokeWidth: 0 }}
            />

            <Bar
              yAxisId="temp"
              dataKey="wind_speed"
              name="Vento"
              unit=" km/h"
              barSize={12}
              fill="url(#windFill)"
              radius={[10, 10, 0, 0]}
            />

            <Brush
              dataKey="collected_at"
              height={22}
              stroke="#0f9f8f"
              travellerWidth={10}
              tickFormatter={formatTimestamp}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}
