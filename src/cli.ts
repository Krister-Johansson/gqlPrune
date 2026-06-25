#!/usr/bin/env node
import { generateConfig } from './core/configGenerator.js';
import { mainFunction } from './core/gqlPruner.js';
import { parseArgs } from './utils/args.js';

const { command, json, annotate } = parseArgs(process.argv.slice(2));

switch (command) {
  case 'init':
    generateConfig();
    break;
  default:
    mainFunction({
      json,
      annotate: annotate || process.env.GITHUB_ACTIONS === 'true',
    });
    break;
}
