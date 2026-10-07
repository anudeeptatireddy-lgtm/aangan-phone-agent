/** @type {import('next').NextConfig} */
// pg and PGlite are loaded at runtime by the Node server; they must not be bundled.
export default { reactStrictMode: true, serverExternalPackages: ["pg", "@electric-sql/pglite"] };
