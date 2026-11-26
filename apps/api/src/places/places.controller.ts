import { Controller, Get, Query } from '@nestjs/common';
import { RateLimit } from '../rate-limit/rate-limit.decorator.js';
import { PlacesService } from './places.service.js';

/** (#199) 장소 검색 `GET /places/search?q=&provider=`, 다시 찾기 `GET /places/resolve` (api.md 2.14). 로그인 필요. provider 는 kakao(기본) 또는 naver (D-259) */
@Controller('places')
export class PlacesController {
  constructor(private readonly places: PlacesService) {}

  @Get('search')
  @RateLimit('placeSearch')
  search(@Query('q') q: unknown, @Query('provider') provider: unknown) {
    return this.places.search(q, provider);
  }

  /** (#199) 저장된 장소 다시 찾기 `GET /places/resolve?provider=&id=&q=` (api.md 2.14). id 는 카카오 장소 ID 또는 네이버 키 */
  @Get('resolve')
  @RateLimit('placeResolve')
  resolve(
    @Query('id') id: unknown,
    @Query('q') q: unknown,
    @Query('provider') provider: unknown,
  ) {
    return this.places.resolve(id, q, provider);
  }
}
