import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type WeatherDocument = HydratedDocument<Weather>;

@Schema({ collection: 'weather_logs' })
export class Weather {
  @Prop()
  cityName?: string;

  @Prop()
  stateName?: string;

  @Prop()
  stateCode?: string;

  @Prop()
  timezone?: string;

  @Prop({ required: true })
  latitude: string;

  @Prop({ required: true })
  longitude: string;

  @Prop({ required: true })
  temp: number; // Celsius

  @Prop({ required: true })
  humidity: number; // Percentage

  @Prop({ required: true })
  wind_speed: number; // km/h

  @Prop({ required: true })
  precipitation: number; // mm

  @Prop({ required: true })
  is_day: number; // 1 = Day, 0 = Night

  @Prop({ required: true })
  insight: string; // AI Generated Text

  @Prop({ type: [String], default: [] })
  insights?: string[];

  @Prop({ default: 'fallback' })
  insight_source?: string;

  @Prop({ default: false })
  has_active_viewer?: boolean;

  @Prop({ type: String, default: null })
  ai_generated_at?: string | null;

  @Prop({ type: String, default: 'sync' })
  source?: string;

  @Prop({ required: true })
  collected_at: string; // ISO Date String
}

export const WeatherSchema = SchemaFactory.createForClass(Weather);
WeatherSchema.index({ latitude: 1, longitude: 1, collected_at: -1 });
