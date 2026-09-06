// Public Apps Script endpoint. It can create a waitlist record or return the
// aggregate count; it never exposes names or email addresses.
window.BARAQ_CONFIG = {
  WAITLIST_API_URL: "https://script.google.com/macros/s/AKfycbw28UNuKJRfS3LGKJKgaAGy-5qj1bxSL_DvYSEQLwwnWQhRi-3YoQiEYPBKdF0TOxm1/exec",

  // The About section's transparency badge. This is the ONE number to edit
  // as the team's own readiness audit changes -- update it here, not in
  // ar/index.html or en/index.html, which keep only a generic no-JS fallback
  // string. Static/manual on purpose (see README "Positioning"): this is a
  // transparency signal the team sets by hand, not live telemetry.
  READINESS_PERCENT: 72
};
