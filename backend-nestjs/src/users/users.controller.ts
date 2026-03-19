import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProperty, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { AdminGuard } from '../auth/admin.guard';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CreateUserDto as CreateUserPayloadDto } from './dto/create-user.dto';
import { UsersService } from './users.service';

class CreateUserApiDto {
  @ApiProperty({ example: 'User Name' }) name: string;
  @ApiProperty({ example: 'user@gdash.io' }) email: string;
  @ApiProperty({ example: 'user' }) role?: 'admin' | 'user';
  @ApiProperty({ example: 'https://example.com/avatar.png', required: false }) avatarUrl?: string;
}

@ApiTags('Users')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, AdminGuard)
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Post()
  @ApiOperation({ summary: 'Create a new user' })
  create(
    @Body() createUserDto: CreateUserPayloadDto,
    @Req() req: Request & { user: { email: string } },
  ) {
    return this.usersService.create(createUserDto, req.user.email);
  }

  @Get()
  @ApiOperation({ summary: 'List all users' })
  findAll() {
    return this.usersService.findAll();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get user by ID' })
  findOne(@Param('id') id: string) {
    return this.usersService.findOne(id);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete user' })
  remove(@Param('id') id: string) {
    return this.usersService.remove(id);
  }
}
