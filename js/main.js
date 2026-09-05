(function () {
  "use strict";

  var reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var config = window.BARAQ_CONFIG || {};
  var lang = document.documentElement.getAttribute("lang") === "en" ? "en" : "ar";

  // ---------- Loading screen ----------
  // Hides once the window fully loads (fonts + images), with a hard cap so a
  // slow connection never traps a visitor behind it.
  var loader = document.getElementById("loadingScreen");
  if (loader) {
    var hideLoader = function () {
      if (loader.classList.contains("is-hidden")) return;
      loader.classList.add("is-hidden");
      window.setTimeout(function () { loader.setAttribute("hidden", ""); }, 500);
    };
    window.addEventListener("load", hideLoader);
    window.setTimeout(hideLoader, 2500);
  }

  // ---------- Theme toggle (persisted, defaults to system preference) ----------
  var themeBtn = document.getElementById("themeToggle");
  if (themeBtn) {
    themeBtn.addEventListener("click", function () {
      var root = document.documentElement;
      var current = root.getAttribute("data-theme");
      var prefersDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
      var effectiveDark = current ? current === "dark" : prefersDark;
      var next = effectiveDark ? "light" : "dark";
      root.setAttribute("data-theme", next);
      try { localStorage.setItem("baraq_theme", next); } catch (e) {}
    });
  }

  // ---------- Scroll reveal ----------
  var reveals = document.querySelectorAll(".reveal");
  if ("IntersectionObserver" in window) {
    var io = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            entry.target.classList.add("in-view");
            io.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.15, rootMargin: "0px 0px -60px 0px" }
    );
    reveals.forEach(function (el) { io.observe(el); });
  } else {
    reveals.forEach(function (el) { el.classList.add("in-view"); });
  }

  // ---------- Pseudo-3D tilt ----------
  // No 3D models involved -- this is a classic CSS-only illusion: the
  // pointer position maps to a small rotateX/rotateY on the card, plus a
  // matching highlight/shadow shift, so a flat character render reads as if
  // it has real depth. Skipped entirely under prefers-reduced-motion, and
  // pointer-only (no effect from keyboard focus, which shouldn't move layout).
  function applyTilt(el, maxDeg) {
    if (reduceMotion) return;
    var raf = null;
    el.addEventListener("pointermove", function (e) {
      if (raf) return;
      raf = requestAnimationFrame(function () {
        var rect = el.getBoundingClientRect();
        var px = (e.clientX - rect.left) / rect.width - 0.5;
        var py = (e.clientY - rect.top) / rect.height - 0.5;
        el.style.setProperty("--tilt-x", (-py * maxDeg).toFixed(2) + "deg");
        el.style.setProperty("--tilt-y", (px * maxDeg).toFixed(2) + "deg");
        el.style.setProperty("--shine-x", (50 + px * 60).toFixed(1) + "%");
        el.style.setProperty("--shine-y", (50 + py * 60).toFixed(1) + "%");
        raf = null;
      });
    });
    el.addEventListener("pointerleave", function () {
      el.style.setProperty("--tilt-x", "0deg");
      el.style.setProperty("--tilt-y", "0deg");
    });
  }
  document.querySelectorAll(".char-card, .orb").forEach(function (el) {
    applyTilt(el, el.classList.contains("orb") ? 10 : 14);
  });

  // ---------- "Which Baraq character are you?" quiz ----------
  var quizBox = document.getElementById("quizBox");
  if (quizBox) {
    var scores = { fahes: 0, khota: 0, rasheed: 0, sada: 0, kholasa: 0 };
    var qIndex = 1;
    var TOTAL_Q = 3;
    var progressDots = [document.getElementById("qp1"), document.getElementById("qp2"), document.getElementById("qp3")];
    var charData = window.BARAQ_QUIZ_DATA || {};

    function showQuestion(n) {
      document.querySelectorAll(".quiz-q").forEach(function (q) { q.classList.remove("active"); });
      var el = document.querySelector('.quiz-q[data-q="' + n + '"]');
      if (el) el.classList.add("active");
      progressDots.forEach(function (dot, i) { if (dot) dot.classList.toggle("done", i < n); });
    }

    document.querySelectorAll(".quiz-opt").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var c = btn.getAttribute("data-c");
        scores[c] = (scores[c] || 0) + 1;
        if (qIndex < TOTAL_Q) {
          qIndex++;
          showQuestion(qIndex);
        } else {
          var winner = Object.keys(scores).reduce(function (a, b) { return scores[b] > scores[a] ? b : a; });
          var data = charData[winner];
          if (data) {
            document.getElementById("quizResultImg").src = data.img;
            document.getElementById("quizResultImg").alt = data.name;
            document.getElementById("quizResultName").textContent = data.name;
            document.getElementById("quizResultDesc").textContent = data.desc;
          }
          document.querySelectorAll(".quiz-q").forEach(function (q) { q.classList.remove("active"); });
          document.getElementById("quizResult").classList.add("active");
          progressDots.forEach(function (dot) { if (dot) dot.classList.add("done"); });
        }
      });
    });

    var restartBtn = document.getElementById("quizRestart");
    if (restartBtn) {
      restartBtn.addEventListener("click", function () {
        scores = { fahes: 0, khota: 0, rasheed: 0, sada: 0, kholasa: 0 };
        qIndex = 1;
        document.getElementById("quizResult").classList.remove("active");
        showQuestion(1);
      });
    }
  }

  // ---------- Waitlist counter (social proof) ----------
  var countEl = document.getElementById("waitlistCount");
  function renderCount(n) {
    if (!countEl) return;
    if (n > 0) {
      var label = lang === "ar"
        ? (n === 1 ? "شخص واحد بالفعل بالقائمة" : n + " شخصاً بالفعل بالقائمة")
        : n + (n === 1 ? " person" : " people") + " already on the list";
      countEl.textContent = label;
      countEl.hidden = false;
    } else {
      countEl.hidden = true;
    }
  }
  if (countEl && config.API_BASE_URL) {
    fetch(config.API_BASE_URL + "/waitlist/count/", { headers: { Accept: "application/json" } })
      .then(function (r) { return r.ok ? r.json() : Promise.reject(r); })
      .then(function (data) { renderCount(Number(data.count) || 0); })
      .catch(function () { countEl.hidden = true; });
  }

  // ---------- Waitlist form ----------
  var form = document.getElementById("waitlistForm");
  if (form) {
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var emailInput = document.getElementById("waitlistEmail");
      var honeypot = document.getElementById("waitlistCompany");
      var submitBtn = form.querySelector("button[type=submit]");
      var errorEl = document.getElementById("waitlistError");
      if (errorEl) errorEl.hidden = true;

      if (!config.API_BASE_URL) {
        // No backend configured at all -- fall back to the old local-only
        // demo behavior instead of silently failing.
        document.getElementById("waitlistSuccess").classList.add("active");
        form.reset();
        return;
      }

      if (submitBtn) submitBtn.disabled = true;
      fetch(config.API_BASE_URL + "/waitlist/", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({
          email: emailInput.value.trim(),
          locale: lang,
          company: honeypot ? honeypot.value : ""
        })
      })
        .then(function (r) {
          if (r.ok) return r.json();
          return r.json().then(function (body) { return Promise.reject(body); }).catch(function () { return Promise.reject({}); });
        })
        .then(function (data) {
          document.getElementById("waitlistSuccess").classList.add("active");
          form.reset();
          if (typeof data.count === "number") renderCount(data.count);
        })
        .catch(function () {
          if (errorEl) {
            errorEl.textContent = lang === "ar"
              ? "تعذّر إرسال طلبك الآن، حاول مرة أخرى بعد قليل."
              : "Couldn't submit that right now -- please try again shortly.";
            errorEl.hidden = false;
          }
        })
        .finally(function () {
          if (submitBtn) submitBtn.disabled = false;
        });
    });
  }
})();
