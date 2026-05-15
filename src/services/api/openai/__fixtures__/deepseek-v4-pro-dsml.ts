export const deepSeekV4ProDSMLFixture = {
  provider: 'deepseek',
  baseURL: 'https://api.deepseek.com/v1',
  model: 'deepseek-v4-pro',
  request: {
    toolProtocol: 'dsml',
    nonThink: {
      effortValue: 'low',
      maxTokens: 16_000,
      thinking: false,
      reasoningEffort: undefined,
      selfHostedThinking: false,
    },
    promptIncludes: [
      '<dsml_tool_protocol>',
      '<|DSML|tool_calls>...</|DSML|tool_calls>',
      '"name": "Read"',
      '"name": "Bash"',
    ],
    nativeTools: [],
  },
  response: {
    text: `<|DSML|tool_calls>
<|DSML|invoke name="Read">
<|DSML|parameter name="file_path" string="true">README.md</|DSML|parameter>
</|DSML|invoke>
<|DSML|invoke name="Bash">
<|DSML|parameter name="command" string="true">bun test src/services/dsml/__tests__/dsml.test.ts</|DSML|parameter>
<|DSML|parameter name="description" string="true">Run DSML parser tests</|DSML|parameter>
</|DSML|invoke>
</|DSML|tool_calls>`,
    expectedToolCalls: [
      {
        name: 'Read',
        input: { file_path: 'README.md' },
      },
      {
        name: 'Bash',
        input: {
          command: 'bun test src/services/dsml/__tests__/dsml.test.ts',
          description: 'Run DSML parser tests',
        },
      },
    ],
  },
} as const
