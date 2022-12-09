import * as cp from 'child_process';
import * as path from 'path';
import { URI } from 'vscode-uri';
import { startServer, initServer, reloadProjects, openFile, normalizeUri, createConnection } from './test_helpers/integration-helpers';
import { MessageConnection } from 'vscode-jsonrpc/node';

import { CompletionRequest, DefinitionRequest } from 'vscode-languageserver-protocol/node';

describe('With `full-project` initialized on server', () => {
  let connection: MessageConnection;
  let serverProcess: cp.ChildProcess;

  beforeAll(async () => {
    serverProcess = startServer();
    connection = createConnection(serverProcess);
    connection.listen();
    await new Promise((resolve) => setTimeout(resolve, 1000));
  });

  afterAll(async () => {
    await connection.dispose();
    await serverProcess.kill();
  });

  beforeEach(async () => {
    await initServer(connection, 'full-project');
  });

  afterEach(async () => {
    await reloadProjects(connection, null);
  });

  describe('Completion request', () => {
    jest.setTimeout(15000);
    it('returns all components and helpers when requesting completion items in a handlebars expression', async () => {
      const applicationTemplatePath = path.join(__dirname, 'fixtures', 'full-project', 'app', 'templates', 'application.hbs');
      const params = {
        textDocument: {
          uri: URI.file(applicationTemplatePath).toString(),
        },
        position: {
          line: 1,
          character: 2,
        },
      };

      openFile(connection, applicationTemplatePath);

      const response = await connection.sendRequest(CompletionRequest.method, params);

      expect(response).toMatchSnapshot();
    });

    it('returns all angle-bracket in a element expression', async () => {
      const applicationTemplatePath = path.join(__dirname, 'fixtures', 'full-project', 'app', 'templates', 'angle-completion.hbs');
      const params = {
        textDocument: {
          uri: URI.file(applicationTemplatePath).toString(),
        },
        position: {
          line: 1,
          character: 2,
        },
      };

      openFile(connection, applicationTemplatePath);

      const response = await connection.sendRequest(CompletionRequest.method, params);

      expect(response).toMatchSnapshot();
    });

    it('returns all routes when requesting completion items in an inline link-to', async () => {
      const templatePath = path.join(__dirname, 'fixtures', 'full-project', 'app', 'templates', 'definition.hbs');
      const params = {
        textDocument: {
          uri: URI.file(templatePath).toString(),
        },
        position: {
          line: 2,
          character: 23,
        },
      };

      openFile(connection, templatePath);

      const response = await connection.sendRequest(CompletionRequest.method, params);

      expect(response).toMatchSnapshot();
    });

    it('returns all routes when requesting completion items in a block link-to', async () => {
      const templatePath = path.join(__dirname, 'fixtures', 'full-project', 'app', 'templates', 'definition.hbs');
      const params = {
        textDocument: {
          uri: URI.file(templatePath).toString(),
        },
        position: {
          line: 3,
          character: 12,
        },
      };

      openFile(connection, templatePath);

      const response = await connection.sendRequest(CompletionRequest.method, params);

      expect(response).toMatchSnapshot();
    });

    it('returns all angle-bracket in a element expression for in repo addons without batman syntax', async () => {
      const applicationTemplatePath = path.join(__dirname, 'fixtures', 'full-project', 'app', 'templates', 'inrepo-addon-completion.hbs');
      const params = {
        textDocument: {
          uri: URI.file(applicationTemplatePath).toString(),
        },
        position: {
          line: 1,
          character: 2,
        },
      };

      openFile(connection, applicationTemplatePath);

      const response = await connection.sendRequest(CompletionRequest.method, params);

      expect(response).toMatchSnapshot();
    });
  });

  describe('Definition request', () => {
    it('returns the definition information for a component in a template', async () => {
      const base = path.join(__dirname, 'fixtures', 'full-project');
      const definitionTemplatePath = path.join(base, 'app', 'templates', 'definition.hbs');
      const params = {
        textDocument: {
          uri: URI.file(definitionTemplatePath).toString(),
        },
        position: {
          line: 0,
          character: 4,
        },
      };

      openFile(connection, definitionTemplatePath);

      let response = await connection.sendRequest(DefinitionRequest.method, params);

      response = normalizeUri(response, base);
      expect(response).toMatchSnapshot();
    });

    it('returns the definition information for a helper in a template', async () => {
      const base = path.join(__dirname, 'fixtures', 'full-project');
      const definitionTemplatePath = path.join(base, 'app', 'templates', 'definition.hbs');
      const params = {
        textDocument: {
          uri: URI.file(definitionTemplatePath).toString(),
        },
        position: {
          line: 1,
          character: 4,
        },
      };

      openFile(connection, definitionTemplatePath);

      let response = await connection.sendRequest(DefinitionRequest.method, params);

      response = normalizeUri(response, base);
      expect(response).toMatchSnapshot();
    });

    it('returns the definition information for a hasMany relationship', async () => {
      const base = path.join(__dirname, 'fixtures', 'full-project');
      const modelPath = path.join(base, 'app', 'models', 'model-a.js');
      const params = {
        textDocument: {
          uri: URI.file(modelPath).toString(),
        },
        position: {
          line: 4,
          character: 27,
        },
      };

      openFile(connection, modelPath);

      let response = await connection.sendRequest(DefinitionRequest.method, params);

      response = normalizeUri(response, base);
      expect(response).toMatchSnapshot();
    });

    it('returns the definition information for a belongsTo relationship', async () => {
      const base = path.join(__dirname, 'fixtures', 'full-project');
      const modelPath = path.join(base, 'app', 'models', 'model-b.js');
      const params = {
        textDocument: {
          uri: URI.file(modelPath).toString(),
        },
        position: {
          line: 4,
          character: 27,
        },
      };

      openFile(connection, modelPath);

      let response = await connection.sendRequest(DefinitionRequest.method, params);

      response = normalizeUri(response, base);
      expect(response).toMatchSnapshot();
    });

    it('returns the definition information for a transform', async () => {
      const base = path.join(__dirname, 'fixtures', 'full-project');
      const modelPath = path.join(base, 'app', 'models', 'model-a.js');
      const params = {
        textDocument: {
          uri: URI.file(modelPath).toString(),
        },
        position: {
          line: 6,
          character: 27,
        },
      };

      openFile(connection, modelPath);

      let response = await connection.sendRequest(DefinitionRequest.method, params);

      response = normalizeUri(response, base);
      expect(response).toMatchSnapshot();
    });
  });
});
