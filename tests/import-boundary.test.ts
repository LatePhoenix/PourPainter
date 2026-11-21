import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

const BOUNDARY_PATHS = [
  'src/sim/boundary-probe.ts',
  'src/domain/boundary-probe.ts',
  'src/render/boundary-probe.ts',
] as const;

async function lintProbe(filePath: string, code: string): Promise<string[]> {
  const eslint = new ESLint();
  const [result] = await eslint.lintText(code, { filePath });
  return (result?.messages ?? [])
    .filter((message) => message.ruleId === 'no-restricted-imports')
    .map((message) => message.message);
}

describe('import boundary (sim/domain/render)', () => {
  it.each(BOUNDARY_PATHS)('blocks react-dom/client in %s', async (filePath) => {
    const messages = await lintProbe(
      filePath,
      `import { createRoot } from 'react-dom/client';\nexport const x = createRoot;\n`,
    );
    expect(messages.length).toBeGreaterThan(0);
    expect(messages.join('\n')).toMatch(/React/i);
  });

  it.each(BOUNDARY_PATHS)('blocks react/jsx-runtime in %s', async (filePath) => {
    const messages = await lintProbe(
      filePath,
      `import { jsx } from 'react/jsx-runtime';\nexport const x = jsx;\n`,
    );
    expect(messages.length).toBeGreaterThan(0);
  });

  it('still blocks exact react imports', async () => {
    const messages = await lintProbe(
      'src/sim/boundary-probe.ts',
      `import React from 'react';\nexport const x = React;\n`,
    );
    expect(messages.length).toBeGreaterThan(0);
  });
});
