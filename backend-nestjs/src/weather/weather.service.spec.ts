import { getModelToken } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { AnalyticsService } from '../analytics/analytics.service';
import { Weather } from './entities/weather.schema';
import { WeatherService } from './weather.service';

const DEFAULT_LOCATION = {
  cityName: 'Juiz de Fora',
  stateName: 'Minas Gerais',
  stateCode: 'MG',
  latitude: -21.7642,
  longitude: -43.3503,
  timezone: 'America/Sao_Paulo',
};

describe('WeatherService', () => {
  let service: WeatherService;
  let analyticsService: { getActiveUsersSummary: jest.Mock };

  beforeEach(async () => {
    analyticsService = {
      getActiveUsersSummary: jest.fn().mockResolvedValue({ activeUsers: 0 }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WeatherService,
        {
          provide: getModelToken(Weather.name),
          useValue: {},
        },
        {
          provide: AnalyticsService,
          useValue: analyticsService,
        },
      ],
    }).compile();

    service = module.get<WeatherService>(WeatherService);
    jest.restoreAllMocks();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('reuses cached live weather instead of calling the provider again inside the TTL window', async () => {
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue({
        ok: true,
        json: async () => ({
          current: {
            temperature_2m: 26.5,
            relative_humidity_2m: 58,
            wind_speed_10m: 8.4,
            precipitation: 0,
            is_day: 1,
            time: '2026-03-24T16:30',
          },
          daily: {
            temperature_2m_max: [27.5],
            temperature_2m_min: [18.1],
            precipitation_sum: [0],
          },
        }),
      } as Response);

    const first = await service.getLiveWeather(DEFAULT_LOCATION);
    const second = await service.getLiveWeather(DEFAULT_LOCATION);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(first.temp).toBe(26.5);
    expect(second.temp).toBe(26.5);
  });

  it('returns stale cached live weather when the provider is rate limited', async () => {
    const cachedResponse = {
      ...DEFAULT_LOCATION,
      displayName: 'Juiz de Fora, MG, Brasil',
      temp: 25,
      humidity: 60,
      wind_speed: 10,
      precipitation: 0,
      is_day: 1,
      collected_at: '2026-03-24T15:30:00.000Z',
      insight: 'Monitoramento ativo.',
      insights: ['Monitoramento ativo.', 'Umidade estavel.', 'Vento controlado.'],
      insight_source: 'fallback' as const,
      has_active_viewer: false,
      ai_generated_at: null,
    };

    (service as any).liveCache.set('-21.7642:-43.3503:America/Sao_Paulo', {
      expiresAt: Date.now() - 1000,
      response: cachedResponse,
    });

    jest
      .spyOn(global, 'fetch')
      .mockResolvedValue({
        ok: false,
        status: 429,
      } as Response);

    await expect(service.getLiveWeather(DEFAULT_LOCATION)).resolves.toEqual(cachedResponse);
  });

  it('returns stale cached history when the provider is rate limited', async () => {
    const cachedHistory = {
      location: {
        ...DEFAULT_LOCATION,
        displayName: 'Juiz de Fora, MG, Brasil',
      },
      range: {
        startDate: '2026-03-01',
        endDate: '2026-03-24',
        pointCount: 1,
      },
      points: [
        {
          collected_at: '2026-03-24T15:00',
          temp: 24.1,
          humidity: 63,
          wind_speed: 9,
          precipitation: 0,
          is_day: 1,
        },
      ],
    };

    (service as any).historyCache.set(
      '-21.7642:-43.3503:America/Sao_Paulo:2026-03-01:2026-03-24',
      {
        expiresAt: Date.now() - 1000,
        response: cachedHistory,
      },
    );

    jest
      .spyOn(global, 'fetch')
      .mockResolvedValue({
        ok: false,
        status: 429,
      } as Response);

    await expect(
      service.getHistory({
        ...DEFAULT_LOCATION,
        startDate: '2026-03-01',
        endDate: '2026-03-24',
      }),
    ).resolves.toEqual(cachedHistory);
  });
});
