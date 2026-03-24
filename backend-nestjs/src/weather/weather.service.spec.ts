import { getModelToken } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { AnalyticsService } from '../analytics/analytics.service';
import { UsersService } from '../users/users.service';
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

function matchesQuery(record: Record<string, any>, query: Record<string, any> = {}) {
  return Object.entries(query).every(([key, value]) => {
    if (value === undefined) {
      return true;
    }

    if (key === 'collected_at' && value && typeof value === 'object' && !Array.isArray(value)) {
      const lowerBound = value.$gte ? record.collected_at >= value.$gte : true;
      const upperBound = value.$lte ? record.collected_at <= value.$lte : true;
      return lowerBound && upperBound;
    }

    return record[key] === value;
  });
}

function sortRecords(records: Array<Record<string, any>>, sortSpec?: Record<string, 1 | -1>) {
  if (!sortSpec || !Object.keys(sortSpec).length) {
    return [...records];
  }

  const [[field, direction]] = Object.entries(sortSpec) as Array<[string, 1 | -1]>;
  return [...records].sort((left, right) => {
    if (left[field] === right[field]) {
      return 0;
    }

    return left[field] > right[field] ? direction : -direction;
  });
}

function createWeatherModelMock() {
  const records: Array<Record<string, any>> = [];

  return {
    records,
    find(query: Record<string, any> = {}) {
      let workingSet = records.filter((record) => matchesQuery(record, query));

      const chain = {
        sort(sortSpec: Record<string, 1 | -1>) {
          workingSet = sortRecords(workingSet, sortSpec);
          return chain;
        },
        limit(amount: number) {
          workingSet = workingSet.slice(0, amount);
          return chain;
        },
        exec: async () => workingSet.map((record) => ({ ...record })),
      };

      return chain;
    },
    findOne(query: Record<string, any> = {}) {
      let workingSet = records.filter((record) => matchesQuery(record, query));

      const chain = {
        sort(sortSpec: Record<string, 1 | -1>) {
          workingSet = sortRecords(workingSet, sortSpec);
          return chain;
        },
        exec: async () => (workingSet[0] ? { ...workingSet[0] } : null),
      };

      return chain;
    },
    countDocuments(query: Record<string, any> = {}) {
      return {
        exec: async () => records.filter((record) => matchesQuery(record, query)).length,
      };
    },
    async bulkWrite(
      operations: Array<{
        updateOne: {
          filter: Record<string, any>;
          update: {
            $set?: Record<string, any>;
            $setOnInsert?: Record<string, any>;
          };
          upsert?: boolean;
        };
      }>,
    ) {
      operations.forEach(({ updateOne }) => {
        const index = records.findIndex((record) => matchesQuery(record, updateOne.filter));
        const payload = {
          ...(updateOne.update.$setOnInsert || {}),
          ...(updateOne.update.$set || {}),
        };

        if (index >= 0) {
          records[index] = { ...records[index], ...(updateOne.update.$set || {}) };
          return;
        }

        if (updateOne.upsert) {
          records.push(payload);
        }
      });

      return { ok: 1 };
    },
  };
}

describe('WeatherService', () => {
  let service: WeatherService;
  let analyticsService: { getActiveUsersSummary: jest.Mock };
  let usersService: { findTrackedWeatherLocations: jest.Mock };
  let weatherModel: ReturnType<typeof createWeatherModelMock>;

  beforeEach(async () => {
    weatherModel = createWeatherModelMock();
    analyticsService = {
      getActiveUsersSummary: jest.fn().mockResolvedValue({ activeUsers: 0 }),
    };
    usersService = {
      findTrackedWeatherLocations: jest.fn().mockResolvedValue([]),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WeatherService,
        {
          provide: getModelToken(Weather.name),
          useValue: weatherModel,
        },
        {
          provide: AnalyticsService,
          useValue: analyticsService,
        },
        {
          provide: UsersService,
          useValue: usersService,
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

  it('imports synced records and serves stored history from Mongo', async () => {
    await service.importMany([
      {
        ...DEFAULT_LOCATION,
        temp: 25,
        humidity: 68,
        wind_speed: 8,
        precipitation: 0,
        is_day: 1,
        collected_at: '2026-03-24T00:00',
      },
      {
        ...DEFAULT_LOCATION,
        temp: 24,
        humidity: 70,
        wind_speed: 7,
        precipitation: 0,
        is_day: 1,
        collected_at: '2026-03-24T01:00',
      },
    ]);

    const history = await service.getHistory({
      ...DEFAULT_LOCATION,
      startDate: '2026-03-24',
      endDate: '2026-03-24',
    });

    expect(history.points).toHaveLength(2);
    expect(history.points[0].temp).toBe(25);
    expect(history.points[1].temp).toBe(24);
    expect(weatherModel.records).toHaveLength(2);
  });

  it('returns the latest stored live reading after import', async () => {
    await service.importMany([
      {
        ...DEFAULT_LOCATION,
        temp: 22,
        humidity: 80,
        wind_speed: 5,
        precipitation: 0,
        is_day: 0,
        collected_at: '2026-03-24T00:00',
      },
      {
        ...DEFAULT_LOCATION,
        temp: 27,
        humidity: 60,
        wind_speed: 9,
        precipitation: 0,
        is_day: 1,
        collected_at: '2026-03-24T12:00',
      },
    ]);

    const live = await service.getLiveWeather(DEFAULT_LOCATION);

    expect(live.temp).toBe(27);
    expect(live.humidity).toBe(60);
    expect(live.insights).toHaveLength(3);
    expect(live.collected_at).toBe('2026-03-24T12:00');
  });

  it('reports tracked sync locations with the latest stored timestamp', async () => {
    usersService.findTrackedWeatherLocations.mockResolvedValue([
      {
        cityName: 'Juiz de Fora',
        stateName: 'Minas Gerais',
        stateCode: 'MG',
        latitude: -21.7642,
        longitude: -43.3503,
        timezone: 'America/Sao_Paulo',
      },
    ]);

    await service.importMany([
      {
        ...DEFAULT_LOCATION,
        temp: 27,
        humidity: 60,
        wind_speed: 9,
        precipitation: 0,
        is_day: 1,
        collected_at: '2026-03-24T12:00',
      },
    ]);

    const locations = await service.getTrackedLocationsForSync();

    expect(locations[0].cityName).toBe('Juiz de Fora');
    expect(locations[0].latestCollectedAt).toBe('2026-03-24T12:00');
  });
});
