import type { Command } from '../../commands.js'

export default () =>
  ({
    type: 'local-jsx',
    name: 'login',
    description: 'Disabled: DeepCode uses local DeepSeek API Key configuration',
    isEnabled: () => false,
    isHidden: true,
    load: () => import('./login.js'),
  }) satisfies Command
