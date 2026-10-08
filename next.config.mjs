/** @type {import('next').NextConfig} */
// pg and PGlite are loaded at runtime by the Node server; they must not be bundled.
// NEXT_DIST_DIR lets a second dev server run beside the first without sharing its build folder.
export default { reactStrictMode: true, serverExternalPackages: ["pg", "@electric-sql/pglite"], distDir: process.env.NEXT_DIST_DIR || ".next" };
