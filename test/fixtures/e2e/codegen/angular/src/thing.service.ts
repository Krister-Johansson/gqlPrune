// FIXTURE source file; parsed by gqlPrune, never compiled.
import { Injectable } from '@angular/core';
import { GetThingGQL } from './generated/graphql';

@Injectable({ providedIn: 'root' })
export class ThingService {
  constructor(private readonly getThing: GetThingGQL) {}

  load() {
    return this.getThing.fetch();
  }
}
