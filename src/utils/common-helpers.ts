import { Server } from '..';
import * as memoize from 'memoizee';

export async function getAppRootFromConfig(server: Server) {
  try {
    return (await server.connection.workspace.getConfiguration('els.appRoot')) || Promise.resolve('');
  } catch (e) {
    return Promise.resolve('');
  }
}

export const mProjectRoot = memoize(getProjectParentRoot);

/**
 * Find the top level root of the project.
 */
export function getProjectParentRoot(root: string, appRoot: string) {
  const indexOfAppRoot = root.indexOf(`/${appRoot}`);

  return appRoot && indexOfAppRoot > -1 ? root.slice(0, indexOfAppRoot) : root;
}
