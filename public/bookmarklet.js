/**
 * Readflow bookmarklet kaynağı.
 *
 * Açık sekmenin HTML'ini Readflow'a gönderir; sunucu sayfayı indirmez.
 * Bot koruması, paywall, çerez duvarı ve JS ile üretilen sayfalar böylece
 * kullanıcının kendi oturumundan geçer.
 *
 * Ayarlar ekranı bu dosyayı okuyup tek satırlık `javascript:` bağlantısına
 * çevirir — kullanıcı yer imleri çubuğuna sürükler.
 */
(function () {
  var origin = "__READFLOW_ORIGIN__";
  var note = document.createElement("div");
  note.style.cssText =
    "position:fixed;z-index:2147483647;right:16px;bottom:16px;padding:10px 14px;border-radius:10px;" +
    "font:14px/1.4 -apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;color:#fff;background:#1c1917;" +
    "box-shadow:0 8px 30px rgba(0,0,0,.28)";
  note.textContent = "Readflow'a gönderiliyor…";
  document.body.appendChild(note);

  var done = function (text, ok) {
    note.textContent = text;
    note.style.background = ok ? "#166534" : "#991b1b";
    setTimeout(function () {
      note.remove();
    }, ok ? 2000 : 5000);
  };

  fetch(origin + "/api/documents", {
    method: "POST",
    headers: { "content-type": "application/json" },
    credentials: "include",
    body: JSON.stringify({
      html: document.documentElement.outerHTML,
      sourceUrl: location.href,
    }),
  })
    .then(function (response) {
      return response.json().then(function (body) {
        return { ok: response.ok, body: body };
      });
    })
    .then(function (result) {
      if (!result.ok || !result.body.id) {
        done("Readflow: " + (result.body.error || "eklenemedi"), false);
        return;
      }
      done("Readflow'a eklendi ✓", true);
    })
    .catch(function () {
      done("Readflow'a ulaşılamadı", false);
    });
})();
