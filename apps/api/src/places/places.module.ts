import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  createNaverPlaceSearchProvider,
  NAVER_PLACE_SEARCH_PROVIDER,
} from './naver-place-search.provider.js';
import {
  createPlaceSearchProvider,
  PLACE_SEARCH_PROVIDER,
} from './place-search.provider.js';
import { PlacesController } from './places.controller.js';
import { PlacesService } from './places.service.js';

/** (#199) 장소 검색 프록시. 공급자는 카카오 PLACE_SEARCH_PROVIDER, 네이버 NAVER_PLACE_SEARCH_PROVIDER 로 주입 (테스트는 가짜, D-259) */
@Module({
  controllers: [PlacesController],
  providers: [
    PlacesService,
    {
      provide: PLACE_SEARCH_PROVIDER,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => createPlaceSearchProvider(config),
    },
    {
      provide: NAVER_PLACE_SEARCH_PROVIDER,
      inject: [ConfigService],
      useFactory: (config: ConfigService) =>
        createNaverPlaceSearchProvider(config),
    },
  ],
  exports: [PlacesService],
})
export class PlacesModule {}
