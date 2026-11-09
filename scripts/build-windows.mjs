import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const packageJson = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'));
const artifactDir = join(repoRoot, 'artifacts', 'windows');
const stagingDir = join(artifactDir, 'staging');
const stagedEntry = join(stagingDir, 'cli.cjs');
const executablePath = join(artifactDir, 'relay-ai.exe');
const installerPath = join(artifactDir, `relay-ai-${packageJson.version}.msi`);
const wantsMsi = process.argv.includes('--msi');

function cleanup() {
  rmSync(stagingDir, { recursive: true, force: true });
}

function run(command, args, options = {}) {
  console.log(`> ${command} ${args.join(' ')}`);
  execFileSync(command, args, {
    cwd: repoRoot,
    stdio: 'inherit',
    shell: command.toLowerCase().endsWith('.cmd'),
    ...options,
  });
}

if (process.platform !== 'win32') {
  throw new Error('Windows packaging must be built on Windows.');
}

run('npm', ['run', 'build']);

rmSync(stagingDir, { recursive: true, force: true });
mkdirSync(stagingDir, { recursive: true });
process.once('exit', cleanup);

const esbuild = join(repoRoot, 'node_modules', 'esbuild', 'bin', 'esbuild');
const pkg = join(repoRoot, 'node_modules', '@yao-pkg', 'pkg', 'lib-es5', 'bin.js');
if (!existsSync(esbuild) || !existsSync(pkg)) {
  throw new Error('Missing packaging tools. Run npm install before building Windows artifacts.');
}

// Bundle the ESM CLI into CommonJS so pkg can create a self-contained snapshot.
run(process.execPath, [esbuild,
  join(repoRoot, 'dist', 'cli.js'),
  '--bundle',
  '--platform=node',
  '--target=node22',
  '--format=cjs',
  '--external:@napi-rs/keyring',
  '--alias:jsonc-parser=jsonc-parser/lib/esm/main.js',
  '--define:import.meta.url=__relayMetaUrl',
  "--banner:js=const { pathToFileURL: __relayPathToFileURL } = require('node:url'); const __relayMetaUrl = __relayPathToFileURL(__filename).href;",
  `--outfile=${stagedEntry}`,
]);

// ui-command resolves its public files beside the compiled entry point.
cpSync(join(repoRoot, 'dist', 'ui'), join(stagingDir, 'ui'), { recursive: true });

run(process.execPath, [pkg,
  stagedEntry,
  '--target',
  'host',
  '--no-bytecode',
  '--public-packages',
  '*',
  '--public',
  '--fallback-to-source',
  '--output',
  executablePath,
]);

run(executablePath, ['--version']);

if (wantsMsi) {
  try {
    run('wix', ['--version']);
  } catch {
    throw new Error('WiX v4 is required. Install it with `dotnet tool install --global wix` and retry.');
  }

  run('wix', [
    'build',
    join(repoRoot, 'installer', 'RelayAI.wxs'),
    '-d',
    `RelayAiVersion=${packageJson.version}`,
    '-d',
    `ArtifactDir=${artifactDir}`,
    '-o',
    installerPath,
  ]);
}

cleanup();
console.log(`Windows executable: ${executablePath}`);
if (wantsMsi) console.log(`Windows installer: ${installerPath}`);
