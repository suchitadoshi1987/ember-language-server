export type Initializer = () => void;

export interface Config {
  addons: string[];
  ignoredProjects: string[];
  disableInitialization: boolean;
  includeModules: string[];
  useBuiltinLinting: boolean;
}
