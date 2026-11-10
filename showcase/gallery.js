document.querySelectorAll("[data-gallery]").forEach(gallery => {
  const slides = [...gallery.querySelectorAll("[data-gallery-label]")];
  const controls = gallery.querySelector("[data-gallery-controls]");
  const status = gallery.querySelector("[data-gallery-status]");
  let index = 0;

  function show(step) {
    index = (index + step + slides.length) % slides.length;
    slides.forEach((slide, position) => { slide.hidden = position !== index; });
    status.textContent = `${index + 1} / ${slides.length} · ${slides[index].dataset.galleryLabel}`;
  }

  show(0);
  gallery.dataset.enhanced = "";
  controls.hidden = false;

  controls.querySelectorAll("[data-gallery-step]").forEach(button => {
    button.addEventListener("click", () => show(Number(button.dataset.galleryStep)));
  });
  controls.addEventListener("keydown", event => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    show(event.key === "ArrowLeft" ? -1 : 1);
  });
});
