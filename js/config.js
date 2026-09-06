// Site-wide runtime config. The bundled Node server exposes the waitlist
// API on the same origin, so no external account, domain, or CORS setup is
// required.
window.BARAQ_CONFIG = {
  API_BASE_URL: "/api/v1",

  // The About section's transparency badge. This is the ONE number to edit
  // as the team's own readiness audit changes -- update it here, not in
  // ar/index.html or en/index.html, which keep only a generic no-JS fallback
  // string. Static/manual on purpose (see README "Positioning"): this is a
  // transparency signal the team sets by hand, not live telemetry.
  READINESS_PERCENT: 72
};
