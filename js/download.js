// Copy buttons on the download page. Everything else on the page works without JavaScript.
(function () {
  "use strict";
  var buttons = document.querySelectorAll("[data-copy]");
  Array.prototype.forEach.call(buttons, function (button) {
    var label = button.textContent;
    button.addEventListener("click", function () {
      var target = document.getElementById(button.getAttribute("data-copy"));
      if (!target) return;
      var text = target.textContent.trim();
      function done() {
        button.textContent = button.getAttribute("data-copied") || "OK";
        setTimeout(function () { button.textContent = label; }, 1800);
      }
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(done, function () { selectText(target); });
      } else {
        selectText(target);
      }
    });
  });
  // Fallback: select the value so the visitor can copy it by hand.
  function selectText(node) {
    var range = document.createRange();
    range.selectNodeContents(node);
    var selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  }
})();
