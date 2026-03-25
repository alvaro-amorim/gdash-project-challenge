import {
  Injectable,
  InternalServerErrorException,
  Logger,
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

type EmailDeliveryMode = 'resend' | 'smtp' | 'disabled';

type LoginCodeEmailMessage = {
  subject: string;
  text: string;
  html: string;
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
    const user = await this.findOrCreateEmailUser(email);

    const loginCode = String(randomInt(100000, 999999));
    user.loginCodeHash = this.hashLoginCode(loginCode);
    user.loginCodeExpiresAt = new Date(Date.now() + this.loginCodeTtlMs);
    await this.usersService.save(user);

    const emailSent = await this.sendLoginCodeEmail(user, loginCode);
    if (emailSent) {
      return { sent: true };
    }

    if (process.env.NODE_ENV === 'production') {
      throw new InternalServerErrorException('O envio por e-mail está indisponível no momento.');
    }

    return { sent: false, devCode: loginCode };
  }

  async verifyLoginCode(email: string, code: string): Promise<AuthResponse> {
    const user = await this.usersService.findByEmail(email);

    if (!user || !user.loginCodeHash || !user.loginCodeExpiresAt) {
      throw new UnauthorizedException('Código inválido ou expirado.');
    }

    if (!user.isActive) {
      throw new UnauthorizedException('Este acesso está desativado.');
    }

    if (user.loginCodeExpiresAt.getTime() < Date.now()) {
      user.loginCodeHash = undefined;
      user.loginCodeExpiresAt = undefined;
      await this.usersService.save(user);
      throw new UnauthorizedException('Código inválido ou expirado.');
    }

    if (user.loginCodeHash !== this.hashLoginCode(code.trim())) {
      throw new UnauthorizedException('Código inválido ou expirado.');
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
      throw new InternalServerErrorException('O login com Google não está configurado.');
    }

    const ticket = await this.googleClient.verifyIdToken({
      idToken,
      audience: googleClientId,
    });

    const payload = ticket.getPayload();

    if (!payload?.email || !payload.email_verified) {
      throw new UnauthorizedException('A conta Google precisa ter um e-mail verificado.');
    }

    let user = await this.usersService.findByEmail(payload.email);

    if (!user) {
      user = await this.usersService.createRaw({
        name: payload.name || payload.email.split('@')[0],
        email: payload.email,
        avatarUrl: payload.picture || undefined,
        role: 'user',
        provider: 'google',
        googleId: payload.sub,
        emailVerified: true,
        createdBy: 'google-oauth',
      });
    }

    if (!user.isActive) {
      throw new UnauthorizedException('Este acesso está desativado.');
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

  getPublicConfig() {
    const emailDeliveryMode = this.resolveEmailDeliveryMode();

    return {
      googleClientId: process.env.GOOGLE_CLIENT_ID?.trim() || '',
      emailLoginEnabled: emailDeliveryMode !== 'disabled',
      emailDeliveryMode,
    };
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

  private async findOrCreateEmailUser(email: string): Promise<UserDocument> {
    const normalizedEmail = email.toLowerCase().trim();
    const existingUser = await this.usersService.findByEmail(normalizedEmail);

    if (existingUser) {
      if (!existingUser.isActive) {
        throw new UnauthorizedException('Este acesso está desativado.');
      }

      return existingUser;
    }

    return this.usersService.createRaw({
      name: this.deriveDisplayNameFromEmail(normalizedEmail),
      email: normalizedEmail,
      role: 'user',
      provider: 'email',
      emailVerified: false,
      createdBy: 'self-signup',
    });
  }

  private deriveDisplayNameFromEmail(email: string): string {
    const [localPart = 'novo usuario'] = email.split('@');
    const collapsed = localPart
      .replace(/[._-]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    if (!collapsed) {
      return 'Novo usuario';
    }

    return collapsed
      .split(' ')
      .filter(Boolean)
      .map((chunk) => chunk.charAt(0).toUpperCase() + chunk.slice(1))
      .join(' ');
  }

  private async sendLoginCodeEmail(user: UserDocument, loginCode: string): Promise<boolean> {
    const message = this.buildLoginCodeEmailMessage(loginCode);

    // Free hosts like Render block outbound SMTP, so prefer HTTPS delivery when available.
    if (await this.sendLoginCodeWithResend(user, message)) {
      return true;
    }

    if (await this.sendLoginCodeWithSmtp(user, message)) {
      return true;
    }

    this.logger.warn(`Email provider not configured. Login code for ${user.email}: ${loginCode}`);
    return false;
  }

  private resolveEmailDeliveryMode(): EmailDeliveryMode {
    const resendApiKey = process.env.RESEND_API_KEY?.trim();
    const resendFromEmail = process.env.RESEND_FROM_EMAIL?.trim();

    if (resendApiKey && resendFromEmail) {
      return 'resend';
    }

    const smtpHost = process.env.SMTP_HOST?.trim();
    const smtpFromEmail = process.env.SMTP_FROM_EMAIL?.trim();

    if (smtpHost && smtpFromEmail) {
      return 'smtp';
    }

    return 'disabled';
  }

  private buildLoginCodeEmailMessage(loginCode: string): LoginCodeEmailMessage {
    return {
      subject: 'Seu código de acesso ao GDASH',
      text:
        `Use este código para entrar no GDASH: ${loginCode}.\n\n` +
        'Ele expira em 10 minutos. Se você não pediu esse acesso, pode ignorar esta mensagem.',
      html:
        '<div style="font-family:Arial,sans-serif;line-height:1.6;color:#102033">' +
        '<p>Use este código para entrar no <strong>GDASH</strong>:</p>' +
        `<p style="font-size:28px;font-weight:700;letter-spacing:0.22em;margin:16px 0">${loginCode}</p>` +
        '<p>Ele expira em 10 minutos.</p>' +
        '<p>Se você não pediu esse acesso, pode ignorar esta mensagem.</p>' +
        '</div>',
    };
  }

  private async sendLoginCodeWithResend(
    user: UserDocument,
    message: LoginCodeEmailMessage,
  ): Promise<boolean> {
    const apiKey = process.env.RESEND_API_KEY?.trim();
    const fromEmail = process.env.RESEND_FROM_EMAIL?.trim();

    if (!apiKey || !fromEmail) {
      return false;
    }

    try {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: fromEmail,
          to: [user.email],
          subject: message.subject,
          text: message.text,
          html: message.html,
        }),
      });

      if (!response.ok) {
        const errorBody = await response.text();
        this.logger.warn(`Resend request failed with status ${response.status}. ${errorBody}`);
        return false;
      }

      return true;
    } catch (error) {
      this.logger.warn(`Failed to send email via Resend. ${error}`);
      return false;
    }
  }

  private async sendLoginCodeWithSmtp(
    user: UserDocument,
    message: LoginCodeEmailMessage,
  ): Promise<boolean> {
    const fromEmail = process.env.SMTP_FROM_EMAIL?.trim();
    const smtpHost = process.env.SMTP_HOST?.trim();

    if (!fromEmail || !smtpHost) {
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
        subject: message.subject,
        text: message.text,
        html: message.html,
      });

      return true;
    } catch (error) {
      this.logger.warn(`Failed to send email via SMTP. ${error}`);
      return false;
    }
  }
}
