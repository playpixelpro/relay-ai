import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const packageJson = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'));
const msiVersion = packageJson.version.split('-')[0];
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
  let wixVersion;
  try {
    wixVersion = execFileSync('wix', ['--version'], { encoding: 'utf8' }).trim();
    console.log(`> wix --version\n${wixVersion}`);
  } catch {
    throw new Error('WiX Toolset v4 or later is required. Install it with `dotnet tool install --global wix` and retry.');
  }

  const wixMajor = Number.parseInt(wixVersion.match(/\d+/)?.[0] ?? '0', 10);
  const wixArgs = [
    'build',
    join(repoRoot, 'installer', 'RelayAI.wxs'),
    '-d',
    `RelayAiMsiVersion=${msiVersion}`,
    '-d',
    `ArtifactDir=${artifactDir}`,
    '-o',
    installerPath,
  ];

  // WiX 7 introduced an OSMF EULA gate. Never accept it silently: either the
  // developer has accepted it persistently with `wix eula accept wix7`, or an
  // explicit environment variable opts into the current-build acceptance.
  if (wixMajor >= 7) {
    const eulaFile = join(homedir(), '.wix', `wix${wixMajor}-osmf-eula.txt`);
    if (!existsSync(eulaFile)) {
      if (process.env.RELAY_AI_ACCEPT_WIX_EULA !== '1') {
        throw new Error(
          `WiX ${wixMajor} requires EULA acceptance. Run \`wix eula accept wix${wixMajor}\` once, or set RELAY_AI_ACCEPT_WIX_EULA=1 for this build, then retry.`,
        );
      }
      wixArgs.splice(1, 0, '--acceptEula', `wix${wixMajor}`);
    }
  }

  run('wix', wixArgs);
}

cleanup();
console.log(`Windows executable: ${executablePath}`);
if (wantsMsi) console.log(`Windows installer: ${installerPath}`);
