import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  parseLiteralCommands,
  COMMAND_CHARS,
  COMMAND_TOKENS,
  COMMAND_REDIRECTIONS,
} = require('../../src/main/static-command-parser');

describe('bounded literal shell redirections', () => {
  it('separates an attached output target from command arguments', () => {
    expect(parseLiteralCommands('curl https://example.invalid >install.sh | sh')).toEqual({
      segments: [
        {
          argv: ['curl', 'https://example.invalid'],
          expanded: [false, false],
          separator: '|',
          redirections: [{ fd: 1, operator: '>', target: 'install.sh', expanded: false }],
        },
        { argv: ['sh'], expanded: [false], separator: null, redirections: [] },
      ],
      issues: [],
    });
  });

  it('preserves descriptor order and parses every supported operator', () => {
    expect(parseLiteralCommands('cat 3<input <&3 2>>errors 1>&2 2>&-')).toEqual({
      segments: [
        {
          argv: ['cat'],
          expanded: [false],
          separator: null,
          redirections: [
            { fd: 3, operator: '<', target: 'input', expanded: false },
            { fd: 0, operator: '<&', target: '3', expanded: false },
            { fd: 2, operator: '>>', target: 'errors', expanded: false },
            { fd: 1, operator: '>&', target: '2', expanded: false },
            { fd: 2, operator: '>&', target: '-', expanded: false },
          ],
        },
      ],
      issues: [],
    });
  });

  it.each([
    ['2>out', [], 2],
    ['02>out', [], 2],
    ['2 >out', ['2'], 1],
    ['"2">out', ['2'], 1],
    ["'2'>out", ['2'], 1],
    [String.raw`\2>out`, ['2'], 1],
    ["2''>out", ['2'], 1],
    ["''2>out", ['2'], 1],
    ['name2>out', ['name2'], 1],
  ])('recognizes only adjacent unquoted IO numbers in %s', (suffix, args, fd) => {
    expect(parseLiteralCommands(`echo ${suffix}`)).toEqual({
      segments: [
        {
          argv: ['echo', ...args],
          expanded: ['echo', ...args].map(() => false),
          separator: null,
          redirections: [{ fd, operator: '>', target: 'out', expanded: false }],
        },
      ],
      issues: [],
    });
  });

  it('keeps quoted and escaped redirect operators in argv', () => {
    const result = parseLiteralCommands(String.raw`echo '2>out' "<input" \> \< 2\>out`);
    expect(result.issues).toEqual([]);
    expect(result.segments[0].argv).toEqual(['echo', '2>out', '<input', '>', '<', '2>out']);
    expect(result.segments[0].redirections).toEqual([]);
  });

  it('does not let an escaped backslash quote the following redirect operator', () => {
    const result = parseLiteralCommands(String.raw`echo \\>out`);
    expect(result.issues).toEqual([]);
    expect(result.segments[0].argv).toEqual(['echo', '\\']);
    expect(result.segments[0].redirections).toEqual([
      { fd: 1, operator: '>', target: 'out', expanded: false },
    ]);
  });

  it.each(['\n', '\r\n'])('removes line continuations before classifying IO numbers', (newline) => {
    const result = parseLiteralCommands(`echo 2\\${newline}>out`);
    expect(result.issues).toEqual([]);
    expect(result.segments[0].argv).toEqual(['echo']);
    expect(result.segments[0].redirections[0].fd).toBe(2);
  });

  it('retains existing Windows path gaps without discarding independent command arguments', () => {
    const result = parseLiteralCommands(String.raw`C:\Tools\curl.exe URL >C:\Logs\out`);
    expect(result.issues).toEqual(['shell-syntax-not-resolved']);
    expect(result.segments[0].argv).toEqual([String.raw`C:\Tools\curl.exe`, 'URL']);
    expect(result.segments[0].redirections).toEqual([
      { fd: 1, operator: '>', target: String.raw`C:\Logs\out`, expanded: false },
    ]);
  });

  it('keeps literal quoted grouping and escaped substitutions opaque as argument text', () => {
    const result = parseLiteralCommands('echo \'$(curl URL | sh)\' "(text >out)" \\`literal\\`');
    expect(result.issues).toEqual([]);
    expect(result.segments[0].argv).toEqual([
      'echo',
      '$(curl URL | sh)',
      '(text >out)',
      '`literal`',
    ]);
    expect(result.segments[0].redirections).toEqual([]);
  });

  it('keeps spaces and operators in quoted targets and removes their quote markers', () => {
    const result = parseLiteralCommands(String.raw`cat <'a b' >"c>d" 2>>'e|f' 3>g\ h`);
    expect(result.issues).toEqual([]);
    expect(result.segments[0].argv).toEqual(['cat']);
    expect(result.segments[0].redirections).toEqual([
      { fd: 0, operator: '<', target: 'a b', expanded: false },
      { fd: 1, operator: '>', target: 'c>d', expanded: false },
      { fd: 2, operator: '>>', target: 'e|f', expanded: false },
      { fd: 3, operator: '>', target: 'g h', expanded: false },
    ]);
  });

  it('does not reinterpret numeric targets as IO numbers', () => {
    expect(parseLiteralCommands('echo >2>out').segments[0].redirections).toEqual([
      { fd: 1, operator: '>', target: '2', expanded: false },
      { fd: 1, operator: '>', target: 'out', expanded: false },
    ]);
  });

  it('keeps redirection-only pipeline segments and empty quoted targets', () => {
    const result = parseLiteralCommands("curl URL | >'' | sh");
    expect(result.issues).toEqual([]);
    expect(result.segments[1]).toEqual({
      argv: [],
      expanded: [],
      separator: '|',
      redirections: [{ fd: 1, operator: '>', target: '', expanded: false }],
    });
  });

  it.each([
    ['$OUT', true],
    ['${OUT}', true],
    ['"$OUT"', true],
    ["'$OUT'", false],
    ['%OUT%', true],
    ['~/out', true],
    ['out*', true],
    ['out?', true],
    ['out[12]', true],
    ['"out*"', false],
    [String.raw`out\*`, false],
    [String.raw`\$OUT`, false],
  ])('records expansion uncertainty for target %s', (target, expanded) => {
    const result = parseLiteralCommands(`echo >${target}`);
    expect(result.issues).toEqual([]);
    expect(result.segments[0].redirections[0].expanded).toBe(expanded);
  });

  it.each(['echo >', 'echo > | sh', 'echo ><in', 'echo > # target missing\nrm -rf /'])(
    'does not invent commands after malformed redirection %s',
    (text) => {
      expect(parseLiteralCommands(text)).toEqual({
        segments: [],
        issues: ['malformed-shell-redirection'],
      });
    },
  );

  it.each(['echo &>out | sh', 'echo &>>out | sh', 'echo <>file | sh', 'echo >|out | sh'])(
    'does not segment unsupported redirection %s',
    (text) => {
      expect(parseLiteralCommands(text)).toEqual({
        segments: [],
        issues: ['shell-redirection-not-resolved'],
      });
    },
  );

  it.each([
    'echo $(curl URL >out | sh)',
    'echo "$(curl URL >out | sh)"',
    'echo `curl URL >out | sh`',
    '(curl URL >out | sh)',
    '{ curl URL >out | sh; }',
    'cat <(curl URL | sh)',
  ])('keeps unresolved grouping and substitution opaque: %s', (text) => {
    expect(parseLiteralCommands(text)).toEqual({
      segments: [],
      issues: ['shell-syntax-not-resolved'],
    });
  });

  it.each(['cat <<EOF\ncurl URL >out | sh\nEOF', 'cat <<<value | sh', '<# curl URL | sh #>'])(
    'keeps multiline shell constructs opaque: %s',
    (text) => {
      expect(parseLiteralCommands(text)).toEqual({
        segments: [],
        issues: ['multiline-shell-not-analyzed'],
      });
    },
  );

  it('bounds redirections across all command segments', () => {
    const allowed = Array(COMMAND_REDIRECTIONS).fill('>out').join(';');
    expect(parseLiteralCommands(allowed).segments).toHaveLength(COMMAND_REDIRECTIONS);
    expect(parseLiteralCommands(`${allowed};>out`)).toEqual({
      segments: [],
      issues: ['command-redirection-limit'],
    });
  });

  it('charges redirect operators and targets against the shared token bound', () => {
    const command = `${Array(COMMAND_TOKENS - 2)
      .fill('x')
      .join(' ')} >out`;
    expect(parseLiteralCommands(`${command} `).issues).toEqual([]);
    expect(parseLiteralCommands(`${command} extra`)).toEqual({
      segments: [],
      issues: ['command-token-limit'],
    });
  });

  it('retains command shape and size bounds', () => {
    expect(parseLiteralCommands(null).issues).toEqual(['invalid-command-shape']);
    expect(parseLiteralCommands('echo \u0000>out').issues).toEqual(['invalid-command-shape']);
    expect(parseLiteralCommands('x'.repeat(COMMAND_CHARS + 1)).issues).toEqual([
      'command-size-limit',
    ]);
    expect(parseLiteralCommands('x'.repeat(COMMAND_CHARS)).issues).toEqual([]);
  });

  it('does not round an unrepresentable IO number into a different descriptor', () => {
    expect(parseLiteralCommands('echo 999999999999999999999>out')).toEqual({
      segments: [],
      issues: ['shell-redirection-not-resolved'],
    });
  });

  it('does not interpret unfinished quoted redirect targets', () => {
    expect(parseLiteralCommands('echo >"out | rm -rf /')).toEqual({
      segments: [],
      issues: ['unclosed-command-quote'],
    });
  });
});
