#!/usr/bin/env node
import { generateConfig } from './core/configGenerator.js';
import { mainFunction } from './core/gqlPruner.js';

const [command] = process.argv.slice(2);

switch (command) {
  case 'init':
    generateConfig();
    break;
  default:
    mainFunction();
    break;
}
