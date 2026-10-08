// SPDX-License-Identifier: MIT
// Copyright (c) 2023 Krister Johansson

import ts from 'typescript';
import type { SourceFile } from './fileUtils.js';
import type { ReferenceIndex } from './referenceIndex.js';
import type { SelectionNode } from './selectionTree.js';
import { scriptKindFor } from './sourceModule.js';

/**
 * Follows what an operation's call site does with its result, to find the
 * selected fields nothing reads. Parse only, like the rest of the engine (ADR
 * 0001): no program and no type checker, so the trace knows nothing of types
 * and judges every value by the syntax around it.
 *
 * The rule throughout is that a value the trace cannot follow counts as read
 * with everything under it. A field is reported only when every way the
 * result is used was understood and none of them reaches the field.
 */

/** What the traced call sites of one operation read from its selection tree. */
export interface FieldReads {
  /** Nodes some read path reaches. */
  reached: Set<SelectionNode>;
  /** Nodes whose whole subtree counts as read. The root means everything. */
  escaped: Set<SelectionNode>;
}

/** An empty set of reads, to accumulate the call sites of one operation into. */
export function createFieldReads(): FieldReads {
  return { reached: new Set(), escaped: new Set() };
}

/** Where a call site's file can be read from and how its imports resolve. */
export interface TraceEnvironment {
  /** The parsed file at a resolved path; undefined outside the corpus or for a file the parser cannot take. */
  sourceFile(path: string): ts.SourceFile | undefined;
  /**
   * The file and name that declare the identifier at this 1-based position,
   * when it is in the corpus. `anonymousDefault` marks a binding to an
   * anonymous default export, whose `name` is only the importer's name for it.
   */
  declarationOf(
    path: string,
    line: number,
    column: number,
  ): { path: string; name: string; anonymousDefault?: boolean } | undefined;
}

/** A call that receives an operation's result, located in a parsed file. */
export interface CallSite {
  call: ts.CallExpression;
  /** The argument that names the document, for a call such as `useQuery(GetUserDocument)`. */
  documentArgument?: ts.Expression;
  sourceFile: ts.SourceFile;
  /** The resolved path of the file. */
  path: string;
}

/**
 * Parses a file for tracing, with parent pointers set: the trace walks up from
 * a call to see where its value goes.
 *
 * @param {string} file - The file name, which picks the script kind.
 * @param {string} content - The file's text.
 * @returns {ts.SourceFile} - The syntax tree.
 */
export function parseForTrace(file: string, content: string): ts.SourceFile {
  return ts.createSourceFile(
    file,
    content,
    ts.ScriptTarget.Latest,
    true,
    scriptKindFor(file) ?? ts.ScriptKind.TS,
  );
}

/**
 * Builds the environment a trace reads files through. Each file is parsed at
 * most once, and only when a trace asks for it, so the cost stays with the
 * files that hold a call site or a component one of them renders.
 *
 * @param {ReferenceIndex} index - The resolved references of the scanned sources.
 * @param {Function} source - The file and text behind a resolved path.
 * @returns {TraceEnvironment} - The environment.
 */
export function createTraceEnvironment(
  index: ReferenceIndex,
  source: (path: string) => SourceFile | undefined,
): TraceEnvironment {
  const parsed = new Map<string, ts.SourceFile | undefined>();
  return {
    sourceFile(path) {
      if (!parsed.has(path)) {
        const file = source(path);
        parsed.set(
          path,
          file !== undefined && scriptKindFor(file.file) !== undefined
            ? parseForTrace(file.file, file.content)
            : undefined,
        );
      }
      return parsed.get(path);
    },
    declarationOf(path, line, column) {
      const reference = index.byFile
        .get(path)
        ?.find((ref) => ref.line === line && ref.column === column);
      if (reference === undefined) return undefined;
      const { origin, name, anonymousDefault } = reference.canonical;
      if (origin === 'outside' || origin === 'unbound') return undefined;
      return anonymousDefault
        ? { path: origin, name, anonymousDefault }
        : { path: origin, name };
    },
  };
}

/** Wrappers that change a value's type, never the value. */
function isTypeWrapper(node: ts.Node): boolean {
  return (
    ts.isParenthesizedExpression(node) ||
    ts.isAsExpression(node) ||
    ts.isSatisfiesExpression(node) ||
    ts.isNonNullExpression(node) ||
    ts.isTypeAssertionExpression(node)
  );
}

/** Type wrappers, plus `await`: awaiting a value hands on the same data. */
function isTransparent(node: ts.Node): boolean {
  return isTypeWrapper(node) || ts.isAwaitExpression(node);
}

/** The identifier that starts exactly at a position, if any. */
function identifierAt(
  sourceFile: ts.SourceFile,
  position: number,
): ts.Identifier | undefined {
  let found: ts.Identifier | undefined;
  const visit = (node: ts.Node): void => {
    if (found !== undefined) return;
    if (ts.isIdentifier(node) && node.getStart(sourceFile) === position) {
      found = node;
    } else if (node.getFullStart() <= position && position < node.getEnd()) {
      ts.forEachChild(node, visit);
    }
  };
  ts.forEachChild(sourceFile, visit);
  return found;
}

/**
 * Finds the call a reference takes part in: the reference as the callee
 * (`useGetUserQuery()`, `api.useGetUserQuery()`) or as an argument
 * (`useQuery(GetUserDocument)`). Any other position, such as a property value
 * (`client.query({ query: GetUserDocument })`), is not a call site.
 *
 * @param {ts.SourceFile} sourceFile - The parsed file.
 * @param {string} path - Its resolved path.
 * @param {number} line - The reference's 1-based line.
 * @param {number} column - The reference's 1-based column.
 * @returns {CallSite | undefined} - The call site, or undefined.
 */
export function findCallSite(
  sourceFile: ts.SourceFile,
  path: string,
  line: number,
  column: number,
): CallSite | undefined {
  let position: number;
  try {
    position = sourceFile.getPositionOfLineAndCharacter(line - 1, column - 1);
  } catch {
    return undefined; // the compiler asserts on a line outside the file
  }
  const identifier = identifierAt(sourceFile, position);
  if (identifier === undefined) return undefined;
  let expression: ts.Node = identifier;
  if (
    ts.isPropertyAccessExpression(identifier.parent) &&
    identifier.parent.name === identifier
  ) {
    expression = identifier.parent;
  }
  while (isTypeWrapper(expression.parent)) expression = expression.parent;
  const call = expression.parent;
  if (!ts.isCallExpression(call)) return undefined;
  if (call.expression === expression) return { call, sourceFile, path };
  // Anything else directly under a call is one of its arguments.
  return {
    call,
    documentArgument: expression as ts.Expression,
    sourceFile,
    path,
  };
}

/**
 * The nodes of a selection tree nothing reads: neither reached by a read path
 * nor under an escape. Only the topmost unread node of a branch is returned,
 * since removing it removes everything under it.
 *
 * @param {SelectionNode} root - The operation's selection tree.
 * @param {FieldReads} reads - What its call sites read.
 * @returns {SelectionNode[]} - The unread nodes, depth first.
 */
export function unreadSelections(
  root: SelectionNode,
  reads: FieldReads,
): SelectionNode[] {
  const unread: SelectionNode[] = [];
  const visit = (node: SelectionNode): void => {
    for (const child of node.children.values()) {
      if (reads.escaped.has(child)) continue;
      if (!reads.reached.has(child)) {
        unread.push(child);
        continue;
      }
      visit(child);
    }
  };
  if (!reads.escaped.has(root)) visit(root);
  return unread;
}

/**
 * Traces one call site of an operation and adds what it reads to `reads`.
 *
 * The call's value is the result object (or a tuple holding it); its `data`
 * is the root of the selection tree. From there the trace follows the value
 * through aliases, destructuring, property and element access and list
 * callbacks, and through one JSX attribute into a function component's
 * props. A call that takes a callback, such as `onCompleted`, reads the data
 * where the trace cannot see, so it counts as reading everything.
 *
 * @param {CallSite} site - The call site.
 * @param {SelectionNode} root - The operation's selection tree.
 * @param {TraceEnvironment} env - Files and import resolution.
 * @param {FieldReads} reads - Accumulates the reads.
 * @returns {void}
 */
export function traceCallSite(
  site: CallSite,
  root: SelectionNode,
  env: TraceEnvironment,
  reads: FieldReads,
): void {
  new Tracer(root, env, reads).site(site);
}

/** The result's keys that hold the data the selection describes. */
const DATA_KEYS = new Set(['data', 'previousData']);

/** Result keys that say nothing about the data: reading them reads no field. */
const INERT_RESULT_KEYS = new Set([
  'loading',
  'error',
  'errors',
  'called',
  'networkStatus',
  'fetching',
  'stale',
  'variables',
  'extensions',
]);

/**
 * List methods that take a callback. `elements` names the callback
 * parameters that receive an element; `returns` says what the callback's
 * return value is used for; `result` whether the call returns elements of
 * the same list, which the trace then keeps following.
 */
const CALLBACK_METHODS: Record<
  string,
  {
    elements: number[];
    returns: 'leaf' | 'escape' | 'none';
    result: boolean;
  }
> = {
  map: { elements: [0], returns: 'escape', result: false },
  flatMap: { elements: [0], returns: 'escape', result: false },
  forEach: { elements: [0], returns: 'none', result: false },
  filter: { elements: [0], returns: 'leaf', result: true },
  find: { elements: [0], returns: 'leaf', result: true },
  findLast: { elements: [0], returns: 'leaf', result: true },
  findIndex: { elements: [0], returns: 'leaf', result: false },
  findLastIndex: { elements: [0], returns: 'leaf', result: false },
  some: { elements: [0], returns: 'leaf', result: false },
  every: { elements: [0], returns: 'leaf', result: false },
  sort: { elements: [0, 1], returns: 'leaf', result: true },
  toSorted: { elements: [0, 1], returns: 'leaf', result: true },
  reduce: { elements: [1], returns: 'escape', result: false },
  reduceRight: { elements: [1], returns: 'escape', result: false },
};

/** Methods whose result holds the same elements, or the same scalar. */
const ELEMENT_METHODS = new Set([
  'slice',
  'at',
  'reverse',
  'toReversed',
  'flat',
  'concat',
  'values',
]);

/** Methods of a list, string, number or date that read the value and nothing under it. */
const LEAF_METHODS = new Set([
  'includes',
  'indexOf',
  'lastIndexOf',
  'join',
  'toString',
  'toLocaleString',
  'toFixed',
  'toPrecision',
  'trim',
  'trimStart',
  'trimEnd',
  'toLowerCase',
  'toUpperCase',
  'toLocaleLowerCase',
  'toLocaleUpperCase',
  'startsWith',
  'endsWith',
  'localeCompare',
  'padStart',
  'padEnd',
  'substring',
  'substr',
  'charAt',
  'charCodeAt',
  'codePointAt',
  'split',
  'replace',
  'replaceAll',
  'match',
  'search',
  'repeat',
  'normalize',
  'valueOf',
  'getTime',
  'toISOString',
]);

/** Global functions that coerce their argument to a scalar without reading under it. */
const LEAF_FUNCTIONS = new Set([
  'Boolean',
  'String',
  'Number',
  'parseInt',
  'parseFloat',
  'isNaN',
  'isFinite',
  'encodeURIComponent',
  'encodeURI',
]);

/** React hooks whose last argument is a dependency array, compared by identity only. */
const DEPENDENCY_HOOKS = new Set([
  'useEffect',
  'useLayoutEffect',
  'useInsertionEffect',
  'useMemo',
  'useCallback',
  'useImperativeHandle',
]);

/** Wrappers a function component is commonly declared through. */
const COMPONENT_WRAPPERS = new Set(['memo', 'forwardRef']);

/** The value a trace follows, and what reading a key of it means. */
type Target =
  /** The call's value: a result object, a tuple element, or an execute function. */
  | { kind: 'result' }
  /** A result key other than the data, such as `refetch` or `fetchMore`. */
  | { kind: 'member' }
  /** A node of the selection tree. */
  | { kind: 'data'; node: SelectionNode }
  /** A component's props, of which only `key` carries the traced node. */
  | { kind: 'props'; key: string; node: SelectionNode };

const RESULT: Target = { kind: 'result' };
const MEMBER: Target = { kind: 'member' };

interface Context {
  sourceFile: ts.SourceFile;
  path: string;
  /** How many JSX attributes the trace has followed into a component: 0 or 1. */
  hops: number;
}

type FunctionNode =
  ts.FunctionDeclaration | ts.FunctionExpression | ts.ArrowFunction;

function isFunctionNode(node: ts.Node): node is FunctionNode {
  return (
    ts.isFunctionDeclaration(node) ||
    ts.isFunctionExpression(node) ||
    ts.isArrowFunction(node)
  );
}

function unwrapExpression(node: ts.Expression): ts.Expression {
  let expression = node;
  while (isTypeWrapper(expression)) {
    expression = (
      expression as
        | ts.ParenthesizedExpression
        | ts.AsExpression
        | ts.SatisfiesExpression
        | ts.NonNullExpression
        | ts.TypeAssertion
    ).expression;
  }
  return expression;
}

/** The name a call is made through: `f` for `f()` and `x.f()`. */
function calleeName(call: ts.CallExpression | ts.NewExpression): string {
  const callee = unwrapExpression(call.expression);
  if (ts.isIdentifier(callee)) return callee.text;
  if (ts.isPropertyAccessExpression(callee)) return callee.name.text;
  return '';
}

/** A callback-shaped option name: `onCompleted`, `onData`, `update`, `updateQuery`. */
function isCallbackName(name: string): boolean {
  return /^on[A-Z]/.test(name) || name === 'update' || name === 'updateQuery';
}

function propertyNameText(name: ts.PropertyName): string | undefined {
  if (
    ts.isIdentifier(name) ||
    ts.isStringLiteral(name) ||
    ts.isNumericLiteral(name) ||
    ts.isPrivateIdentifier(name)
  ) {
    return name.text;
  }
  if (
    ts.isComputedPropertyName(name) &&
    ts.isStringLiteralLike(name.expression)
  ) {
    return name.expression.text;
  }
  return undefined;
}

/**
 * Whether an argument may hand the data to code the trace does not follow: a
 * function, an object holding a callback-named option, a spread, or, at the
 * top level, any value that is not a literal (an options object built
 * elsewhere may carry a callback too).
 */
function mayCarryCallback(node: ts.Expression, topLevel: boolean): boolean {
  const expression = unwrapExpression(node);
  if (ts.isArrowFunction(expression) || ts.isFunctionExpression(expression)) {
    return true;
  }
  if (ts.isObjectLiteralExpression(expression)) {
    return expression.properties.some((property) => {
      if (
        ts.isSpreadAssignment(property) ||
        ts.isMethodDeclaration(property) ||
        ts.isAccessor(property)
      ) {
        return true;
      }
      const name = propertyNameText(property.name);
      if (name === undefined || isCallbackName(name)) return true;
      return (
        ts.isPropertyAssignment(property) &&
        mayCarryCallback(property.initializer, false)
      );
    });
  }
  if (ts.isArrayLiteralExpression(expression)) {
    return expression.elements.some(
      (element) =>
        ts.isSpreadElement(element) || mayCarryCallback(element, false),
    );
  }
  if (
    ts.isLiteralExpression(expression) ||
    ts.isTemplateExpression(expression) ||
    expression.kind === ts.SyntaxKind.TrueKeyword ||
    expression.kind === ts.SyntaxKind.FalseKeyword ||
    expression.kind === ts.SyntaxKind.NullKeyword ||
    (ts.isIdentifier(expression) && expression.text === 'undefined')
  ) {
    return false;
  }
  return topLevel;
}

function argumentsMayReadData(
  call: ts.CallExpression,
  skip?: ts.Expression,
): boolean {
  return call.arguments.some(
    (argument) => argument !== skip && mayCarryCallback(argument, true),
  );
}

/** Whether a call's value is thrown away: a bare statement, `void`, or an arrow's body. */
function isDiscarded(call: ts.CallExpression): boolean {
  let node: ts.Node = call;
  while (isTransparent(node.parent)) node = node.parent;
  const parent = node.parent;
  return (
    ts.isExpressionStatement(parent) ||
    ts.isVoidExpression(parent) ||
    (ts.isArrowFunction(parent) && parent.body === node)
  );
}

/** Positions that read a value as a whole without reaching under it. */
function isLeafPosition(parent: ts.Node, expression: ts.Node): boolean {
  if (
    ts.isPrefixUnaryExpression(parent) ||
    ts.isPostfixUnaryExpression(parent) ||
    ts.isTypeOfExpression(parent) ||
    ts.isVoidExpression(parent) ||
    ts.isDeleteExpression(parent) ||
    ts.isIfStatement(parent) ||
    ts.isWhileStatement(parent) ||
    ts.isDoStatement(parent) ||
    ts.isSwitchStatement(parent) ||
    ts.isCaseClause(parent) ||
    ts.isForInStatement(parent)
  ) {
    return true;
  }
  return ts.isForStatement(parent) && parent.initializer !== expression;
}

function isDependencyArray(array: ts.ArrayLiteralExpression): boolean {
  const call = array.parent;
  return (
    ts.isCallExpression(call) &&
    call.arguments.length > 1 &&
    call.arguments[call.arguments.length - 1] === array &&
    DEPENDENCY_HOOKS.has(calleeName(call))
  );
}

function isLeafCall(call: ts.CallExpression | ts.NewExpression): boolean {
  const callee = unwrapExpression(call.expression);
  if (ts.isNewExpression(call)) {
    return ts.isIdentifier(callee) && callee.text === 'Date';
  }
  if (ts.isIdentifier(callee)) return LEAF_FUNCTIONS.has(callee.text);
  return (
    ts.isPropertyAccessExpression(callee) &&
    ts.isIdentifier(callee.expression) &&
    callee.expression.text === 'Math'
  );
}

function enclosingFunction(node: ts.Node): ts.SignatureDeclaration | undefined {
  for (let current = node.parent; current; current = current.parent) {
    if (ts.isFunctionLike(current)) return current;
  }
  return undefined;
}

/** The node a variable's references are searched in. */
function declarationScope(declaration: ts.VariableDeclaration): ts.Node {
  const list = declaration.parent;
  if (!ts.isVariableDeclarationList(list)) return list;
  const holder = list.parent;
  if (
    ts.isForStatement(holder) ||
    ts.isForOfStatement(holder) ||
    ts.isForInStatement(holder)
  ) {
    return holder;
  }
  if ((list.flags & ts.NodeFlags.BlockScoped) === 0) {
    return enclosingFunction(holder) ?? holder.getSourceFile();
  }
  return holder.parent;
}

/** Every identifier a binding name introduces, through nested patterns. */
function bindingNames(name: ts.BindingName): string[] {
  if (ts.isIdentifier(name)) return [name.text];
  return name.elements.flatMap((element) =>
    ts.isBindingElement(element) ? bindingNames(element.name) : [],
  );
}

function declaresInStatements(
  statements: ts.NodeArray<ts.Statement>,
  name: string,
): boolean {
  return statements.some((statement) => {
    if (ts.isVariableStatement(statement)) {
      return statement.declarationList.declarations.some((declaration) =>
        bindingNames(declaration.name).includes(name),
      );
    }
    return (
      (ts.isFunctionDeclaration(statement) ||
        ts.isClassDeclaration(statement)) &&
      statement.name?.text === name
    );
  });
}

/** Whether a node opens a scope that declares the name again, hiding the one being traced. */
function shadows(node: ts.Node, name: string): boolean {
  if (ts.isFunctionLike(node)) {
    if (
      ts.isFunctionExpression(node) &&
      node.name !== undefined &&
      node.name.text === name
    ) {
      return true;
    }
    return node.parameters.some((parameter) =>
      bindingNames(parameter.name).includes(name),
    );
  }
  if (ts.isBlock(node) || ts.isSourceFile(node) || ts.isModuleBlock(node)) {
    return declaresInStatements(node.statements, name);
  }
  if (ts.isCaseClause(node) || ts.isDefaultClause(node)) {
    return declaresInStatements(node.statements, name);
  }
  if (
    ts.isForStatement(node) ||
    ts.isForOfStatement(node) ||
    ts.isForInStatement(node)
  ) {
    const initializer = node.initializer;
    return (
      initializer !== undefined &&
      ts.isVariableDeclarationList(initializer) &&
      initializer.declarations.some((declaration) =>
        bindingNames(declaration.name).includes(name),
      )
    );
  }
  if (ts.isCatchClause(node)) {
    const variable = node.variableDeclaration;
    return variable !== undefined && bindingNames(variable.name).includes(name);
  }
  return false;
}

/**
 * The scope an assigned name was declared in: the nearest enclosing block or
 * function that declares it, or the file when nothing does.
 */
function assignmentScope(node: ts.Node, name: string): ts.Node {
  for (let current = node.parent; current; current = current.parent) {
    if (shadows(current, name)) return current;
  }
  return node.getSourceFile();
}

/** Whether an identifier reads a binding, as opposed to naming a key, a declaration or a type. */
function isReference(identifier: ts.Identifier): boolean {
  const parent = identifier.parent;
  if (ts.isBindingElement(parent)) return parent.initializer === identifier;
  if (
    ts.isPropertyAccessExpression(parent) ||
    ts.isPropertyAssignment(parent) ||
    ts.isPropertyDeclaration(parent) ||
    ts.isPropertySignature(parent) ||
    ts.isMethodDeclaration(parent) ||
    ts.isMethodSignature(parent) ||
    ts.isGetAccessorDeclaration(parent) ||
    ts.isSetAccessorDeclaration(parent) ||
    ts.isEnumMember(parent) ||
    ts.isVariableDeclaration(parent) ||
    ts.isParameter(parent) ||
    ts.isFunctionDeclaration(parent) ||
    ts.isFunctionExpression(parent) ||
    ts.isClassDeclaration(parent) ||
    ts.isClassExpression(parent) ||
    ts.isJsxAttribute(parent)
  ) {
    return parent.name !== identifier;
  }
  return !(
    ts.isQualifiedName(parent) ||
    ts.isTypeReferenceNode(parent) ||
    ts.isTypeQueryNode(parent) ||
    ts.isImportSpecifier(parent) ||
    ts.isImportClause(parent) ||
    ts.isNamespaceImport(parent) ||
    ts.isLabeledStatement(parent) ||
    ts.isBreakOrContinueStatement(parent) ||
    ts.isJsxOpeningElement(parent) ||
    ts.isJsxSelfClosingElement(parent) ||
    ts.isJsxClosingElement(parent)
  );
}

/** The key a destructuring element reads, or undefined for a computed one. */
function bindingKey(element: ts.BindingElement): string | undefined {
  if (element.propertyName !== undefined) {
    return propertyNameText(element.propertyName);
  }
  return ts.isIdentifier(element.name) ? element.name.text : undefined;
}

/** The function a component name stands for: unwrapped from `memo`/`forwardRef`, resolved once more by name. */
function componentFunction(
  expression: ts.Expression,
  sourceFile: ts.SourceFile,
  depth: number,
): FunctionNode | undefined {
  const node = unwrapExpression(expression);
  if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) return node;
  if (
    ts.isCallExpression(node) &&
    COMPONENT_WRAPPERS.has(calleeName(node)) &&
    node.arguments[0] !== undefined
  ) {
    return componentFunction(node.arguments[0], sourceFile, depth);
  }
  if (ts.isIdentifier(node) && depth < 2) {
    return findComponent(sourceFile, node.text, depth + 1);
  }
  return undefined;
}

/** A top-level function component declared under this name. */
function findComponent(
  sourceFile: ts.SourceFile,
  name: string,
  depth = 0,
): FunctionNode | undefined {
  for (const statement of sourceFile.statements) {
    if (
      ts.isFunctionDeclaration(statement) &&
      statement.name?.text === name &&
      statement.body !== undefined
    ) {
      return statement;
    }
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (
          ts.isIdentifier(declaration.name) &&
          declaration.name.text === name &&
          declaration.initializer !== undefined
        ) {
          return componentFunction(declaration.initializer, sourceFile, depth);
        }
      }
    }
  }
  return undefined;
}

/** The function a file exports as its default, when that is a function component. */
function defaultExportComponent(
  sourceFile: ts.SourceFile,
): FunctionNode | undefined {
  for (const statement of sourceFile.statements) {
    if (
      ts.isFunctionDeclaration(statement) &&
      statement.body !== undefined &&
      (ts.getModifiers(statement) ?? []).some(
        (modifier) => modifier.kind === ts.SyntaxKind.DefaultKeyword,
      )
    ) {
      return statement;
    }
    if (ts.isExportAssignment(statement) && !statement.isExportEquals) {
      return componentFunction(statement.expression, sourceFile, 0);
    }
  }
  return undefined;
}

/**
 * One trace: a call site, followed to every read and escape it leads to. The
 * `seen` map stops a value that flows back into itself (`u = u.next`, a
 * component rendering itself) from being followed forever.
 */
class Tracer {
  private readonly seen = new Map<ts.Node, Set<unknown>>();

  constructor(
    private readonly root: SelectionNode,
    private readonly env: TraceEnvironment,
    private readonly reads: FieldReads,
  ) {}

  site(site: CallSite): void {
    if (argumentsMayReadData(site.call, site.documentArgument)) {
      this.escapeAll();
      return;
    }
    this.trace(site.call, RESULT, {
      sourceFile: site.sourceFile,
      path: site.path,
      hops: 0,
    });
  }

  private escapeAll(): void {
    this.reads.escaped.add(this.root);
  }

  /** Everything under the target counts as read. */
  private escape(target: Target): void {
    if (target.kind === 'data' || target.kind === 'props') {
      this.reads.escaped.add(target.node);
    } else {
      this.escapeAll();
    }
  }

  /** What reading `key` of the target yields, recording the read. */
  private child(target: Target, key: string): Target | undefined {
    switch (target.kind) {
      case 'data': {
        const node = target.node.children.get(key);
        if (node === undefined) return undefined; // not selected: `length`, a scalar's own key
        this.reads.reached.add(node);
        return { kind: 'data', node };
      }
      case 'result':
        if (DATA_KEYS.has(key)) return { kind: 'data', node: this.root };
        return INERT_RESULT_KEYS.has(key) ? undefined : MEMBER;
      case 'member':
        this.escapeAll();
        return undefined;
      case 'props':
        return key === target.key
          ? { kind: 'data', node: target.node }
          : undefined;
    }
  }

  /** What an element of the target yields: a list element, or a tuple element of a result. */
  private element(target: Target): Target | undefined {
    if (target.kind === 'data' || target.kind === 'result') return target;
    this.escape(target);
    return undefined;
  }

  private follow(node: ts.Node, target: Target | undefined, ctx: Context) {
    if (target !== undefined) this.trace(node, target, ctx);
  }

  /** Follows the value of `expression` one step up the tree. */
  private trace(expression: ts.Node, target: Target, ctx: Context): void {
    const identity = target.kind === 'data' ? target.node : target;
    const seen = this.seen.get(expression) ?? new Set<unknown>();
    if (seen.has(identity)) return;
    seen.add(identity);
    this.seen.set(expression, seen);

    const parent = expression.parent;
    if (isTransparent(parent)) return this.trace(parent, target, ctx);
    if (
      ts.isPropertyAccessExpression(parent) &&
      parent.expression === expression
    ) {
      return this.access(parent, parent.name.text, target, ctx);
    }
    if (
      ts.isElementAccessExpression(parent) &&
      parent.expression === expression
    ) {
      const argument = parent.argumentExpression;
      if (ts.isStringLiteralLike(argument)) {
        return this.access(parent, argument.text, target, ctx);
      }
      if (ts.isNumericLiteral(argument)) {
        return this.follow(parent, this.element(target), ctx);
      }
      return this.escape(target);
    }
    if (ts.isCallExpression(parent) || ts.isNewExpression(parent)) {
      if (parent.expression === expression) {
        return ts.isCallExpression(parent)
          ? this.called(parent, target)
          : this.escape(target);
      }
      return isLeafCall(parent) ? undefined : this.escape(target);
    }
    if (ts.isVariableDeclaration(parent) && parent.initializer === expression) {
      return this.bind(parent.name, target, ctx, declarationScope(parent));
    }
    if (ts.isBinaryExpression(parent)) {
      return this.binary(parent, expression, target, ctx);
    }
    if (ts.isConditionalExpression(parent)) {
      return parent.condition === expression
        ? undefined
        : this.trace(parent, target, ctx);
    }
    if (isLeafPosition(parent, expression)) return;
    if (ts.isTemplateSpan(parent)) {
      // A tagged template hands its values to the tag function.
      return ts.isTaggedTemplateExpression(parent.parent.parent)
        ? this.escape(target)
        : undefined;
    }
    if (ts.isJsxExpression(parent))
      return this.jsxExpression(parent, target, ctx);
    if (ts.isForOfStatement(parent) && parent.expression === expression) {
      return this.forOf(parent, target, ctx);
    }
    if (ts.isArrayLiteralExpression(parent) && isDependencyArray(parent)) {
      return;
    }
    if (ts.isReturnStatement(parent)) {
      const fn = enclosingFunction(parent);
      return fn !== undefined && isFunctionNode(fn)
        ? this.returned(fn, target, ctx)
        : this.escape(target);
    }
    if (ts.isArrowFunction(parent) && parent.body === expression) {
      return this.returned(parent, target, ctx);
    }
    if (ts.isExpressionStatement(parent)) return;
    // Spread, object and array literals, throw, yield, export, and anything
    // else the trace has no rule for: the value goes where it cannot follow.
    this.escape(target);
  }

  /** `value.key` or `value['key']`, possibly called as a method. */
  private access(
    node: ts.Expression,
    key: string,
    target: Target,
    ctx: Context,
  ): void {
    let callee: ts.Node = node;
    while (isTypeWrapper(callee.parent)) callee = callee.parent;
    const call = callee.parent;
    if (ts.isCallExpression(call) && call.expression === callee) {
      return this.method(call, key, target, ctx);
    }
    this.follow(node, this.child(target, key), ctx);
  }

  /** The target itself is called. */
  private called(call: ts.CallExpression, target: Target): void {
    if (target.kind === 'result' || target.kind === 'member') {
      return this.memberCall(call);
    }
    this.escape(target);
  }

  /**
   * A result function is called: `refetch()`, `execute({ variables })`. It
   * is harmless while it gets no callback and its value is thrown away; a
   * callback (`fetchMore({ updateQuery })`) or a used return value can read
   * the data where the trace cannot see.
   */
  private memberCall(call: ts.CallExpression): void {
    if (argumentsMayReadData(call) || !isDiscarded(call)) this.escapeAll();
  }

  private method(
    call: ts.CallExpression,
    key: string,
    target: Target,
    ctx: Context,
  ): void {
    switch (target.kind) {
      case 'result':
        if (DATA_KEYS.has(key)) return this.escapeAll();
        if (INERT_RESULT_KEYS.has(key)) return;
        return this.memberCall(call);
      case 'member':
        return this.escapeAll();
      case 'props':
        return key === target.key ? this.escape(target) : undefined;
      case 'data':
        return this.dataMethod(call, key, target, ctx);
    }
  }

  private dataMethod(
    call: ts.CallExpression,
    key: string,
    target: Target,
    ctx: Context,
  ): void {
    const spec = Object.hasOwn(CALLBACK_METHODS, key)
      ? CALLBACK_METHODS[key]
      : undefined;
    if (spec !== undefined) {
      const [argument] = call.arguments;
      if (argument === undefined) {
        if (spec.result) this.trace(call, target, ctx);
        return;
      }
      const callback = unwrapExpression(argument);
      if (!ts.isArrowFunction(callback) && !ts.isFunctionExpression(callback)) {
        return this.escape(target); // the elements go to a function it cannot see
      }
      for (const index of spec.elements) {
        const parameter = callback.parameters[index];
        if (parameter !== undefined) {
          this.bind(parameter.name, target, ctx, callback);
        }
      }
      if (spec.result) this.trace(call, target, ctx);
      return;
    }
    if (ELEMENT_METHODS.has(key)) return this.trace(call, target, ctx);
    if (LEAF_METHODS.has(key)) return;
    this.escape(target);
  }

  /** A value returned from a function: what the caller does with it decides. */
  private returned(fn: FunctionNode, target: Target, ctx: Context): void {
    let holder: ts.Node = fn;
    while (isTypeWrapper(holder.parent)) holder = holder.parent;
    const call = holder.parent;
    if (ts.isCallExpression(call) && call.arguments[0] === holder) {
      const name = calleeName(call);
      const spec = Object.hasOwn(CALLBACK_METHODS, name)
        ? CALLBACK_METHODS[name]
        : undefined;
      if (
        spec !== undefined &&
        ts.isPropertyAccessExpression(call.expression)
      ) {
        return spec.returns === 'escape' ? this.escape(target) : undefined;
      }
      // useMemo hands the callback's value back as its own.
      if (name === 'useMemo') return this.trace(call, target, ctx);
    }
    this.escape(target);
  }

  private binary(
    parent: ts.BinaryExpression,
    expression: ts.Node,
    target: Target,
    ctx: Context,
  ): void {
    switch (parent.operatorToken.kind) {
      case ts.SyntaxKind.EqualsToken:
        if (parent.left === expression) return; // written, not read
        if (ts.isIdentifier(parent.left)) {
          const name = parent.left.text;
          return this.references(
            name,
            assignmentScope(parent, name),
            target,
            ctx,
          );
        }
        return this.escape(target);
      case ts.SyntaxKind.AmpersandAmpersandToken:
        return parent.left === expression
          ? undefined
          : this.trace(parent, target, ctx);
      case ts.SyntaxKind.BarBarToken:
      case ts.SyntaxKind.QuestionQuestionToken:
        return this.trace(parent, target, ctx);
      case ts.SyntaxKind.CommaToken:
        return parent.right === expression
          ? this.trace(parent, target, ctx)
          : undefined;
      case ts.SyntaxKind.BarBarEqualsToken:
      case ts.SyntaxKind.AmpersandAmpersandEqualsToken:
      case ts.SyntaxKind.QuestionQuestionEqualsToken:
        return parent.left === expression ? undefined : this.escape(target);
      default:
        // Comparison, arithmetic, `in`, `instanceof`, compound assignment:
        // the value is used as a whole.
        return;
    }
  }

  /** A declared name, or every name a destructuring pattern introduces. */
  private bind(
    name: ts.BindingName,
    target: Target,
    ctx: Context,
    scope: ts.Node,
  ): void {
    if (ts.isIdentifier(name)) {
      return this.references(name.text, scope, target, ctx, name);
    }
    if (ts.isObjectBindingPattern(name)) {
      for (const element of name.elements) {
        if (element.dotDotDotToken !== undefined) {
          // The rest holds the remaining keys; following it as the whole
          // value only ever credits more reads.
          this.bind(element.name, target, ctx, scope);
          continue;
        }
        const key = bindingKey(element);
        if (key === undefined) {
          this.escape(target);
          continue;
        }
        const child = this.child(target, key);
        if (child !== undefined) this.bind(element.name, child, ctx, scope);
      }
      return;
    }
    for (const element of name.elements) {
      if (ts.isOmittedExpression(element)) continue;
      const next =
        element.dotDotDotToken !== undefined ? target : this.element(target);
      if (next !== undefined) this.bind(element.name, next, ctx, scope);
    }
  }

  /**
   * Traces every read of a name inside its scope, skipping scopes that
   * redeclare it. A scope that holds the declaration itself (the block a
   * `var` sits in, below the function it belongs to) is never skipped.
   */
  private references(
    name: string,
    scope: ts.Node,
    target: Target,
    ctx: Context,
    declaration?: ts.Node,
  ): void {
    const holdsDeclaration = (node: ts.Node): boolean =>
      declaration !== undefined &&
      node.pos <= declaration.pos &&
      declaration.end <= node.end;
    const visit = (node: ts.Node): void => {
      if (node !== scope && !holdsDeclaration(node) && shadows(node, name)) {
        return;
      }
      if (ts.isIdentifier(node)) {
        if (node.text === name && isReference(node)) {
          this.trace(node, target, ctx);
        }
        return;
      }
      ts.forEachChild(node, visit);
    };
    visit(scope);
  }

  private forOf(
    statement: ts.ForOfStatement,
    target: Target,
    ctx: Context,
  ): void {
    const element = this.element(target);
    if (element === undefined) return;
    const initializer = statement.initializer;
    if (ts.isVariableDeclarationList(initializer)) {
      const [declaration] = initializer.declarations;
      if (declaration !== undefined) {
        this.bind(declaration.name, element, ctx, statement);
      }
      return;
    }
    this.escape(target);
  }

  private jsxExpression(
    expression: ts.JsxExpression,
    target: Target,
    ctx: Context,
  ): void {
    const holder = expression.parent;
    // The only other place a JSX expression sits is among an element's
    // children, where the value is rendered as text.
    if (ts.isJsxAttribute(holder)) this.jsxAttribute(holder, target, ctx);
  }

  /**
   * A value given to a JSX attribute. An intrinsic element (`<img>`) and
   * React's `key` read it as a whole. A function component the trace can
   * resolve gets one hop: the trace continues at its props, and anything it
   * cannot follow there, a second component included, counts as read.
   */
  private jsxAttribute(
    attribute: ts.JsxAttribute,
    target: Target,
    ctx: Context,
  ): void {
    const tag = attribute.parent.parent.tagName;
    if (ts.isIdentifier(attribute.name) && attribute.name.text === 'key') {
      return;
    }
    if (
      ts.isJsxNamespacedName(tag) ||
      (ts.isIdentifier(tag) && /^[a-z]/.test(tag.text))
    ) {
      return;
    }
    if (
      target.kind !== 'data' ||
      ctx.hops > 0 ||
      !ts.isIdentifier(tag) ||
      !ts.isIdentifier(attribute.name)
    ) {
      return this.escape(target);
    }
    const component = this.component(tag, ctx);
    if (component === undefined) return this.escape(target);
    const [props] = component.fn.parameters;
    if (props === undefined) return; // the component takes no props at all
    this.bind(
      props.name,
      { kind: 'props', key: attribute.name.text, node: target.node },
      { sourceFile: component.sourceFile, path: component.path, hops: 1 },
      component.fn,
    );
  }

  private component(
    tag: ts.Identifier,
    ctx: Context,
  ): { fn: FunctionNode; sourceFile: ts.SourceFile; path: string } | undefined {
    const local = findComponent(ctx.sourceFile, tag.text);
    if (local !== undefined) {
      return { fn: local, sourceFile: ctx.sourceFile, path: ctx.path };
    }
    const { line, character } = ctx.sourceFile.getLineAndCharacterOfPosition(
      tag.getStart(ctx.sourceFile),
    );
    const declared = this.env.declarationOf(ctx.path, line + 1, character + 1);
    if (declared === undefined || declared.path === ctx.path) return undefined;
    const sourceFile = this.env.sourceFile(declared.path);
    if (sourceFile === undefined) return undefined;
    // Only an anonymous default export is looked up as "the default": a named
    // binding that is not a component must escape, never borrow another one.
    const fn = declared.anonymousDefault
      ? defaultExportComponent(sourceFile)
      : findComponent(sourceFile, declared.name);
    return fn === undefined
      ? undefined
      : { fn, sourceFile, path: declared.path };
  }
}
