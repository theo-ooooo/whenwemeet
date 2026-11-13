import { Controller, Get, Query } from '@nestjs/common';
import { RateLimit } from '../rate-limit/rate-limit.decorator.js';
import { PlacesService } from './places.service.js';

/** (#199) 장소 검색 `GET /places/search?q=` (api.md 2.13). 로그인 필요, 사용자당 분당 60회 */
@Controller('places')
export class PlacesController {
  constructor(private readonly places: PlacesService) {}

  @Get('search')
  @RateLimit('placeSearch')
  search(@Query('q') q: unknown) {
    return this.places.search(q);
  }
}
