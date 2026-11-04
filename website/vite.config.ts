// SPDX-License-Identifier: MIT
// Copyright (c) 2023 Krister Johansson

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // A relative base keeps asset URLs working under the GitHub Pages project
  // path (/gqlPrune/) and at the root of a custom domain later, without a
  // rebuild for either.
  base: './',
});
