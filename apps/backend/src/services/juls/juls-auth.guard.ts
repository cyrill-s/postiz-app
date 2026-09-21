import { Prisma } from '@prisma/client';
import {
  CanActivate,
  ExecutionContext,
  HttpException,
  Injectable,
  RawBodyRequest,
} from '@nestjs/common';
import { createHash, createHmac, timingSafeEqual } from 'crypto';
import { Request } from 'express';
import { PrismaService } from '@gitroom/nestjs-libraries/database/prisma/prisma.service';

export function julsConfiguration() {
  const secret = process.env.JULS_PROVISIONING_SECRET;
  const issuer = process.env.JULS_ISSUER;
  const clientId = process.env.JULS_OAUTH_CLIENT_ID;
  if (!secret || Buffer.byteLength(secret) < 32 || !issuer || !clientId) {
    throw new HttpException({ error: 'juls_not_configured' }, 503);
  }
  return { secret, issuer, clientId };
}

@Injectable()
export class JulsAuthGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext) {
    const { secret, issuer } = julsConfiguration();
    const req = context.switchToHttp().getRequest<RawBodyRequest<Request>>();
    const timestamp = req.header('x-juls-timestamp') || '';
    const nonce = req.header('x-juls-nonce') || '';
    const key = req.header('idempotency-key') || '';
    const signature = req.header('x-juls-signature') || '';
    const now = Date.now();
    if (
      !/^\d{10}$/.test(timestamp) ||
      Math.abs(now - Number(timestamp) * 1000) > 300_000 ||
      !/^[A-Za-z0-9_-]{16,128}$/.test(nonce) ||
      (key && !/^[A-Za-z0-9_-]{16,128}$/.test(key)) ||
      !/^v1=[a-f0-9]{64}$/.test(signature) ||
      !Buffer.isBuffer(req.rawBody) ||
      req.originalUrl.includes('?')
    ) {
      throw new HttpException({ error: 'invalid_signature' }, 401);
    }
    // The signed path is the backend path, without the reverse proxy's /api prefix.
    const canonical = [
      'v1',
      req.method,
      req.path,
      timestamp,
      nonce,
      key,
      createHash('sha256').update(req.rawBody).digest('hex'),
    ].join('\n');
    const expected = createHmac('sha256', secret).update(canonical).digest();
    if (!timingSafeEqual(expected, Buffer.from(signature.slice(3), 'hex'))) {
      throw new HttpException({ error: 'invalid_signature' }, 401);
    }
    await this.prisma.julsRequestNonce.deleteMany({
      where: { expiresAt: { lt: new Date(now) } },
    });
    try {
      await this.prisma.julsRequestNonce.create({
        data: {
          nonce: createHash('sha256')
            .update(`${issuer}\n${nonce}`)
            .digest('hex'),
          // Retain through the entire validity window, including future-dated requests.
          expiresAt: new Date(Number(timestamp) * 1000 + 301_000),
        },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      )
        throw new HttpException({ error: 'request_replayed' }, 409);
      throw error;
    }
    return true;
  }
}
