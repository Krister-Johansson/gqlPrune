// SPDX-License-Identifier: MIT
// Copyright (c) 2023 Krister Johansson

import { createCorpusResolver } from '../../src/utils/moduleResolver';
import {
  buildReferenceIndex,
  ReferenceIndex,
} from '../../src/utils/referenceIndex';
import { parseSourceModule } from '../../src/utils/sourceModule';

/**
 * Builds a reference index over in-memory source files, keyed by the path the
 * scan would report them under. Imports between the files resolve; anything
 * else is outside the corpus, the way an excluded codegen directory is.
 */
export function indexOf(
  files: Record<string, string>,
  options: { inline?: boolean } = {},
): ReferenceIndex {
  const modules = Object.entries(files).map(([file, content]) =>
    parseSourceModule(file, content),
  );
  return buildReferenceIndex(
    modules,
    createCorpusResolver(modules.map((module) => module.path)),
    options,
  );
}
