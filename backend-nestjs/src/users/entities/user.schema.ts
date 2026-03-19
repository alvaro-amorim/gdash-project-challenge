import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type UserDocument = HydratedDocument<User>;
export type UserRole = 'admin' | 'user';
export type AuthProvider = 'email' | 'google';

@Schema({ timestamps: true, collection: 'users' })
export class User {
  @Prop({ required: true, trim: true })
  name: string;

  @Prop({ required: true, unique: true, lowercase: true, trim: true })
  email: string;

  @Prop({ enum: ['admin', 'user'], default: 'user' })
  role: UserRole;

  @Prop({ enum: ['email', 'google'], default: 'email' })
  provider: AuthProvider;

  @Prop()
  googleId?: string;

  @Prop()
  avatarUrl?: string;

  @Prop()
  preferredCityName?: string;

  @Prop()
  preferredStateName?: string;

  @Prop()
  preferredStateCode?: string;

  @Prop()
  preferredLatitude?: number;

  @Prop()
  preferredLongitude?: number;

  @Prop()
  preferredTimezone?: string;

  @Prop({ default: false })
  emailVerified: boolean;

  @Prop({ default: true })
  isActive: boolean;

  @Prop()
  loginCodeHash?: string;

  @Prop({ type: Date })
  loginCodeExpiresAt?: Date;

  @Prop({ type: Date })
  lastLoginAt?: Date;

  @Prop()
  createdBy?: string;

  createdAt?: Date;
  updatedAt?: Date;
}

export const UserSchema = SchemaFactory.createForClass(User);
