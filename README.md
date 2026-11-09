<p align="center">
  <img src="assets/banner.png" alt="PlayPixelPro fork banner" width="100%">
</p>

<h1 align="center">Relay AI · PlayPixelPro fork</h1>

<p align="center">
  A focused OpenAI/ChatGPT authentication bridge for Relay-powered coding sessions.
</p>

<p align="center">
  <a href="https://github.com/playpixelpro/relay-ai/releases/tag/v1.0.0"><img src="https://img.shields.io/badge/release-v1.0.0-7c3aed" alt="Release v1.0.0"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-22c55e" alt="MIT License"></a>
</p>

This fork updates OpenAI/ChatGPT sign-in for a smoother local flow. The CLI and visual launcher now use browser-based PKCE authentication with a localhost callback instead of the older device-code flow.

## What changed in OpenAI authentication

- Browser-first PKCE sign-in for ChatGPT Plus/Pro accounts.
- The CLI and visual launcher share the same authorization flow.
- Relay listens for the registered callback at `http://127.0.0.1:1455/auth/callback`.
- If port `1455` is busy, the callback server safely falls back to port `1457`.
- OAuth state and PKCE verification protect the callback before tokens are exchanged.
- Multiple ChatGPT accounts continue to work through separate provider entries.

```text
relay-ai providers auth openai-oauth
              │
              ▼
      OpenAI browser sign-in
              │
              ▼
   localhost PKCE callback
              │
              ▼
  ChatGPT provider is ready
```

## Install this fork

Requirements:

- Node.js 22 or newer
- Claude Code installed if you want to launch Claude Code sessions

```bash
git clone https://github.com/playpixelpro/relay-ai.git
cd relay-ai
npm install
npm run build
npm link
```

Confirm the local installation:

```bash
relay-ai --version
```

It should report `1.0.0`.

## Sign in with OpenAI/ChatGPT

Run the provider authentication command:

```bash
relay-ai providers auth openai-oauth
```

Your browser opens to the OpenAI authorization page. After approval, OpenAI redirects to Relay’s local callback and the credential is saved in Relay’s provider credential store.

You can also start the visual launcher and authenticate from its provider screen:

```bash
relay-ai ui
```

## Launch a ChatGPT model

Use the exact provider ID `openai-oauth`—the picker label may appear as **OpenAI (ChatGPT)**:

```bash
relay-ai claude --relay-only --provider openai-oauth --model gpt-5.6-luna
```

To browse the models available to your account, run `relay-ai claude` and choose the OpenAI/ChatGPT provider from the picker.

## Callback troubleshooting

If sign-in cannot return to Relay:

1. Make sure ports `1455` and `1457` are available on `127.0.0.1`.
2. Close another local OpenAI/Codex login that may be using one of those ports.
3. Retry `relay-ai providers auth openai-oauth`.

The callback endpoint is `/auth/callback`; the server also accepts the legacy `/callback` and `/oauth/callback` paths.

## License

This fork is released under the [MIT License](LICENSE).

For the complete provider, gateway, launcher, Docker, Core API, and troubleshooting documentation, open the [old README](oldreadme.md).

<p align="center">
  <a href="https://buymeacoffee.com/playpixelpro"><img src="https://cdn.buymeacoffee.com/buttons/v2/default-yellow.png" alt="Support this fork" height="42"></a>
</p>
