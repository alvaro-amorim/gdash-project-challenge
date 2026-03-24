import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  Logger,
  Post,
  Query,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiBody, ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import * as ExcelJS from 'exceljs';
import { Parser } from 'json2csv';
import { Weather } from './entities/weather.schema';
import { WeatherHistoryPoint, WeatherService } from './weather.service';

class CreateWeatherDto {
  cityName?: string;
  stateName?: string;
  stateCode?: string;
  timezone?: string;
  temp: number;
  humidity: number;
  wind_speed: number;
  precipitation: number;
  insight: string;
  insights?: string[];
  insight_source?: string;
  has_active_viewer?: boolean;
  ai_generated_at?: string | null;
  is_day: number;
  collected_at: string;
  latitude: string | number;
  longitude: string | number;
  source?: string;
}

class ImportWeatherDto {
  records!: CreateWeatherDto[];
}

class WeatherLocationQueryDto {
  latitude?: string;
  longitude?: string;
  cityName?: string;
  stateName?: string;
  stateCode?: string;
  timezone?: string;
}

const EXCEL_STYLES = {
  TITLE_BG: 'FF111827',
  HEADER_BG: 'FF10B981',
  TEXT_WHITE: 'FFFFFFFF',
  FONT_FAMILY: 'Arial',
};

@ApiTags('Weather')
@Controller('weather')
export class WeatherController {
  private readonly logger = new Logger(WeatherController.name);

  constructor(private readonly weatherService: WeatherService) {}

  @Post()
  @ApiOperation({ summary: 'Ingest weather data (Internal Use)' })
  @ApiBody({ type: CreateWeatherDto })
  @ApiResponse({ status: 201, description: 'Data successfully stored.' })
  create(@Body() data: CreateWeatherDto) {
    return this.weatherService.create(data);
  }

  @Get('sync/locations')
  @ApiOperation({ summary: 'List tracked locations for background weather sync (Internal Use)' })
  getSyncLocations(@Headers('x-weather-sync-secret') secret?: string) {
    this.assertSyncSecret(secret);
    return this.weatherService.getTrackedLocationsForSync();
  }

  @Post('import')
  @ApiOperation({ summary: 'Import synchronized weather records (Internal Use)' })
  @ApiBody({ type: ImportWeatherDto })
  importMany(@Headers('x-weather-sync-secret') secret: string | undefined, @Body() body: ImportWeatherDto) {
    this.assertSyncSecret(secret);

    if (!Array.isArray(body?.records)) {
      throw new BadRequestException('records must be an array');
    }

    return this.weatherService.importMany(body.records);
  }

  @Get('cities')
  @ApiOperation({ summary: 'Search Brazilian cities for user selection' })
  @ApiQuery({ name: 'q', required: true, description: 'City name or partial term' })
  searchCities(@Query('q') query: string) {
    return this.weatherService.searchCities(query || '');
  }

  @Get('live')
  @ApiOperation({ summary: 'Retrieve current weather and rotating insight bundle for a city' })
  @ApiQuery({ name: 'latitude', required: false })
  @ApiQuery({ name: 'longitude', required: false })
  @ApiQuery({ name: 'cityName', required: false })
  @ApiQuery({ name: 'stateName', required: false })
  @ApiQuery({ name: 'stateCode', required: false })
  @ApiQuery({ name: 'timezone', required: false })
  getLiveWeather(@Query() query: WeatherLocationQueryDto) {
    return this.weatherService.getLiveWeather({
      latitude: this.parseNumber(query.latitude),
      longitude: this.parseNumber(query.longitude),
      cityName: query.cityName,
      stateName: query.stateName,
      stateCode: query.stateCode,
      timezone: query.timezone,
    });
  }

  @Get('history')
  @ApiOperation({ summary: 'Retrieve hourly historical weather for a city' })
  @ApiQuery({ name: 'latitude', required: false })
  @ApiQuery({ name: 'longitude', required: false })
  @ApiQuery({ name: 'cityName', required: false })
  @ApiQuery({ name: 'stateName', required: false })
  @ApiQuery({ name: 'stateCode', required: false })
  @ApiQuery({ name: 'timezone', required: false })
  @ApiQuery({ name: 'startDate', required: false, description: 'YYYY-MM-DD' })
  @ApiQuery({ name: 'endDate', required: false, description: 'YYYY-MM-DD' })
  @ApiQuery({ name: 'days', required: false, description: 'Fallback range when no explicit start/end is provided' })
  getHistory(
    @Query() query: WeatherLocationQueryDto & { startDate?: string; endDate?: string; days?: string },
  ) {
    return this.weatherService.getHistory({
      latitude: this.parseNumber(query.latitude),
      longitude: this.parseNumber(query.longitude),
      cityName: query.cityName,
      stateName: query.stateName,
      stateCode: query.stateCode,
      timezone: query.timezone,
      startDate: this.toDateOnly(query.startDate),
      endDate: this.toDateOnly(query.endDate),
      days: query.days ? Number.parseInt(query.days, 10) : undefined,
    });
  }

  @Get()
  @ApiOperation({ summary: 'Retrieve stored weather history from ingestion pipeline' })
  @ApiQuery({ name: 'limit', required: false, description: 'Number of records (0 for all)' })
  @ApiQuery({ name: 'start', required: false, description: 'Start date (ISO)' })
  @ApiQuery({ name: 'end', required: false, description: 'End date (ISO)' })
  @ApiResponse({ status: 200, description: 'List of weather records', type: [Weather] })
  findAll(
    @Query('limit') limit?: string,
    @Query('start') start?: string,
    @Query('end') end?: string,
  ) {
    const quantity = limit !== undefined ? Number.parseInt(limit, 10) : 100;
    return this.weatherService.findAll(quantity, start, end);
  }

  @Get('export/csv')
  @ApiOperation({ summary: 'Download weather history as CSV' })
  async exportCsv(
    @Res() res: Response,
    @Query() query?: WeatherLocationQueryDto & { startDate?: string; endDate?: string; days?: string },
  ) {
    try {
      const data = await this.resolveExportData(query);
      const parser = new Parser({
        fields: ['collected_at', 'temp', 'humidity', 'wind_speed', 'precipitation', 'is_day'],
      });
      const csv = parser.parse(data);

      res.header('Content-Type', 'text/csv');
      res.attachment(`weather_history_${Date.now()}.csv`);
      return res.send(csv);
    } catch (err) {
      this.logger.error('Failed to export CSV', err);
      return res.status(500).json({ message: 'Error generating CSV', error: err });
    }
  }

  @Get('export/xlsx')
  @ApiOperation({ summary: 'Download weather history as Excel (XLSX)' })
  async exportXlsx(
    @Res() res: Response,
    @Query() query?: WeatherLocationQueryDto & { startDate?: string; endDate?: string; days?: string },
  ) {
    try {
      const data = await this.resolveExportData(query);
      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet('GDASH Report', {
        views: [{ showGridLines: false }],
      });

      worksheet.mergeCells('A1:F1');
      const titleCell = worksheet.getCell('A1');
      titleCell.value = 'CLIMATE MONITORING REPORT - GDASH';
      titleCell.font = {
        name: EXCEL_STYLES.FONT_FAMILY,
        size: 16,
        bold: true,
        color: { argb: EXCEL_STYLES.TEXT_WHITE },
      };
      titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: EXCEL_STYLES.TITLE_BG } };
      titleCell.alignment = { vertical: 'middle', horizontal: 'center' };
      worksheet.getRow(1).height = 30;

      worksheet.getRow(2).values = [
        'Timestamp',
        'Temperature (C)',
        'Humidity (%)',
        'Wind Speed (km/h)',
        'Precipitation (mm)',
        'Period',
      ];

      worksheet.columns = [
        { key: 'collected_at', width: 25 },
        { key: 'temp', width: 18 },
        { key: 'humidity', width: 15 },
        { key: 'wind_speed', width: 18 },
        { key: 'precipitation', width: 20 },
        { key: 'period', width: 16 },
      ];

      const headerRow = worksheet.getRow(2);
      headerRow.height = 20;
      headerRow.eachCell((cell) => {
        cell.font = { name: EXCEL_STYLES.FONT_FAMILY, bold: true, color: { argb: EXCEL_STYLES.TEXT_WHITE } };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: EXCEL_STYLES.HEADER_BG } };
        cell.alignment = { vertical: 'middle', horizontal: 'center' };
        cell.border = {
          top: { style: 'thin' },
          left: { style: 'thin' },
          bottom: { style: 'thin' },
          right: { style: 'thin' },
        };
      });

      data.forEach((item) => {
        const row = worksheet.addRow({
          collected_at: new Date(item.collected_at).toLocaleString('pt-BR'),
          temp: item.temp,
          humidity: item.humidity,
          wind_speed: item.wind_speed,
          precipitation: item.precipitation,
          period: item.is_day === 1 ? 'Day' : 'Night',
        });

        row.eachCell((cell) => {
          cell.border = {
            top: { style: 'thin' },
            left: { style: 'thin' },
            bottom: { style: 'thin' },
            right: { style: 'thin' },
          };
          cell.alignment = { vertical: 'middle', horizontal: 'center' };
        });
      });

      res.header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.attachment(`gdash_report_${Date.now()}.xlsx`);

      await workbook.xlsx.write(res);
      res.end();
    } catch (err) {
      this.logger.error('Failed to export Excel', err);
      return res.status(500).json({ message: 'Error generating Excel file', error: err });
    }
  }

  private async resolveExportData(
    query?: WeatherLocationQueryDto & { startDate?: string; endDate?: string; days?: string },
  ): Promise<WeatherHistoryPoint[]> {
    if (query?.latitude && query?.longitude) {
      const history = await this.weatherService.getHistory({
        latitude: this.parseNumber(query.latitude),
        longitude: this.parseNumber(query.longitude),
        cityName: query.cityName,
        stateName: query.stateName,
        stateCode: query.stateCode,
        timezone: query.timezone,
        startDate: this.toDateOnly(query.startDate),
        endDate: this.toDateOnly(query.endDate),
        days: query.days ? Number.parseInt(query.days, 10) : 30,
      });

      return history.points;
    }

    const data = await this.weatherService.findAll(0);
    return data.map((item) => ({
      collected_at: item.collected_at,
      temp: item.temp,
      humidity: item.humidity,
      wind_speed: item.wind_speed,
      precipitation: item.precipitation,
      is_day: item.is_day,
    }));
  }

  private parseNumber(value?: string) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  private toDateOnly(value?: string) {
    if (!value) {
      return undefined;
    }

    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      return undefined;
    }

    return parsed.toISOString().slice(0, 10);
  }

  private assertSyncSecret(secret?: string) {
    const configuredSecret = process.env.WEATHER_SYNC_SECRET?.trim();

    if (!configuredSecret) {
      throw new UnauthorizedException('Weather sync is not configured.');
    }

    if (!secret || secret !== configuredSecret) {
      throw new UnauthorizedException('Invalid weather sync secret.');
    }
  }
}
