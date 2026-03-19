import {
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { OAuth2Client } from 'google-auth-library';
import * as nodemailer from 'nodemailer';
import { createHash, randomInt } from 'crypto';
import { UpdateUserDto } from '../users/dto/update-user.dto';
import { UserDocument } from '../users/entities/user.schema';
import { UsersService } from '../users/users.service';

type AuthResponse = {
  access_token: string;
  user: Record<string, unknown>;
};

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly googleClient = new OAuth2Client();
  private readonly loginCodeTtlMs = 10 * 60 * 1000;

  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
  ) {}

  async requestLoginCode(email: string): Promise<{ sent: boolean; devCode?: string }> {
    const user = await this.usersService.findByEmail(email);

    if (!user || !user.isActive) {
      throw new NotFoundException('User not found or inactive');
    }

    const loginCode = String(randomInt(100000, 999999));
    user.loginCodeHash = this.hashLoginCode(loginCode);
    user.loginCodeExpiresAt = new Date(Date.now() + this.loginCodeTtlMs);
    await this.usersService.save(user);

    const emailSent = await this.sendLoginCodeEmail(user, loginCode);
    return emailSent ? { sent: true } : { sent: false, devCode: loginCode };
  }

  async verifyLoginCode(email: string, code: string): Promise<AuthResponse> {
    const user = await this.usersService.findByEmail(email);

    if (!user || !user.loginCodeHash || !user.loginCodeExpiresAt) {
      throw new UnauthorizedException('Invalid or expired verification code');
    }

    if (user.loginCodeExpiresAt.getTime() < Date.now()) {
      user.loginCodeHash = undefined;
      user.loginCodeExpiresAt = undefined;
      await this.usersService.save(user);
      throw new UnauthorizedException('Invalid or expired verification code');
    }

    if (user.loginCodeHash !== this.hashLoginCode(code.trim())) {
      throw new UnauthorizedException('Invalid or expired verification code');
    }

    user.loginCodeHash = undefined;
    user.loginCodeExpiresAt = undefined;
    user.emailVerified = true;
    user.lastLoginAt = new Date();
    await this.usersService.save(user);

    return this.buildAuthResponse(user);
  }

  async loginWithGoogle(idToken: string): Promise<AuthResponse> {
    const googleClientId = process.env.GOOGLE_CLIENT_ID;

    if (!googleClientId) {
      throw new InternalServerErrorException('Google login is not configured');
    }

    const ticket = await this.googleClient.verifyIdToken({
      idToken,
      audience: googleClientId,
    });

    const payload = ticket.getPayload();

    if (!payload?.email || !payload.email_verified) {
      throw new UnauthorizedException('Google account email is not verified');
    }

    let user = await this.usersService.findByEmail(payload.email);

    if (!user) {
      user = await this.usersService.createRaw(
        {
          name: payload.name || payload.email.split('@')[0],
          email: payload.email,
          avatarUrl: payload.picture || undefined,
          role: 'user',
          provider: 'google',
          googleId: payload.sub,
          emailVerified: true,
          createdBy: 'google-oauth',
        },
      );
    }

    if (!user.isActive) {
      throw new UnauthorizedException('User is inactive');
    }

    user.name = user.name || payload.name || payload.email.split('@')[0];
    user.provider = 'google';
    user.googleId = payload.sub;
    user.avatarUrl = payload.picture || user.avatarUrl;
    user.emailVerified = true;
    user.lastLoginAt = new Date();
    await this.usersService.save(user);

    return this.buildAuthResponse(user);
  }

  async getProfile(userId: string): Promise<Record<string, unknown>> {
    const user = await this.usersService.findByIdOrThrow(userId);
    return this.usersService.toPublicUser(user);
  }

  async updateProfile(userId: string, updateUserDto: UpdateUserDto): Promise<Record<string, unknown>> {
    return this.usersService.updateProfile(userId, updateUserDto);
  }

  private buildAuthResponse(user: UserDocument): AuthResponse {
    const payload = {
      sub: String(user._id),
      email: user.email,
      name: user.name,
      role: user.role,
    };

    return {
      access_token: this.jwtService.sign(payload),
      user: this.usersService.toPublicUser(user),
    };
  }

  private hashLoginCode(code: string): string {
    return createHash('sha256').update(code).digest('hex');
  }

  private async sendLoginCodeEmail(user: UserDocument, loginCode: string): Promise<boolean> {
    const fromEmail = process.env.SMTP_FROM_EMAIL;
    const smtpHost = process.env.SMTP_HOST;

    if (!fromEmail || !smtpHost) {
      this.logger.warn(
        `SMTP not configured. Login code for ${user.email}: ${loginCode}`,
      );
      return false;
    }

    try {
      const transporter = nodemailer.createTransport({
        host: smtpHost,
        port: Number(process.env.SMTP_PORT || 587),
        secure:
          process.env.SMTP_SECURE === 'true' ||
          Number(process.env.SMTP_PORT || 587) === 465,
        auth: process.env.SMTP_USER
          ? {
              user: process.env.SMTP_USER,
              pass: process.env.SMTP_PASS || '',
            }
          : undefined,
      });

      await transporter.sendMail({
        from: fromEmail,
        to: user.email,
        subject: 'Seu código de acesso GDASH',
        text: `Seu código de acesso é ${loginCode}. Ele expira em 10 minutos.`,
        html: `<p>Seu código de acesso é <strong>${loginCode}</strong>.</p><p>Ele expira em 10 minutos.</p>`,
      });

      return true;
    } catch (error) {
      this.logger.warn(`Failed to send email via SMTP. Using dev fallback. ${error}`);
      return false;
    }
  }
}
