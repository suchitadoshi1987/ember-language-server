import { Diagnostic, Files } from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { getExtension } from './utils/file-extension';
import { toDiagnostic, toHbsSource } from './utils/diagnostic';
import { getTemplateNodes } from '@lifeart/ember-extract-inline-templates';
import { parseScriptFile } from 'ember-meta-explorer';
import { URI } from 'vscode-uri';
import { log, logError } from './utils/logger';
import * as findUp from 'find-up';
import * as path from 'path';
import * as fs from 'fs';
import { pathToFileURL } from 'url';

export type LinterVerifyArgs = { source: string; moduleId: string; filePath: string };
export interface Linter {
  new (): this;
  verify(_params: LinterVerifyArgs): TemplateLinterError[];
  verifyAndFix(_params: LinterVerifyArgs): {
    output: '';
    isFixed: true;
  };
}
import Server from './server';
import { Project } from './project';

export interface TemplateLinterError {
  fatal?: boolean;
  moduleId: string;
  rule?: string;
  filePath: string;
  severity: number;
  message: string;
  isFixable?: boolean;
  line?: number;
  column?: number;
  source?: string;
}

const extensionsToLint: string[] = ['.hbs', '.js', '.ts'];

function setCwd(cwd: string) {
  try {
    process.chdir(cwd);
  } catch (err) {
    logError(`chdir: ${err.toString()}`);
  }
}

export default class TemplateLinter {
  private _linterCache = new Map<Project, any>();
  private _isEnabled = true;

  constructor(private server: Server) {}

  disable() {
    this._isEnabled = false;
  }

  enable() {
    this._isEnabled = true;
  }

  private getProjectForDocument(textDocument: TextDocument) {
    const ext = getExtension(textDocument);

    if (ext !== null && !extensionsToLint.includes(ext)) {
      return;
    }

    return this.server.projectRoots.projectForUri(textDocument.uri);
  }

  private sourcesForDocument(textDocument: TextDocument) {
    const ext = getExtension(textDocument);

    if (ext !== null && !extensionsToLint.includes(ext)) {
      return [];
    }

    const documentContent = textDocument.getText();

    if (ext === '.hbs') {
      if (documentContent.trim().length === 0) {
        return [];
      } else {
        return [documentContent];
      }
    } else {
      const nodes = getTemplateNodes(documentContent, {
        parse(source: string) {
          return parseScriptFile(source);
        },
      });
      const sources = nodes.filter((el) => {
        return el.template.trim().length > 0;
      });

      return sources.map((el) => {
        return toHbsSource(el);
      });
    }
  }
  async lint(textDocument: TextDocument): Promise<Diagnostic[] | undefined> {
    if (this._isEnabled === false) {
      return;
    }

    const cwd = process.cwd();
    const project = this.getProjectForDocument(textDocument);

    if (!project) {
      return;
    }

    const sources = this.sourcesForDocument(textDocument);

    if (!sources.length) {
      return;
    }

    const TemplateLinter = await this.getLinter(project);

    if (!TemplateLinter) {
      return;
    }

    let linter: Linter;

    try {
      setCwd(project.root);
      linter = new TemplateLinter();
    } catch (e) {
      setCwd(cwd);

      return;
    }

    let diagnostics: Diagnostic[] = [];

    try {
      const results = await Promise.all(
        sources.map(async (source) => {
          const errors = await Promise.resolve(
            linter.verify({
              source,
              moduleId: URI.parse(textDocument.uri).fsPath,
              filePath: URI.parse(textDocument.uri).fsPath,
            })
          );

          return errors.map((error: TemplateLinterError) => toDiagnostic(source, error));
        })
      );

      results.forEach((result) => {
        diagnostics = [...diagnostics, ...result];
      });
    } catch (e) {
      logError(e);
    }

    setCwd(cwd);

    return diagnostics;
  }
  private templateLintConfig(cwd: string): string | undefined {
    return findUp.sync('.template-lintrc.js', { cwd });
  }
  // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
  public async linterForProject(project: Project) {
    return await this.getLinter(project);
  }
  // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
  private async getLinter(project: Project): Promise<Linter | undefined> {
    if (this._linterCache.has(project)) {
      return this._linterCache.get(project);
    }

    try {
      // don't resolve template-lint (due to resolution error) if no linter config found;
      if (!this.templateLintConfig(project.root)) {
        return;
      }

      const nodePath = 'node_modules';

      if (!fs.existsSync(path.join(project.root, nodePath))) {
        return;
      }

      const linterPath = await (Files.resolveModulePath(project.root, 'ember-template-lint', nodePath, () => {
        /* intentially empty default callback */
      }) as Promise<string>);

      if (!linterPath) {
        return;
      }

      try {
        // commonjs behavior

        // @ts-expect-error @todo - fix webpack imports
        const requireFunc = typeof __webpack_require__ === 'function' ? __non_webpack_require__ : require;

        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const linter: Linter = requireFunc(linterPath);

        this._linterCache.set(project, linter);

        return linter;
      } catch {
        // ember-template-lint v4 support (as esm module)
        // using eval here to stop webpack from bundling it
        const linter: Linter = (await eval(`import("${pathToFileURL(linterPath)}")`)).default;

        this._linterCache.set(project, linter);

        return linter;
      }
    } catch (error) {
      log('Module ember-template-lint not found. ' + error.toString());
    }
  }
}
