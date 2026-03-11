/**
 * CodeAnalyzer - AST-based code entity extraction
 *
 * Uses Babel parser for accurate TypeScript/JavaScript code analysis.
 * Supports .ts, .tsx, .js, .jsx files.
 *
 * Dependencies: @babel/core (already in project)
 * The parser is exported from @babel/core or can use @babel/parser directly.
 *
 * @example
 * ```ts
 * const analyzer = new CodeAnalyzer()
 * const entities = analyzer.extractEntities(fileContent, 'example.ts')
 * const imports = analyzer.extractImports(fileContent, 'example.ts')
 * ```
 */

import { parse, type ParserPlugin, type ParserOptions } from "@babel/parser"

const log = {
  debug: (...args: unknown[]) => {}, // Silent in production
  warn: (...args: unknown[]) => console.warn("[CodeAnalyzer]", ...args),
  error: (...args: unknown[]) => console.error("[CodeAnalyzer]", ...args),
}

// ============================================================================
// Types
// ============================================================================

export interface CodeEntity {
  type: "class" | "interface" | "function" | "variable" | "type" | "enum" | "method" | "property"
  name: string
  filePath: string
  lineNumber: number
  columnNumber: number
  endLineNumber: number
  content?: string
  documentation?: string
  signature?: string
  exported: boolean
  async?: boolean
  static?: boolean
  visibility?: "public" | "private" | "protected"
  generics?: string[]
  extends?: string
  implements?: string[]
  decorators?: string[]
  metadata?: Record<string, unknown>
}

export interface ImportInfo {
  source: string
  specifiers: Array<{
    type: "default" | "namespace" | "named"
    name: string
    alias?: string
  }>
  lineNumber: number
}

export interface ExportInfo {
  type: "named" | "default" | "named_default"
  name?: string
  lineNumber: number
}

export interface DependencyRelation {
  sourceFile: string
  targetFile: string
  type: "imports" | "exports" | "dynamic_import"
  lineNumber: number
}

export interface MethodCallInfo {
  callerFile: string
  callerFunction?: string
  calleeName: string
  calleeObject?: string
  lineNumber: number
}

export interface AnalysisResult {
  entities: CodeEntity[]
  imports: ImportInfo[]
  exports: ExportInfo[]
  dependencies: DependencyRelation[]
  methodCalls: MethodCallInfo[]
}

// AST Node type helpers (minimal subset of @babel/types)
type ASTNode = any // eslint-disable-line @typescript-eslint/no-explicit-any
type ASTFile = any // eslint-disable-line @typescript-eslint/no-explicit-any - Return type of parse()

// ============================================================================
// AST Type Guards
// ============================================================================

function isNode(node: unknown): node is ASTNode {
  return typeof node === "object" && node !== null && "type" in node
}

function isIdentifier(node: ASTNode): node is { type: "Identifier"; name: string; loc?: SourceLocation } {
  return node?.type === "Identifier"
}

function isStringLiteral(node: ASTNode): node is { type: "StringLiteral"; value: string; loc?: SourceLocation } {
  return node?.type === "StringLiteral"
}

function isClassDeclaration(node: ASTNode): node is ClassDeclarationNode {
  return node?.type === "ClassDeclaration"
}

function isFunctionDeclaration(node: ASTNode): node is FunctionDeclarationNode {
  return node?.type === "FunctionDeclaration"
}

function isTSInterfaceDeclaration(node: ASTNode): node is TSInterfaceDeclarationNode {
  return node?.type === "TSInterfaceDeclaration"
}

function isTSTypeAliasDeclaration(node: ASTNode): node is TSTypeAliasDeclarationNode {
  return node?.type === "TSTypeAliasDeclaration"
}

function isTSEnumDeclaration(node: ASTNode): node is TSEnumDeclarationNode {
  return node?.type === "TSEnumDeclaration"
}

function isVariableDeclaration(node: ASTNode): node is VariableDeclarationNode {
  return node?.type === "VariableDeclaration"
}

function isImportDeclaration(node: ASTNode): node is ImportDeclarationNode {
  return node?.type === "ImportDeclaration"
}

function isExportNamedDeclaration(node: ASTNode): node is ExportNamedDeclarationNode {
  return node?.type === "ExportNamedDeclaration"
}

function isExportDefaultDeclaration(node: ASTNode): node is ExportDefaultDeclarationNode {
  return node?.type === "ExportDefaultDeclaration"
}

function isClassMethod(node: ASTNode): node is ClassMethodNode {
  return node?.type === "ClassMethod"
}

function isClassProperty(node: ASTNode): node is ClassPropertyNode {
  return node?.type === "ClassProperty"
}

function isCallExpression(node: ASTNode): node is CallExpressionNode {
  return node?.type === "CallExpression"
}

function isMemberExpression(node: ASTNode): node is MemberExpressionNode {
  return node?.type === "MemberExpression"
}

function isTSPropertySignature(node: ASTNode): node is TSPropertySignatureNode {
  return node?.type === "TSPropertySignature"
}

// ============================================================================
// AST Node Types
// ============================================================================

interface SourceLocation {
  start: { line: number; column: number }
  end: { line: number; column: number }
}

interface ClassDeclarationNode {
  type: "ClassDeclaration"
  id?: { name: string; loc?: SourceLocation }
  superClass?: ASTNode
  implements?: Array<{ expression: ASTNode }>
  decorators?: Array<{ expression: ASTNode }>
  typeParameters?: { params: ASTNode[] }
  body?: { body: ASTNode[] }
  loc?: SourceLocation
}

interface FunctionDeclarationNode {
  type: "FunctionDeclaration"
  id?: { name: string; loc?: SourceLocation }
  params: ASTNode[]
  async?: boolean
  typeParameters?: { params: ASTNode[] }
  loc?: SourceLocation
}

interface TSInterfaceDeclarationNode {
  type: "TSInterfaceDeclaration"
  id: { name: string; loc?: SourceLocation }
  extends?: ASTNode[]
  typeParameters?: { params: ASTNode[] }
  body?: { body: ASTNode[] }
  loc?: SourceLocation
}

interface TSTypeAliasDeclarationNode {
  type: "TSTypeAliasDeclaration"
  id: { name: string; loc?: SourceLocation }
  typeParameters?: { params: ASTNode[] }
  loc?: SourceLocation
}

interface TSEnumDeclarationNode {
  type: "TSEnumDeclaration"
  id: { name: string; loc?: SourceLocation }
  members?: ASTNode[]
  loc?: SourceLocation
}

interface VariableDeclarationNode {
  type: "VariableDeclaration"
  kind: "var" | "let" | "const"
  declarations: Array<{
    id: ASTNode
    init?: ASTNode
  }>
  loc?: SourceLocation
}

interface ImportDeclarationNode {
  type: "ImportDeclaration"
  source: { value: string }
  specifiers: ASTNode[]
  loc?: SourceLocation
}

interface ExportNamedDeclarationNode {
  type: "ExportNamedDeclaration"
  declaration?: ASTNode
  specifiers: ASTNode[]
  loc?: SourceLocation
}

interface ExportDefaultDeclarationNode {
  type: "ExportDefaultDeclaration"
  declaration: ASTNode
  loc?: SourceLocation
}

interface ClassMethodNode {
  type: "ClassMethod"
  kind: "method" | "get" | "set" | "constructor"
  key?: ASTNode
  async?: boolean
  static?: boolean
  accessibility?: "public" | "private" | "protected"
  params: ASTNode[]
  loc?: SourceLocation
}

interface ClassPropertyNode {
  type: "ClassProperty"
  key?: ASTNode
  static?: boolean
  accessibility?: "public" | "private" | "protected"
  loc?: SourceLocation
}

interface CallExpressionNode {
  type: "CallExpression"
  callee: ASTNode
  arguments: ASTNode[]
  loc?: SourceLocation
}

interface MemberExpressionNode {
  type: "MemberExpression"
  object: ASTNode
  property: ASTNode
}

interface TSPropertySignatureNode {
  type: "TSPropertySignature"
  key: ASTNode
  optional?: boolean
}

// ============================================================================
// CodeAnalyzer Class
// ============================================================================

export class CodeAnalyzer {
  /**
   * Get parser plugins based on file extension
   */
  private getParserPlugins(filePath: string): ParserPlugin[] {
    const plugins: ParserPlugin[] = ["jsx"]

    if (filePath.endsWith(".ts") || filePath.endsWith(".tsx")) {
      plugins.push("typescript")
    }

    // Add common TypeScript/JavaScript features
    plugins.push(
      "classProperties",
      "classPrivateProperties",
      "classPrivateMethods",
      "objectRestSpread",
      "dynamicImport",
      "decorators-legacy",
      "exportDefaultFrom",
      "exportNamespaceFrom",
      "optionalChaining",
      "nullishCoalescingOperator",
    )

    return plugins
  }

  /**
   * Get parser options
   */
  private getParserOptions(filePath: string): ParserOptions {
    return {
      sourceType: "module",
      plugins: this.getParserPlugins(filePath),
      ranges: true,
      tokens: false,
      errorRecovery: true,
    }
  }

  /**
   * Parse file content and return AST
   */
  parse(content: string, filePath: string): ASTFile | null {
    try {
      const ast = parse(content, this.getParserOptions(filePath))
      return ast
    } catch (error) {
      log.warn(`Failed to parse ${filePath}:`, error instanceof Error ? error.message : error)
      return null
    }
  }

  /**
   * Extract documentation comment from node
   */
  private extractDocumentation(node: ASTNode, content: string, comments?: ASTNode[]): string | undefined {
    if (!node.loc) return undefined

    const line = node.loc.start.line
    const lines = content.split("\n")

    // Look for JSDoc-style comments above the node
    let docStart = line - 2
    while (docStart >= 0) {
      const lineContent = lines[docStart].trim()
      if (lineContent === "" || lineContent.startsWith("//")) {
        docStart--
        continue
      }
      if (lineContent.endsWith("*/")) {
        // Found end of JSDoc comment, find start
        let startLine = docStart
        while (startLine >= 0 && !lines[startLine].includes("/**")) {
          startLine--
        }
        if (startLine >= 0) {
          const docLines = lines.slice(startLine, docStart + 1)
          // Clean up JSDoc format
          return docLines
            .map((l) =>
              l
                .trim()
                .replace(/^\s*\*\s*/, "")
                .replace(/^\/\*\*|\*\/$/g, ""),
            )
            .filter((l) => l)
            .join("\n")
            .trim()
        }
      }
      break
    }

    // Check for inline comment on same line
    const nodeLine = lines[line - 1]
    const commentMatch = nodeLine.match(/\/\/\s*(.+)$/)
    if (commentMatch) {
      return commentMatch[1].trim()
    }

    return undefined
  }

  /**
   * Extract class entity from class declaration
   */
  private extractClassEntity(
    node: ClassDeclarationNode,
    filePath: string,
    content: string,
  ): CodeEntity | null {
    if (!node.id) return null

    const entity: CodeEntity = {
      type: "class",
      name: node.id.name,
      filePath,
      lineNumber: node.loc?.start.line ?? 0,
      columnNumber: node.loc?.start.column ?? 0,
      endLineNumber: node.loc?.end.line ?? 0,
      exported: false, // Will be set by caller
      documentation: this.extractDocumentation(node, content),
    }

    // Extract extends
    if (node.superClass && isIdentifier(node.superClass)) {
      entity.extends = node.superClass.name
    }

    // Extract implements
    if (node.implements && node.implements.length > 0) {
      entity.implements = node.implements
        .map((impl) => {
          if (isIdentifier(impl.expression)) {
            return impl.expression.name
          }
          return undefined
        })
        .filter((name): name is string => name !== undefined)
    }

    // Extract decorators
    if (node.decorators && node.decorators.length > 0) {
      entity.decorators = node.decorators.map((d) => {
        if (isIdentifier(d.expression)) {
          return d.expression.name
        }
        if (isCallExpression(d.expression) && isIdentifier(d.expression.callee)) {
          return d.expression.callee.name
        }
        return "unknown"
      })
    }

    // Extract generics
    if (node.typeParameters && node.typeParameters.params) {
      entity.generics = node.typeParameters.params.map((p) => (isIdentifier(p) ? p.name : String(p.name)))
    }

    return entity
  }

  /**
   * Extract function entity from function declaration
   */
  private extractFunctionEntity(
    node: FunctionDeclarationNode,
    filePath: string,
    content: string,
  ): CodeEntity | null {
    if (!node.id) return null

    const entity: CodeEntity = {
      type: "function",
      name: node.id.name,
      filePath,
      lineNumber: node.loc?.start.line ?? 0,
      columnNumber: node.loc?.start.column ?? 0,
      endLineNumber: node.loc?.end.line ?? 0,
      exported: false, // Will be set by caller
      async: node.async ?? false,
      documentation: this.extractDocumentation(node, content),
    }

    // Extract generics
    if (node.typeParameters && node.typeParameters.params) {
      entity.generics = node.typeParameters.params.map((p) => (isIdentifier(p) ? p.name : String(p.name)))
    }

    // Build signature
    const params = node.params.map((p) => {
      if (isIdentifier(p)) return p.name
      return "..."
    })
    entity.signature = `${node.async ? "async " : ""}function ${node.id.name}(${params.join(", ")})`

    return entity
  }

  /**
   * Extract interface entity from interface declaration
   */
  private extractInterfaceEntity(
    node: TSInterfaceDeclarationNode,
    filePath: string,
    content: string,
  ): CodeEntity {
    const entity: CodeEntity = {
      type: "interface",
      name: node.id.name,
      filePath,
      lineNumber: node.loc?.start.line ?? 0,
      columnNumber: node.loc?.start.column ?? 0,
      endLineNumber: node.loc?.end.line ?? 0,
      exported: false, // Will be set by caller
      documentation: this.extractDocumentation(node, content),
    }

    // Extract extends
    if (node.extends && node.extends.length > 0) {
      entity.extends = node.extends
        .map((ext) => {
          if (isIdentifier(ext)) {
            return ext.name
          }
          return undefined
        })
        .filter((name): name is string => name !== undefined)[0]
    }

    // Extract generics
    if (node.typeParameters && node.typeParameters.params) {
      entity.generics = node.typeParameters.params.map((p) => (isIdentifier(p) ? p.name : String(p.name)))
    }

    // Extract properties
    if (node.body && node.body.body) {
      const props = node.body.body.filter(isTSPropertySignature)
      entity.metadata = {
        properties: props
          .filter((p) => isIdentifier(p.key))
          .map((p) => ({
            name: (p.key as { name: string }).name,
            optional: p.optional,
          })),
      }
    }

    return entity
  }

  /**
   * Extract type alias entity
   */
  private extractTypeEntity(
    node: TSTypeAliasDeclarationNode,
    filePath: string,
    content: string,
  ): CodeEntity {
    const entity: CodeEntity = {
      type: "type",
      name: node.id.name,
      filePath,
      lineNumber: node.loc?.start.line ?? 0,
      columnNumber: node.loc?.start.column ?? 0,
      endLineNumber: node.loc?.end.line ?? 0,
      exported: false, // Will be set by caller
      documentation: this.extractDocumentation(node, content),
    }

    // Extract generics
    if (node.typeParameters && node.typeParameters.params) {
      entity.generics = node.typeParameters.params.map((p) => (isIdentifier(p) ? p.name : String(p.name)))
    }

    return entity
  }

  /**
   * Extract enum entity
   */
  private extractEnumEntity(
    node: TSEnumDeclarationNode,
    filePath: string,
    content: string,
  ): CodeEntity {
    const entity: CodeEntity = {
      type: "enum",
      name: node.id.name,
      filePath,
      lineNumber: node.loc?.start.line ?? 0,
      columnNumber: node.loc?.start.column ?? 0,
      endLineNumber: node.loc?.end.line ?? 0,
      exported: false, // Will be set by caller
      documentation: this.extractDocumentation(node, content),
    }

    // Extract members
    if (node.members && node.members.length > 0) {
      entity.metadata = {
        members: node.members
          .filter((m) => isIdentifier(m.id))
          .map((m) => ({
            name: (m.id as { name: string }).name,
          })),
      }
    }

    return entity
  }

  /**
   * Extract variable entities from variable declaration
   */
  private extractVariableEntities(
    node: VariableDeclarationNode,
    filePath: string,
    content: string,
  ): CodeEntity[] {
    const entities: CodeEntity[] = []

    for (const decl of node.declarations) {
      if (!isIdentifier(decl.id)) continue

      const entity: CodeEntity = {
        type: "variable",
        name: decl.id.name,
        filePath,
        lineNumber: node.loc?.start.line ?? 0,
        columnNumber: node.loc?.start.column ?? 0,
        endLineNumber: node.loc?.end.line ?? 0,
        exported: false, // Will be set by caller
        documentation: this.extractDocumentation(node, content),
      }

      // Detect const arrow functions
      if (decl.init && isCallExpression(decl.init)) {
        if (isIdentifier(decl.init.callee)) {
          entity.metadata = { isFunctionCall: true, callee: decl.init.callee.name }
        }
      }

      entities.push(entity)
    }

    return entities
  }

  /**
   * Extract import information
   */
  private extractImportInfo(node: ImportDeclarationNode): ImportInfo {
    const source = node.source.value

    const info: ImportInfo = {
      source,
      specifiers: [],
      lineNumber: node.loc?.start.line ?? 0,
    }

    for (const spec of node.specifiers) {
      switch (spec.type) {
        case "ImportDefaultSpecifier":
          info.specifiers.push({
            type: "default",
            name: spec.local.name,
          })
          break
        case "ImportNamespaceSpecifier":
          info.specifiers.push({
            type: "namespace",
            name: spec.local.name,
          })
          break
        case "ImportSpecifier":
          const importedName =
            typeof spec.imported === "string"
              ? spec.imported
              : spec.imported.type === "Identifier"
                ? spec.imported.name
                : spec.imported.value
          info.specifiers.push({
            type: "named",
            name: importedName,
            alias: spec.local.name !== importedName ? spec.local.name : undefined,
          })
          break
      }
    }

    return info
  }

  /**
   * Walk AST and call visitor for each node
   */
  private walkAST(node: ASTNode, visitor: (node: ASTNode, parent?: ASTNode) => void, parent?: ASTNode): void {
    if (!isNode(node)) return

    visitor(node, parent)

    // Walk children
    for (const key of Object.keys(node)) {
      if (key === "loc" || key === "start" || key === "end" || key === "range") continue

      const child = node[key]
      if (Array.isArray(child)) {
        for (const item of child) {
          if (isNode(item)) {
            this.walkAST(item, visitor, node)
          }
        }
      } else if (isNode(child)) {
        this.walkAST(child, visitor, node)
      }
    }
  }

  /**
   * Extract all code entities from file content
   */
  extractEntities(content: string, filePath: string): CodeEntity[] {
    const ast = this.parse(content, filePath)
    if (!ast) return []

    const entities: CodeEntity[] = []
    const exportedNames = new Set<string>()
    const program = ast.program

    // First pass: collect exported names
    for (const stmt of program.body) {
      if (isExportNamedDeclaration(stmt)) {
        if (stmt.declaration) {
          if (isIdentifier(stmt.declaration)) {
            exportedNames.add(stmt.declaration.name)
          } else if (isVariableDeclaration(stmt.declaration)) {
            for (const decl of stmt.declaration.declarations) {
              if (isIdentifier(decl.id)) {
                exportedNames.add(decl.id.name)
              }
            }
          } else if ("id" in stmt.declaration && stmt.declaration.id && isIdentifier(stmt.declaration.id)) {
            exportedNames.add(stmt.declaration.id.name)
          }
        }
        // Handle export { x, y }
        for (const spec of stmt.specifiers) {
          if (spec.exported) {
            exportedNames.add(
              typeof spec.exported === "string"
                ? spec.exported
                : spec.exported.type === "Identifier"
                  ? spec.exported.name
                  : spec.exported.value,
            )
          }
        }
      } else if (isExportDefaultDeclaration(stmt)) {
        if (isIdentifier(stmt.declaration)) {
          exportedNames.add(stmt.declaration.name)
        } else if ("id" in stmt.declaration && stmt.declaration.id && isIdentifier(stmt.declaration.id)) {
          exportedNames.add(stmt.declaration.id.name)
        }
      }
    }

    // Track class context for methods/properties
    let currentClass: string | undefined

    // Second pass: extract entities
    for (const stmt of program.body) {
      // Handle export wrappers
      let node = stmt
      let isExported = false

      if (isExportNamedDeclaration(stmt)) {
        isExported = true
        node = stmt.declaration
        if (!node) continue
      } else if (isExportDefaultDeclaration(stmt)) {
        isExported = true
        node = stmt.declaration
      }

      if (isClassDeclaration(node)) {
        const entity = this.extractClassEntity(node, filePath, content)
        if (entity) {
          entity.exported = isExported || exportedNames.has(entity.name)
          entities.push(entity)
          currentClass = entity.name

          // Extract class methods and properties
          if (node.body && node.body.body) {
            for (const member of node.body.body) {
              if (isClassMethod(member) && member.key && isIdentifier(member.key)) {
                entities.push({
                  type: "method",
                  name: `${entity.name}.${member.key.name}`,
                  filePath,
                  lineNumber: member.loc?.start.line ?? 0,
                  columnNumber: member.loc?.start.column ?? 0,
                  endLineNumber: member.loc?.end.line ?? 0,
                  exported: false,
                  async: member.async,
                  static: member.static,
                  visibility: member.accessibility,
                  documentation: this.extractDocumentation(member, content),
                  metadata: member.kind !== "method" ? { accessor: member.kind } : undefined,
                })
              } else if (isClassProperty(member) && member.key && isIdentifier(member.key)) {
                entities.push({
                  type: "property",
                  name: `${entity.name}.${member.key.name}`,
                  filePath,
                  lineNumber: member.loc?.start.line ?? 0,
                  columnNumber: member.loc?.start.column ?? 0,
                  endLineNumber: member.loc?.end.line ?? 0,
                  exported: false,
                  static: member.static,
                  visibility: member.accessibility,
                  documentation: this.extractDocumentation(member, content),
                })
              }
            }
          }

          currentClass = undefined
        }
      } else if (isFunctionDeclaration(node)) {
        const entity = this.extractFunctionEntity(node, filePath, content)
        if (entity) {
          entity.exported = isExported || exportedNames.has(entity.name)
          entities.push(entity)
        }
      } else if (isTSInterfaceDeclaration(node)) {
        const entity = this.extractInterfaceEntity(node, filePath, content)
        entity.exported = isExported || exportedNames.has(entity.name)
        entities.push(entity)
      } else if (isTSTypeAliasDeclaration(node)) {
        const entity = this.extractTypeEntity(node, filePath, content)
        entity.exported = isExported || exportedNames.has(entity.name)
        entities.push(entity)
      } else if (isTSEnumDeclaration(node)) {
        const entity = this.extractEnumEntity(node, filePath, content)
        entity.exported = isExported || exportedNames.has(entity.name)
        entities.push(entity)
      } else if (isVariableDeclaration(node)) {
        const vars = this.extractVariableEntities(node, filePath, content)
        for (const v of vars) {
          v.exported = isExported || exportedNames.has(v.name)
          entities.push(v)
        }
      }
    }

    return entities
  }

  /**
   * Extract imports from file content
   */
  extractImports(content: string, filePath: string): ImportInfo[] {
    const ast = this.parse(content, filePath)
    if (!ast) return []

    const imports: ImportInfo[] = []
    const program = ast.program

    for (const stmt of program.body) {
      if (isImportDeclaration(stmt)) {
        imports.push(this.extractImportInfo(stmt))
      }
    }

    // Also extract dynamic imports
    this.walkAST(program, (node) => {
      if (isCallExpression(node) && isIdentifier(node.callee) && node.callee.name === "import") {
        const arg = node.arguments[0]
        if (arg && isStringLiteral(arg)) {
          imports.push({
            source: arg.value,
            specifiers: [{ type: "namespace", name: "*dynamic*" }],
            lineNumber: node.loc?.start.line ?? 0,
          })
        }
      }
    })

    return imports
  }

  /**
   * Build dependency relations between files
   */
  buildDependencies(
    filePath: string,
    imports: ImportInfo[],
    resolvedPaths: Map<string, string>,
  ): DependencyRelation[] {
    const dependencies: DependencyRelation[] = []

    for (const imp of imports) {
      const source = imp.source

      // Skip node_modules (bare imports)
      if (!source.startsWith(".") && !source.startsWith("/")) {
        continue
      }

      // Try to resolve the path
      let targetFile = resolvedPaths.get(source)
      if (!targetFile) {
        // Try common extensions
        const extensions = [".ts", ".tsx", ".js", ".jsx", "/index.ts", "/index.tsx", "/index.js", "/index.jsx"]
        for (const ext of extensions) {
          targetFile = resolvedPaths.get(source + ext)
          if (targetFile) break
        }
      }

      if (targetFile) {
        dependencies.push({
          sourceFile: filePath,
          targetFile,
          type: source.includes("import(") ? "dynamic_import" : "imports",
          lineNumber: imp.lineNumber,
        })
      }
    }

    return dependencies
  }

  /**
   * Extract method calls from file content
   */
  extractMethodCalls(content: string, filePath: string): MethodCallInfo[] {
    const ast = this.parse(content, filePath)
    if (!ast) return []

    const calls: MethodCallInfo[] = []
    let currentFunction: string | undefined

    this.walkAST(ast.program, (node, parent) => {
      // Track current function context
      if (isFunctionDeclaration(node) && node.id) {
        currentFunction = node.id.name
      } else if (isClassMethod(node) && node.key && isIdentifier(node.key)) {
        // Find parent class
        // Note: In our simplified walker, we'd need additional context tracking
        // For now, just use method name
        currentFunction = node.key.name
      }

      // Extract method calls
      if (isCallExpression(node)) {
        const callee = node.callee

        // Method call: obj.method()
        if (isMemberExpression(callee)) {
          if (isIdentifier(callee.object) && isIdentifier(callee.property)) {
            calls.push({
              callerFile: filePath,
              callerFunction: currentFunction,
              calleeObject: callee.object.name,
              calleeName: callee.property.name,
              lineNumber: node.loc?.start.line ?? 0,
            })
          }
        }
        // Function call: func()
        else if (isIdentifier(callee) && callee.name !== "import") {
          calls.push({
            callerFile: filePath,
            callerFunction: currentFunction,
            calleeName: callee.name,
            lineNumber: node.loc?.start.line ?? 0,
          })
        }
      }
    })

    return calls
  }

  /**
   * Full analysis of a file
   */
  analyze(content: string, filePath: string, resolvedPaths?: Map<string, string>): AnalysisResult {
    const entities = this.extractEntities(content, filePath)
    const imports = this.extractImports(content, filePath)
    const methodCalls = this.extractMethodCalls(content, filePath)

    let dependencies: DependencyRelation[] = []
    if (resolvedPaths) {
      dependencies = this.buildDependencies(filePath, imports, resolvedPaths)
    }

    // Extract exports
    const exports: ExportInfo[] = []
    const ast = this.parse(content, filePath)
    if (ast) {
      for (const stmt of ast.program.body) {
        if (isExportNamedDeclaration(stmt)) {
          if (stmt.declaration && "id" in stmt.declaration && stmt.declaration.id && isIdentifier(stmt.declaration.id)) {
            exports.push({
              type: "named",
              name: stmt.declaration.id.name,
              lineNumber: stmt.loc?.start.line ?? 0,
            })
          }
          for (const spec of stmt.specifiers) {
            exports.push({
              type: "named",
              name:
                typeof spec.exported === "string"
                  ? spec.exported
                  : spec.exported.type === "Identifier"
                    ? spec.exported.name
                    : spec.exported.value,
              lineNumber: stmt.loc?.start.line ?? 0,
            })
          }
        } else if (isExportDefaultDeclaration(stmt)) {
          exports.push({
            type: "default",
            name: isIdentifier(stmt.declaration) ? stmt.declaration.name : undefined,
            lineNumber: stmt.loc?.start.line ?? 0,
          })
        }
      }
    }

    return {
      entities,
      imports,
      exports,
      dependencies,
      methodCalls,
    }
  }
}

// Export singleton instance for convenience
export const codeAnalyzer = new CodeAnalyzer()