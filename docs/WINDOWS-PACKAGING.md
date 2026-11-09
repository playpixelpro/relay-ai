# Windows packaging

The fork can be distributed as a portable executable or as a per-user MSI
installer. The executable includes the compiled CLI and its public UI assets;
Node.js is not required on the target machine.

## Prerequisites

- Windows 10 or later
- Node.js 22 or later for building
- npm dependencies installed with `npm install`
- WiX Toolset v4 only when building the MSI

The WiX source uses the WiX v4 schema. Newer WiX releases can also build it;
follow their first-run license prompt if one is shown.

Install WiX v4 with the .NET tool installer if it is not already available:

```powershell
dotnet tool install --global wix
```

If the installed WiX release asks for its Open Source Maintenance Fee EULA,
accept it explicitly once before building. For WiX 7, use:

```powershell
wix eula accept wix7
```

For a one-off build without saving the acceptance, set the explicit opt-in
variable for that command:

```powershell
$env:RELAY_AI_ACCEPT_WIX_EULA = '1'
npm run build:msi
Remove-Item Env:RELAY_AI_ACCEPT_WIX_EULA
```

## Build the portable `.exe`

```powershell
npm run build:windows
```

The output is written to `artifacts/windows/relay-ai.exe`. The build performs a
version smoke test before it completes.

## Build the `.msi`

```powershell
npm run build:msi
```

This first creates and validates the executable, then builds
`artifacts/windows/relay-ai-<version>.msi`. The MSI installs per-user under
`%LOCALAPPDATA%\PlayPixelPro\Relay AI` and does not require administrator
privileges.

MSI ProductVersion values are numeric because Windows Installer does not allow
npm prerelease labels. For example, the `0.0.1-beta` release uses MSI ProductVersion
`0.0.1`; the beta label remains in the filename, package version, and release tag.

The generated `artifacts/` directory is intentionally ignored by Git. Release
workflows can upload the two files as release assets without committing binary
artifacts to the repository.

## Notes

The Windows build uses a CommonJS staging bundle because the npm CLI is ESM and
uses dynamic provider imports. `@napi-rs/keyring` remains an optional runtime
dependency, so the executable keeps the same credential-store fallback behavior
when that native package is available on the target system.
