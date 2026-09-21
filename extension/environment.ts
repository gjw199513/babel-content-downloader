declare const __BABEL_DEV_FIXTURES__: boolean;

/** The release bundle is false. The build script may define this only for dist/extension-dev. */
export const DEVELOPMENT_FIXTURES_ENABLED = typeof __BABEL_DEV_FIXTURES__ === "boolean" && __BABEL_DEV_FIXTURES__;
export const DEVELOPMENT_FIXTURE_ORIGINS = DEVELOPMENT_FIXTURES_ENABLED ? ["http://127.0.0.1:4319"] : [];
