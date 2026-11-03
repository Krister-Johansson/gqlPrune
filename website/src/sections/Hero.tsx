// SPDX-License-Identifier: MIT
// Copyright (c) 2023 Krister Johansson

import { CopyCommand } from '../components/CopyCommand';
import { ArrowUpRight } from '../components/Icons';
import { COMMAND, LINKS } from '../links';

/** The pitch, the command to run, and the short facts list. */
export function Hero() {
  return (
    <section className="hero">
      <div className="wrap hero-grid">
        <div>
          <h1 className="h1">
            Find the GraphQL operations your code <em>no longer uses.</em>
          </h1>
          <p className="lead">
            gqlPrune reads your <code>.graphql</code> files, parses your
            TypeScript and JavaScript, and follows imports, re-exports and
            barrel files to see what still references each query, mutation and
            fragment. It needs no schema, no running server and no
            introspection.
          </p>
          <div className="cta">
            <CopyCommand command={COMMAND} />
            <a className="btn btn-secondary" href={LINKS.github}>
              View on GitHub <ArrowUpRight />
            </a>
          </div>
          <p className="hero-note">
            Reads your GraphQL Code Generator config when it finds one. Without
            one, run <code>npx gqlprune init</code> first.
          </p>
        </div>
        <dl className="facts">
          <div>
            <dt>needs</dt>
            <dd>Node.js 20 or newer</dd>
          </div>
          <div>
            <dt>reads</dt>
            <dd>
              <code>.gql</code> and <code>.graphql</code> files, plus{' '}
              <code>.ts</code> <code>.tsx</code> <code>.js</code>{' '}
              <code>.jsx</code> and friends
            </dd>
          </div>
          <div>
            <dt>never</dt>
            <dd>runs your code, starts a server or calls the network</dd>
          </div>
          <div>
            <dt>license</dt>
            <dd>MIT</dd>
          </div>
        </dl>
      </div>
    </section>
  );
}
