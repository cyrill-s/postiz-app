import {
  Body,
  Controller,
  Get,
  Header,
  Headers,
  HttpCode,
  Post,
  Query,
  Res,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { Response } from 'express';
import { JulsAuthGuard } from '@gitroom/backend/services/juls/juls-auth.guard';
import { JulsWorkspaceService } from '@gitroom/backend/services/juls/juls-workspace.service';
import {
  JulsHandoffDto,
  JulsProvisionDto,
  JulsWorkspaceDto,
} from '@gitroom/backend/services/juls/juls.dto';
import { getCookieUrlFromDomain } from '@gitroom/helpers/subdomain/subdomain.management';

@Controller('/internal/juls')
@UseGuards(JulsAuthGuard)
@UsePipes(
  new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
  })
)
export class JulsController {
  constructor(private readonly workspaces: JulsWorkspaceService) {}

  @Post('/provision')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  provision(
    @Body() body: JulsProvisionDto,
    @Headers('idempotency-key') key: string
  ) {
    return this.workspaces.provision(body, key);
  }

  @Post('/handoff')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  handoff(@Body() body: JulsHandoffDto) {
    return this.workspaces.handoff(body);
  }

  @Post('/revoke')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  revoke(@Body() body: JulsWorkspaceDto) {
    return this.workspaces.revoke(body);
  }
}

// The browser presents a one-use capability, never the server's HMAC credential.
@Controller('/internal/juls')
export class JulsSessionController {
  constructor(private readonly workspaces: JulsWorkspaceService) {}

  @Get('/session')
  async session(@Query('ticket') ticket: string, @Res() res: Response) {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    const session = await this.workspaces.consumeHandoff(ticket);
    const cookie = {
      domain: getCookieUrlFromDomain(process.env.FRONTEND_URL!),
      path: '/',
      httpOnly: true,
      secure: !process.env.NOT_SECURED,
      sameSite: (process.env.NOT_SECURED ? 'lax' : 'none') as 'lax' | 'none',
      expires: session.expiresAt,
    };
    res.cookie('auth', session.jwt, cookie);
    res.cookie('showorg', session.organizationId, cookie);
    res.clearCookie('impersonate', { domain: cookie.domain, path: '/' });
    return res.redirect(
      303,
      `${process.env.FRONTEND_URL!.replace(/\/$/, '')}/launches`
    );
  }
}
