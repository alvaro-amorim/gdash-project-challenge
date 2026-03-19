import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model } from 'mongoose';
import { AnalyticsService } from '../analytics/analytics.service';
import { Weather, WeatherDocument } from './entities/weather.schema';

type WeatherLocationInput = {
  cityName?: string;
  stateName?: string;
  stateCode?: string;
  latitude: number;
  longitude: number;
  timezone?: string;
};

export type WeatherLocation = {
  cityName: string;
  stateName: string | null;
  stateCode: string | null;
  latitude: number;
  longitude: number;
  timezone: string;
  displayName: string;
};

export type WeatherHistoryPoint = {
  collected_at: string;
  temp: number;
  humidity: number;
  wind_speed: number;
  precipitation: number;
  is_day: number;
};

export type WeatherHistoryResponse = {
  location: WeatherLocation;
  range: {
    startDate: string;
    endDate: string;
    pointCount: number;
  };
  points: WeatherHistoryPoint[];
};

export type WeatherLiveResponse = WeatherHistoryPoint &
  WeatherLocation & {
    insight: string;
    insights: string[];
    insight_source: 'ai' | 'fallback';
    has_active_viewer: boolean;
    ai_generated_at: string | null;
  };

type InsightCacheEntry = {
  generatedAt: number;
  insights: string[];
  source: 'ai' | 'fallback';
};

const DEFAULT_CITY = 'Juiz de Fora';
const DEFAULT_STATE_NAME = 'Minas Gerais';
const DEFAULT_STATE_CODE = 'MG';
const DEFAULT_TIMEZONE = 'America/Sao_Paulo';
const DEFAULT_LATITUDE = -21.7642;
const DEFAULT_LONGITUDE = -43.3503;
const HISTORY_CACHE_TTL_MS = 10 * 60 * 1000;
const INSIGHT_REFRESH_INTERVAL_MS = 20 * 60 * 1000;
const FORECAST_FIELDS =
  'temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,wind_speed_10m,is_day';
const DAILY_FIELDS = 'temperature_2m_max,temperature_2m_min,precipitation_sum';
const HOURLY_FIELDS = 'temperature_2m,relative_humidity_2m,precipitation,wind_speed_10m,is_day';

const BRAZIL_STATE_CODES: Record<string, string> = {
  acre: 'AC',
  alagoas: 'AL',
  amapa: 'AP',
  amazonas: 'AM',
  bahia: 'BA',
  ceara: 'CE',
  'distrito federal': 'DF',
  'espirito santo': 'ES',
  goias: 'GO',
  maranhao: 'MA',
  'mato grosso': 'MT',
  'mato grosso do sul': 'MS',
  'minas gerais': 'MG',
  para: 'PA',
  paraiba: 'PB',
  parana: 'PR',
  pernambuco: 'PE',
  piaui: 'PI',
  'rio de janeiro': 'RJ',
  'rio grande do norte': 'RN',
  'rio grande do sul': 'RS',
  rondonia: 'RO',
  roraima: 'RR',
  'santa catarina': 'SC',
  'sao paulo': 'SP',
  sergipe: 'SE',
  tocantins: 'TO',
};

@Injectable()
export class WeatherService {
  private readonly logger = new Logger(WeatherService.name);
  private readonly historyCache = new Map<string, { expiresAt: number; response: WeatherHistoryResponse }>();
  private readonly insightCache = new Map<string, InsightCacheEntry>();

  constructor(
    @InjectModel(Weather.name) private readonly weatherModel: Model<WeatherDocument>,
    private readonly analyticsService: AnalyticsService,
  ) {}

  async create(data: any): Promise<Weather> {
    try {
      const createdWeather = new this.weatherModel(data);
      return await createdWeather.save();
    } catch (error) {
      this.logger.error('Failed to save weather data', error);
      throw error;
    }
  }

  async findAll(limit?: number, start?: string, end?: string): Promise<Weather[]> {
    const query: FilterQuery<WeatherDocument> = {};

    if (start && end) {
      query.collected_at = {
        $gte: start,
        $lte: end,
      };
    }

    const dbQuery = this.weatherModel.find(query).sort({ collected_at: -1 });

    if (limit && limit > 0) {
      dbQuery.limit(limit);
    }

    return dbQuery.exec();
  }

  async searchCities(query: string): Promise<WeatherLocation[]> {
    const normalizedQuery = query.trim();
    if (normalizedQuery.length < 2) {
      return [];
    }

    const url = new URL('https://geocoding-api.open-meteo.com/v1/search');
    url.searchParams.set('name', normalizedQuery);
    url.searchParams.set('count', '12');
    url.searchParams.set('language', 'pt');
    url.searchParams.set('format', 'json');
    url.searchParams.set('countryCode', 'BR');

    const response = await this.fetchJson<{ results?: Array<Record<string, unknown>> }>(url.toString());
    const deduped = new Map<string, WeatherLocation>();

    for (const item of response.results || []) {
      const countryCode = String(item.country_code || item.countryCode || '').toUpperCase();
      if (countryCode && countryCode !== 'BR') {
        continue;
      }

      const mapped = this.toLocation({
        cityName: String(item.name || DEFAULT_CITY),
        stateName: item.admin1 ? String(item.admin1) : undefined,
        latitude: this.toNumber(item.latitude, DEFAULT_LATITUDE),
        longitude: this.toNumber(item.longitude, DEFAULT_LONGITUDE),
        timezone: item.timezone ? String(item.timezone) : DEFAULT_TIMEZONE,
      });

      deduped.set(
        `${mapped.cityName}-${mapped.stateCode || mapped.stateName || 'BR'}-${mapped.latitude}-${mapped.longitude}`,
        mapped,
      );
    }

    return Array.from(deduped.values());
  }

  async getLiveWeather(input: WeatherLocationInput): Promise<WeatherLiveResponse> {
    const location = this.toLocation(input);
    const url = new URL('https://api.open-meteo.com/v1/forecast');
    url.searchParams.set('latitude', String(location.latitude));
    url.searchParams.set('longitude', String(location.longitude));
    url.searchParams.set('current', FORECAST_FIELDS);
    url.searchParams.set('daily', DAILY_FIELDS);
    url.searchParams.set('forecast_days', '1');
    url.searchParams.set('timezone', location.timezone);

    const data = await this.fetchJson<Record<string, any>>(url.toString());
    const current = data.current || {};
    const daily = data.daily || {};
    const activeUsersSummary = await this.analyticsService.getActiveUsersSummary();
    const hasActiveViewer = Number(activeUsersSummary.activeUsers || 0) > 0;
    const insightResult = await this.resolveInsightBundle(current, daily, location, hasActiveViewer);

    return {
      ...location,
      temp: this.toNumber(current.temperature_2m),
      humidity: this.toNumber(current.relative_humidity_2m),
      wind_speed: this.toNumber(current.wind_speed_10m),
      precipitation: this.toNumber(current.precipitation),
      is_day: this.toNumber(current.is_day),
      collected_at: current.time ? String(current.time) : new Date().toISOString(),
      insight: insightResult.insights[0] || '',
      insights: insightResult.insights,
      insight_source: insightResult.source,
      has_active_viewer: hasActiveViewer,
      ai_generated_at: insightResult.generatedAt
        ? new Date(insightResult.generatedAt).toISOString()
        : null,
    };
  }

  async getHistory(input: WeatherLocationInput & { startDate?: string; endDate?: string; days?: number }) {
    const location = this.toLocation(input);
    const endDate = input.endDate || this.toDateString(new Date());
    const startDate =
      input.startDate ||
      this.toDateString(new Date(Date.now() - (input.days || 30) * 24 * 60 * 60 * 1000));

    const cacheKey = `${this.toLocationKey(location)}:${startDate}:${endDate}`;
    const cached = this.historyCache.get(cacheKey);

    if (cached && cached.expiresAt > Date.now()) {
      return cached.response;
    }

    const url = new URL('https://archive-api.open-meteo.com/v1/archive');
    url.searchParams.set('latitude', String(location.latitude));
    url.searchParams.set('longitude', String(location.longitude));
    url.searchParams.set('start_date', startDate);
    url.searchParams.set('end_date', endDate);
    url.searchParams.set('hourly', HOURLY_FIELDS);
    url.searchParams.set('timezone', location.timezone);

    const data = await this.fetchJson<Record<string, any>>(url.toString());
    const hourly = data.hourly || {};
    const times = Array.isArray(hourly.time) ? hourly.time : [];

    const points: WeatherHistoryPoint[] = times.map((collectedAt: string, index: number) => ({
      collected_at: collectedAt,
      temp: this.toNumber(hourly.temperature_2m?.[index]),
      humidity: this.toNumber(hourly.relative_humidity_2m?.[index]),
      wind_speed: this.toNumber(hourly.wind_speed_10m?.[index]),
      precipitation: this.toNumber(hourly.precipitation?.[index]),
      is_day: this.toNumber(hourly.is_day?.[index]),
    }));

    const response: WeatherHistoryResponse = {
      location,
      range: {
        startDate,
        endDate,
        pointCount: points.length,
      },
      points,
    };

    this.historyCache.set(cacheKey, {
      expiresAt: Date.now() + HISTORY_CACHE_TTL_MS,
      response,
    });

    return response;
  }

  private async resolveInsightBundle(
    current: Record<string, unknown>,
    daily: Record<string, unknown>,
    location: WeatherLocation,
    hasActiveViewer: boolean,
  ) {
    if (!hasActiveViewer) {
      return {
        insights: this.buildFallbackInsights(current, location),
        source: 'fallback' as const,
        generatedAt: null,
      };
    }

    const cacheKey = this.toLocationKey(location);
    const cached = this.insightCache.get(cacheKey);
    if (cached && Date.now() - cached.generatedAt < INSIGHT_REFRESH_INTERVAL_MS) {
      return {
        insights: cached.insights,
        source: cached.source,
        generatedAt: cached.generatedAt,
      };
    }

    const generatedInsights = await this.generateAiInsights(current, daily, location);
    if (generatedInsights.length === 3) {
      const cacheEntry: InsightCacheEntry = {
        generatedAt: Date.now(),
        insights: generatedInsights,
        source: 'ai',
      };
      this.insightCache.set(cacheKey, cacheEntry);

      return {
        insights: generatedInsights,
        source: cacheEntry.source,
        generatedAt: cacheEntry.generatedAt,
      };
    }

    return {
      insights: this.buildFallbackInsights(current, location),
      source: 'fallback' as const,
      generatedAt: null,
    };
  }

  private async generateAiInsights(
    current: Record<string, unknown>,
    daily: Record<string, unknown>,
    location: WeatherLocation,
  ): Promise<string[]> {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return [];
    }

    const dailyMax = Array.isArray(daily.temperature_2m_max) ? daily.temperature_2m_max[0] : undefined;
    const dailyMin = Array.isArray(daily.temperature_2m_min) ? daily.temperature_2m_min[0] : undefined;
    const dailyRain = Array.isArray(daily.precipitation_sum) ? daily.precipitation_sum[0] : undefined;

    const prompt = [
      'Voce atua como um meteorologista senior para um dashboard executivo.',
      `Cidade: ${location.displayName}.`,
      `Temperatura atual: ${this.formatMetric(current.temperature_2m)} C.`,
      `Sensacao termica: ${this.formatMetric(current.apparent_temperature)} C.`,
      `Umidade: ${this.formatMetric(current.relative_humidity_2m)}%.`,
      `Vento: ${this.formatMetric(current.wind_speed_10m)} km/h.`,
      `Chuva agora: ${this.formatMetric(current.precipitation)} mm.`,
      `Maxima do dia: ${this.formatMetric(dailyMax)} C.`,
      `Minima do dia: ${this.formatMetric(dailyMin)} C.`,
      `Chuva acumulada do dia: ${this.formatMetric(dailyRain)} mm.`,
      'Retorne somente JSON valido no formato {"insights":["...","...","..."]}.',
      'Cada insight deve ter no maximo 18 palavras e comecar com um marcador visual curto.',
      'Crie exatamente 3 insights diferentes e complementares.',
      'Nunca apresente sensacao termica como se fosse temperatura atual.',
      'Se citar sensacao termica, escreva explicitamente "sensacao termica".',
      'Se houver chuva, priorize seguranca e deslocamento.',
      'Nao use markdown, nao numere, nao inclua texto fora do JSON.',
    ].join(' ');

    try {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            contents: [
              {
                parts: [{ text: prompt }],
              },
            ],
            generationConfig: {
              temperature: 0.7,
              topP: 0.9,
            },
          }),
        },
      );

      if (!response.ok) {
        this.logger.warn(`Gemini request failed with status ${response.status}`);
        return [];
      }

      const payload = (await response.json()) as {
        candidates?: Array<{
          content?: {
            parts?: Array<{ text?: string }>;
          };
        }>;
      };

      const rawText =
        payload.candidates?.[0]?.content?.parts
          ?.map((part) => part.text || '')
          .join(' ')
          .trim() || '';

      return this.extractInsights(rawText);
    } catch (error) {
      this.logger.warn(`Gemini request failed. Falling back to local insights. ${error}`);
      return [];
    }
  }

  private extractInsights(rawText: string): string[] {
    if (!rawText) {
      return [];
    }

    try {
      const parsed = JSON.parse(rawText) as { insights?: unknown };
      if (Array.isArray(parsed.insights)) {
        return this.normalizeInsightList(parsed.insights);
      }
    } catch {
      const match = rawText.match(/\{[\s\S]*\}/);
      if (match) {
        try {
          const parsed = JSON.parse(match[0]) as { insights?: unknown };
          if (Array.isArray(parsed.insights)) {
            return this.normalizeInsightList(parsed.insights);
          }
        } catch {
          return [];
        }
      }
    }

    return [];
  }

  private normalizeInsightList(insights: unknown[]): string[] {
    const normalized = insights
      .map((item) => String(item || '').replace(/\s+/g, ' ').trim())
      .filter((item) => item.length >= 12)
      .map((item) => item.replace(/^"+|"+$/g, ''));

    return Array.from(new Set(normalized)).slice(0, 3);
  }

  private buildFallbackInsights(current: Record<string, unknown>, location: WeatherLocation): string[] {
    const temp = this.toNumber(current.temperature_2m);
    const humidity = this.toNumber(current.relative_humidity_2m);
    const wind = this.toNumber(current.wind_speed_10m);
    const rain = this.toNumber(current.precipitation);
    const isDay = this.toNumber(current.is_day) === 1;

    const insights: string[] = [];
    const addInsight = (value: string) => {
      if (!insights.includes(value)) {
        insights.push(value);
      }
    };

    if (rain > 0) {
      addInsight(`Chuva: ${location.cityName} tem ${this.formatMetric(rain)} mm; redobre a atencao com piso molhado.`);
    } else if (temp >= 30) {
      addInsight(`Calor: ${location.cityName} opera com ${this.formatMetric(temp)} C; hidratacao reforcada e recomendada.`);
    } else if (temp <= 15) {
      addInsight(`Frio: ${location.cityName} marca ${this.formatMetric(temp)} C; vale reforcar agasalho nas proximas horas.`);
    } else {
      addInsight(`Estavel: ${location.cityName} segue com ${this.formatMetric(temp)} C e leitura consistente para operacao.`);
    }

    if (humidity >= 85) {
      addInsight(`Umidade: ${this.formatMetric(humidity)}% pede atencao a condensacao e sensacao de abafamento.`);
    } else if (humidity <= 35) {
      addInsight(`Umidade: ${this.formatMetric(humidity)}% indica ar seco e necessidade de hidratacao.`);
    } else {
      addInsight(`Umidade: ${this.formatMetric(humidity)}% sustenta conforto moderado na cidade.`);
    }

    if (wind >= 20) {
      addInsight(`Vento: ${this.formatMetric(wind)} km/h pode afetar deslocamentos e areas mais expostas.`);
    } else {
      addInsight(
        isDay
          ? 'Periodo diurno com vento controlado favorece uma leitura operacional mais previsivel.'
          : 'Periodo noturno com vento controlado favorece uma janela mais tranquila.'
      );
    }

    while (insights.length < 3) {
      addInsight(`Monitoramento ativo em ${location.cityName} com atualizacao local e fallback confiavel.`);
    }

    return insights.slice(0, 3);
  }

  private toLocation(input: Partial<WeatherLocationInput>): WeatherLocation {
    const stateName = input.stateName?.trim() || DEFAULT_STATE_NAME;
    const stateCode = input.stateCode?.trim().toUpperCase() || this.resolveStateCode(stateName) || DEFAULT_STATE_CODE;
    const cityName = input.cityName?.trim() || DEFAULT_CITY;
    const timezone = input.timezone?.trim() || DEFAULT_TIMEZONE;
    const latitude = this.toNumber(input.latitude, DEFAULT_LATITUDE);
    const longitude = this.toNumber(input.longitude, DEFAULT_LONGITUDE);

    return {
      cityName,
      stateName,
      stateCode,
      latitude,
      longitude,
      timezone,
      displayName: [cityName, stateCode || stateName, 'Brasil'].filter(Boolean).join(', '),
    };
  }

  private toLocationKey(location: WeatherLocation) {
    return `${location.latitude.toFixed(4)}:${location.longitude.toFixed(4)}:${location.timezone}`;
  }

  private resolveStateCode(stateName?: string | null) {
    if (!stateName) {
      return null;
    }

    const normalized = stateName
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim()
      .toLowerCase();

    return BRAZIL_STATE_CODES[normalized] || null;
  }

  private toNumber(value: unknown, fallback = 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  private formatMetric(value: unknown) {
    const parsed = this.toNumber(value);
    return parsed.toFixed(1).replace('.0', '');
  }

  private toDateString(date: Date) {
    return date.toISOString().slice(0, 10);
  }

  private async fetchJson<T>(url: string): Promise<T> {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Weather provider request failed with status ${response.status}`);
    }

    return (await response.json()) as T;
  }
}
