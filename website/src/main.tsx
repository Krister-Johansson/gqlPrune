// SPDX-License-Identifier: MIT
// Copyright (c) 2023 Krister Johansson

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';

const root = document.getElementById('root');
if (!root) {
  throw new Error('index.html has no #root element to mount the page into');
}

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
