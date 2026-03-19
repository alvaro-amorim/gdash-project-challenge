import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiProperty,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import type { Request } from 'express';
import { AdminGuard } from '../auth/admin.guard';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AnalyticsService } from './analytics.service';

class VisitSessionDto {
  @ApiProperty({ example: '8d7b8f3d-7f7d-4c56-8b1f-b7f2440a1f95' })
  sessionId: string;

  @ApiProperty({ example: '/dashboard', required: false })
  path?: string;
}

@ApiTags('Analytics')
@Controller('analytics')
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  @Get('active-users')
  @ApiOperation({ summary: 'Return the current number of active users' })
  getActiveUsers() {
    return this.analyticsService.getActiveUsersSummary();
  }

  @Post('visits/start')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Start or refresh a logged-in user visit session' })
  @ApiBody({ type: VisitSessionDto })
  startVisit(
    @Body() body: VisitSessionDto,
    @Req() req: Request & { user: { sub: string; email: string; name: string } },
  ) {
    return this.analyticsService.startVisit({
      sessionId: body.sessionId,
      path: body.path,
      userAgent: req.headers['user-agent'],
      ip: req.ip,
      user: req.user,
    });
  }

  @Post('visits/heartbeat')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update the active session heartbeat' })
  @ApiBody({ type: VisitSessionDto })
  heartbeat(
    @Body() body: VisitSessionDto,
    @Req() req: Request & { user: { sub: string; email: string; name: string } },
  ) {
    return this.analyticsService.heartbeat({
      sessionId: body.sessionId,
      path: body.path,
      userAgent: req.headers['user-agent'],
      ip: req.ip,
      user: req.user,
    });
  }

  @Post('visits/end')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'End the active visit session' })
  @ApiBody({ type: VisitSessionDto })
  endVisit(@Body() body: VisitSessionDto) {
    return this.analyticsService.endVisit(body.sessionId);
  }

  @Get('overview')
  @UseGuards(JwtAuthGuard, AdminGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Admin overview with usage metrics' })
  getOverview() {
    return this.analyticsService.getOverview();
  }

  @Get('visits')
  @UseGuards(JwtAuthGuard, AdminGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Admin visit history' })
  @ApiQuery({ name: 'limit', required: false, example: 100 })
  getVisits(@Query('limit') limit?: string) {
    const parsedLimit = limit ? Number.parseInt(limit, 10) : 100;
    return this.analyticsService.getVisits(parsedLimit);
  }
}
