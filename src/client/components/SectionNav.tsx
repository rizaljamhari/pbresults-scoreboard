import { useEffect, useRef, useState, type RefObject } from "react";

export type PageSection = { id: string; label: string };

function scrollBehavior(): ScrollBehavior {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
}

/** Scrolls only the page body to a section; scrollIntoView would also scroll the shell and hide the toolbar. */
function scrollBodyTo(root: HTMLElement, target: HTMLElement, behavior: ScrollBehavior) {
  root.scrollTo({ top: target.getBoundingClientRect().top - root.getBoundingClientRect().top + root.scrollTop, behavior });
}

/**
 * The section list beside a long settings-style page. It follows the scroll position, and a #section link
 * opens that section directly once the page has rendered.
 */
export function useSectionNav(sections: readonly PageSection[], bodyRef: RefObject<HTMLElement | null>, ready: boolean) {
  const [activeSection, setActiveSection] = useState<string>(sections[0]?.id ?? "");
  // The section a #link opened, while the page holds it in view; scroll positions mean nothing until then.
  const pinnedRef = useRef<string | null>(null);

  useEffect(() => {
    if (!ready) return;
    const id = window.location.hash.slice(1);
    const root = bodyRef.current;
    const target = sections.some((section) => section.id === id) ? document.getElementById(id) : null;
    if (!root || !target) return;
    pinnedRef.current = id;
    setActiveSection(id);
    // Sections around it are still loading and move it; keep it in view until they settle or the reader takes over.
    // A timer rather than animation frames, so a tab opened in the background still lands on the section.
    const pin = () => scrollBodyTo(root, target, "auto");
    pin();
    const interval = window.setInterval(pin, 100);
    const release = () => {
      window.clearInterval(interval);
      pinnedRef.current = null;
    };
    const timer = window.setTimeout(release, 3000);
    const takeover = ["wheel", "touchstart", "pointerdown", "keydown"] as const;
    takeover.forEach((type) => root.addEventListener(type, release, { passive: true }));
    return () => {
      release();
      window.clearTimeout(timer);
      takeover.forEach((type) => root.removeEventListener(type, release));
    };
  }, [ready]);

  useEffect(() => {
    const root = bodyRef.current;
    if (!root || !ready) return;
    const update = () => {
      if (pinnedRef.current) {
        setActiveSection(pinnedRef.current);
        return;
      }
      // Short last sections never reach the reading line; at the bottom of the page, they are the one being read.
      // A page too short to scroll is always "at the bottom", so that rule only applies once it scrolls.
      const scrolls = root.scrollHeight > root.clientHeight + 2;
      if (scrolls && root.scrollTop + root.clientHeight >= root.scrollHeight - 2) {
        setActiveSection(sections[sections.length - 1].id);
        return;
      }
      // Just below the top, where a heading lands when its section is opened from the list.
      const readingLine = root.getBoundingClientRect().top + 64;
      let current = sections[0].id;
      for (const section of sections) {
        const top = document.getElementById(section.id)?.getBoundingClientRect().top;
        if (top !== undefined && top <= readingLine) current = section.id;
      }
      setActiveSection(current);
    };
    update();
    root.addEventListener("scroll", update, { passive: true });
    return () => root.removeEventListener("scroll", update);
  }, [ready]);

  function jumpTo(id: string) {
    const root = bodyRef.current;
    const target = document.getElementById(id);
    if (root && target) scrollBodyTo(root, target, scrollBehavior());
    setActiveSection(id);
  }

  return { activeSection, jumpTo };
}

export function SectionToc({ sections, activeSection, onJump, label }: { sections: readonly PageSection[]; activeSection: string; onJump: (id: string) => void; label: string }) {
  return (
    <nav className="ad-toc" aria-label={label}>
      {sections.map((section) => (
        <a
          key={section.id}
          href={`#${section.id}`}
          aria-current={activeSection === section.id ? "true" : undefined}
          onClick={(event) => {
            event.preventDefault();
            onJump(section.id);
          }}
        >
          {section.label}
        </a>
      ))}
    </nav>
  );
}
