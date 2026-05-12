import React from 'react';
import type { LocalJSXCommandContext } from '../../commands.js';
import type { LocalJSXCommandOnDone } from '../../types/command.js';
import { runExtraUsage } from './extra-usage-core.js';

export async function call(
  onDone: LocalJSXCommandOnDone,
  context: LocalJSXCommandContext,
): Promise<React.ReactNode | null> {
  const result = await runExtraUsage();

  if (result.type === 'message') {
    onDone(result.value);
    return null;
  }

  context.onChangeAPIKey();
  onDone(result.opened ? `Opened ${result.url}` : `Visit ${result.url} to manage extra usage.`);
  return null;
}
