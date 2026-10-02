// Named, not `export *`: React's runtime is CommonJS, and a star re-export of
// a CommonJS module exposes no names to the browser.

export type { JSX } from 'react/jsx-dev-runtime'
export { Fragment, jsxDEV } from 'react/jsx-dev-runtime'
