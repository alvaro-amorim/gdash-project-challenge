import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model } from 'mongoose';
import { AnalyticsService } from '../analytics/analytics.service';
import { UsersService } from '../users/users.service';
import { Weather, WeatherDocument } from './entities/weather.schema';

type WeatherLocationInput = {
  cityName?: string;
  stateName?: string;
  stateCode?: string;
  latitude?: number | string;
  longitude?: number | string;
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

type StoredWeatherEntry = {
  cityName: string;
  stateName: string | null;
  stateCode: string | null;
  timezone: string;
  latitude: string;
  longitude: string;
  temp: number;
  humidity: number;
  wind_speed: number;
  precipitation: number;
  is_day: number;
  insight: string;
  insights: string[];
  insight_source: 'ai' | 'fallback';
  has_active_viewer: boolean;
  ai_generated_at: string | null;
  collected_at: string;
  source: 'archive' | 'manual' | 'sync';
};

type StoredCoverage = {
  count: number;
  firstCollectedAt: string | null;
  lastCollectedAt: string | null;
};

const DEFAULT_CITY = 'Juiz de Fora';
const DEFAULT_STATE_NAME = 'Minas Gerais';
const DEFAULT_STATE_CODE = 'MG';
const DEFAULT_TIMEZONE = 'America/Sao_Paulo';
const DEFAULT_LATITUDE = -21.7642;
const DEFAULT_LONGITUDE = -43.3503;
const INSIGHT_REFRESH_INTERVAL_MS = 20 * 60 * 1000;
const LIVE_REFRESH_THRESHOLD_MS = 15 * 60 * 1000;
const DEFAULT_TRACKED_SYNC_INTERVAL_MS = 20 * 60 * 1000;
const DEFAULT_BOOTSTRAP_DAYS = 30;
const ONE_DAY_MS = 24 * 60 * 60 * 1000;
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
export class WeatherService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WeatherService.name);
  private readonly insightCache = new Map<string, InsightCacheEntry>();
  private readonly syncLocks = new Map<string, Promise<unknown>>();
  private syncLoop: Promise<void> | null = null;
  private syncTimer: NodeJS.Timeout | null = null;

  constructor(
    @InjectModel(Weather.name) private readonly weatherModel: Model<WeatherDocument>,
    private readonly analyticsService: AnalyticsService,
    private readonly usersService: UsersService,
  ) {}

  onModuleInit() {
    void this.syncTrackedLocations('startup');

    this.syncTimer = setInterval(() => {
      void this.syncTrackedLocations('interval');
    }, this.getTrackedSyncIntervalMs());

    this.syncTimer.unref?.();
  }

  onModuleDestroy() {
    if (this.syncTimer) {
      clearInterval(this.syncTimer);
    }
  }

  async create(data: any): Promise<WeatherDocument> {
    const location = this.toLocation({
      cityName: this.toOptionalString(data.cityName),
      stateName: this.toOptionalString(data.stateName),
      stateCode: this.toOptionalString(data.stateCode),
      latitude: data.latitude as string | number | undefined,
      longitude: data.longitude as string | number | undefined,
      timezone: this.toOptionalString(data.timezone),
    });

    const fallbackInsights = this.buildFallbackInsights(
      {
        temperature_2m: data.temp,
        relative_humidity_2m: data.humidity,
        wind_speed_10m: data.wind_speed,
        precipitation: data.precipitation,
        is_day: data.is_day,
      },
      location,
    );

    const normalizedInsights = this.normalizeInsightList(
      Array.isArray(data.insights) ? data.insights : fallbackInsights,
    );

    const entry: StoredWeatherEntry = {
      ...this.toStoredLocation(location),
      temp: this.toNumber(data.temp),
      humidity: this.toNumber(data.humidity),
      wind_speed: this.toNumber(data.wind_speed),
      precipitation: this.toNumber(data.precipitation),
      is_day: this.toNumber(data.is_day),
      insight: this.toOptionalString(data.insight) || normalizedInsights[0] || fallbackInsights[0],
      insights: normalizedInsights.length ? normalizedInsights : fallbackInsights,
      insight_source: data.insight_source === 'ai' ? 'ai' : 'fallback',
      has_active_viewer: Boolean(data.has_active_viewer),
      ai_generated_at: this.normalizeOptionalCollectedAt(data.ai_generated_at),
      collected_at: this.normalizeCollectedAt(data.collected_at),
      source: 'manual',
    };

    await this.upsertWeatherEntries([entry]);
    return this.findStoredRecordByTimestamp(location, entry.collected_at);
  }

  async findAll(limit?: number, start?: string, end?: string): Promise<Weather[]> {
    const query: FilterQuery<WeatherDocument> = {};
    const collectedAtQuery = this.buildCollectedAtQuery(start, end);

    if (collectedAtQuery) {
      query.collected_at = collectedAtQuery;
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

      deduped.set(this.toLocationKey(mapped), mapped);
    }

    return Array.from(deduped.values());
  }

  async getLiveWeather(input: WeatherLocationInput): Promise<WeatherLiveResponse> {
    const location = this.toLocation(input);
    await this.ensureLiveSnapshot(location);

    let latestRecord = await this.findLatestStoredRecord(location);
    if (!latestRecord) {
      const endDate = this.toDateString(new Date());
      const startDate = this.toDateString(new Date(Date.now() - ONE_DAY_MS));
      await this.ensureHistoryCoverage(location, startDate, endDate);
      latestRecord = await this.findLatestStoredRecord(location);
    }

    if (!latestRecord) {
      throw new Error('Weather data is not available for this city yet');
    }

    return this.toLiveResponse(location, latestRecord);
  }

  async getHistory(
    input: WeatherLocationInput & { startDate?: string; endDate?: string; days?: number },
  ): Promise<WeatherHistoryResponse> {
    const location = this.toLocation(input);
    const endDate = input.endDate || this.toDateString(new Date());
    const startDate =
      input.startDate ||
      this.toDateString(new Date(Date.now() - (input.days || DEFAULT_BOOTSTRAP_DAYS) * ONE_DAY_MS));

    await this.ensureHistoryCoverage(location, startDate, endDate);
    const records = await this.loadStoredHistory(location, startDate, endDate);

    return {
      location,
      range: {
        startDate,
        endDate,
        pointCount: records.length,
      },
      points: records.map((record) => this.toHistoryPoint(record)),
    };
  }

  private async syncTrackedLocations(reason: 'startup' | 'interval') {
    if (this.syncLoop) {
      return this.syncLoop;
    }

    this.syncLoop = (async () => {
      const locations = await this.getTrackedLocations();
      if (!locations.length) {
        return;
      }

      const endDate = this.toDateString(new Date());
      const startDate = this.toDateString(
        new Date(Date.now() - this.getBootstrapDays() * ONE_DAY_MS),
      );

      for (const location of locations) {
        const shouldBootstrapHistory =
          reason === 'startup' || !(await this.hasStoredWeather(location));

        if (shouldBootstrapHistory) {
          await this.ensureHistoryCoverage(location, startDate, endDate).catch((error) => {
            this.logger.warn(
              `History bootstrap failed for ${location.displayName}. ${String(error)}`,
            );
          });
        }

        await this.ensureLiveSnapshot(location).catch((error) => {
          this.logger.warn(`Live sync failed for ${location.displayName}. ${String(error)}`);
        });
      }
    })().finally(() => {
      this.syncLoop = null;
    });

    return this.syncLoop;
  }

  private async getTrackedLocations() {
    const trackedLocations = await this.usersService.findTrackedWeatherLocations();
    const deduped = new Map<string, WeatherLocation>();
    const defaultLocation = this.toLocation({});

    deduped.set(this.toLocationKey(defaultLocation), defaultLocation);

    for (const candidate of trackedLocations) {
      const location = this.toLocation(candidate);
      deduped.set(this.toLocationKey(location), location);
    }

    return Array.from(deduped.values());
  }

  private async hasStoredWeather(location: WeatherLocation) {
    const latest = await this.findLatestStoredRecord(location);
    return Boolean(latest);
  }

  private async ensureLiveSnapshot(location: WeatherLocation) {
    const lockKey = `live:${this.toLocationKey(location)}`;

    return this.withSyncLock(lockKey, async () => {
      const latestRecord = await this.findLatestStoredRecord(location);
      if (latestRecord && !this.isCollectedAtStale(latestRecord.collected_at, LIVE_REFRESH_THRESHOLD_MS)) {
        return;
      }

      try {
        const entry = await this.fetchCurrentSnapshot(location);
        await this.upsertWeatherEntries([entry]);
      } catch (error) {
        if (latestRecord) {
          this.logger.warn(
            `Weather provider failed while refreshing ${location.displayName}. Reusing stored reading. ${String(error)}`,
          );
          return;
        }

        throw error;
      }
    });
  }

  private async ensureHistoryCoverage(location: WeatherLocation, startDate: string, endDate: string) {
    const lockKey = `history:${this.toLocationKey(location)}:${startDate}:${endDate}`;

    return this.withSyncLock(lockKey, async () => {
      const coverage = await this.getStoredCoverage(location, startDate, endDate);
      if (this.hasEnoughCoverage(startDate, endDate, coverage)) {
        return;
      }

      try {
        const entries = await this.fetchHistoricalRange(location, startDate, endDate);
        if (!entries.length) {
          return;
        }

        await this.upsertWeatherEntries(entries);
      } catch (error) {
        if (coverage.count > 0) {
          this.logger.warn(
            `Archive sync failed for ${location.displayName}. Serving partial stored history. ${String(error)}`,
          );
          return;
        }

        throw error;
      }
    });
  }

  private async fetchCurrentSnapshot(location: WeatherLocation): Promise<StoredWeatherEntry> {
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
      ...this.toStoredLocation(location),
      temp: this.toNumber(current.temperature_2m),
      humidity: this.toNumber(current.relative_humidity_2m),
      wind_speed: this.toNumber(current.wind_speed_10m),
      precipitation: this.toNumber(current.precipitation),
      is_day: this.toNumber(current.is_day),
      insight: insightResult.insights[0] || '',
      insights: insightResult.insights,
      insight_source: insightResult.source,
      has_active_viewer: hasActiveViewer,
      ai_generated_at: insightResult.generatedAt
        ? this.normalizeCollectedAt(new Date(insightResult.generatedAt).toISOString())
        : null,
      collected_at: this.normalizeCollectedAt(current.time),
      source: 'sync',
    };
  }

  private async fetchHistoricalRange(
    location: WeatherLocation,
    startDate: string,
    endDate: string,
  ): Promise<StoredWeatherEntry[]> {
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

    return times.map((collectedAt: string, index: number) => ({
      ...this.toStoredLocation(location),
      temp: this.toNumber(hourly.temperature_2m?.[index]),
      humidity: this.toNumber(hourly.relative_humidity_2m?.[index]),
      wind_speed: this.toNumber(hourly.wind_speed_10m?.[index]),
      precipitation: this.toNumber(hourly.precipitation?.[index]),
      is_day: this.toNumber(hourly.is_day?.[index]),
      insight: `Sincronizacao historica armazenada para ${location.cityName}.`,
      insights: [],
      insight_source: 'fallback',
      has_active_viewer: false,
      ai_generated_at: null,
      collected_at: this.normalizeCollectedAt(collectedAt),
      source: 'archive',
    }));
  }

  private async upsertWeatherEntries(entries: StoredWeatherEntry[]) {
    if (!entries.length) {
      return;
    }

    await this.weatherModel.bulkWrite(
      entries.map((entry) => ({
        updateOne: {
          filter: {
            latitude: entry.latitude,
            longitude: entry.longitude,
            collected_at: entry.collected_at,
          },
          update: {
            $set: {
              cityName: entry.cityName,
              stateName: entry.stateName || undefined,
              stateCode: entry.stateCode || undefined,
              timezone: entry.timezone,
              temp: entry.temp,
              humidity: entry.humidity,
              wind_speed: entry.wind_speed,
              precipitation: entry.precipitation,
              is_day: entry.is_day,
              insight: entry.insight,
              insights: entry.insights,
              insight_source: entry.insight_source,
              has_active_viewer: entry.has_active_viewer,
              ai_generated_at: entry.ai_generated_at || undefined,
              source: entry.source,
            },
            $setOnInsert: {
              latitude: entry.latitude,
              longitude: entry.longitude,
              collected_at: entry.collected_at,
            },
          },
          upsert: true,
        },
      })),
    );
  }

  private async findLatestStoredRecord(location: WeatherLocation) {
    return this.weatherModel
      .findOne(this.buildLocationQuery(location))
      .sort({ collected_at: -1 })
      .exec();
  }

  private async findStoredRecordByTimestamp(location: WeatherLocation, collectedAt: string) {
    const stored = await this.weatherModel
      .findOne({
        ...this.buildLocationQuery(location),
        collected_at: collectedAt,
      })
      .exec();

    if (!stored) {
      throw new Error('Stored weather record could not be located after the upsert.');
    }

    return stored;
  }

  private async loadStoredHistory(location: WeatherLocation, startDate: string, endDate: string) {
    return this.weatherModel
      .find({
        ...this.buildLocationQuery(location),
        collected_at: this.buildCollectedAtQuery(startDate, endDate),
      })
      .sort({ collected_at: 1 })
      .exec();
  }

  private async getStoredCoverage(
    location: WeatherLocation,
    startDate: string,
    endDate: string,
  ): Promise<StoredCoverage> {
    const query = {
      ...this.buildLocationQuery(location),
      collected_at: this.buildCollectedAtQuery(startDate, endDate),
    };

    const [count, firstRecord, lastRecord] = await Promise.all([
      this.weatherModel.countDocuments(query).exec(),
      this.weatherModel.findOne(query).sort({ collected_at: 1 }).exec(),
      this.weatherModel.findOne(query).sort({ collected_at: -1 }).exec(),
    ]);

    return {
      count,
      firstCollectedAt: firstRecord?.collected_at || null,
      lastCollectedAt: lastRecord?.collected_at || null,
    };
  }

  private hasEnoughCoverage(startDate: string, endDate: string, coverage: StoredCoverage) {
    if (!coverage.count || !coverage.firstCollectedAt || !coverage.lastCollectedAt) {
      return false;
    }

    const hasStartCoverage = coverage.firstCollectedAt.slice(0, 10) <= startDate;
    const hasEndCoverage = coverage.lastCollectedAt.slice(0, 10) >= endDate;
    const minimumExpectedPoints = Math.max(
      6,
      Math.min(72, this.getInclusiveDaySpan(startDate, endDate) * 6),
    );

    return (
      coverage.count >= minimumExpectedPoints &&
      hasStartCoverage &&
      hasEndCoverage
    );
  }

  private getInclusiveDaySpan(startDate: string, endDate: string) {
    const start = new Date(`${startDate}T00:00:00Z`);
    const end = new Date(`${endDate}T00:00:00Z`);
    const diff = end.getTime() - start.getTime();
    return Math.max(1, Math.floor(diff / ONE_DAY_MS) + 1);
  }

  private buildCollectedAtQuery(start?: string, end?: string) {
    if (!start && !end) {
      return undefined;
    }

    const query: { $gte?: string; $lte?: string } = {};

    if (start) {
      query.$gte = start.includes('T') ? this.normalizeCollectedAt(start) : `${start}T00:00`;
    }

    if (end) {
      query.$lte = end.includes('T') ? this.normalizeCollectedAt(end) : `${end}T23:59`;
    }

    return query;
  }

  private buildLocationQuery(location: WeatherLocation): FilterQuery<WeatherDocument> {
    return {
      latitude: this.toCoordinateString(location.latitude),
      longitude: this.toCoordinateString(location.longitude),
    };
  }

  private toLiveResponse(location: WeatherLocation, record: WeatherDocument): WeatherLiveResponse {
    const insights =
      Array.isArray(record.insights) && record.insights.length
        ? record.insights
        : this.buildFallbackInsights(record as unknown as Record<string, unknown>, location);

    return {
      ...location,
      collected_at: record.collected_at,
      temp: record.temp,
      humidity: record.humidity,
      wind_speed: record.wind_speed,
      precipitation: record.precipitation,
      is_day: record.is_day,
      insight: record.insight || insights[0] || '',
      insights,
      insight_source: record.insight_source === 'ai' ? 'ai' : 'fallback',
      has_active_viewer: Boolean(record.has_active_viewer),
      ai_generated_at: record.ai_generated_at || null,
    };
  }

  private toHistoryPoint(record: WeatherDocument): WeatherHistoryPoint {
    return {
      collected_at: record.collected_at,
      temp: record.temp,
      humidity: record.humidity,
      wind_speed: record.wind_speed,
      precipitation: record.precipitation,
      is_day: record.is_day,
    };
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
      this.logger.warn(`Gemini request failed. Falling back to local insights. ${String(error)}`);
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
    const temp = this.toNumber(current.temperature_2m ?? current.temp);
    const humidity = this.toNumber(current.relative_humidity_2m ?? current.humidity);
    const wind = this.toNumber(current.wind_speed_10m ?? current.wind_speed);
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
          : 'Periodo noturno com vento controlado favorece uma janela mais tranquila.',
      );
    }

    while (insights.length < 3) {
      addInsight(`Monitoramento ativo em ${location.cityName} com atualizacao local e leitura persistida.`);
    }

    return insights.slice(0, 3);
  }

  private toLocation(input: Partial<WeatherLocationInput>): WeatherLocation {
    const hasCoordinates =
      input.latitude !== undefined &&
      input.latitude !== null &&
      input.latitude !== '' &&
      input.longitude !== undefined &&
      input.longitude !== null &&
      input.longitude !== '';

    const stateName = input.stateName?.trim() || DEFAULT_STATE_NAME;
    const stateCode = input.stateCode?.trim().toUpperCase() || this.resolveStateCode(stateName) || DEFAULT_STATE_CODE;
    const cityName = input.cityName?.trim() || DEFAULT_CITY;
    const timezone = input.timezone?.trim() || DEFAULT_TIMEZONE;
    const latitude = hasCoordinates
      ? this.toNumber(input.latitude, DEFAULT_LATITUDE)
      : DEFAULT_LATITUDE;
    const longitude = hasCoordinates
      ? this.toNumber(input.longitude, DEFAULT_LONGITUDE)
      : DEFAULT_LONGITUDE;

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

  private toStoredLocation(location: WeatherLocation) {
    return {
      cityName: location.cityName,
      stateName: location.stateName,
      stateCode: location.stateCode,
      timezone: location.timezone,
      latitude: this.toCoordinateString(location.latitude),
      longitude: this.toCoordinateString(location.longitude),
    };
  }

  private toLocationKey(location: WeatherLocation) {
    return `${this.toCoordinateString(location.latitude)}:${this.toCoordinateString(location.longitude)}:${location.timezone}`;
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

  private toCoordinateString(value: unknown) {
    return this.toNumber(value).toFixed(4);
  }

  private formatMetric(value: unknown) {
    const parsed = this.toNumber(value);
    return parsed.toFixed(1).replace('.0', '');
  }

  private toDateString(date: Date) {
    return date.toISOString().slice(0, 10);
  }

  private normalizeCollectedAt(value: unknown) {
    if (typeof value === 'string') {
      const normalized = value.trim();
      const directMatch = normalized.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})/);
      if (directMatch) {
        return directMatch[1];
      }

      const parsed = new Date(normalized);
      if (!Number.isNaN(parsed.getTime())) {
        return parsed.toISOString().slice(0, 16);
      }
    }

    if (value instanceof Date && !Number.isNaN(value.getTime())) {
      return value.toISOString().slice(0, 16);
    }

    return new Date().toISOString().slice(0, 16);
  }

  private normalizeOptionalCollectedAt(value: unknown) {
    if (value === undefined || value === null || value === '') {
      return null;
    }

    return this.normalizeCollectedAt(value);
  }

  private toOptionalString(value: unknown) {
    if (typeof value !== 'string') {
      return '';
    }

    return value.trim();
  }

  private isCollectedAtStale(collectedAt: string, thresholdMs: number) {
    const parsed = new Date(collectedAt);
    if (Number.isNaN(parsed.getTime())) {
      return true;
    }

    return Date.now() - parsed.getTime() > thresholdMs;
  }

  private async withSyncLock<T>(key: string, task: () => Promise<T>): Promise<T> {
    const existing = this.syncLocks.get(key) as Promise<T> | undefined;
    if (existing) {
      return existing;
    }

    const promise = task().finally(() => {
      this.syncLocks.delete(key);
    });

    this.syncLocks.set(key, promise);
    return promise;
  }

  private getTrackedSyncIntervalMs() {
    const minutes = Number.parseInt(process.env.WEATHER_SYNC_INTERVAL_MINUTES || '', 10);
    if (Number.isFinite(minutes) && minutes > 0) {
      return minutes * 60 * 1000;
    }

    return DEFAULT_TRACKED_SYNC_INTERVAL_MS;
  }

  private getBootstrapDays() {
    const days = Number.parseInt(process.env.WEATHER_BOOTSTRAP_DAYS || '', 10);
    if (Number.isFinite(days) && days > 0) {
      return days;
    }

    return DEFAULT_BOOTSTRAP_DAYS;
  }

  private async fetchJson<T>(url: string): Promise<T> {
    const response = await fetch(url, {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'gdash-weather-sync/1.0',
      },
    });

    if (!response.ok) {
      throw new Error(`Weather provider request failed with status ${response.status}`);
    }

    return (await response.json()) as T;
  }
}
