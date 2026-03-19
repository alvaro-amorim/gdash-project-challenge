import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { User, UserDocument } from '../users/entities/user.schema';
import { Visit, VisitDocument } from './entities/visit.schema';

type VisitPayload = {
  sessionId: string;
  path?: string;
  userAgent?: string;
  ip?: string;
  user: {
    sub: string;
    email: string;
    name: string;
  };
};

@Injectable()
export class AnalyticsService {
  private readonly activeWindowMs = 2 * 60 * 1000;

  constructor(
    @InjectModel(Visit.name) private readonly visitModel: Model<VisitDocument>,
    @InjectModel(User.name) private readonly userModel: Model<UserDocument>,
  ) {}

  async startVisit(payload: VisitPayload) {
    const now = new Date();

    const visit = await this.visitModel
      .findOneAndUpdate(
        { sessionId: payload.sessionId },
        {
          $set: {
            userId: payload.user.sub,
            userName: payload.user.name,
            userEmail: payload.user.email,
            path: payload.path || '/dashboard',
            userAgent: payload.userAgent || 'unknown',
            ip: payload.ip || 'unknown',
            lastSeenAt: now,
            endedAt: null,
          },
          $setOnInsert: {
            startedAt: now,
          },
        },
        {
          upsert: true,
          new: true,
        },
      )
      .exec();

    return this.toPublicVisit(visit);
  }

  async heartbeat(payload: VisitPayload) {
    return this.startVisit(payload);
  }

  async endVisit(sessionId: string) {
    const visit = await this.visitModel
      .findOneAndUpdate(
        { sessionId },
        {
          $set: {
            endedAt: new Date(),
          },
        },
        { new: true },
      )
      .exec();

    return visit ? this.toPublicVisit(visit) : { sessionId, ended: true };
  }

  async getVisits(limit = 100) {
    const visits = await this.visitModel.find().sort({ startedAt: -1 }).limit(limit).exec();
    return visits.map((visit) => this.toPublicVisit(visit));
  }

  async getOverview() {
    const activeUsers = await this.getActiveUserCount();
    const [totalUsers, verifiedUsers, totalVisits, visitsToday] = await Promise.all([
      this.userModel.countDocuments().exec(),
      this.userModel.countDocuments({ emailVerified: true }).exec(),
      this.visitModel.countDocuments().exec(),
      this.visitModel.countDocuments({
        startedAt: { $gte: this.getStartOfDay() },
      }).exec(),
    ]);

    return {
      totalUsers,
      verifiedUsers,
      activeUsers,
      totalVisits,
      visitsToday,
    };
  }

  async getActiveUsersSummary() {
    return {
      activeUsers: await this.getActiveUserCount(),
    };
  }

  private async getActiveUserCount() {
    const threshold = new Date(Date.now() - this.activeWindowMs);
    const activeUserIds = await this.visitModel.distinct('userId', {
      lastSeenAt: { $gte: threshold },
    });

    return activeUserIds.filter(Boolean).length;
  }

  private getStartOfDay() {
    const date = new Date();
    date.setHours(0, 0, 0, 0);
    return date;
  }

  private isActive(lastSeenAt?: Date | null) {
    if (!lastSeenAt) {
      return false;
    }

    return lastSeenAt.getTime() >= Date.now() - this.activeWindowMs;
  }

  private toPublicVisit(visit: VisitDocument | Visit) {
    const plainVisit = 'toObject' in visit ? visit.toObject() : visit;
    const visitId = (plainVisit as Visit & { _id?: unknown })._id;

    return {
      id: String(visitId),
      sessionId: plainVisit.sessionId,
      userId: plainVisit.userId,
      userName: plainVisit.userName,
      userEmail: plainVisit.userEmail,
      path: plainVisit.path || null,
      userAgent: plainVisit.userAgent || null,
      ip: plainVisit.ip || null,
      startedAt: plainVisit.startedAt,
      lastSeenAt: plainVisit.lastSeenAt,
      endedAt: plainVisit.endedAt || null,
      active: this.isActive(plainVisit.lastSeenAt),
    };
  }
}
