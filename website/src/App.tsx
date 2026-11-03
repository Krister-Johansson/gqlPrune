// SPDX-License-Identifier: MIT
// Copyright (c) 2023 Krister Johansson

// The page text is written here on purpose: the site builds on its own and
// never reads from the npm package. Terminal output is copied from real runs
// against test/fixtures/e2e.
import { Faq } from './sections/Faq';
import { Footer } from './sections/Footer';
import { Grades } from './sections/Grades';
import { Hero } from './sections/Hero';
import { HowItWorks } from './sections/HowItWorks';
import { Nav } from './sections/Nav';
import { PullRequest } from './sections/PullRequest';
import { RequiredCheck } from './sections/RequiredCheck';
import { Scan } from './sections/Scan';

/** The landing page. */
export function App() {
  return (
    <div className="gp">
      <Nav />
      <main id="top">
        <Hero />
        <Scan />
        <PullRequest />
        <RequiredCheck />
        <Grades />
        <HowItWorks />
        <Faq />
      </main>
      <Footer />
    </div>
  );
}
