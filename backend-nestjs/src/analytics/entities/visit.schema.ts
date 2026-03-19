import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type VisitDocument = HydratedDocument<Visit>;

@Schema({ timestamps: true, collection: 'app_visits' })
export class Visit {
  @Prop({ required: true, unique: true, trim: true })
  sessionId: string;

  @Prop({ required: true })
  userId: string;

  @Prop({ required: true })
  userName: string;

  @Prop({ required: true })
  userEmail: string;

  @Prop()
  path?: string;

  @Prop()
  userAgent?: string;

  @Prop()
  ip?: string;

  @Prop({ type: Date, default: Date.now })
  startedAt: Date;

  @Prop({ type: Date, default: Date.now })
  lastSeenAt: Date;

  @Prop({ type: Date })
  endedAt?: Date | null;

  createdAt?: Date;
  updatedAt?: Date;
}

export const VisitSchema = SchemaFactory.createForClass(Visit);
