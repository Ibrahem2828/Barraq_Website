// Site-wide runtime config. This is a static site (no build step), so this
// is the equivalent of an .env file -- edit this one value when the backend
// domain changes, instead of hunting through every page.
window.BARAQ_CONFIG = {
  // Must match wherever apps/waitlist is actually deployed and reachable.
  // The backend also needs this site's own origin added to its
  // CORS_ALLOWED_ORIGINS (and CSRF_TRUSTED_ORIGINS) -- see Baraaq_back/backend/.env.example.
  API_BASE_URL: "https://api.barraq.xn--mgbaab0cxheq.tech/api/v1",

  // The About section's transparency badge. This is the ONE number to edit
  // as the team's own readiness audit changes -- update it here, not in
  // ar/index.html or en/index.html, which keep only a generic no-JS fallback
  // string. Static/manual on purpose (see README "Positioning"): this is a
  // transparency signal the team sets by hand, not live telemetry.
  READINESS_PERCENT: 72
};
