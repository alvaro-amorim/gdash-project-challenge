export interface WeatherData {
  _id: string;
  temp: number;
  humidity: number;
  wind_speed: number;
  precipitation: number;
  collected_at: string;
  insight?: string;
  insight_source?: 'ai' | 'fallback';
  has_active_viewer?: boolean;
  is_day?: number;
}

export interface CityOption {
  cityName: string;
  stateName?: string | null;
  stateCode?: string | null;
  latitude: number;
  longitude: number;
  timezone: string;
  displayName: string;
}

export interface WeatherHistoryPoint {
  collected_at: string;
  temp: number;
  humidity: number;
  wind_speed: number;
  precipitation: number;
  is_day: number;
}

export interface WeatherHistoryResponse {
  location: CityOption;
  range: {
    startDate: string;
    endDate: string;
    pointCount: number;
  };
  points: WeatherHistoryPoint[];
}

export interface LiveWeatherData extends WeatherHistoryPoint, CityOption {
  insight: string;
  insights: string[];
  insight_source: 'ai' | 'fallback';
  has_active_viewer: boolean;
  ai_generated_at?: string | null;
}

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: 'admin' | 'user';
  provider: 'email' | 'google';
  avatarUrl?: string | null;
  preferredCityName?: string | null;
  preferredStateName?: string | null;
  preferredStateCode?: string | null;
  preferredLatitude?: number | null;
  preferredLongitude?: number | null;
  preferredTimezone?: string | null;
  emailVerified: boolean;
  lastLoginAt?: string | null;
  createdAt?: string | null;
}

export interface AuthState {
  token: string;
  user: AuthUser;
}

export interface AuthApiResponse {
  access_token: string;
  user: AuthUser;
}

export interface VisitRecord {
  id: string;
  sessionId: string;
  userId: string;
  userName: string;
  userEmail: string;
  path?: string | null;
  userAgent?: string | null;
  ip?: string | null;
  startedAt: string;
  lastSeenAt: string;
  endedAt?: string | null;
  active: boolean;
}

export interface AdminOverview {
  totalUsers: number;
  verifiedUsers: number;
  activeUsers: number;
  totalVisits: number;
  visitsToday: number;
}
