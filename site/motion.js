// Motion layer: Lenis smooth scroll + GSAP animations.
// Loads after the main scripts. If anything here fails, the site still works exactly as before.
(function () {
  if (!window.gsap) return;
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));

  // ---------- styles for the effects ----------
  const css = document.createElement("style");
  css.textContent = `
  html.lenis,html.lenis body{height:auto}
  .lenis.lenis-stopped{overflow:clip}
  .lenis [data-lenis-prevent]{overscroll-behavior:contain}
  #fxBg{position:fixed;inset:0;z-index:-1;pointer-events:none;overflow:hidden}
  #fxBg .blob{position:absolute;width:60vmax;height:60vmax;border-radius:50%;filter:blur(90px);opacity:.10;will-change:transform}
  #fxBg .b1{background:#0ff796;left:-20vmax;top:-25vmax}
  #fxBg .b2{background:#2ee6ff;right:-25vmax;top:30vh;opacity:.07}
  #fxBg .b3{background:#ffe000;left:20vw;bottom:-40vmax;opacity:.04}
  #fxBg .grid{position:absolute;inset:-40px;background:
     linear-gradient(rgba(15,247,150,.045) 1px,transparent 1px) 0 0/44px 44px,
     linear-gradient(90deg,rgba(15,247,150,.045) 1px,transparent 1px) 0 0/44px 44px;
     -webkit-mask-image:radial-gradient(ellipse 70% 55% at 50% 20%,#000 20%,transparent 75%);
             mask-image:radial-gradient(ellipse 70% 55% at 50% 20%,#000 20%,transparent 75%)}
  #fxFlash{position:fixed;inset:0;z-index:45;pointer-events:none;opacity:0;
     background:radial-gradient(circle at 50% 40%,rgba(255,224,0,.35),rgba(15,247,150,.12) 45%,transparent 70%)}
  #spinAll{position:relative;overflow:hidden}
  #spinAll .shine{position:absolute;top:0;bottom:0;width:40%;left:-60%;pointer-events:none;
     background:linear-gradient(100deg,transparent,rgba(255,255,255,.55),transparent);transform:skewX(-20deg)}
  `;
  document.head.appendChild(css);

  // ---------- animated background (slow drifting glow + faint grid) ----------
  const bg = document.createElement("div");
  bg.id = "fxBg";
  bg.setAttribute("aria-hidden", "true");
  bg.innerHTML = '<div class="grid"></div><div class="blob b1"></div><div class="blob b2"></div><div class="blob b3"></div>';
  document.body.prepend(bg);
  if (!reduce) {
    gsap.to("#fxBg .b1", { x: "18vw", y: "12vh", duration: 22, ease: "sine.inOut", yoyo: true, repeat: -1 });
    gsap.to("#fxBg .b2", { x: "-22vw", y: "-14vh", duration: 26, ease: "sine.inOut", yoyo: true, repeat: -1 });
    gsap.to("#fxBg .b3", { x: "-10vw", y: "-8vh", duration: 30, ease: "sine.inOut", yoyo: true, repeat: -1 });
    gsap.to("#fxBg .grid", { backgroundPosition: "0 44px, 44px 0", duration: 8, ease: "none", repeat: -1 });
  }

  if (reduce) return; // everything below is movement, so skip it for people who asked for less motion

  // ---------- Lenis smooth scrolling ----------
  let lenis = null;
  if (window.Lenis) {
    lenis = new Lenis({
      lerp: 0.11,
      wheelMultiplier: 1,
      autoRaf: false,
      allowNestedScroll: true,
      // let these handle the mouse wheel themselves: map zoom, pop-ups, scroll boxes
      prevent: (node) => !!(node.closest && node.closest(".mp-stage,.mp-layers,.dip,.bs-back,.tablewrap,[data-lenis-prevent]")),
    });
    window.lenis = lenis;
    gsap.ticker.add((t) => lenis.raf(t * 1000));
    gsap.ticker.lagSmoothing(0);
    // aim trainer: while the mouse is captured, the page must not scroll
    document.addEventListener("pointerlockchange", () => (document.pointerLockElement ? lenis.stop() : lenis.start()));
  }

  if (window.ScrollTrigger) {
    gsap.registerPlugin(ScrollTrigger);
    if (lenis) lenis.on("scroll", ScrollTrigger.update);
  }

  // ---------- intro on page load ----------
  const hl = $("header h1 .h");
  const intro = gsap.timeline({ defaults: { ease: "power3.out" } }).timeScale(1.5); // quick, so people can spin straight away
  intro
    .from("header h1", { y: 24, opacity: 0, duration: 0.7 })
    .from("header .tagline", { y: 10, opacity: 0, letterSpacing: ".6em", duration: 0.7 }, "-=0.45")
    .from(["header .data", "header .rotbar", "header .intro"], { y: 10, opacity: 0, duration: 0.5, stagger: 0.08 }, "-=0.45")
    .from(".sitetabs button", { y: 14, opacity: 0, duration: 0.45, stagger: 0.06 }, "-=0.35")
    .from(".toplinks > a", { y: -12, opacity: 0, duration: 0.45, stagger: 0.08 }, "<")
    .from(".cab", { y: 30, opacity: 0, scale: 0.97, duration: 0.8, clearProps: "transform,opacity" }, "-=0.3")
    .from(".cab-line", { scaleX: 0, duration: 0.7, ease: "expo.out", clearProps: "transform" }, "-=0.45")
    .from("#spinAll, #dipBtn", { scale: 0.8, opacity: 0, duration: 0.45, stagger: 0.08, ease: "back.out(2)", clearProps: "transform,opacity" }, "-=0.5");

  // "decrypt" effect on the green part of the title
  if (hl) {
    const final = hl.textContent, glyphs = "ABCDEFGHJKLMNPQRSTUVWXYZ0123456789#%&*<>/";
    hl.closest("h1").setAttribute("aria-label", hl.closest("h1").textContent);
    const o = { p: 0 };
    gsap.to(o, {
      p: 1, duration: 1.1, delay: 0.15, ease: "power1.inOut",
      onUpdate() {
        const n = Math.floor(o.p * final.length);
        hl.textContent = final.slice(0, n) + final.slice(n).replace(/\S/g, () => glyphs[(Math.random() * glyphs.length) | 0]);
      },
      onComplete() { hl.textContent = final; },
    });
  }

  // ---------- reveal sections as you scroll down ----------
  function reveal(targets, vars = {}) {
    if (!window.ScrollTrigger) return;
    $$(targets).forEach((el) => {
      gsap.from(el, Object.assign({
        y: 36, opacity: 0, duration: 0.8, ease: "power3.out", clearProps: "transform,opacity",
        scrollTrigger: { trigger: el, start: "top 92%", once: true },
      }, vars));
    });
  }
  reveal(".quicktog", { y: 18 });
  if (window.ScrollTrigger && $(".dice")) {
    gsap.from(".dice .die", {
      y: 50, opacity: 0, rotate: (i) => (i - 1) * 4, duration: 0.8, stagger: 0.12, ease: "back.out(1.4)", clearProps: "transform,opacity",
      scrollTrigger: { trigger: ".dice", start: "top 88%", once: true },
    });
  }
  reveal("#codes .codes-head");
  reveal(".botcta", { scale: 0.95 });
  reveal("#settings", { y: 20 });
  reveal(".about > *", { y: 24, duration: 0.6 });
  reveal("footer > span", { y: 14, duration: 0.5 });

  // door code cards: pop in one by one when they load
  const grid = $("#codesGrid");
  if (grid) {
    const pop = () => {
      const cards = Array.from(grid.children).filter((c) => !c.dataset.fx);
      if (!cards.length) return;
      cards.forEach((c) => (c.dataset.fx = 1));
      gsap.from(cards, { y: 20, opacity: 0, scale: 0.94, duration: 0.5, stagger: 0.06, ease: "back.out(1.6)", clearProps: "transform,opacity" });
    };
    new MutationObserver(pop).observe(grid, { childList: true });
    pop();
  }

  // ---------- tab switching: slide the new tab in ----------
  $$(".sitetabs button").forEach((b) =>
    b.addEventListener("click", () => {
      requestAnimationFrame(() => {
        const pane = $$(".tabpane").find((p) => !p.hidden);
        if (pane) gsap.fromTo(pane, { y: 18, opacity: 0 }, { y: 0, opacity: 1, duration: 0.45, ease: "power2.out", clearProps: "transform,opacity" });
        if (window.ScrollTrigger) ScrollTrigger.refresh();
      });
    })
  );

  // ---------- Spin all button: shine sweep + press ----------
  const spinBtn = $("#spinAll");
  if (spinBtn) {
    const sh = document.createElement("span");
    sh.className = "shine";
    spinBtn.appendChild(sh);
    gsap.to(sh, { left: "130%", duration: 0.9, ease: "power2.inOut", repeat: -1, repeatDelay: 3.2 });
    spinBtn.addEventListener("pointerdown", () => gsap.to(spinBtn, { scale: 0.92, duration: 0.1 }));
    const up = () => gsap.to(spinBtn, { scale: 1, duration: 0.5, ease: "elastic.out(1.1,0.4)", clearProps: "transform" });
    spinBtn.addEventListener("pointerup", up);
    spinBtn.addEventListener("pointerleave", up);
  }

  // ---------- results: kick on every finish, shake + flash on a BIG WIN ----------
  const reels = $("#reels"), cab = $(".cab");
  if (reels && cab) {
    const flash = document.createElement("div");
    flash.id = "fxFlash";
    document.body.appendChild(flash);
    new MutationObserver(() => {
      if (reels.classList.contains("bigwin")) {
        gsap.timeline()
          .to(flash, { opacity: 1, duration: 0.08 })
          .to(flash, { opacity: 0, duration: 0.9, ease: "power2.out" })
          .fromTo(cab, { x: 0 }, { keyframes: { x: [-9, 8, -6, 5, -3, 2, 0] }, duration: 0.5, ease: "none", clearProps: "transform" }, 0);
      } else if (reels.classList.contains("win")) {
        gsap.fromTo(cab, { scale: 1 }, { keyframes: { scale: [1.012, 1] }, duration: 0.35, ease: "power2.out", clearProps: "transform" });
      }
    }).observe(reels, { attributes: true, attributeFilter: ["class"] });
  }
})();
