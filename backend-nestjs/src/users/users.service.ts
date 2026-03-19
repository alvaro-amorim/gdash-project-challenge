import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { AuthProvider, User, UserDocument, UserRole } from './entities/user.schema';

type CreateUserInput = CreateUserDto & {
  createdBy?: string;
  emailVerified?: boolean;
  googleId?: string;
  isActive?: boolean;
  provider?: AuthProvider;
  role?: UserRole;
};

@Injectable()
export class UsersService implements OnModuleInit {
  private readonly logger = new Logger(UsersService.name);

  constructor(@InjectModel(User.name) private userModel: Model<UserDocument>) {}

  async onModuleInit() {
    const adminEmail = (process.env.ADMIN_EMAIL || 'admin@gdash.io').toLowerCase();
    try {
      const exists = await this.userModel.findOne({ email: adminEmail });
      if (!exists) {
        await this.userModel.create({
          name: process.env.ADMIN_NAME || 'Admin GDASH',
          email: adminEmail,
          role: 'admin',
          provider: 'email',
          emailVerified: false,
          createdBy: 'system',
        });
        this.logger.log(`Default admin user created: ${adminEmail}`);
      }
    } catch (error) {
      this.logger.error('Failed to initialize default admin user', error);
    }
  }

  async findByEmail(email: string): Promise<UserDocument | null> {
    return this.userModel.findOne({ email: email.toLowerCase().trim() }).exec();
  }

  async findByIdRaw(id: string): Promise<UserDocument | null> {
    return this.userModel.findById(id).exec();
  }

  async findByIdOrThrow(id: string): Promise<UserDocument> {
    const user = await this.findByIdRaw(id);
    if (!user) {
      throw new NotFoundException('User not found');
    }
    return user;
  }

  async create(createUserDto: CreateUserDto, createdBy = 'admin'): Promise<Record<string, unknown>> {
    const savedUser = await this.createRaw({
      ...createUserDto,
      createdBy,
      provider: 'email',
      emailVerified: false,
      role: createUserDto.role || 'user',
    });

    return this.toPublicUser(savedUser);
  }

  async createRaw(createUserDto: CreateUserInput): Promise<UserDocument> {
    const normalizedEmail = createUserDto.email.toLowerCase().trim();
    const existing = await this.userModel.findOne({ email: normalizedEmail });
    if (existing) {
      throw new ConflictException('Email already exists');
    }

    const createdUser = new this.userModel({
      ...createUserDto,
      email: normalizedEmail,
      role: createUserDto.role || 'user',
      provider: createUserDto.provider || 'email',
      emailVerified: createUserDto.emailVerified ?? false,
      createdBy: createUserDto.createdBy || 'admin',
    });

    return createdUser.save();
  }

  async findAll(): Promise<Record<string, unknown>[]> {
    const users = await this.userModel.find().sort({ createdAt: -1 }).exec();
    return users.map((user) => this.toPublicUser(user));
  }

  async findOne(id: string): Promise<Record<string, unknown>> {
    const user = await this.findByIdOrThrow(id);
    return this.toPublicUser(user);
  }

  async remove(id: string): Promise<void> {
    const result = await this.userModel.findByIdAndDelete(id).exec();
    if (!result) throw new NotFoundException('User not found');
  }

  async updateProfile(id: string, updateUserDto: UpdateUserDto): Promise<Record<string, unknown>> {
    const user = await this.findByIdOrThrow(id);

    if (updateUserDto.email && updateUserDto.email.toLowerCase().trim() !== user.email) {
      const existing = await this.userModel.findOne({
        email: updateUserDto.email.toLowerCase().trim(),
        _id: { $ne: id },
      });

      if (existing) {
        throw new ConflictException('Email already exists');
      }

      user.email = updateUserDto.email.toLowerCase().trim();
      user.emailVerified = false;
    }

    if (updateUserDto.name) {
      user.name = updateUserDto.name.trim();
    }

    if (updateUserDto.avatarUrl !== undefined) {
      user.avatarUrl = updateUserDto.avatarUrl?.trim() || undefined;
    }

    if (updateUserDto.preferredCityName !== undefined) {
      user.preferredCityName = updateUserDto.preferredCityName?.trim() || undefined;
    }

    if (updateUserDto.preferredStateName !== undefined) {
      user.preferredStateName = updateUserDto.preferredStateName?.trim() || undefined;
    }

    if (updateUserDto.preferredStateCode !== undefined) {
      user.preferredStateCode = updateUserDto.preferredStateCode?.trim().toUpperCase() || undefined;
    }

    if (updateUserDto.preferredLatitude !== undefined) {
      user.preferredLatitude = updateUserDto.preferredLatitude ?? undefined;
    }

    if (updateUserDto.preferredLongitude !== undefined) {
      user.preferredLongitude = updateUserDto.preferredLongitude ?? undefined;
    }

    if (updateUserDto.preferredTimezone !== undefined) {
      user.preferredTimezone = updateUserDto.preferredTimezone?.trim() || undefined;
    }

    const savedUser = await user.save();
    return this.toPublicUser(savedUser);
  }

  async save(user: UserDocument): Promise<UserDocument> {
    return user.save();
  }

  toPublicUser(user: UserDocument | (User & { _id?: unknown })): Record<string, unknown> {
    const plainUser = 'toObject' in user ? user.toObject() : user;

    return {
      id: String(plainUser._id),
      name: plainUser.name,
      email: plainUser.email,
      role: plainUser.role,
      provider: plainUser.provider,
      avatarUrl: plainUser.avatarUrl || null,
      preferredCityName: plainUser.preferredCityName || null,
      preferredStateName: plainUser.preferredStateName || null,
      preferredStateCode: plainUser.preferredStateCode || null,
      preferredLatitude: plainUser.preferredLatitude ?? null,
      preferredLongitude: plainUser.preferredLongitude ?? null,
      preferredTimezone: plainUser.preferredTimezone || null,
      emailVerified: plainUser.emailVerified,
      isActive: plainUser.isActive,
      createdBy: plainUser.createdBy || null,
      lastLoginAt: plainUser.lastLoginAt || null,
      createdAt: plainUser.createdAt || null,
      updatedAt: plainUser.updatedAt || null,
    };
  }
}
