// SPDX-License-Identifier: MIT
// Copyright (c) 2023 Krister Johansson

import { OperationDefinitionNode, parse, Source } from 'graphql';
import { buildGraphqlEntities } from '../src/utils/operations';
import {
  createFieldReads,
  createTraceEnvironment,
  findCallSite,
  traceCallSite,
  unreadSelections,
} from '../src/utils/resultFlow';
import {
  buildSelectionTree,
  collectFragmentDefinitions,
  SelectionNode,
} from '../src/utils/selectionTree';
import { parseForTrace } from '../src/utils/resultFlow';
import { indexOf } from './support';

const USER_QUERY = `
query GetUser {
  user {
    id
    name
    avatarUrl
    address {
      city
      zip
    }
  }
}`;

const USERS_QUERY = `
query GetUser {
  users {
    id
    name
    email
  }
}`;

/** The selection tree of the one operation in a document. */
function treeOf(query: string): SelectionNode {
  const entities = buildGraphqlEntities(
    parse(new Source(query, 'q.gql')),
    'q.gql',
  );
  const operation = entities.document?.definitions.find(
    (definition) => definition.kind === 'OperationDefinition',
  ) as OperationDefinitionNode;
  return buildSelectionTree(
    operation,
    'q.gql',
    collectFragmentDefinitions([entities]),
  );
}

const HOOKS = ['useGetUserQuery', 'useGetUserLazyQuery', 'GetUserDocument'];

/**
 * Traces every call site of the operation's identifiers across the files and
 * returns the dot paths nothing reads. One file is the common case, so a bare
 * string is the body of `/p/App.tsx`.
 */
function unread(
  query: string,
  files: Record<string, string> | string,
  names: string[] = HOOKS,
): string[] {
  const corpus = typeof files === 'string' ? { '/p/App.tsx': files } : files;
  const root = treeOf(query);
  const index = indexOf(corpus);
  const env = createTraceEnvironment(index, (path) =>
    corpus[path] === undefined
      ? undefined
      : { file: path, content: corpus[path] },
  );
  const reads = createFieldReads();
  for (const name of names) {
    for (const reference of index.byName.get(name) ?? []) {
      const sourceFile = env.sourceFile(reference.path);
      const site =
        sourceFile &&
        findCallSite(
          sourceFile,
          reference.path,
          reference.line,
          reference.column,
        );
      if (site) traceCallSite(site, root, env, reads);
    }
  }
  return unreadSelections(root, reads).map((node) => node.path.join('.'));
}

/** Wraps statements in a component, so `return` and scopes behave as in an app. */
const component = (body: string): string =>
  `export function App() {\n${body}\n}`;

const ALL_BUT_NAME = ['user.id', 'user.avatarUrl', 'user.address'];
const ALL_BUT_ADDRESS = ['user.id', 'user.name', 'user.avatarUrl'];

describe('findCallSite', () => {
  const siteAt = (content: string, line: number, column: number) =>
    findCallSite(
      parseForTrace('/p/App.tsx', content),
      '/p/App.tsx',
      line,
      column,
    );

  it('finds a call whose callee is the identifier', () => {
    const site = siteAt('const r = useGetUserQuery();', 1, 11);

    expect(site?.call.getText()).toBe('useGetUserQuery()');
    expect(site?.documentArgument).toBeUndefined();
  });

  it('finds a call through a namespace member', () => {
    const site = siteAt('const r = api.useGetUserQuery();', 1, 15);

    expect(site?.call.getText()).toBe('api.useGetUserQuery()');
  });

  it('finds a call that takes the identifier as an argument', () => {
    const site = siteAt('const r = useQuery(GetUserDocument, {});', 1, 20);

    expect(site?.call.getText()).toBe('useQuery(GetUserDocument, {})');
    expect(site?.documentArgument?.getText()).toBe('GetUserDocument');
  });

  it('returns nothing for a reference that is not a call or an argument', () => {
    expect(siteAt('const doc = GetUserDocument;', 1, 13)).toBeUndefined();
    expect(
      siteAt('client.query({ query: GetUserDocument });', 1, 23),
    ).toBeUndefined();
  });

  it('returns nothing for a position that is no identifier or not in the file', () => {
    expect(siteAt('useGetUserQuery();', 1, 16)).toBeUndefined();
    expect(siteAt('useGetUserQuery();', 9, 1)).toBeUndefined();
  });
});

describe('createTraceEnvironment', () => {
  it('parses a file once and gives nothing for a file it cannot parse', () => {
    const files: Record<string, string> = {
      '/p/App.tsx': 'useGetUserQuery();',
      '/p/App.vue': '<template />',
    };
    const env = createTraceEnvironment(indexOf(files), (path) =>
      files[path] === undefined
        ? undefined
        : { file: path, content: files[path] },
    );

    expect(env.sourceFile('/p/App.tsx')).toBe(env.sourceFile('/p/App.tsx'));
    expect(env.sourceFile('/p/App.vue')).toBeUndefined();
    expect(env.sourceFile('/p/Missing.tsx')).toBeUndefined();
  });

  it('resolves a JSX tag to the file and name that declare it', () => {
    const files: Record<string, string> = {
      '/p/App.tsx': "import { Card as C } from './Card';\n<C />;",
      '/p/Card.tsx': 'export function Card() { return null; }',
    };
    const env = createTraceEnvironment(indexOf(files), (path) => ({
      file: path,
      content: files[path],
    }));

    expect(env.declarationOf('/p/App.tsx', 2, 2)).toEqual({
      path: '/p/Card.tsx',
      name: 'Card',
    });
    expect(env.declarationOf('/p/App.tsx', 1, 1)).toBeUndefined();
  });

  it('gives nothing for a tag declared outside the scanned files', () => {
    const files = { '/p/App.tsx': "import { C } from 'ui';\n<C />;" };
    const env = createTraceEnvironment(indexOf(files), () => undefined);

    expect(env.declarationOf('/p/App.tsx', 2, 2)).toBeUndefined();
  });
});

describe('traceCallSite', () => {
  describe('read paths', () => {
    it('follows a destructured result through an optional chain', () => {
      expect(
        unread(
          USER_QUERY,
          component(
            'const { data } = useGetUserQuery();\nconst user = data?.user;\nreturn <p>{user?.name}</p>;',
          ),
        ),
      ).toEqual(ALL_BUT_NAME);
    });

    it('follows nested destructuring with renames', () => {
      expect(
        unread(
          USER_QUERY,
          component(
            'const { data: { user: { name: fullName, address: { city } } } } = useGetUserQuery();\nreturn `${fullName} ${city}`;',
          ),
        ),
      ).toEqual(['user.id', 'user.avatarUrl', 'user.address.zip']);
    });

    it('follows property chains, string keys and non-null assertions', () => {
      expect(
        unread(
          USER_QUERY,
          component(
            "const r = useGetUserQuery();\nif (r.data!.user!['name'] === 'x') {}\nif (r.data?.user?.address?.city) {}",
          ),
        ),
      ).toEqual(['user.id', 'user.avatarUrl', 'user.address.zip']);
    });

    it('follows aliases and plain assignments', () => {
      expect(
        unread(
          USER_QUERY,
          component(
            'const { data } = useGetUserQuery();\nconst d = data;\nconst u = d.user;\nlet v;\nv = u;\nif (v.name) {}',
          ),
        ),
      ).toEqual(ALL_BUT_NAME);
    });

    it('does not credit a shadowing name in a nested scope', () => {
      expect(
        unread(
          USER_QUERY,
          component(
            'const { data } = useGetUserQuery();\nconst u = data.user;\nconst pick = (u) => u.avatarUrl;\nfunction other() { const u = 1; return u.id; }\nreturn `${u.name}`;',
          ),
        ),
      ).toEqual(ALL_BUT_NAME);
    });

    it('passes values through ||, ??, ternaries and await', () => {
      expect(
        unread(
          USER_QUERY,
          component(
            'const { data } = useGetUserQuery();\nconst u = (data?.user ?? null) || fallback;\nconst w = ok ? u : null;\nconst x = await w;\nreturn `${x.name}`;',
          ),
        ),
      ).toEqual(ALL_BUT_NAME);
    });

    it.each([
      ['map', 'data.users.map((u) => u.name);'],
      ['forEach', 'data.users.forEach((u) => { if (u.name) {} });'],
      ['filter', 'if (data.users.filter((u) => u.name).length) {}'],
      ['find', "data.users.find((u) => u.name === 'a');"],
      ['some', 'data.users.some((u) => u.name);'],
      ['every', 'data.users.every((u) => u.name);'],
      ['flatMap', 'data.users.flatMap((u) => [u.name]);'],
      ['for...of', 'for (const u of data.users) { if (u.name) {} }'],
      ['a numeric index', 'if (data.users[0].name) {}'],
      [
        'array destructuring',
        'const [first] = data.users;\nif (first.name) {}',
      ],
    ])('passes through a list with %s', (_label, read) => {
      expect(
        unread(
          USERS_QUERY,
          component(`const { data } = useGetUserQuery();\n${read}`),
        ),
      ).toEqual(['users.id', 'users.email']);
    });

    it('keeps tracing the elements a filter returns', () => {
      expect(
        unread(
          USERS_QUERY,
          component(
            'const { data } = useGetUserQuery();\nreturn data.users.filter((u) => u.id).map((u) => <li>{u.name}</li>);',
          ),
        ),
      ).toEqual(['users.email']);
    });

    it('takes a value out of useMemo and leaves dependency arrays alone', () => {
      expect(
        unread(
          USER_QUERY,
          component(
            'const { data } = useGetUserQuery();\nconst name = useMemo(() => data?.user?.name, [data]);\nuseEffect(() => {}, [data.user]);\nreturn `${name}`;',
          ),
        ),
      ).toEqual(ALL_BUT_NAME);
    });
  });

  describe('leaf reads', () => {
    it.each([
      ['truthiness', 'if (data.user.address) {}'],
      ['negation', 'if (!data.user.address) {}'],
      ['a comparison', 'if (data.user.address === null) {}'],
      ['a template literal', 'const s = `${data.user.address}`;'],
      ['a JSX child', 'return <p>{data.user.address}</p>;'],
      ['the left of &&', 'const ok = data.user.address && 1;'],
      ['a ternary condition', 'const ok = data.user.address ? 1 : 2;'],
      ['a coercing builtin', 'const s = String(data.user.address);'],
      [
        'an intrinsic JSX attribute',
        'return <div title={data.user.address} />;',
      ],
    ])('reads only the node itself through %s', (_label, read) => {
      expect(
        unread(
          USER_QUERY,
          component(`const { data } = useGetUserQuery();\n${read}`),
        ),
      ).toEqual([...ALL_BUT_ADDRESS, 'user.address.city', 'user.address.zip']);
    });
  });

  describe('escapes', () => {
    it.each([
      ['a call argument', 'save(data.user.address);'],
      ['a spread', 'const copy = { ...data.user.address };'],
      ['a return', 'return data.user.address;'],
      ['an object literal', 'const o = { a: data.user.address };'],
      ['an array literal', 'const l = [data.user.address];'],
      ['a property assignment', 'store.address = data.user.address;'],
      ['a computed key', 'const v = data.user.address[key];'],
      [
        'a shorthand property',
        'const address = data.user.address;\nsend({ address });',
      ],
      ['a tagged template', 'const c = css`${data.user.address}`;'],
      ['an unknown method', 'data.user.address.toJSON();'],
      ['a callback it cannot see', 'data.user.address.forEach(render);'],
    ])('reads everything under the node through %s', (_label, use) => {
      expect(
        unread(
          USER_QUERY,
          component(`const { data } = useGetUserQuery();\n${use}`),
        ),
      ).toEqual(ALL_BUT_ADDRESS);
    });

    it('reads everything when the hook takes a callback', () => {
      expect(
        unread(
          USER_QUERY,
          component('useGetUserQuery({ onCompleted: (d) => setUser(d) });'),
        ),
      ).toEqual([]);
      expect(
        unread(USER_QUERY, component('useGetUserQuery(options);')),
      ).toEqual([]);
    });

    it('does not escape on plain options', () => {
      expect(
        unread(
          USER_QUERY,
          component(
            'const { data } = useGetUserQuery({ variables: { id }, skip: !id });\nreturn `${data.user.name}`;',
          ),
        ),
      ).toEqual(ALL_BUT_NAME);
    });
  });

  describe('result shapes', () => {
    it('reads nothing when data is never touched', () => {
      expect(
        unread(
          USER_QUERY,
          component('const { loading } = useGetUserQuery();\nif (loading) {}'),
        ),
      ).toEqual(['user']);
    });

    it('takes data from a lazy query tuple', () => {
      expect(
        unread(
          USER_QUERY,
          component(
            'const [execute, { data }] = useGetUserLazyQuery();\nexecute({ variables: { id } });\nreturn `${data?.user?.name}`;',
          ),
        ),
      ).toEqual(ALL_BUT_NAME);
    });

    it('takes data from an urql tuple', () => {
      expect(
        unread(
          USER_QUERY,
          component(
            'const [{ data, fetching }] = useGetUserQuery();\nreturn `${data.user.name}`;',
          ),
        ),
      ).toEqual(ALL_BUT_NAME);
    });

    it('takes data from a whole result and a tuple element', () => {
      expect(
        unread(
          USER_QUERY,
          component(
            'const result = useGetUserQuery();\nconst [other] = useGetUserQuery();\nif (result.data?.user.name) {}\nif (other.data.user.id) {}',
          ),
        ),
      ).toEqual(['user.avatarUrl', 'user.address']);
    });

    it('follows a call that takes the document constant', () => {
      expect(
        unread(
          USER_QUERY,
          component(
            'const { data } = useQuery(GetUserDocument);\nreturn `${data.user.name}`;',
          ),
        ),
      ).toEqual(ALL_BUT_NAME);
    });

    it('allows a result method called with plain arguments', () => {
      expect(
        unread(
          USER_QUERY,
          component(
            'const { data, refetch } = useGetUserQuery();\nconst onClick = () => refetch({ id });\nawait refetch();\nreturn `${data.user.name}`;',
          ),
        ),
      ).toEqual(ALL_BUT_NAME);
    });

    it.each([
      ['a callback', 'fetchMore({ updateQuery: (prev) => prev });'],
      ['its result used', 'const next = await refetch();'],
      ['itself passed on', 'return <Button onClick={refetch} />;'],
      ['the whole result passed on', 'return <View result={result} />;'],
    ])('reads everything when a result method gets %s', (_label, use) => {
      expect(
        unread(
          USER_QUERY,
          component(
            `const result = useGetUserQuery();\nconst { fetchMore, refetch } = result;\n${use}`,
          ),
        ),
      ).toEqual([]);
    });
  });

  describe('one hop into a component', () => {
    const app = component(
      'const { data } = useGetUserQuery();\nreturn <UserCard user={data.user} key={data.user.id} />;',
    );

    it.each([
      [
        'a destructured function declaration',
        'function UserCard({ user }) { return <p>{user.name}</p>; }',
      ],
      [
        'an arrow taking props',
        'const UserCard = (props) => <p>{props.user.name}</p>;',
      ],
      [
        'a memo-wrapped function expression',
        'const UserCard = memo(function UserCard({ user: u }) { return <p>{u.name}</p>; });',
      ],
      [
        'a forwardRef-wrapped arrow',
        'const UserCard = React.forwardRef(({ user }, ref) => <p ref={ref}>{user.name}</p>);',
      ],
    ])('follows the prop into %s in the same file', (_label, declaration) => {
      expect(unread(USER_QUERY, `${declaration}\n${app}`)).toEqual([
        'user.avatarUrl',
        'user.address',
      ]);
    });

    it('follows the prop into a component imported from another file', () => {
      expect(
        unread(USER_QUERY, {
          '/p/App.tsx': `import { UserCard } from './UserCard';\n${app}`,
          '/p/UserCard.tsx':
            'export function UserCard({ user }) { return <p>{user.name}</p>; }',
        }),
      ).toEqual(['user.avatarUrl', 'user.address']);
    });

    it('follows the prop into a default export', () => {
      expect(
        unread(USER_QUERY, {
          '/p/App.tsx': `import UserCard from './UserCard';\n${app}`,
          '/p/UserCard.tsx':
            'export default function ({ user }) { return <p>{user.name}</p>; }',
        }),
      ).toEqual(['user.avatarUrl', 'user.address']);
    });

    it('never follows a second hop', () => {
      expect(
        unread(
          USER_QUERY,
          [
            'function AddressLine({ address }) { return <p>{address.city}</p>; }',
            'function UserCard({ user }) { return <AddressLine address={user.address} />; }',
            app,
          ].join('\n'),
        ),
      ).toEqual(['user.name', 'user.avatarUrl']);
    });

    it('reads everything for a component it cannot resolve', () => {
      expect(
        unread(USER_QUERY, `import { UserCard } from 'ui';\n${app}`),
      ).toEqual([]);
    });

    it('reads everything the component spreads or passes on', () => {
      expect(
        unread(
          USER_QUERY,
          `const UserCard = (props) => <Inner {...props} />;\n${app}`,
        ),
      ).toEqual([]);
    });

    it('reads nothing under a prop the component never takes', () => {
      expect(
        unread(USER_QUERY, `function UserCard() { return null; }\n${app}`),
      ).toEqual(['user.name', 'user.avatarUrl', 'user.address']);
    });
  });
});

describe('traceCallSite (less common shapes)', () => {
  const read = (body: string, query = USER_QUERY) =>
    unread(query, component(`const { data } = useGetUserQuery();\n${body}`));

  it.each([
    ['a type assertion', 'if ((data as any).user.name) {}'],
    ['a satisfies wrapper', 'if ((data.user satisfies object).name) {}'],
    ['the right of a comma', 'const u = (0, data.user);\nif (u.name) {}'],
    ['a var declaration', 'var u = data.user;\nif (u.name) {}'],
    ['a for loop initializer', 'for (let u = data.user; u.name; ) {}'],
    ['the right of &&', 'const u = ok && data.user;\nif (u.name) {}'],
    ['new Date', 'const d = new Date(data.user.name);'],
    ['a Math call', 'const n = Math.round(data.user.name);'],
    ['a leaf method', 'if (data.user.name.toLowerCase()) {}'],
    ['a string method chain', 'if (data.user.name.slice(1).trim()) {}'],
  ])('reads only the name through %s', (_label, body) => {
    expect(read(body)).toEqual(ALL_BUT_NAME);
  });

  it.each([
    ['a function argument', 'useGetUserQuery(() => 1);'],
    ['a spread option', 'useGetUserQuery({ ...defaults });'],
    ['a method option', 'useGetUserQuery({ onCompleted() {} });'],
    ['a computed option key', 'useGetUserQuery({ [key]: 1 });'],
    ['a callback in a list option', 'useGetUserQuery({ hooks: [() => 1] });'],
    ['a spread list option', 'useGetUserQuery({ hooks: [...more] });'],
  ])('reads everything when the hook takes %s', (_label, body) => {
    expect(unread(USER_QUERY, component(body))).toEqual([]);
  });

  it('accepts literal, keyed and listed options', () => {
    expect(
      unread(
        USER_QUERY,
        component(
          "const { data } = useQuery(GetUserDocument, { ['skip']: false, ids: [1, 'a'], ctx: null, x: undefined, t: `t` });\nif (data.user.name) {}",
        ),
      ),
    ).toEqual(ALL_BUT_NAME);
  });

  it('reads nothing through a write, a compound assignment or an unknown key', () => {
    expect(
      read(
        'data.user = null;\ncount += data.user.name;\nif (data.user.unknownKey) {}\ndata.user.name ||= 1;',
      ),
    ).toEqual(ALL_BUT_NAME);
  });

  it.each([
    ['an assignment to a property', 'other.user = data.user;'],
    ['a destructuring assignment', '({ a } = data.user);'],
    ['a logical assignment', 'x ??= data.user;'],
    ['a computed binding key', 'const { [k]: v } = data.user;'],
    ['the value called as a function', 'data.user();'],
    ['a constructor argument', 'new Wrapper(data.user);'],
    ['a dependency array of an unknown callee', 'make()(fn, [data.user]);'],
    ['a for...of over an existing name', 'for (u of data.user) {}'],
    ['a return at the top of a file', 'return data.user;'],
  ])('reads everything under the node through %s', (_label, body) => {
    expect(read(body)).toEqual([]);
  });

  it('keeps the rest of a destructuring as the whole value', () => {
    expect(
      read('const { id, ...rest } = data.user;\nif (rest.name) {}'),
    ).toEqual(['user.avatarUrl', 'user.address']);
  });

  it('skips scopes that redeclare the name', () => {
    expect(
      read(
        [
          'const u = data.user;',
          'switch (k) { case 1: { const u = 1; u.id; } }',
          'switch (k) { case 2: const u = 2; u.avatarUrl; }',
          'try {} catch (u) { u.address; }',
          'for (const u of []) { u.id; }',
          'const f = function u() { return u.id; };',
          'if (u.name) {}',
        ].join('\n'),
      ),
    ).toEqual(ALL_BUT_NAME);
  });

  it('finds the declaring scope of an assigned name, up to the file', () => {
    expect(
      unread(
        USER_QUERY,
        'const { data } = useGetUserQuery();\nglobalUser = data.user;\nif (globalUser.name) {}',
      ),
    ).toEqual(ALL_BUT_NAME);
  });

  it('sorts without a callback and keeps tracing the elements', () => {
    expect(
      read(
        'const sorted = data.users.sort();\nif (sorted[0].name) {}',
        USERS_QUERY,
      ),
    ).toEqual(['users.id', 'users.email']);
  });

  it('ignores an array pattern hole and a list callback without parameters', () => {
    expect(
      read(
        'const [, second] = data.users;\ndata.users.forEach(() => {});\nif (second.name) {}',
        USERS_QUERY,
      ),
    ).toEqual(['users.id', 'users.email']);
  });

  it('follows a hook wrapped in a type assertion at the call', () => {
    expect(
      unread(
        USER_QUERY,
        component(
          'const { data } = (useGetUserQuery as any)();\nif (data.user.name) {}',
        ),
      ),
    ).toEqual(ALL_BUT_NAME);
  });

  it('reads nothing through an inert result key that is called', () => {
    expect(
      unread(
        USER_QUERY,
        component('const result = useGetUserQuery();\nresult.loading();'),
      ),
    ).toEqual(['user']);
  });

  it.each([
    ['data called', 'result.data();'],
    ['a member of a member', 'result.refetch.bind(null);'],
    ['a member element', 'const [x] = result.refetch;'],
    ['a member method', 'result.refetch.call(null);'],
    ['a destructured member element', 'const { refetch: [y] } = result;'],
  ])('reads everything when the result has %s', (_label, body) => {
    expect(
      unread(
        USER_QUERY,
        component(`const result = useGetUserQuery();\n${body}`),
      ),
    ).toEqual([]);
  });

  it('follows a component wrapped around an identifier', () => {
    expect(
      unread(
        USER_QUERY,
        [
          'function Card({ user }) { return <p>{user.name}</p>; }',
          'const UserCard = memo(Card);',
          component(
            'const { data } = useGetUserQuery();\nreturn <UserCard user={data.user} />;',
          ),
        ].join('\n'),
      ),
    ).toEqual(ALL_BUT_NAME);
  });

  it('follows a component exported as a default expression', () => {
    expect(
      unread(USER_QUERY, {
        '/p/App.tsx': `import UserCard from './UserCard';\n${component(
          'const { data } = useGetUserQuery();\nreturn <UserCard user={data.user} />;',
        )}`,
        '/p/UserCard.tsx':
          'const Card = ({ user }) => <p>{user.name}</p>;\nexport default Card;',
      }),
    ).toEqual(ALL_BUT_NAME);
  });

  it.each([
    ['a class', 'export class UserCard {}'],
    ['a default export that is not a component', 'export default 42;'],
  ])('reads everything for an imported %s', (_label, card) => {
    expect(
      unread(USER_QUERY, {
        '/p/App.tsx': `import UserCard from './UserCard';\n${component(
          'const { data } = useGetUserQuery();\nreturn <UserCard user={data.user} />;',
        )}`,
        '/p/UserCard.tsx': card,
      }),
    ).toEqual([]);
  });

  it('never swaps a named import it cannot follow for the default export', () => {
    // UserCard is not a function component, so the trace cannot follow it.
    // The file's default export is an unrelated component that reads nothing
    // the query selects; tracing into it would flag every field.
    expect(
      unread(USER_QUERY, {
        '/p/App.tsx': `import { UserCard } from './UserCard';\n${component(
          'const { data } = useGetUserQuery();\nreturn <UserCard user={data.user} />;',
        )}`,
        '/p/UserCard.tsx':
          'export const UserCard = styled.div`color: red`;\nexport default function Other() { return null; }',
      }),
    ).toEqual([]);
  });

  it('reads everything for a component in a file it cannot parse', () => {
    expect(
      unread(USER_QUERY, {
        '/p/App.tsx': `import UserCard from './UserCard.vue';\n${component(
          'const { data } = useGetUserQuery();\nreturn <UserCard user={data.user} />;',
        )}`,
        '/p/UserCard.vue': '<template />',
      }),
    ).toEqual([]);
  });

  it.each([
    ['a member tag', 'return <ui.Card user={data.user} />;'],
    ['a namespaced attribute', 'return <Card xlink:user={data.user} />;'],
    ['a result value', 'return <Card result={data} />;'],
  ])('handles %s', (_label, body) => {
    // A member tag and a namespaced attribute name are beyond the one-hop
    // rule, so they read everything; the data root is followed like any node.
    expect(
      unread(
        USER_QUERY,
        `function Card({ result }) { return <p>{result.user.name}</p>; }\n${component(
          `const { data } = useGetUserQuery();\n${body}`,
        )}`,
      ),
    ).toEqual(body.includes('result=') ? ALL_BUT_NAME : []);
  });

  it('reads a prop the component calls or names under another key', () => {
    expect(
      unread(
        USER_QUERY,
        `function Card(props) { props.onSelect(); props.user(); return null; }\n${component(
          'const { data } = useGetUserQuery();\nreturn <Card user={data.user} />;',
        )}`,
      ),
    ).toEqual([]);
  });

  it('reads nothing for a namespaced tag, as an intrinsic element', () => {
    expect(
      read('return <svg:text value={data.user.address} />;').includes(
        'user.address.city',
      ),
    ).toBe(true);
  });
});

describe('unreadSelections', () => {
  it('reports the topmost unread node and nothing under it', () => {
    const root = treeOf(USER_QUERY);
    const reads = createFieldReads();
    const user = root.children.get('user') as SelectionNode;
    reads.reached.add(user);

    expect(
      unreadSelections(root, reads).map((node) => node.path.join('.')),
    ).toEqual(['user.id', 'user.name', 'user.avatarUrl', 'user.address']);
  });

  it('reports nothing under an escaped node', () => {
    const root = treeOf(USER_QUERY);
    const reads = createFieldReads();
    reads.escaped.add(root);

    expect(unreadSelections(root, reads)).toEqual([]);
  });
});
