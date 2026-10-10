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

  const prompt = document.createElement("div");
  prompt.className = "theme-fullscreen-prompt";
  prompt.textContent = "Fullscreen?";

  const cursor = document.createElement("div");
  cursor.className = "theme-cursor";
  cursor.innerHTML =
    '<svg viewBox="0 0 16 20" width="16" height="20" aria-hidden="true"><path d="M1 1 L1 15.2 L4.8 11.6 L7.7 18.2 L10 17.2 L7 10.6 L12.4 10.4 Z" fill="#1a1916" stroke="#f6f4ef" stroke-width="1" stroke-linejoin="round"/></svg>';

  document.body.append(overlay, marquee, prompt, cursor);

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

  const paint = (rect: Rect, cursorAt: Point) => {
    const top = rect.top;
    const left = rect.left;
    const right = window.innerWidth - rect.right;
    const bottom = window.innerHeight - rect.bottom;
    overlay.style.clipPath = `inset(${top}px ${right}px ${bottom}px ${left}px)`;
    marquee.style.left = `${rect.left}px`;
    marquee.style.top = `${rect.top}px`;
    marquee.style.width = `${Math.max(0, rect.right - rect.left)}px`;
    marquee.style.height = `${Math.max(0, rect.bottom - rect.top)}px`;
    marquee.style.opacity = rect.right - rect.left > 8 ? "1" : "0";
    cursor.style.left = `${cursorAt.x}px`;
    cursor.style.top = `${cursorAt.y}px`;
  };

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
    overlay.remove();
    marquee.remove();
    prompt.remove();
    cursor.remove();
    document.body.style.overflow = previousOverflow;
    playing = false;
  };

  return (async (): Promise<"done" | "fallback" | "busy"> => {
    try {
      await motion(280, (t) => {
        paint(pointRect(origin), {
          x: origin.x + (target.left - origin.x) * t,
          y: origin.y + (target.top - origin.y) * t,
        });
      });
      await motion(720, (t) => {
        const rect = lerpRect(start, target, t);
        paint(rect, { x: rect.right, y: rect.bottom });
      });

      const promptX = target.right - 10;
      const promptY = target.bottom - 10;
      prompt.style.left = `${promptX}px`;
      prompt.style.top = `${promptY}px`;
      prompt.dataset.visible = "true";
      await motion(200, () => {
        paint(target, { x: target.right, y: target.bottom });
      });

      const promptBox = prompt.getBoundingClientRect();
      const clickAt = {
        x: promptBox.left + promptBox.width * 0.45,
        y: promptBox.top + promptBox.height * 0.55,
      };
      await motion(320, (t) => {
        paint(target, {
          x: target.right + (clickAt.x - target.right) * t,
          y: target.bottom + (clickAt.y - target.bottom) * t,
        });
      });
      cursor.dataset.pressed = "true";
      prompt.dataset.pressed = "true";
      await motion(140, () => {
        paint(target, clickAt);
      });

      const fullscreen: Rect = {
        left: 0,
        top: 0,
        right: window.innerWidth,
        bottom: window.innerHeight,
      };
      prompt.dataset.visible = "false";
      await motion(460, (t) => {
        const rect = lerpRect(target, fullscreen, t);
        paint(rect, clickAt);
      });
      document.documentElement.setAttribute("data-theme", next);
      try {
        localStorage.setItem("ocos-theme", next);
      } catch {
        // The in-memory theme still applies for this visit.
      }
      return "done";
    } finally {
      cleanup();
    }
  })();
}
