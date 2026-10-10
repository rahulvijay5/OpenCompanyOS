type Appearance = "light" | "dark";

type Point = { x: number; y: number };

type Rect = {
  left: number;
  top: number;
  right: number;
  bottom: number;
};

let playing = false;

export function playThemeReveal(
  next: Appearance,
  origin: Point,
): Promise<"done" | "fallback" | "busy"> {
  if (playing) {
    return Promise.resolve("busy");
  }
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    return Promise.resolve("fallback");
  }

  const kicker = document.querySelector(".hero .kicker");
  const title = document.querySelector(".hero h1");
  const site = document.querySelector(".site");
  if (!(kicker instanceof HTMLElement) || !(title instanceof HTMLElement) || !(site instanceof HTMLElement)) {
    return Promise.resolve("fallback");
  }

  const kickerTop = kicker.getBoundingClientRect().top;
  if (kickerTop < 96 || title.getBoundingClientRect().bottom > window.innerHeight - 32) {
    window.scrollTo(0, Math.max(0, window.scrollY + kickerTop - 150));
  }

  playing = true;
  const previousOverflow = document.body.style.overflow;
  document.body.style.overflow = "hidden";
  document.documentElement.classList.add("theme-selecting");

  const pad = 16;
  const kickerBox = kicker.getBoundingClientRect();
  const titleBox = title.getBoundingClientRect();
  const target: Rect = {
    left: Math.min(kickerBox.left, titleBox.left) - pad,
    top: kickerBox.top - pad,
    right: Math.max(kickerBox.right, titleBox.right) + pad,
    bottom: titleBox.bottom + pad,
  };

  const overlay = document.createElement("div");
  overlay.className = "theme-reveal";
  overlay.dataset.reveal = next;
  overlay.setAttribute("aria-hidden", "true");

  const clone = site.cloneNode(true);
  if (clone instanceof HTMLElement) {
    clone.querySelectorAll("[id]").forEach((node) => node.removeAttribute("id"));
    const siteBox = site.getBoundingClientRect();
    clone.style.position = "fixed";
    clone.style.top = `${siteBox.top}px`;
    clone.style.left = `${siteBox.left}px`;
    clone.style.width = `${siteBox.width}px`;
    clone.style.height = `${siteBox.height}px`;
    clone.style.margin = "0";
    clone.style.pointerEvents = "none";
    overlay.appendChild(clone);
  }

  const marquee = document.createElement("div");
  marquee.className = "theme-marquee";
  marquee.innerHTML = `
    <div class="theme-corner" data-at="nw"></div>
    <div class="theme-corner" data-at="ne"></div>
    <div class="theme-corner" data-at="sw"></div>
    <div class="theme-corner" data-at="se"></div>
  `;

  const telemetry = document.createElement("div");
  telemetry.className = "theme-telemetry";
  telemetry.textContent = "AGENT · SELECT";

  const prompt = document.createElement("div");
  prompt.className = "theme-fullscreen-prompt";
  prompt.textContent = "Fullscreen?";

  const cursor = document.createElement("div");
  cursor.className = "theme-cursor";
  cursor.innerHTML =
    '<svg viewBox="0 0 16 20" width="16" height="20" aria-hidden="true"><path d="M1 1 L1 15.2 L4.8 11.6 L7.7 18.2 L10 17.2 L7 10.6 L12.4 10.4 Z" fill="#1a1916" stroke="#f6f4ef" stroke-width="1" stroke-linejoin="round"/></svg>';

  const particles = document.createElement("canvas");
  particles.className = "theme-particles";
  const ratio = Math.min(2, window.devicePixelRatio || 1);
  particles.width = Math.round(window.innerWidth * ratio);
  particles.height = Math.round(window.innerHeight * ratio);
  const context = particles.getContext("2d");

  document.body.append(overlay, particles, marquee, telemetry, prompt, cursor);

  const pointRect = (point: Point): Rect => ({
    left: point.x,
    top: point.y,
    right: point.x,
    bottom: point.y,
  });

  const lerpRect = (from: Rect, to: Rect, t: number): Rect => ({
    left: from.left + (to.left - from.left) * t,
    top: from.top + (to.top - from.top) * t,
    right: from.right + (to.right - from.right) * t,
    bottom: from.bottom + (to.bottom - from.bottom) * t,
  });

  let selection = pointRect(origin);
  let fieldOpacity = 0;
  let phase: "select" | "commit" | "return" = "select";
  const samples: Point[] = [];

  const placeCursor = (cursorAt: Point) => {
    const last = samples[samples.length - 1];
    if (!last || Math.hypot(cursorAt.x - last.x, cursorAt.y - last.y) > 12) {
      samples.push({ x: cursorAt.x, y: cursorAt.y });
      if (samples.length > 8) {
        samples.shift();
      }
    }
    cursor.style.left = `${cursorAt.x}px`;
    cursor.style.top = `${cursorAt.y}px`;
  };

  const paint = (rect: Rect, cursorAt: Point) => {
    selection = rect;
    const top = rect.top;
    const left = rect.left;
    const right = window.innerWidth - rect.right;
    const bottom = window.innerHeight - rect.bottom;
    const width = Math.max(0, rect.right - rect.left);
    const height = Math.max(0, rect.bottom - rect.top);
    overlay.style.clipPath = `inset(${top}px ${right}px ${bottom}px ${left}px)`;
    marquee.style.left = `${rect.left}px`;
    marquee.style.top = `${rect.top}px`;
    marquee.style.width = `${width}px`;
    marquee.style.height = `${height}px`;
    marquee.style.opacity = width > 8 ? "1" : "0";
    if (phase === "select") {
      telemetry.style.left = `${rect.left}px`;
      telemetry.style.top = `${rect.top - 22}px`;
      telemetry.style.opacity = width > 48 ? "1" : "0";
      telemetry.textContent = `AGENT · SELECT   ${Math.round(width)} × ${Math.round(height)}`;
    }
    placeCursor(cursorAt);
    particles.style.opacity = "1";
  };

  type Mote = { x: number; y: number; vx: number; vy: number; radius: number; amber: boolean };
  const spawn = (): Mote => ({
    x: Math.random() * window.innerWidth,
    y: Math.random() * window.innerHeight,
    vx: (Math.random() - 0.5) * 0.28,
    vy: -0.12 - Math.random() * 0.38,
    radius: Math.random() < 0.12 ? 1.7 : 0.6 + Math.random() * 0.7,
    amber: Math.random() < 0.58,
  });
  const motes = Array.from({ length: 108 }, spawn);
  const ink = next === "dark" ? "rgba(26, 25, 22, 0.5)" : "rgba(244, 241, 234, 0.62)";
  const amber = "rgba(224, 138, 60, 0.9)";
  let alive = true;
  let particleFrame = 0;

  const drawMotes = () => {
    if (!alive) {
      return;
    }
    particleFrame = requestAnimationFrame(drawMotes);
    if (!context) {
      return;
    }
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, window.innerWidth, window.innerHeight);
    for (const mote of motes) {
      mote.x += mote.vx;
      mote.y += mote.vy;
      if (mote.y < -6) {
        mote.y = window.innerHeight + 4;
        mote.x = Math.random() * window.innerWidth;
      }
      if (mote.x < -6) {
        mote.x = window.innerWidth + 4;
      }
      if (mote.x > window.innerWidth + 6) {
        mote.x = -4;
      }
      const inside =
        mote.x > selection.left &&
        mote.x < selection.right &&
        mote.y > selection.top &&
        mote.y < selection.bottom;
      if (inside || fieldOpacity <= 0.01) {
        continue;
      }
      context.globalAlpha = fieldOpacity;
      context.fillStyle = mote.amber ? amber : ink;
      context.beginPath();
      context.arc(mote.x, mote.y, mote.radius, 0, Math.PI * 2);
      context.fill();
    }
    const trail = samples.slice(0, -1);
    trail.forEach((sample, index) => {
      context.globalAlpha = ((index + 1) / trail.length) * 0.8;
      context.fillStyle = amber;
      context.fillRect(sample.x - 1.6, sample.y - 1.6, 3.2, 3.2);
    });
    context.globalAlpha = 1;
  };
  particleFrame = requestAnimationFrame(drawMotes);

  const start = pointRect({ x: target.left, y: target.top });
  paint(pointRect(origin), origin);

  const motion = (duration: number, draw: (t: number) => void) =>
    new Promise<void>((resolve) => {
      const started = performance.now();
      const frame = (now: number) => {
        const t = Math.min(1, (now - started) / duration);
        const eased = t < 0.5 ? 2 * t * t : 1 - ((-2 * t + 2) ** 2) / 2;
        draw(eased);
        if (t < 1) {
          requestAnimationFrame(frame);
        } else {
          resolve();
        }
      };
      requestAnimationFrame(frame);
    });

  const cleanup = () => {
    alive = false;
    cancelAnimationFrame(particleFrame);
    overlay.remove();
    particles.remove();
    marquee.remove();
    telemetry.remove();
    prompt.remove();
    cursor.remove();
    document.body.style.overflow = previousOverflow;
    document.documentElement.classList.remove("theme-selecting");
    playing = false;
  };

  return (async (): Promise<"done" | "fallback" | "busy"> => {
    try {
      await motion(560, (t) => {
        paint(pointRect(origin), {
          x: origin.x + (target.left - origin.x) * t,
          y: origin.y + (target.top - origin.y) * t,
        });
      });
      await motion(1500, (t) => {
        fieldOpacity = t;
        const rect = lerpRect(start, target, t);
        paint(rect, { x: rect.right, y: rect.bottom });
      });

      const promptX = target.right - 10;
      const promptY = target.bottom - 10;
      prompt.style.left = `${promptX}px`;
      prompt.style.top = `${promptY}px`;
      prompt.dataset.visible = "true";
      await motion(520, () => {
        fieldOpacity = 1;
        paint(target, { x: target.right, y: target.bottom });
      });

      const promptBox = prompt.getBoundingClientRect();
      const clickAt = {
        x: promptBox.left + promptBox.width * 0.45,
        y: promptBox.top + promptBox.height * 0.55,
      };
      await motion(640, (t) => {
        paint(target, {
          x: target.right + (clickAt.x - target.right) * t,
          y: target.bottom + (clickAt.y - target.bottom) * t,
        });
      });
      cursor.dataset.pressed = "true";
      prompt.dataset.pressed = "true";
      phase = "commit";
      telemetry.textContent = `commit theme=${next}`;
      telemetry.style.opacity = "1";
      await motion(280, () => {
        paint(target, clickAt);
      });

      const fullscreen: Rect = {
        left: 0,
        top: 0,
        right: window.innerWidth,
        bottom: window.innerHeight,
      };
      prompt.dataset.visible = "false";
      await motion(980, (t) => {
        fieldOpacity = 1 - t;
        const rect = lerpRect(target, fullscreen, t);
        paint(rect, clickAt);
      });
      document.documentElement.setAttribute("data-theme", next);
      try {
        localStorage.setItem("ocos-theme", next);
      } catch {
        // The in-memory theme still applies for this visit.
      }
      overlay.remove();
      marquee.remove();
      prompt.remove();
      phase = "return";
      cursor.dataset.pressed = "false";
      await motion(720, (t) => {
        fieldOpacity = 0;
        placeCursor({
          x: clickAt.x + (origin.x - clickAt.x) * t,
          y: clickAt.y + (origin.y - clickAt.y) * t,
        });
        telemetry.style.opacity = String(Math.max(0, 1 - t * 1.35));
      });
      return "done";
    } finally {
      cleanup();
    }
  })();
}
