// SPDX-License-Identifier: MIT
// Copyright (c) 2023 Krister Johansson

import path from 'path';
import ts from 'typescript';
import { identifierWords } from './stringHelpers.js';

/**
 * The per-file model the usage engine works from. A source file is parsed once
 * with the TypeScript compiler (no program, no type checker) and reduced to
 * what a usage verdict needs: which local names are import bindings, what the
 * file exports, every identifier that *references* something, the inline
 * GraphQL documents it defines, and the words written inside its strings. The
 * syntax tree itself is dropped after the walk.
 */

export type ImportKind = 'named' | 'default' | 'namespace';

export interface ImportBinding {
  /** The name the file uses. */
  local: string;
  /** The module specifier as written. */
  specifier: string;
  kind: ImportKind;
  /** The exported name behind a `named` binding. */
  imported?: string;
}

export type ExportEntry =
  /** `export const X`, `export { a as b }`, `export default X`. No `local` for an anonymous default. */
  | { kind: 'local'; exported: string; local?: string }
  /** `export { a as b } from './m'`, `export { default as X } from './m'`. */
  | { kind: 'reexport'; exported: string; specifier: string; imported: string }
  /** `export * as ns from './m'`. */
  | { kind: 'namespace'; exported: string; specifier: string };

export type ReferenceKind =
  'expression' | 'shorthand' | 'member' | 'type' | 'jsx' | 'token';

export interface Reference {
  /** The identifier as written; for a `member`, the property name. */
  name: string;
  /** For a `member`: the identifier it was accessed on, when that is a plain identifier. */
  base?: string;
  kind: ReferenceKind;
  /** 1-based. */
  line: number;
  /** 1-based. */
  column: number;
}

export interface InlineSite {
  /** The document text, with every `${...}` blanked to spaces of the same length. */
  body: string;
  /** Where the body starts, 1-based. */
  line: number;
  column: number;
  /** The constant the document is assigned to, when it is. */
  identifier?: string;
  /** True when the document is used where it stands (an argument, a property value, ...). */
  consumed: boolean;
  /** Offsets of the body inside the file, so the text can be blanked for other passes. */
  textRange: { start: number; end: number };
}

export interface SourceModule {
  /** The file as the scan discovered it, for reporting. */
  file: string;
  /** The resolved posix path; the key every cross-file structure uses. */
  path: string;
  imports: Map<string, ImportBinding>;
  exports: Map<string, ExportEntry>;
  /** Specifiers of `export * from`, in order. */
  starExports: string[];
  /** Every name the file declares, at any scope. */
  declarations: Set<string>;
  references: Reference[];
  /** Every declared or referenced name, for coverage counts. */
  identifiers: Set<string>;
  /** Identifier-shaped words inside string and template literals, inline document bodies excluded. */
  stringWords: Set<string>;
  /** Identifier-shaped words inside inline document bodies. */
  siteWords: Set<string>;
  inlineSites: InlineSite[];
  /** Parser diagnostics; zero for a file that parsed cleanly. */
  syntaxErrors: number;
  /** `module` for a parsed file, `tokens` for the lexical fallback. */
  mode: 'module' | 'tokens';
}

const SCRIPT_KINDS: Record<string, ts.ScriptKind> = {
  '.ts': ts.ScriptKind.TS,
  '.mts': ts.ScriptKind.TS,
  '.cts': ts.ScriptKind.TS,
  '.tsx': ts.ScriptKind.TSX,
  '.js': ts.ScriptKind.JS,
  '.mjs': ts.ScriptKind.JS,
  '.cjs': ts.ScriptKind.JS,
  '.jsx': ts.ScriptKind.JSX,
};

/** The tag and helper names that introduce an inline GraphQL document. */
const DOCUMENT_TAGS = new Set(['gql', 'graphql']);

/**
 * The script kind the compiler should parse a file as, by extension, or
 * undefined for a file it cannot take (a single-file component, say).
 */
export function scriptKindFor(file: string): ts.ScriptKind | undefined {
  return SCRIPT_KINDS[path.extname(file).toLowerCase()];
}

/** The compiler keeps its parse diagnostics on the file, but not in the public types. */
interface ParsedSourceFile extends ts.SourceFile {
  parseDiagnostics?: readonly ts.Diagnostic[];
}

function emptyModule(file: string, mode: 'module' | 'tokens'): SourceModule {
  return {
    file,
    path: path.resolve(file).split(path.sep).join('/'),
    imports: new Map(),
    exports: new Map(),
    starExports: [],
    declarations: new Set(),
    references: [],
    identifiers: new Set(),
    stringWords: new Set(),
    siteWords: new Set(),
    inlineSites: [],
    syntaxErrors: 0,
    mode,
  };
}

/**
 * Parses one file and walks it once. Never throws: the parser recovers from
 * syntax errors and the walk reads whatever tree it produced, with the error
 * count reported on the module.
 */
export function parseSourceModule(file: string, content: string): SourceModule {
  const module = emptyModule(file, 'module');
  const sourceFile = ts.createSourceFile(
    file,
    content,
    ts.ScriptTarget.Latest,
    true,
    scriptKindFor(file) ?? ts.ScriptKind.TS,
  ) as ParsedSourceFile;
  module.syntaxErrors = sourceFile.parseDiagnostics?.length ?? 0;
  new Walker(sourceFile, module).walk();
  return module;
}

/**
 * The lexical fallback for a file the parser cannot take: every identifier
 * token is a reference of kind `token`, strings feed the string words, and
 * nothing is known about imports, exports or declarations. Detection on such
 * a file is a plain name match, which the README says.
 */
export function tokenizeSourceModule(
  file: string,
  content: string,
): SourceModule {
  const module = emptyModule(file, 'tokens');
  const scanner = ts.createScanner(
    ts.ScriptTarget.Latest,
    true,
    ts.LanguageVariant.JSX,
    content,
  );
  const lineStarts = computeLineStarts(content);
  // One entry per open template: how many `{` are open inside its current `${`.
  const templateDepths: number[] = [];
  let previous = ts.SyntaxKind.Unknown;
  for (let token = scanner.scan(); token !== ts.SyntaxKind.EndOfFileToken;) {
    if (
      token === ts.SyntaxKind.SlashToken ||
      token === ts.SyntaxKind.SlashEqualsToken
    ) {
      if (regexCanFollow(previous)) token = scanner.reScanSlashToken();
    } else if (
      token === ts.SyntaxKind.OpenBraceToken &&
      templateDepths.length > 0
    ) {
      templateDepths[templateDepths.length - 1] += 1;
    } else if (
      token === ts.SyntaxKind.CloseBraceToken &&
      templateDepths.length > 0
    ) {
      const depth = templateDepths[templateDepths.length - 1];
      if (depth > 0) {
        templateDepths[templateDepths.length - 1] = depth - 1;
      } else {
        token = scanner.reScanTemplateToken(false);
        if (token === ts.SyntaxKind.TemplateTail) templateDepths.pop();
      }
    }
    if (token === ts.SyntaxKind.TemplateHead) templateDepths.push(0);
    if (isIdentifierToken(token)) {
      const { line, column } = lineAndColumn(
        lineStarts,
        scanner.getTokenStart(),
      );
      const name = scanner.getTokenValue();
      module.references.push({ name, kind: 'token', line, column });
      module.identifiers.add(name);
    } else if (isStringToken(token)) {
      for (const word of identifierWords(scanner.getTokenValue())) {
        module.stringWords.add(word);
      }
    }
    previous = token;
    token = scanner.scan();
  }
  return module;
}

/** Dispatches on the extension: a real parse when the compiler can, tokens otherwise. */
export function buildSourceModule(file: string, content: string): SourceModule {
  return scriptKindFor(file) === undefined
    ? tokenizeSourceModule(file, content)
    : parseSourceModule(file, content);
}

/** The offset of every line's first character. */
function computeLineStarts(text: string): number[] {
  const starts = [0];
  for (let i = 0; i < text.length; i += 1) {
    const char = text.charCodeAt(i);
    if (char === 13 && text.charCodeAt(i + 1) === 10) i += 1;
    if (char === 10 || char === 13) starts.push(i + 1);
  }
  return starts;
}

/** 1-based line and column of an offset, by binary search over the line starts. */
function lineAndColumn(
  lineStarts: number[],
  position: number,
): { line: number; column: number } {
  let low = 0;
  let high = lineStarts.length - 1;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (lineStarts[mid] <= position) low = mid;
    else high = mid - 1;
  }
  return { line: low + 1, column: position - lineStarts[low] + 1 };
}

/** Identifiers, plus the keywords that may also be identifiers (`type`, `from`, `async`, ...). */
function isIdentifierToken(token: ts.SyntaxKind): boolean {
  return (
    token === ts.SyntaxKind.Identifier ||
    (token > ts.SyntaxKind.LastReservedWord &&
      token <= ts.SyntaxKind.LastKeyword)
  );
}

function isStringToken(token: ts.SyntaxKind): boolean {
  return (
    token === ts.SyntaxKind.StringLiteral ||
    token === ts.SyntaxKind.NoSubstitutionTemplateLiteral ||
    token === ts.SyntaxKind.TemplateHead ||
    token === ts.SyntaxKind.TemplateMiddle ||
    token === ts.SyntaxKind.TemplateTail
  );
}

/** A `/` starts a regular expression unless the previous token ended an operand. */
function regexCanFollow(previous: ts.SyntaxKind): boolean {
  switch (previous) {
    case ts.SyntaxKind.Identifier:
    case ts.SyntaxKind.NumericLiteral:
    case ts.SyntaxKind.BigIntLiteral:
    case ts.SyntaxKind.StringLiteral:
    case ts.SyntaxKind.NoSubstitutionTemplateLiteral:
    case ts.SyntaxKind.TemplateTail:
    case ts.SyntaxKind.RegularExpressionLiteral:
    case ts.SyntaxKind.CloseParenToken:
    case ts.SyntaxKind.CloseBracketToken:
    case ts.SyntaxKind.CloseBraceToken:
    case ts.SyntaxKind.ThisKeyword:
    case ts.SyntaxKind.TrueKeyword:
    case ts.SyntaxKind.FalseKeyword:
    case ts.SyntaxKind.NullKeyword:
      return false;
    default:
      return !isIdentifierToken(previous);
  }
}

type DocumentLiteral =
  ts.StringLiteral | ts.NoSubstitutionTemplateLiteral | ts.TemplateExpression;

function isDocumentLiteral(node: ts.Node): node is DocumentLiteral {
  return (
    ts.isStringLiteral(node) ||
    ts.isNoSubstitutionTemplateLiteral(node) ||
    ts.isTemplateExpression(node)
  );
}

/** `gql` or `graphql`, bare or as the last member of a chain (`apollo.gql`). */
function isDocumentTag(node: ts.Expression): boolean {
  if (ts.isIdentifier(node)) return DOCUMENT_TAGS.has(node.text);
  return (
    ts.isPropertyAccessExpression(node) && DOCUMENT_TAGS.has(node.name.text)
  );
}

function isTopLevelRequire(
  node: ts.VariableDeclaration,
): node is ts.VariableDeclaration & { initializer: ts.CallExpression } {
  const statement = node.parent.parent;
  return (
    ts.isVariableStatement(statement) &&
    ts.isSourceFile(statement.parent) &&
    node.initializer !== undefined &&
    ts.isCallExpression(node.initializer) &&
    ts.isIdentifier(node.initializer.expression) &&
    node.initializer.expression.text === 'require' &&
    node.initializer.arguments.length === 1 &&
    ts.isStringLiteral(node.initializer.arguments[0])
  );
}

/**
 * One walk over the tree. Each syntax position is either a declaration (a
 * name is introduced), plumbing (an import or export specifier), a reference
 * (something is read), or text. The default arm of `visit` treats a bare
 * identifier as a reference, so every position where an identifier is *not*
 * one has an arm of its own that steps around it.
 */
class Walker {
  constructor(
    private readonly sourceFile: ts.SourceFile,
    private readonly module: SourceModule,
  ) {}

  walk(): void {
    ts.forEachChild(this.sourceFile, (node) => this.visit(node));
  }

  private visit(node: ts.Node): void {
    if (ts.isIdentifier(node)) {
      this.reference(node, 'expression');
    } else if (ts.isImportDeclaration(node)) {
      this.importDeclaration(node);
    } else if (ts.isImportEqualsDeclaration(node)) {
      const reference = node.moduleReference;
      if (
        ts.isExternalModuleReference(reference) &&
        ts.isStringLiteral(reference.expression)
      ) {
        this.bind(node.name.text, reference.expression.text, 'namespace');
      }
    } else if (ts.isExportDeclaration(node)) {
      this.exportDeclaration(node);
    } else if (ts.isExportAssignment(node)) {
      if (ts.isIdentifier(node.expression)) {
        this.module.exports.set('default', {
          kind: 'local',
          exported: 'default',
          local: node.expression.text,
        });
      } else {
        this.module.exports.set('default', {
          kind: 'local',
          exported: 'default',
        });
        this.visit(node.expression);
      }
    } else if (ts.isVariableStatement(node)) {
      if (hasModifier(node, ts.SyntaxKind.ExportKeyword)) {
        for (const declaration of node.declarationList.declarations) {
          for (const name of bindingNames(declaration.name)) {
            this.module.exports.set(name, {
              kind: 'local',
              exported: name,
              local: name,
            });
          }
        }
      }
      this.children(node);
    } else if (ts.isVariableDeclaration(node)) {
      if (isTopLevelRequire(node)) {
        this.requireBinding(node);
      } else {
        this.binding(node.name);
        this.children(node, node.name);
      }
    } else if (ts.isParameter(node)) {
      this.binding(node.name);
      this.children(node, node.name);
    } else if (
      ts.isFunctionDeclaration(node) ||
      ts.isClassDeclaration(node) ||
      ts.isInterfaceDeclaration(node) ||
      ts.isTypeAliasDeclaration(node) ||
      ts.isEnumDeclaration(node) ||
      ts.isModuleDeclaration(node)
    ) {
      this.namedDeclaration(node);
    } else if (ts.isFunctionExpression(node) || ts.isClassExpression(node)) {
      if (node.name !== undefined) this.declare(node.name.text);
      this.children(node, node.name);
    } else if (
      ts.isPropertyDeclaration(node) ||
      ts.isMethodDeclaration(node) ||
      ts.isGetAccessorDeclaration(node) ||
      ts.isSetAccessorDeclaration(node)
    ) {
      if (ts.isIdentifier(node.name)) this.declare(node.name.text);
      this.propertyName(node.name);
      this.children(node, node.name);
    } else if (ts.isTypeParameterDeclaration(node)) {
      this.declare(node.name.text);
      this.children(node, node.name);
    } else if (
      ts.isPropertyAssignment(node) ||
      ts.isPropertySignature(node) ||
      ts.isMethodSignature(node) ||
      ts.isEnumMember(node)
    ) {
      this.propertyName(node.name);
      this.children(node, node.name);
    } else if (
      ts.isBinaryExpression(node) &&
      commonJsExportName(node) !== undefined
    ) {
      const name = commonJsExportName(node) as string;
      this.declare(name);
      this.module.exports.set(name, {
        kind: 'local',
        exported: name,
        local: name,
      });
      this.visit(node.right);
    } else if (ts.isShorthandPropertyAssignment(node)) {
      this.reference(node.name, 'shorthand');
      this.children(node, node.name);
    } else if (ts.isBindingElement(node)) {
      this.binding(node.name);
      if (
        node.propertyName !== undefined &&
        ts.isComputedPropertyName(node.propertyName)
      ) {
        this.visit(node.propertyName.expression);
      }
      if (node.initializer !== undefined) this.visit(node.initializer);
    } else if (ts.isPropertyAccessExpression(node)) {
      this.visit(node.expression);
      if (ts.isIdentifier(node.name)) {
        this.reference(
          node.name,
          'member',
          ts.isIdentifier(node.expression) ? node.expression.text : undefined,
        );
      }
    } else if (ts.isQualifiedName(node)) {
      if (ts.isIdentifier(node.left)) {
        this.reference(node.left, 'type');
      } else {
        this.visit(node.left);
      }
      this.reference(
        node.right,
        'member',
        ts.isIdentifier(node.left) ? node.left.text : undefined,
      );
    } else if (ts.isTypeReferenceNode(node)) {
      if (ts.isIdentifier(node.typeName)) {
        this.reference(node.typeName, 'type');
      } else {
        this.visit(node.typeName);
      }
      node.typeArguments?.forEach((argument) => this.visit(argument));
    } else if (ts.isTypeQueryNode(node)) {
      if (ts.isIdentifier(node.exprName)) {
        this.reference(node.exprName, 'type');
      } else {
        this.visit(node.exprName);
      }
      node.typeArguments?.forEach((argument) => this.visit(argument));
    } else if (
      ts.isJsxOpeningElement(node) ||
      ts.isJsxSelfClosingElement(node) ||
      ts.isJsxClosingElement(node)
    ) {
      if (ts.isIdentifier(node.tagName)) {
        this.reference(node.tagName, 'jsx');
      } else {
        this.visit(node.tagName);
      }
      this.children(node, node.tagName);
    } else if (ts.isJsxAttribute(node)) {
      if (node.initializer !== undefined) this.visit(node.initializer);
    } else if (ts.isLabeledStatement(node)) {
      this.visit(node.statement);
    } else if (ts.isBreakOrContinueStatement(node)) {
      // A label is not a reference.
    } else if (ts.isTaggedTemplateExpression(node)) {
      this.visit(node.tag);
      node.typeArguments?.forEach((argument) => this.visit(argument));
      if (isDocumentTag(node.tag)) {
        this.site(node.template, node);
      } else {
        this.visit(node.template);
      }
    } else if (ts.isCallExpression(node)) {
      const [first, ...rest] = node.arguments;
      this.visit(node.expression);
      node.typeArguments?.forEach((argument) => this.visit(argument));
      if (
        first !== undefined &&
        isDocumentTag(node.expression) &&
        isDocumentLiteral(first)
      ) {
        this.site(first, node);
      } else if (first !== undefined) {
        this.visit(first);
      }
      rest.forEach((argument) => this.visit(argument));
    } else if (
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node)
    ) {
      this.words(node.text, this.module.stringWords);
    } else if (ts.isTemplateExpression(node)) {
      this.words(node.head.text, this.module.stringWords);
      for (const span of node.templateSpans) {
        this.visit(span.expression);
        this.words(span.literal.text, this.module.stringWords);
      }
    } else {
      this.children(node);
    }
  }

  /** Visits every child but the one given, which the caller has already dealt with. */
  private children(node: ts.Node, skip?: ts.Node): void {
    ts.forEachChild(node, (child) => {
      if (child !== skip) this.visit(child);
    });
  }

  private declare(name: string): void {
    this.module.declarations.add(name);
    this.module.identifiers.add(name);
  }

  private reference(
    node: ts.Identifier,
    kind: ReferenceKind,
    base?: string,
  ): void {
    const { line, character } = this.sourceFile.getLineAndCharacterOfPosition(
      node.getStart(this.sourceFile),
    );
    const reference: Reference = {
      name: node.text,
      kind,
      line: line + 1,
      column: character + 1,
    };
    if (base !== undefined) reference.base = base;
    this.module.references.push(reference);
    this.module.identifiers.add(node.text);
  }

  private words(text: string, into: Set<string>): void {
    for (const word of identifierWords(text)) into.add(word);
  }

  private bind(
    local: string,
    specifier: string,
    kind: ImportKind,
    imported?: string,
  ): void {
    const binding: ImportBinding = { local, specifier, kind };
    if (imported !== undefined) binding.imported = imported;
    this.module.imports.set(local, binding);
  }

  /** A declared name: an identifier, or every identifier inside a destructuring pattern. */
  private binding(name: ts.BindingName): void {
    if (ts.isIdentifier(name)) {
      this.declare(name.text);
    } else {
      for (const element of name.elements) {
        if (ts.isBindingElement(element)) this.visit(element);
      }
    }
  }

  /** A key is not a reference, unless it is computed, in which case its expression is walked. */
  private propertyName(name: ts.PropertyName): void {
    if (ts.isComputedPropertyName(name)) this.visit(name.expression);
  }

  private namedDeclaration(
    node:
      | ts.FunctionDeclaration
      | ts.ClassDeclaration
      | ts.InterfaceDeclaration
      | ts.TypeAliasDeclaration
      | ts.EnumDeclaration
      | ts.ModuleDeclaration,
  ): void {
    const name =
      node.name !== undefined && ts.isIdentifier(node.name)
        ? node.name.text
        : undefined;
    if (name !== undefined) this.declare(name);
    if (hasModifier(node, ts.SyntaxKind.ExportKeyword)) {
      if (hasModifier(node, ts.SyntaxKind.DefaultKeyword)) {
        const entry: ExportEntry = { kind: 'local', exported: 'default' };
        if (name !== undefined) entry.local = name;
        this.module.exports.set('default', entry);
      } else if (name !== undefined) {
        this.module.exports.set(name, {
          kind: 'local',
          exported: name,
          local: name,
        });
      }
    }
    this.children(node, node.name);
  }

  private importDeclaration(node: ts.ImportDeclaration): void {
    if (
      !ts.isStringLiteral(node.moduleSpecifier) ||
      node.importClause === undefined
    )
      return;
    const specifier = node.moduleSpecifier.text;
    const clause = node.importClause;
    if (clause.name !== undefined)
      this.bind(clause.name.text, specifier, 'default');
    const bindings = clause.namedBindings;
    if (bindings === undefined) return;
    if (ts.isNamespaceImport(bindings)) {
      this.bind(bindings.name.text, specifier, 'namespace');
    } else {
      for (const element of bindings.elements) {
        this.bind(
          element.name.text,
          specifier,
          'named',
          (element.propertyName ?? element.name).text,
        );
      }
    }
  }

  private exportDeclaration(node: ts.ExportDeclaration): void {
    const specifier =
      node.moduleSpecifier !== undefined &&
      ts.isStringLiteral(node.moduleSpecifier)
        ? node.moduleSpecifier.text
        : undefined;
    const clause = node.exportClause;
    if (clause === undefined) {
      if (specifier !== undefined) this.module.starExports.push(specifier);
    } else if (ts.isNamespaceExport(clause)) {
      if (specifier !== undefined) {
        this.module.exports.set(clause.name.text, {
          kind: 'namespace',
          exported: clause.name.text,
          specifier,
        });
      }
    } else {
      for (const element of clause.elements) {
        const exported = element.name.text;
        const local = (element.propertyName ?? element.name).text;
        this.module.exports.set(
          exported,
          specifier === undefined
            ? { kind: 'local', exported, local }
            : { kind: 'reexport', exported, specifier, imported: local },
        );
      }
    }
  }

  /** `const ns = require('./m')` and `const { a: b } = require('./m')` at the top level. */
  private requireBinding(
    node: ts.VariableDeclaration & { initializer: ts.CallExpression },
  ): void {
    const specifier = (node.initializer.arguments[0] as ts.StringLiteral).text;
    if (ts.isIdentifier(node.name)) {
      this.bind(node.name.text, specifier, 'namespace');
    } else if (ts.isObjectBindingPattern(node.name)) {
      for (const element of node.name.elements) {
        if (!ts.isIdentifier(element.name)) continue;
        const imported =
          element.propertyName !== undefined &&
          ts.isIdentifier(element.propertyName)
            ? element.propertyName.text
            : element.name.text;
        this.bind(element.name.text, specifier, 'named', imported);
      }
    }
  }

  /** An inline GraphQL document: its body, where it is, and how it is held. */
  private site(literal: DocumentLiteral, expression: ts.Expression): void {
    const text = this.sourceFile.text;
    const start = literal.getStart(this.sourceFile) + 1;
    const end = literal.getEnd() - 1;
    let body = text.slice(start, end);
    if (ts.isTemplateExpression(literal)) {
      let previousEnd = literal.head.getEnd();
      for (const span of literal.templateSpans) {
        this.visit(span.expression);
        const from = previousEnd - 2 - start;
        const to = span.literal.getStart(this.sourceFile) + 1 - start;
        body =
          body.slice(0, from) +
          body.slice(from, to).replace(/[^\n]/g, ' ') +
          body.slice(to);
        previousEnd = span.literal.getEnd();
      }
    }
    this.words(body, this.module.siteWords);
    const { line, character } =
      this.sourceFile.getLineAndCharacterOfPosition(start);
    let holder: ts.Node = expression;
    while (
      ts.isParenthesizedExpression(holder.parent) ||
      ts.isAsExpression(holder.parent) ||
      ts.isSatisfiesExpression(holder.parent) ||
      ts.isNonNullExpression(holder.parent) ||
      ts.isTypeAssertionExpression(holder.parent)
    ) {
      holder = holder.parent;
    }
    const parent = holder.parent;
    const site: InlineSite = {
      body,
      line: line + 1,
      column: character + 1,
      consumed: false,
      textRange: { start, end },
    };
    if (
      ts.isVariableDeclaration(parent) &&
      ts.isIdentifier(parent.name) &&
      parent.initializer === holder
    ) {
      site.identifier = parent.name.text;
    } else {
      site.consumed = !ts.isExpressionStatement(parent);
    }
    this.module.inlineSites.push(site);
  }
}

/** The name assigned by `exports.X = ...` or `module.exports.X = ...`, a CommonJS export. */
function commonJsExportName(node: ts.BinaryExpression): string | undefined {
  if (node.operatorToken.kind !== ts.SyntaxKind.EqualsToken) return undefined;
  const target = node.left;
  if (!ts.isPropertyAccessExpression(target) || !ts.isIdentifier(target.name))
    return undefined;
  const object = target.expression;
  const isExports =
    (ts.isIdentifier(object) && object.text === 'exports') ||
    (ts.isPropertyAccessExpression(object) &&
      ts.isIdentifier(object.expression) &&
      object.expression.text === 'module' &&
      object.name.text === 'exports');
  return isExports ? target.name.text : undefined;
}

function hasModifier(node: ts.Node, kind: ts.SyntaxKind): boolean {
  return ts.canHaveModifiers(node)
    ? (ts.getModifiers(node) ?? []).some((modifier) => modifier.kind === kind)
    : false;
}

/** Every identifier a binding name introduces, through nested patterns. */
function bindingNames(name: ts.BindingName): string[] {
  if (ts.isIdentifier(name)) return [name.text];
  return name.elements.flatMap((element) =>
    ts.isBindingElement(element) ? bindingNames(element.name) : [],
  );
}
