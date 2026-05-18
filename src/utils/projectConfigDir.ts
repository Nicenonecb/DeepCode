import { join } from 'path'

export const PROJECT_CONFIG_DIR_NAME = '.deep'
export const LEGACY_PROJECT_CONFIG_DIR_NAME = '.claude'

export function projectConfigPath(root: string, ...parts: string[]): string {
  return join(root, PROJECT_CONFIG_DIR_NAME, ...parts)
}

export function legacyProjectConfigPath(
  root: string,
  ...parts: string[]
): string {
  return join(root, LEGACY_PROJECT_CONFIG_DIR_NAME, ...parts)
}

export function projectConfigRelativePath(...parts: string[]): string {
  return join(PROJECT_CONFIG_DIR_NAME, ...parts)
}

export function legacyProjectConfigRelativePath(...parts: string[]): string {
  return join(LEGACY_PROJECT_CONFIG_DIR_NAME, ...parts)
}
