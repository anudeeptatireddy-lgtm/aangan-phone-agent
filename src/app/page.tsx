export default function Home() {
  return (
    <main style={{ fontFamily: "system-ui", padding: 24 }}>
      <h1>Aangan voice agent — local</h1>
      <p>Session 2 (Vaani agent + tools). Dashboard arrives in a later session.</p>
      <p><code>GET /api/health</code> · <code>POST /api/tools/*</code> · <code>POST /api/vaani/webhook</code></p>
    </main>
  );
}
