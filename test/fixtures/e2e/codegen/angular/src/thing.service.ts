// FIXTURE source file; string-searched only, never compiled.
import { Injectable } from '@angular/core';
import { GetThingGQL } from './generated/graphql';

@Injectable({ providedIn: 'root' })
export class ThingService {
  constructor(private readonly getThing: GetThingGQL) {}

  load() {
    return this.getThing.fetch();
  }
}
