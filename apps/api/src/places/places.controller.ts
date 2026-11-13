import { Controller, Get, Query } from '@nestjs/common';
import { RateLimit } from '../rate-limit/rate-limit.decorator.js';
import { PlacesService } from './places.service.js';

/** (#199) 장소 검색 `GET /places/search?q=`, 다시 찾기 `GET /places/resolve` (api.md 2.14). 로그인 필요 */
@Controller('places')
export class PlacesController {
  constructor(private readonly places: PlacesService) {}

  @Get('search')
  @RateLimit('placeSearch')
  search(@Query('q') q: unknown) {
    return this.places.search(q);
  }

  /** (#199) 저장된 장소 다시 찾기 `GET /places/resolve?id=&q=` (api.md 2.14). 같은 한도 묶음 */
  @Get('resolve')
  @RateLimit('placeResolve')
  resolve(@Query('id') id: unknown, @Query('q') q: unknown) {
    return this.places.resolve(id, q);
  }
}
