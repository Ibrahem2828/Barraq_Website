(function () {
  "use strict";

  var reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var config = window.BARAQ_CONFIG || {};
  var lang = document.documentElement.getAttribute("lang") === "en" ? "en" : "ar";

  // ---------- Header depth on scroll ----------
  var siteHeader = document.querySelector(".site-header");
  if (siteHeader) {
    var updateHeader = function () {
      siteHeader.classList.toggle("is-scrolled", window.scrollY > 12);
    };
    updateHeader();
    window.addEventListener("scroll", updateHeader, { passive: true });
  }

  // ---------- Loading screen ----------
  // Hides once the window fully loads (fonts + images), with a hard cap so a
  // slow connection never traps a visitor behind it. On a fast/cached load
  // the logo+wordmark reveal animation would otherwise get cut off after a
  // few ms, so we also enforce a minimum display time -- skipped entirely
  // under prefers-reduced-motion, where a near-instant hide is preferable.
  var loader = document.getElementById("loadingScreen");
  if (loader) {
    var loadStart = (window.performance && performance.now) ? performance.now() : Date.now();
    var minDisplay = reduceMotion ? 250 : 5200;
    var hideLoader = function () {
      if (loader.classList.contains("is-hidden")) return;
      var now = (window.performance && performance.now) ? performance.now() : Date.now();
      var wait = Math.max(0, minDisplay - (now - loadStart));
      window.setTimeout(function () {
        loader.classList.add("is-hidden");
        window.setTimeout(function () { loader.setAttribute("hidden", ""); }, 500);
      }, wait);
    };
    window.addEventListener("load", hideLoader);
    window.setTimeout(hideLoader, reduceMotion ? 500 : 7200);
  }

  // ---------- Theme toggle (persisted, defaults to system preference) ----------
  var themeBtn = document.getElementById("themeToggle");
  if (themeBtn) {
    var updateThemeLabel = function () {
      var current = document.documentElement.getAttribute("data-theme");
      var prefersDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
      var isDark = current ? current === "dark" : prefersDark;
      themeBtn.setAttribute("aria-label", lang === "ar"
        ? (isDark ? "تفعيل الوضع النهاري" : "تفعيل الوضع الليلي")
        : (isDark ? "Switch to light mode" : "Switch to dark mode"));
    };
    updateThemeLabel();
    themeBtn.addEventListener("click", function () {
      var root = document.documentElement;
      var current = root.getAttribute("data-theme");
      var prefersDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
      var effectiveDark = current ? current === "dark" : prefersDark;
      var next = effectiveDark ? "light" : "dark";
      root.setAttribute("data-theme", next);
      try { localStorage.setItem("baraq_theme", next); } catch (e) {}
      updateThemeLabel();
    });
  }

  // ---------- Readiness badge (About section) ----------
  // Static/manual by design (see README "Positioning") -- the percentage
  // lives in js/config.js as the one number to edit; this just renders the
  // localized sentence around it. The markup ships a generic no-JS fallback
  // string, so a crawler or a JS-disabled visitor still sees an honest,
  // non-numeric claim instead of nothing.
  var readinessLabel = document.getElementById("readinessLabel");
  if (readinessLabel && typeof config.READINESS_PERCENT === "number") {
    readinessLabel.textContent = lang === "ar"
      ? config.READINESS_PERCENT + "% جاهزية — نحدّثها بصدق كل أسبوعين"
      : config.READINESS_PERCENT + "% ready — updated honestly every two weeks";
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
    reveals.forEach(function (el, index) {
      // A tiny capped stagger gives grouped content a natural cadence
      // without making visitors wait for long cascades.
      el.style.setProperty("--reveal-delay", Math.min(index % 5, 4) * 55 + "ms");
      io.observe(el);
    });
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

  // ---------- "Which Barraq character are you?" quiz ----------
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

    // ---------- Quiz result: copy to share ----------
    var shareBtn = document.getElementById("quizShare");
    if (shareBtn) {
      var shareStatus = document.getElementById("quizShareStatus");
      var shareFallback = document.getElementById("quizShareFallback");
      var shareHideTimer = null;

      function shareText() {
        var name = document.getElementById("quizResultName").textContent;
        var desc = document.getElementById("quizResultDesc").textContent;
        var canonical = document.querySelector('link[rel="canonical"]');
        var url = canonical ? canonical.href : (window.location.origin + "/" + lang + "/");
        return lang === "ar"
          ? "أنا " + name + " في برّاق! " + desc + " جرّبه معي: " + url
          : "I'm " + name + " on Barraq! " + desc + " Try it with me: " + url;
      }

      function announce(text, isSuccess) {
        if (!shareStatus) return;
        shareStatus.textContent = text;
        shareStatus.classList.add("visible");
        window.clearTimeout(shareHideTimer);
        if (isSuccess) {
          shareHideTimer = window.setTimeout(function () { shareStatus.classList.remove("visible"); }, 2500);
        }
      }

      // Old-browsers / insecure-context fallback: select the text so the
      // visitor can copy it manually, and still attempt the legacy
      // execCommand copy so it "just works" wherever that's supported.
      function fallbackSelect(text) {
        if (!shareFallback) return;
        shareFallback.hidden = false;
        shareFallback.value = text;
        shareFallback.focus();
        shareFallback.select();
        var copied = false;
        try { copied = document.execCommand("copy"); } catch (e) {}
        if (copied) {
          announce(lang === "ar" ? "تم النسخ!" : "Copied!", true);
        } else {
          announce(lang === "ar" ? "النص محدد -- انسخه يدويًا" : "Text selected -- copy it manually", false);
        }
      }

      shareBtn.addEventListener("click", function () {
        var text = shareText();
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(text)
            .then(function () { announce(lang === "ar" ? "تم النسخ!" : "Copied!", true); })
            .catch(function () { fallbackSelect(text); });
        } else {
          fallbackSelect(text);
        }
      });
    }
  }

  // ---------- Waitlist counter (social proof) ----------
  var countEl = document.getElementById("waitlistCount");
  var waitlistApiUrl = config.WAITLIST_API_URL || "";
  function labelFor(n) {
    return lang === "ar"
      ? (n === 1 ? "قبلك شخص واحد في قائمة الانتظار" : "قبلك " + n + " شخصًا في قائمة الانتظار")
      : n + (n === 1 ? " person is" : " people are") + " ahead of you on the waitlist";
  }
  function renderCount(n) {
    if (!countEl) return;
    if (n <= 0) { countEl.hidden = true; return; }
    countEl.hidden = false;
    var previous = Number(countEl.dataset.count) || 0;
    countEl.dataset.count = String(n);
    if (reduceMotion || previous === n) {
      countEl.textContent = labelFor(n);
      return;
    }
    var start = performance.now();
    var duration = 700;
    function tick(now) {
      var progress = Math.min(1, (now - start) / duration);
      var eased = 1 - Math.pow(1 - progress, 3);
      var current = Math.round(previous + (n - previous) * eased);
      countEl.textContent = labelFor(current);
      if (progress < 1) requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }
  function apiUrl(action) {
    return waitlistApiUrl + (waitlistApiUrl.indexOf("?") === -1 ? "?" : "&") + "action=" + encodeURIComponent(action);
  }
  if (countEl && waitlistApiUrl) {
    fetch(apiUrl("count"), { headers: { Accept: "application/json" } })
      .then(function (r) { return r.ok ? r.json() : Promise.reject(r); })
      .then(function (data) { if (!data.ok) return Promise.reject(data); renderCount(Number(data.count) || 0); })
      .catch(function () { countEl.hidden = true; });
  }

  // ---------- Waitlist form ----------
  var form = document.getElementById("waitlistForm");
  if (form) {
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var nameInput = document.getElementById("waitlistName");
      var emailInput = document.getElementById("waitlistEmail");
      var honeypot = document.getElementById("waitlistCompany");
      var submitBtn = form.querySelector("button[type=submit]");
      var errorEl = document.getElementById("waitlistError");
      if (errorEl) errorEl.hidden = true;

      if (!waitlistApiUrl) {
        // Never show a fake success when storage is not configured.
        if (errorEl) {
          errorEl.textContent = lang === "ar"
            ? "قائمة الانتظار غير متاحة مؤقتًا. راسلنا عبر البريد وسنضيفك يدويًا."
            : "The waitlist is temporarily unavailable. Email us and we'll add you manually.";
          errorEl.hidden = false;
        }
        return;
      }

      if (submitBtn) submitBtn.disabled = true;
      fetch(apiUrl("join"), {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8", Accept: "application/json" },
        body: new URLSearchParams({
          email: emailInput.value.trim(), full_name: nameInput ? nameInput.value.trim() : "",
          locale: lang, company: honeypot ? honeypot.value : ""
        }).toString()
      })
        .then(function (r) {
          if (r.ok) return r.json().then(function (data) { return data.ok ? data : Promise.reject(data); });
          return r.json().then(function (body) { return Promise.reject(body); }).catch(function () { return Promise.reject({}); });
        })
        .then(function (data) {
          var successEl = document.getElementById("waitlistSuccess");
          if (successEl) {
            successEl.textContent = data.created
              ? (lang === "ar" ? "تم تسجيلك بنجاح. أنت رقم " + data.count + " في قائمة الانتظار." : "You're in! You're number " + data.count + " on the waitlist.")
              : (lang === "ar" ? "بريدك مسجّل بالفعل في قائمة الانتظار." : "This email is already on the waitlist.");
            successEl.classList.add("active");
          }
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

