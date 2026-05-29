import {
  Controller,
  Get,
  Put,
  Param,
  Body,
  Headers,
  HttpCode,
  HttpStatus,
  NotFoundException,
  HttpException,
} from '@nestjs/common';
import { validateApiKey } from '../auth/api-key';
import { fetcherStore, FetcherState } from './fetcher.store';

/**
 * GET  /api/fetcher/state/:adapter — read opaque cursor.  Requires X-Api-Key.
 * PUT  /api/fetcher/state/:adapter — upsert opaque cursor.  Requires X-Api-Key.
 */
@Controller('api/fetcher/state')
export class FetcherController {
  @Get(':adapter')
  getState(
    @Headers('x-api-key') apiKey: string | undefined,
    @Param('adapter') adapter: string,
  ): FetcherState {
    validateApiKey(apiKey);

    const state = fetcherStore.get(adapter);
    if (!state) {
      throw new NotFoundException({
        type: 'about:blank',
        title: 'Not Found',
        status: 404,
        detail: `No state stored for adapter '${adapter}'.`,
      });
    }
    return state;
  }

  @Put(':adapter')
  @HttpCode(HttpStatus.NO_CONTENT)
  putState(
    @Headers('x-api-key') apiKey: string | undefined,
    @Param('adapter') adapter: string,
    @Body() body: { cursor?: unknown },
  ): void {
    validateApiKey(apiKey);

    const cursor = body?.cursor;
    if (cursor === undefined || cursor === null || typeof cursor !== 'string') {
      throw new HttpException(
        {
          type: 'about:blank',
          title: 'Unprocessable Entity',
          status: HttpStatus.UNPROCESSABLE_ENTITY,
          detail: 'Field "cursor" is required and must be a string.',
          errors: [{ pointer: '/cursor', message: 'Required string.' }],
        },
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }

    if (Buffer.byteLength(cursor, 'utf8') > 8 * 1024) {
      throw new HttpException(
        {
          type: 'about:blank',
          title: 'Payload Too Large',
          status: HttpStatus.PAYLOAD_TOO_LARGE,
          detail: 'Cursor exceeds the 8 KiB limit.',
        },
        HttpStatus.PAYLOAD_TOO_LARGE,
      );
    }

    fetcherStore.set(adapter, cursor);
  }
}
