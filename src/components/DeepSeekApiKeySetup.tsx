import * as React from 'react';
import { Box, Text, useInput } from '@anthropic/ink';
import { saveDeepSeekConfig } from '../services/deepseek/config.js';

const MIN_KEY_LENGTH = 8;
const MAX_KEY_LENGTH = 512;

function maskKey(value: string): string {
  if (!value) return '';
  if (value.length <= 8) return '*'.repeat(value.length);
  return `${value.slice(0, 3)}${'*'.repeat(Math.min(value.length - 6, 18))}${value.slice(-3)}`;
}

function validateKey(value: string): string | null {
  if (!value) return null;
  if (value.length < MIN_KEY_LENGTH) {
    return `Key too short (${value.length}/${MIN_KEY_LENGTH} chars minimum)`;
  }
  if (value.length > MAX_KEY_LENGTH) {
    return `Key too long (${value.length}/${MAX_KEY_LENGTH} chars maximum)`;
  }
  return null;
}

export function DeepSeekApiKeySetup({ onDone }: { onDone(): void }): React.ReactNode {
  const [value, setValue] = React.useState('');
  const [saving, setSaving] = React.useState(false);
  const [saveError, setSaveError] = React.useState<string | null>(null);

  const inlineError = validateKey(value);
  const canSubmit = !saving && value.length >= MIN_KEY_LENGTH && inlineError === null;

  useInput(
    (input: string, key: { return: boolean; backspace: boolean; delete: boolean }) => {
      if (key.return) {
        if (!canSubmit) return;
        setSaving(true);
        setSaveError(null);
        void saveDeepSeekConfig({ apiKey: value })
          .then(onDone)
          .catch((err: unknown) => {
            setSaveError(err instanceof Error ? err.message : 'Failed to save DeepSeek API Key');
            setSaving(false);
          });
        return;
      }

      if (key.backspace || key.delete) {
        setValue(prev => prev.slice(0, -1));
        return;
      }

      if (!input) return;
      setValue(prev => {
        const printable = Array.from(input).filter(char => {
          const code = char.charCodeAt(0);
          return code >= 32 && code <= 126;
        });
        const next = prev + printable.join('');
        return next.length <= MAX_KEY_LENGTH ? next : prev;
      });
    },
    { isActive: !saving },
  );

  const displayError = saveError ?? inlineError;

  return (
    <Box flexDirection="column" gap={1} paddingLeft={1}>
      <Text bold>Configure DeepSeek API Key</Text>
      <Box flexDirection="column" width={72}>
        <Text>DeepCode will save this key locally and use it for model requests.</Text>
        <Text dimColor>Base URL defaults to https://api.deepseek.com/v1 and model defaults to deepseek-v4-pro.</Text>
      </Box>

      <Box>
        <Text>{'> '}</Text>
        {value ? <Text>{maskKey(value)}</Text> : <Text dimColor>{'[paste your DeepSeek API Key]'}</Text>}
      </Box>

      {displayError && <Text color="warning">{displayError}</Text>}
      {saving && <Text dimColor>Saving...</Text>}

      <Text dimColor>{canSubmit ? 'Press Enter to save' : 'Paste your key to continue'}</Text>
    </Box>
  );
}
