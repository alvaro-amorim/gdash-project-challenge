import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiProperty,
  ApiTags,
} from '@nestjs/swagger';
import type { Request } from 'express';
import { UpdateUserDto } from '../users/dto/update-user.dto';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';

class RequestLoginCodeDto {
  @ApiProperty({ example: 'admin@gdash.io' })
  email: string;
}

class VerifyLoginCodeDto {
  @ApiProperty({ example: 'admin@gdash.io' })
  email: string;

  @ApiProperty({ example: '123456' })
  code: string;
}

class GoogleLoginDto {
  @ApiProperty({ example: 'google-id-token' })
  credential: string;
}

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('request-login-code')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Send an email login verification code' })
  @ApiBody({ type: RequestLoginCodeDto })
  requestLoginCode(@Body() body: RequestLoginCodeDto) {
    return this.authService.requestLoginCode(body.email);
  }

  @Post('verify-login-code')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Validate the login verification code and issue JWT' })
  @ApiBody({ type: VerifyLoginCodeDto })
  verifyLoginCode(@Body() body: VerifyLoginCodeDto) {
    return this.authService.verifyLoginCode(body.email, body.code);
  }

  @Post('google')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Login with Google identity token' })
  @ApiBody({ type: GoogleLoginDto })
  loginWithGoogle(@Body() body: GoogleLoginDto) {
    return this.authService.loginWithGoogle(body.credential);
  }

  @Get('public-config')
  @ApiOperation({ summary: 'Return public authentication configuration' })
  getPublicConfig() {
    return this.authService.getPublicConfig();
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get the authenticated user profile' })
  getProfile(@Req() req: Request & { user: { sub: string } }) {
    return this.authService.getProfile(req.user.sub);
  }

  @Patch('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Update the authenticated user profile' })
  updateProfile(
    @Req() req: Request & { user: { sub: string } },
    @Body() updateUserDto: UpdateUserDto,
  ) {
    return this.authService.updateProfile(req.user.sub, updateUserDto);
  }
}
