import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { UserRole } from '../entities/user.schema';

export class CreateUserDto {
  @ApiProperty({ example: 'Maria Silva' })
  name: string;

  @ApiProperty({ example: 'maria@gdash.io' })
  email: string;

  @ApiPropertyOptional({ example: 'user', enum: ['admin', 'user'] })
  role?: UserRole;

  @ApiPropertyOptional({ example: 'https://example.com/avatar.png' })
  avatarUrl?: string;

  @ApiPropertyOptional({ example: 'Juiz de Fora' })
  preferredCityName?: string;

  @ApiPropertyOptional({ example: 'Minas Gerais' })
  preferredStateName?: string;

  @ApiPropertyOptional({ example: 'MG' })
  preferredStateCode?: string;

  @ApiPropertyOptional({ example: -21.7642 })
  preferredLatitude?: number;

  @ApiPropertyOptional({ example: -43.3503 })
  preferredLongitude?: number;

  @ApiPropertyOptional({ example: 'America/Sao_Paulo' })
  preferredTimezone?: string;
}
