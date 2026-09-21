# Contributing

Thanks for helping improve Babel Content Downloader.

## Before opening a change

- Read [README.md](README.md) and the current [platform status](docs/platform-status.md).
- Keep collection limited to content the user can lawfully access. Do not add paywall, private-content, login, DRM or anti-bot bypasses.
- Treat a registered source as a bounded adapter, not a claim that every page on the platform works.
- Preserve the local-first design: credentials, browser state and collected content must not be uploaded by default.

## Development

Use Node.js 22.13.0 or newer:

```sh
npm ci
npm run typecheck
npm test -- --maxWorkers=2
npm run build
```

Changes to TypeScript source should also pass:

```sh
npm run lsp
```

For extension changes, verify both `dist/extension` and `dist/extension-dev`, then test the unpacked extension in Chrome. Automated tests and a local preview do not replace a real browser check.

## Pull requests

Describe the concrete user problem, the resulting behavior and the validation performed. Include the exact platform route and sample type for adapter changes. Do not include downloaded user content, credentials, local runtime configuration, `.audit/`, `dist/` or `releases/`.

Bug reports and feature requests can be filed in [GitHub Issues](https://github.com/gjw199513/babel-content-downloader/issues).
