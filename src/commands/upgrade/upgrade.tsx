import type { LocalJSXCommandContext } from '../../commands.js';
import type { LocalJSXCommandOnDone } from '../../types/command.js';
import { openBrowser } from '../../utils/browser.js';
import { logError } from '../../utils/log.js';

export async function call(onDone: LocalJSXCommandOnDone, context: LocalJSXCommandContext): Promise<null> {
  try {
    const url = 'https://claude.ai/upgrade/max';
    await openBrowser(url);
    context.onChangeAPIKey();
    setTimeout(onDone, 0, `Opened ${url}`);
  } catch (error) {
    logError(error as Error);
    setTimeout(onDone, 0, 'Failed to open browser. Please visit https://claude.ai/upgrade/max to upgrade.');
  }
  return null;
}
