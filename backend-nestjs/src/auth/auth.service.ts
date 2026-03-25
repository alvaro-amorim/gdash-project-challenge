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
    const message = this.buildLoginCodeEmailMessage(user, loginCode);

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

  private buildLoginCodeEmailMessage(
    user: Pick<UserDocument, 'name' | 'email'>,
    loginCode: string,
  ): LoginCodeEmailMessage {
    const greetingName = this.escapeHtml(this.resolveGreetingName(user));
    const panelUrl = 'https://gdash.comercias.com.br';

    return {
      subject: 'Seu código de acesso ao GDASH',
      text:
        `Olá, ${this.resolveGreetingName(user)}!\n\n` +
        `Seu código de acesso ao GDASH é ${loginCode}.\n\n` +
        `Ele expira em 10 minutos.\n\n` +
        `Abra o painel em ${panelUrl} para concluir a entrada.\n` +
        'Se você não pediu esse acesso, pode ignorar esta mensagem.',
      html:
        '<!doctype html>' +
        '<html lang="pt-BR">' +
        '<head>' +
        '<meta charset="utf-8" />' +
        '<meta name="viewport" content="width=device-width, initial-scale=1.0" />' +
        '<title>Seu código de acesso ao GDASH</title>' +
        '</head>' +
        '<body style="margin:0;padding:0;background-color:#f4efe7;color:#102033;">' +
        '<div style="display:none;max-height:0;overflow:hidden;opacity:0;">' +
        `Seu código de acesso ao GDASH é ${loginCode}. Ele expira em 10 minutos.` +
        '</div>' +
        '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;background-color:#f4efe7;">' +
        '<tr>' +
        '<td align="center" style="padding:32px 16px;">' +
        '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:620px;border-collapse:collapse;">' +
        '<tr>' +
        '<td style="padding:0 0 18px 0;font-family:Arial,sans-serif;font-size:12px;letter-spacing:0.22em;text-transform:uppercase;color:#5e7488;text-align:center;">' +
        'Portal GDASH' +
        '</td>' +
        '</tr>' +
        '<tr>' +
        '<td style="border-radius:28px;overflow:hidden;background:linear-gradient(145deg,#0f2236,#153a59);box-shadow:0 26px 70px -42px rgba(12,24,40,0.85);">' +
        '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;">' +
        '<tr>' +
        '<td style="padding:28px 32px 18px 32px;">' +
        '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;">' +
        '<tr>' +
        '<td style="font-family:Arial,sans-serif;font-size:12px;font-weight:700;letter-spacing:0.24em;text-transform:uppercase;color:#8ecfcb;">' +
        'Acesso ao painel' +
        '</td>' +
        '<td align="right">' +
        '<span style="display:inline-block;border-radius:999px;background-color:rgba(12,168,154,0.14);border:1px solid rgba(97,208,191,0.18);padding:8px 14px;font-family:Arial,sans-serif;font-size:11px;font-weight:700;letter-spacing:0.18em;text-transform:uppercase;color:#b7efea;">' +
        'Válido por 10 min' +
        '</span>' +
        '</td>' +
        '</tr>' +
        '<tr>' +
        '<td colspan="2" style="padding-top:18px;font-family:Arial,sans-serif;font-size:38px;line-height:1.15;font-weight:700;color:#ffffff;">' +
        'Seu código chegou.' +
        '</td>' +
        '</tr>' +
        '<tr>' +
        '<td colspan="2" style="padding-top:14px;font-family:Arial,sans-serif;font-size:16px;line-height:1.7;color:#d5e2eb;">' +
        `Olá, ${greetingName}. Use o código abaixo para entrar no GDASH e continuar de onde parou.` +
        '</td>' +
        '</tr>' +
        '</table>' +
        '</td>' +
        '</tr>' +
        '<tr>' +
        '<td style="padding:0 32px 32px 32px;">' +
        '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;border-radius:24px;background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.12);">' +
        '<tr>' +
        '<td align="center" style="padding:14px 20px 6px 20px;font-family:Arial,sans-serif;font-size:11px;font-weight:700;letter-spacing:0.22em;text-transform:uppercase;color:#8fb1c3;">' +
        'Código de verificação' +
        '</td>' +
        '</tr>' +
        '<tr>' +
        '<td align="center" style="padding:6px 20px 12px 20px;font-family:Arial,sans-serif;font-size:34px;line-height:1.1;font-weight:700;letter-spacing:0.32em;color:#ffffff;">' +
        `${loginCode}` +
        '</td>' +
        '</tr>' +
        '<tr>' +
        '<td align="center" style="padding:0 20px 22px 20px;font-family:Arial,sans-serif;font-size:14px;line-height:1.6;color:#c3d5e0;">' +
        'Digite esse código na tela de acesso para concluir a entrada.' +
        '</td>' +
        '</tr>' +
        '</table>' +
        '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border-collapse:collapse;margin-top:18px;">' +
        '<tr>' +
        '<td style="font-family:Arial,sans-serif;font-size:14px;line-height:1.7;color:#c3d5e0;">' +
        'Se você não pediu esse acesso, pode ignorar este e-mail com segurança.' +
        '</td>' +
        '</tr>' +
        '<tr>' +
        '<td style="padding-top:18px;">' +
        `<a href="${panelUrl}" style="display:inline-block;border-radius:18px;background:#0ca89a;padding:13px 18px;font-family:Arial,sans-serif;font-size:14px;font-weight:700;color:#ffffff;text-decoration:none;">Abrir painel</a>` +
        '</td>' +
        '</tr>' +
        '</table>' +
        '</td>' +
        '</tr>' +
        '</table>' +
        '</td>' +
        '</tr>' +
        '<tr>' +
        '<td style="padding:18px 18px 0 18px;font-family:Arial,sans-serif;font-size:12px;line-height:1.7;color:#6d7f8f;text-align:center;">' +
        'GDASH · Painel climático com leitura ao vivo, histórico por cidade e recortes operacionais.' +
        '</td>' +
        '</tr>' +
        '<tr>' +
        '<td style="padding:8px 18px 0 18px;font-family:Arial,sans-serif;font-size:12px;line-height:1.7;color:#8b99a5;text-align:center;">' +
        `Acesse: <a href="${panelUrl}" style="color:#153a59;text-decoration:none;">${panelUrl}</a>` +
        '</td>' +
        '</tr>' +
        '</table>' +
        '</td>' +
        '</tr>' +
        '</table>' +
        '</body>' +
        '</html>',
    };
  }

  private resolveGreetingName(user: Pick<UserDocument, 'name' | 'email'>): string {
    const source = user.name?.trim() || this.deriveDisplayNameFromEmail(user.email);
    const [firstName = ''] = source.split(' ').filter(Boolean);
    return firstName || 'Olá';
  }

  private escapeHtml(value: string): string {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
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
