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
}
