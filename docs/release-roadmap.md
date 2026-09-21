# Release roadmap

## Current: downloadable extension archive

Every Release must include a versioned formal browser-extension artifact:

- `babel-content-downloader-extension-<version>.zip`
- `manifest.json` at the ZIP root
- formal production permissions only; no fixture origin or development adapter
- matching product, runtime and extension version
- SHA256 entry and release-manifest entry
- a standalone multilingual `EXTENSION-INSTALL.md`

This path lets a user download the extension without downloading or building source code. Chrome still requires the ZIP to be unpacked and loaded with **Load unpacked**.

## Next: one-click browser installation

Priority: **P1 after the first public repository release**.

The supported route for a true one-click Chrome installation is a Chrome Web Store listing. A standalone CRX is not the primary plan because normal Chrome installations restrict extensions distributed outside the store.

Delivery requirements:

1. Create store listing copy, screenshots, privacy disclosure and support URL in all five supported languages.
2. Produce the store upload ZIP from the same formal `dist/extension` output used by the Release artifact.
3. Verify that the store-assigned extension ID is authorized without weakening the existing exact-ID pairing policy.
4. Document upgrade behavior from the unpacked build to the store build, including ID and local pairing changes.
5. Complete a clean-profile install, runtime pairing, language switch, article collection and media collection smoke test before marking the store link stable.

Until those checks pass, Release documentation must describe the ZIP as “download, unpack, Load unpacked”, not as a one-click install.
