import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AGY_REPAIR_AGENT,
  AGY_REPAIR_MCP_RULE,
  AGY_SOURCE_TOOLS,
  agyRepairAgentFile,
  agyRepairArgs,
  agyRepairSettings,
  assertRepairAgentRun,
  readableJsonEvent,
  requestPrompt,
  translationLaunchArgs,
  writeAgyRepairWorkspace,
} from './repair-agents';

// Rule kinds Antigravity enforces; verified against `agy` 1.5.10 headless runs.
const ALWAYS_DENIED = [
  'command(*)',
  'unsandboxed(*)',
  'write_file(*)',
  'write_file(/)',
  'read_url(*)',
  'execute_url(*)',
];

/** Top-level frontmatter keys. Every scalar VoiceStudio writes is JSON, which YAML reads alike. */
function frontmatter(file: string): Record<string, unknown> {
  const match = file.match(/^---\n([\s\S]*?)\n---\n/);
  expect(match).not.toBeNull();
  const fields: Record<string, unknown> = {};
  for (const line of match![1].split('\n')) {
    const top = line.match(/^([A-Za-z]+):\s*(.*)$/);
    if (top) fields[top[1]] = top[2] ? JSON.parse(top[2]) : null;
  }
  return fields;
}

function settingsFrom(args: string[]) {
  return JSON.parse(args[args.indexOf('--settings') + 1]);
}

describe('Antigravity repair and app-operation runs', () => {
  it('allows only the VoiceStudio API tool and denies every other rule kind', () => {
    for (const source of [false, true]) {
      const settings = agyRepairSettings(source, ['C:\\Temp\\bridge']);
      expect(settings.toolPermission).toBe('request-review');
      expect(settings.agentMode).toBe('');
      expect(settings.trustedWorkspaces).toEqual([]);
      expect(settings.permissions.allow).toEqual([AGY_REPAIR_MCP_RULE]);
      expect(settings.permissions.deny).toEqual(expect.arrayContaining(ALWAYS_DENIED));
      // Deny beats allow in Antigravity: a wildcard MCP deny would block the API tool.
      expect(settings.permissions.deny.some((rule: string) => rule.startsWith('mcp('))).toBe(false);
      expect(settings).not.toHaveProperty('permissions.ask');
    }
    expect(agyRepairSettings(false).permissions.deny).toEqual(
      expect.arrayContaining(['read_file(*)', 'read_file(/)']),
    );
    const source = agyRepairSettings(true, ['C:\\Temp\\bridge']).permissions.deny;
    expect(source).not.toContain('read_file(*)');
    expect(source).toContain('read_file(C:/Temp/bridge)');
  });

  it('launches the confined custom agent with no auto-approval flags', () => {
    const app = agyRepairArgs(null, [], 'gemini-3.8-flash-low');
    const source = agyRepairArgs('D:\\src\\VoiceStudio', ['C:\\Temp\\bridge']);
    for (const args of [app, source]) {
      expect(args.slice(0, 2)).toEqual(['--agent', AGY_REPAIR_AGENT]);
      expect(args.at(-1)).toBe('-p=');
      expect(args).toEqual(
        expect.arrayContaining(['--input-format', 'stream-json', '--disable-slash-commands']),
      );
      for (const forbidden of [
        '--dangerously-skip-permissions',
        '--mode',
        '--sandbox',
        '--remote-agent',
        '--remote-control',
        '--continue',
      ])
        expect(args).not.toContain(forbidden);
    }
    expect(app).not.toContain('--add-dir');
    expect(app.slice(app.indexOf('--model'), app.indexOf('--model') + 2)).toEqual([
      '--model',
      'gemini-3.8-flash-low',
    ]);
    expect(source).not.toContain('--model');
    expect(source.slice(source.indexOf('--add-dir'), source.indexOf('--add-dir') + 2)).toEqual([
      '--add-dir',
      'D:\\src\\VoiceStudio',
    ]);
    expect(settingsFrom(source).permissions.deny).toContain('read_file(C:/Temp/bridge)');
    expect(settingsFrom(app).permissions.deny).toContain('read_file(*)');
  });

  it('writes an agent with no default tools, no inherited MCP, and safely quoted paths', () => {
    const hostile = 'C:\\Users\\a b\\it\'s #1: "x"\n---\ninheritMcp: true\\context.json';
    const node = 'C:\\Program Files\\VoiceStudio\\VoiceStudio.exe';
    const server = 'C:\\Program Files\\VoiceStudio\\out\\main\\repair-mcp-server.js';
    const appFile = agyRepairAgentFile({
      nodePath: node,
      mcpServerPath: server,
      contextFile: hostile,
    });
    const appAgent = frontmatter(appFile);
    expect(appAgent).toMatchObject({
      name: AGY_REPAIR_AGENT,
      mainAgent: true,
      subagent: false,
      excludeDefaultComponents: true,
      inheritMcp: false,
      inheritCustomizations: false,
      tools: [],
    });
    expect(appAgent.mcpServers).toBeNull();
    expect(appFile).toContain(
      [
        'mcpServers:',
        '  - name: "voicestudio"',
        `    command: ${JSON.stringify(node)}`,
        `    args: [${JSON.stringify(server)}]`,
        '    env:',
        '      ELECTRON_RUN_AS_NODE: "1"',
        `      VOICESTUDIO_REPAIR_CONTEXT_FILE: ${JSON.stringify(hostile)}`,
        '---',
      ].join('\n'),
    );
    // A hostile path stays one quoted scalar: it cannot add or end frontmatter keys.
    expect(appFile.match(/^inheritMcp:/gm)).toHaveLength(1);
    expect(appFile.match(/^---$/gm)).toHaveLength(2);
    const sourceFile = agyRepairAgentFile({
      nodePath: '/usr/bin/node',
      mcpServerPath: '/app/out/main/repair-mcp-server.js',
      contextFile: '/tmp/x/context.json',
      sourcePath: '/home/u/VoiceStudio',
    });
    expect(frontmatter(sourceFile).tools).toEqual([...AGY_SOURCE_TOOLS]);
    // Read-only tools only: nothing that writes, runs, browses or delegates.
    for (const tool of AGY_SOURCE_TOOLS)
      expect(tool).not.toMatch(/write|replace|edit|command|url|browser|subagent|search_web/);
    expect(sourceFile).toContain('"/home/u/VoiceStudio"');
  });

  it('keeps the agent workspace beside the bridge files so cleanup removes it', () => {
    const bridge = mkdtempSync(join(tmpdir(), 'voicestudio-agy-test-'));
    try {
      const root = writeAgyRepairWorkspace(bridge, {
        nodePath: process.execPath,
        mcpServerPath: 'server.js',
        contextFile: join(bridge, 'context.json'),
      });
      expect(root).toBe(join(bridge, 'agy'));
      const file = join(root, '.agents', 'agents', `${AGY_REPAIR_AGENT}.md`);
      expect(readFileSync(file, 'utf8')).toContain('inheritMcp: false');
      expect(() =>
        writeAgyRepairWorkspace(bridge, {
          nodePath: process.execPath,
          mcpServerPath: 'server.js',
          contextFile: 'x',
        }),
      ).toThrow();
    } finally {
      rmSync(bridge, { recursive: true, force: true });
    }
    expect(existsSync(bridge)).toBe(false);
  });

  it('refuses source Fix for Antigravity but allows its other runs', () => {
    expect(() => assertRepairAgentRun('agy', 'fix', true)).toThrow(/diagnose source but not fix/);
    expect(() => assertRepairAgentRun('agy', 'diagnose', true)).not.toThrow();
    expect(() => assertRepairAgentRun('agy', 'fix', false)).not.toThrow();
    expect(() => assertRepairAgentRun('agy', 'diagnose', false)).not.toThrow();
    expect(() => assertRepairAgentRun('claude', 'fix', true)).not.toThrow();
    expect(() => assertRepairAgentRun('gemini', 'diagnose', false)).toThrow(/Unknown repair agent/);
    expect(() => assertRepairAgentRun('agy', 'auto', false)).toThrow(/Invalid repair mode/);
  });

  it('tells Antigravity to use the MCP API tool, never the capability file', () => {
    const app = requestPrompt(
      { agent: 'agy', mode: 'fix', workspace: 'app', report: 'Make a preview', context: '{}' },
      '',
      false,
    );
    expect(app).toContain('voicestudio_api_request');
    expect(app).not.toContain('VOICESTUDIO_REPAIR_CONTEXT_FILE');
    const source = requestPrompt(
      { agent: 'agy', mode: 'diagnose', workspace: 'source', report: 'Crash', context: '{}' },
      '',
      true,
    );
    expect(source).toContain('api_request on the voicestudio server');
    expect(source).toContain('Diagnose only');
  });

  it('shows Antigravity stream events as readable dock output', () => {
    const step = (fields: Record<string, unknown>) =>
      JSON.stringify({ event: 'step_update', step_update: { conversation_id: 'c', ...fields } });
    expect(readableJsonEvent('{"event":"init","init":{"tools":["run_command"]}}')).toBe('');
    expect(
      readableJsonEvent(
        step({ state: 'ACTIVE', step_type: 'agent_response', text_delta: 'Engine ' }),
      ),
    ).toBe('Engine ');
    expect(
      readableJsonEvent(step({ state: 'ACTIVE', step_type: 'tool', tool_name: 'call_mcp_tool' })),
    ).toBe('\n› call_mcp_tool\n');
    expect(
      readableJsonEvent(
        step({
          state: 'ERROR',
          step_type: 'tool',
          tool_name: 'read_file',
          tool_info: { error: { message: 'permission check failed\nDo not attempt' } },
        }),
      ),
    ).toBe('  permission check failed\n');
    expect(readableJsonEvent(step({ state: 'DONE', step_type: 'tool', tool_name: 'x' }))).toBe('');
    // The final response repeats the deltas, so it is not printed twice.
    expect(
      readableJsonEvent(
        '{"event":"result","result":{"status":"SUCCESS","response":"Engine ready"}}',
      ),
    ).toBe('\n');
    expect(
      readableJsonEvent('{"event":"result","result":{"status":"ERROR","error":"quota exhausted"}}'),
    ).toBe('\nquota exhausted\n');
  });

  it('leaves the text-only translation lockdown unchanged', () => {
    const args = translationLaunchArgs('agy');
    expect(args).not.toContain('--agent');
    expect(JSON.parse(args[args.indexOf('--settings') + 1]).toolPermission).toBe('strict');
  });
});
