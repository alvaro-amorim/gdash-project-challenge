import { InternalServerErrorException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test, TestingModule } from '@nestjs/testing';
import { UsersService } from '../users/users.service';
import { AuthService } from './auth.service';

describe('AuthService', () => {
  let service: AuthService;
  let usersService: {
    findByEmail: jest.Mock;
    save: jest.Mock;
    findByIdOrThrow: jest.Mock;
    toPublicUser: jest.Mock;
    updateProfile: jest.Mock;
    createRaw: jest.Mock;
  };

  const originalEnv = process.env;

  beforeEach(async () => {
    process.env = { ...originalEnv };
    jest.restoreAllMocks();

    usersService = {
      findByEmail: jest.fn(),
      save: jest.fn(),
      findByIdOrThrow: jest.fn(),
      toPublicUser: jest.fn(),
      updateProfile: jest.fn(),
      createRaw: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        {
          provide: UsersService,
          useValue: usersService,
        },
        {
          provide: JwtService,
          useValue: {
            sign: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('sends login codes with Resend when configured', async () => {
    process.env.RESEND_API_KEY = 're_test';
    process.env.RESEND_FROM_EMAIL = 'GDASH <onboarding@resend.dev>';

    const user = {
      email: 'user@example.com',
      isActive: true,
    } as any;

    usersService.findByEmail.mockResolvedValue(user);
    usersService.save.mockResolvedValue(user);
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
    } as Response);

    await expect(service.requestLoginCode(user.email)).resolves.toEqual({ sent: true });
    expect(global.fetch).toHaveBeenCalledWith(
      'https://api.resend.com/emails',
      expect.objectContaining({
        method: 'POST',
      }),
    );
  });

  it('creates a user automatically on the first email login request', async () => {
    process.env.NODE_ENV = 'test';

    const createdUser = {
      email: 'new.user@example.com',
      isActive: true,
    } as any;

    usersService.findByEmail.mockResolvedValue(null);
    usersService.createRaw.mockResolvedValue(createdUser);
    usersService.save.mockResolvedValue(createdUser);

    const response = await service.requestLoginCode(createdUser.email);

    expect(usersService.createRaw).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'new.user@example.com',
        name: 'New User',
        role: 'user',
        provider: 'email',
        createdBy: 'self-signup',
      }),
    );
    expect(response.sent).toBe(false);
    expect(response.devCode).toMatch(/^\d{6}$/);
  });

  it('rejects email login for inactive users', async () => {
    usersService.findByEmail.mockResolvedValue({
      email: 'inactive@example.com',
      isActive: false,
    });

    await expect(service.requestLoginCode('inactive@example.com')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(usersService.createRaw).not.toHaveBeenCalled();
  });

  it('returns a dev code when no email provider is configured outside production', async () => {
    delete process.env.RESEND_API_KEY;
    delete process.env.RESEND_FROM_EMAIL;
    delete process.env.SMTP_HOST;
    delete process.env.SMTP_FROM_EMAIL;
    process.env.NODE_ENV = 'test';

    const user = {
      email: 'user@example.com',
      isActive: true,
    } as any;

    usersService.findByEmail.mockResolvedValue(user);
    usersService.save.mockResolvedValue(user);

    const response = await service.requestLoginCode(user.email);

    expect(response.sent).toBe(false);
    expect(response.devCode).toMatch(/^\d{6}$/);
  });

  it('throws in production when email login is unavailable', async () => {
    delete process.env.RESEND_API_KEY;
    delete process.env.RESEND_FROM_EMAIL;
    delete process.env.SMTP_HOST;
    delete process.env.SMTP_FROM_EMAIL;
    process.env.NODE_ENV = 'production';

    const user = {
      email: 'user@example.com',
      isActive: true,
    } as any;

    usersService.findByEmail.mockResolvedValue(user);
    usersService.save.mockResolvedValue(user);

    await expect(service.requestLoginCode(user.email)).rejects.toBeInstanceOf(
      InternalServerErrorException,
    );
  });
});
