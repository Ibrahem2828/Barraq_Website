(function () {
  "use strict";

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

  // ---------- "Which Baraq character are you?" quiz ----------
  var quizBox = document.getElementById("quizBox");
  if (quizBox) {
    var scores = { fahes: 0, khota: 0, rasheed: 0, sada: 0, kholasa: 0 };
    var qIndex = 1;
    var TOTAL_Q = 3;
    var progressDots = [document.getElementById("qp1"), document.getElementById("qp2"), document.getElementById("qp3")];
    // charData is defined inline per-page (it needs the page's own AR/EN text
    // and asset base path), see the <script> block near the end of each page.
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

  // ---------- Waitlist form (demo only, no backend wired up yet) ----------
  var form = document.getElementById("waitlistForm");
  if (form) {
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      document.getElementById("waitlistSuccess").classList.add("active");
      form.reset();
    });
  }
})();
