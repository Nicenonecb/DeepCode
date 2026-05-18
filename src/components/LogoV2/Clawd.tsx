import * as React from 'react';
import { Box, Text } from '@anthropic/ink';
import { env } from '../../utils/env.js';

export type ClawdPose =
  | 'default'
  | 'arms-up' // tail lifted (used during jump)
  | 'look-left' // blowhole shifted left
  | 'look-right'; // blowhole shifted right

type Props = {
  pose?: ClawdPose;
};

// Standard-terminal pose fragments. Each row is split into segments so we can
// vary only the parts that change while keeping the body/bg spans stable. All
// poses end up 11 cols wide.
type Segments = {
  /** row 1 left (no bg): tail + body side */
  r1L: string;
  /** row 1 body (with bg): whale back */
  r1B: string;
  /** row 1 right (no bg): tail/body side */
  r1R: string;
  /** row 2 left (no bg): lower body curve */
  r2L: string;
  /** row 2 right (no bg): lower body curve */
  r2R: string;
  /** row 3 center: fin/feet */
  r3: string;
};

const POSES: Record<ClawdPose, Segments> = {
  default: { r1L: '▗▖  ▗', r1B: '████', r1R: '▄▖', r2L: '▝▜', r2R: '██▛▘', r3: '  ▝▀▘ ▝▀▘  ' },
  'look-left': { r1L: '▗▖▝ ▗', r1B: '████', r1R: '▄▖', r2L: '▝▜', r2R: '██▛▘', r3: '  ▝▀▘ ▝▀▘  ' },
  'look-right': { r1L: '▗▖  ▗', r1B: '████', r1R: '▄▘', r2L: '▝▜', r2R: '██▛▘', r3: '  ▝▀▘ ▝▀▘  ' },
  'arms-up': { r1L: '▗▟  ▗', r1B: '████', r1R: '▄▖', r2L: ' ▜', r2R: '██▛ ', r3: '  ▝▀▘ ▝▀▘  ' },
};

// Apple Terminal uses a bg-fill trick (see below), so only blowhole poses make
// sense. Tail poses fall back to default.
const APPLE_EYES: Record<ClawdPose, string> = {
  default: '  ▗    ',
  'look-left': ' ▝     ',
  'look-right': '   ▘   ',
  'arms-up': '  ▗    ',
};

export function Clawd({ pose = 'default' }: Props = {}): React.ReactNode {
  if (env.terminal === 'Apple_Terminal') {
    return <AppleTerminalClawd pose={pose} />;
  }
  const p = POSES[pose];
  return (
    <Box flexDirection="column">
      <Text>
        <Text color="clawd_body">{p.r1L}</Text>
        <Text color="clawd_body" backgroundColor="clawd_background">
          {p.r1B}
        </Text>
        <Text color="clawd_body">{p.r1R}</Text>
      </Text>
      <Text>
        <Text color="clawd_body">{p.r2L}</Text>
        <Text color="clawd_body" backgroundColor="clawd_background">
          █████
        </Text>
        <Text color="clawd_body">{p.r2R}</Text>
      </Text>
      <Text color="clawd_body">{p.r3}</Text>
    </Box>
  );
}

function AppleTerminalClawd({ pose }: { pose: ClawdPose }): React.ReactNode {
  // Apple's Terminal renders vertical space between chars by default.
  // It does NOT render vertical space between background colors
  // so we use background color to draw the main shape.
  return (
    <Box flexDirection="column" alignItems="center">
      <Text>
        <Text color="clawd_body">▗▖▗</Text>
        <Text color="clawd_background" backgroundColor="clawd_body">
          {APPLE_EYES[pose]}
        </Text>
        <Text color="clawd_body">▖</Text>
      </Text>
      <Text>
        <Text color="clawd_body">▝▜</Text>
        <Text backgroundColor="clawd_body">{' '.repeat(5)}</Text>
        <Text color="clawd_body">██▛▘</Text>
      </Text>
      <Text color="clawd_body"> ▝▀▘ ▝▀▘ </Text>
    </Box>
  );
}
