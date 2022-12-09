import * as path from 'path';
import * as t from '@babel/types';
import { Definition, Location } from 'vscode-languageserver/node';
import { DefinitionFunctionParams } from './../../utils/addon-api';
import { importPathsToLocations, pathsToLocations, getAddonPathsForType, getAddonImport } from '../../utils/definition-helpers';
import {
  isRouteLookup,
  isTransformReference,
  isModelReference,
  isImportPathDeclaration,
  isServiceInjection,
  isNamedServiceInjection,
  isTemplateElement,
  isImportSpecifier,
  isImportDefaultSpecifier,
} from './../../utils/ast-helpers';
import { normalizeServiceName } from '../../utils/normalizers';
import { isModuleUnificationApp, podModulePrefixForRoot } from './../../utils/layout-helpers';
import { provideRouteDefinition } from './template-definition-provider';
import { logInfo } from '../../utils/logger';
import { Project } from '../../project';

type ItemType = 'Model' | 'Transform' | 'Service';

// barking on 'LayoutCollectorFn' is defined but never used  @typescript-eslint/no-unused-vars
// eslint-disable-line
type LayoutCollectorFn = (root: string, itemName: string, podModulePrefix?: string) => string[];

function joinPaths(...args: string[]) {
  return ['.ts', '.js'].map((extName: string) => {
    const localArgs = args.slice(0);
    const lastArg = localArgs.pop() + extName;

    return path.join.apply(path, [...localArgs, lastArg]);
  });
}

class PathResolvers {
  [key: string]: LayoutCollectorFn;
  muModelPaths(root: string, modelName: string) {
    return joinPaths(root, 'src', 'data', 'models', modelName, 'model');
  }
  muTransformPaths(root: string, transformName: string) {
    return joinPaths(root, 'src', 'data', 'transforms', transformName);
  }
  muServicePaths(root: string, transformName: string) {
    return joinPaths(root, 'src', 'services', transformName);
  }
  classicModelPaths(root: string, modelName: string) {
    return joinPaths(root, 'app', 'models', modelName);
  }
  classicTransformPaths(root: string, transformName: string) {
    return joinPaths(root, 'app', 'transforms', transformName);
  }
  classicServicePaths(root: string, modelName: string) {
    return joinPaths(root, 'app', 'services', modelName);
  }
  podTransformPaths(root: string, transformName: string, podPrefix: string) {
    return joinPaths(root, 'app', podPrefix, transformName, 'transform');
  }
  podModelPaths(root: string, modelName: string, podPrefix: string) {
    return joinPaths(root, 'app', podPrefix, modelName, 'model');
  }
  podServicePaths(root: string, modelName: string, podPrefix: string) {
    return joinPaths(root, 'app', podPrefix, modelName, 'service');
  }
  addonServicePaths(root: string, serviceName: string) {
    return getAddonPathsForType(root, 'services', serviceName);
  }
  addonImportPaths(root: string, pathName: string) {
    return getAddonImport(root, pathName);
  }
  classicImportPaths(root: string, pathName: string) {
    const pathParts = pathName.split('/');

    pathParts.shift();
    const appParams = [root, 'app', ...pathParts];

    return joinPaths(...appParams);
  }

  resolveTestScopeImport(root: string, pathName: string) {
    return joinPaths(path.join(root, pathName));
  }

  muImportPaths(root: string, pathName: string) {
    const pathParts = pathName.split('/');

    pathParts.shift();
    const params = [root, ...pathParts];

    return joinPaths(...params);
  }
}

export default class CoreScriptDefinitionProvider {
  private resolvers!: PathResolvers;
  constructor() {
    this.resolvers = new PathResolvers();
  }
  guessPathForImport(root: string, uri: string, importPath: string, importSpecifierName?: string) {
    if (!uri) {
      return null;
    }

    const guessedPaths: string[] = [];
    const fnName = 'Import';

    if (isModuleUnificationApp(root)) {
      this.resolvers[`mu${fnName}Paths`](root, importPath).forEach((pathLocation: string) => {
        guessedPaths.push(pathLocation);
      });
    } else {
      this.resolvers[`classic${fnName}Paths`](root, importPath).forEach((pathLocation: string) => {
        guessedPaths.push(pathLocation);
      });
    }

    this.resolvers.addonImportPaths(root, importPath).forEach((pathLocation: string) => {
      guessedPaths.push(pathLocation);
    });

    return importPathsToLocations(guessedPaths, importSpecifierName);
  }
  guessPathsForType(root: string, fnName: ItemType, typeName: string) {
    const guessedPaths: string[] = [];

    if (isModuleUnificationApp(root)) {
      this.resolvers[`mu${fnName}Paths`](root, typeName).forEach((pathLocation: string) => {
        guessedPaths.push(pathLocation);
      });
    } else {
      this.resolvers[`classic${fnName}Paths`](root, typeName).forEach((pathLocation: string) => {
        guessedPaths.push(pathLocation);
      });
      const podPrefix = podModulePrefixForRoot(root);

      if (podPrefix) {
        this.resolvers[`pod${fnName}Paths`](root, typeName, podPrefix).forEach((pathLocation: string) => {
          guessedPaths.push(pathLocation);
        });
      }
    }

    if (fnName === 'Service') {
      this.resolvers.addonServicePaths(root, typeName).forEach((item: string) => {
        guessedPaths.push(item);
      });
    }

    return pathsToLocations(...guessedPaths);
  }

  getImportSpecifierName(importDeclaration: t.ImportDeclaration, position: any) {
    const importNameData = importDeclaration.specifiers.find((item) => {
      const importLine = item.loc?.start.line;
      const importStartCol = item.loc?.start.column;
      const importStartEnd = item.loc?.end.column;

      return (
        importStartCol && importStartEnd && position.line + 1 === importLine && importStartCol <= position.character && importStartEnd >= position.character
      );
    }) as t.ImportSpecifier;

    return importNameData && importNameData.type === 'ImportSpecifier' ? (importNameData.imported as t.Identifier).name : '';
  }

  getPotentialImportPaths(pathName: string, project: Project, uri: string, importSpecifierName?: string) {
    const pathParts = pathName.split('/');
    let maybeAppName = pathParts.shift();

    if (maybeAppName && maybeAppName.startsWith('@')) {
      maybeAppName = maybeAppName + '/' + pathParts.shift();
    }

    let potentialPaths: Location[];
    const addonInfo = project.addonsMeta.find(({ name }) => pathName.startsWith(name + '/tests'));

    // If the start of the pathname is same as the project name, then use that as the root.
    if (project.name === maybeAppName && pathName.startsWith(project.name + '/tests')) {
      const importPaths = this.resolvers.resolveTestScopeImport(project.root, pathParts.join(path.sep));

      potentialPaths = importPathsToLocations(importPaths, importSpecifierName);
    } else if (addonInfo) {
      const importPaths = this.resolvers.resolveTestScopeImport(addonInfo.root, pathName);

      potentialPaths = importPathsToLocations(importPaths, importSpecifierName);
    } else {
      potentialPaths = this.guessPathForImport(project.root, uri, pathName, importSpecifierName) || [];
    }

    return potentialPaths;
  }
  async onDefinition(root: string, params: DefinitionFunctionParams): Promise<Definition | null> {
    const { textDocument, focusPath, type, results, server, position } = params;

    if (type !== 'script') {
      return results;
    }

    const uri = textDocument.uri;
    let definitions: Location[] = results;
    const astPath = focusPath;

    const project = server.projectRoots.projectForUri(uri);

    if (!project) {
      return results;
    }

    if (isTemplateElement(astPath)) {
      const templateResults = await server.definitionProvider.template.handle(
        {
          textDocument,
          position,
        },
        project
      );

      if (Array.isArray(templateResults)) {
        definitions = templateResults;
      }
    } else if (isModelReference(astPath)) {
      const modelName = (astPath.node as unknown as t.StringLiteral).value;

      definitions = this.guessPathsForType(root, 'Model', modelName);
    } else if (isTransformReference(astPath)) {
      const transformName = (astPath.node as unknown as t.StringLiteral).value;

      definitions = this.guessPathsForType(root, 'Transform', transformName);
    } else if (isImportPathDeclaration(astPath)) {
      const pathName = (astPath.node as unknown as t.StringLiteral).value;

      definitions = definitions.concat(this.getPotentialImportPaths(pathName, project, uri));
    } else if (isImportSpecifier(astPath) || isImportDefaultSpecifier(astPath)) {
      logInfo(`Handle script import for Project "${project.name}"`);
      const importDeclaration: t.ImportDeclaration = astPath.parentFromLevel(2);
      const pathName: string = (astPath.parentFromLevel(2) as unknown as t.ImportDeclaration).source.value;
      let importSpecifierName = '';

      if (isImportSpecifier(astPath)) {
        importSpecifierName = this.getImportSpecifierName(importDeclaration, position);
      }

      definitions = definitions.concat(this.getPotentialImportPaths(pathName, project, uri, importSpecifierName));
    } else if (isServiceInjection(astPath)) {
      let serviceName = (astPath.node as unknown as t.Identifier).name;
      const args = astPath.parent.value.arguments;

      if (args.length && args[0].type === 'StringLiteral') {
        serviceName = args[0].value;
      }

      definitions = this.guessPathsForType(root, 'Service', normalizeServiceName(serviceName));
    } else if (isNamedServiceInjection(astPath)) {
      const serviceName = (astPath.node as unknown as t.StringLiteral).value;

      definitions = this.guessPathsForType(root, 'Service', normalizeServiceName(serviceName));
    } else if (isRouteLookup(astPath)) {
      const routePath = (astPath.node as unknown as t.StringLiteral).value;

      definitions = provideRouteDefinition(root, routePath);
    }

    return definitions || [];
  }
}
