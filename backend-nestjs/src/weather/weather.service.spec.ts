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

  it('bootstraps missing history into Mongo and reuses stored data on later requests', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        hourly: {
          time: [
            '2026-03-24T00:00',
            '2026-03-24T01:00',
            '2026-03-24T02:00',
            '2026-03-24T03:00',
            '2026-03-24T04:00',
            '2026-03-24T05:00',
          ],
          temperature_2m: [25, 24, 23, 22, 21, 20],
          relative_humidity_2m: [68, 69, 70, 71, 72, 73],
          precipitation: [0, 0, 0, 0, 0, 0],
          wind_speed_10m: [8, 8, 7, 7, 6, 6],
          is_day: [0, 0, 0, 0, 1, 1],
        },
      }),
    } as Response);

    const first = await service.getHistory({
      ...DEFAULT_LOCATION,
      startDate: '2026-03-24',
      endDate: '2026-03-24',
    });
    const second = await service.getHistory({
      ...DEFAULT_LOCATION,
      startDate: '2026-03-24',
      endDate: '2026-03-24',
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(first.points).toHaveLength(6);
    expect(second.points).toHaveLength(6);
    expect(weatherModel.records).toHaveLength(6);
  });

  it('stores the live snapshot and serves it from Mongo while the record is still fresh', async () => {
    const currentTimestamp = new Date().toISOString().slice(0, 16);
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      json: async () => ({
        current: {
          temperature_2m: 26.5,
          relative_humidity_2m: 58,
          wind_speed_10m: 8.4,
          precipitation: 0,
          is_day: 1,
          time: currentTimestamp,
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
    expect(first.insights).toHaveLength(3);
    expect(weatherModel.records).toHaveLength(1);
  });
});
