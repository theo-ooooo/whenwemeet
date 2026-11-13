import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createPlaceSearchProvider, PLACE_SEARCH_PROVIDER } from './place-search.provider.js';
import { PlacesController } from './places.controller.js';
import { PlacesService } from './places.service.js';

/** (#199) 장소 검색 프록시. 공급자는 PLACE_SEARCH_PROVIDER 로 주입 (테스트는 가짜) */
@Module({
  controllers: [PlacesController],
  providers: [
    PlacesService,
    { provide: PLACE_SEARCH_PROVIDER, inject: [ConfigService], useFactory: (config: ConfigService) => createPlaceSearchProvider(config) },
  ],
})
export class PlacesModule {}
