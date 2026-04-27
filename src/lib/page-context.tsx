"use client";

/**
 * Page-level context shared between AppLayout and the page component.
 *
 *   - title / subtitle / headerSlot — page can publish its own header content
 *     to the global app frame (via usePageTitle etc.) without lifting state.
 *   - scrollingDown — used by AppLayout to auto-hide its top bar when the
 *     user scrolls down and reveal it on scroll up.
 */

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useRef,
} from "react";

interface PageContextValue {
  title: string;
  setTitle: (t: string) => void;
  subtitle: string;
  setSubtitle: (s: string) => void;
  headerSlot: React.ReactNode;
  setHeaderSlot: (node: React.ReactNode) => void;
  scrollingDown: boolean;
  setScrollingDown: (v: boolean) => void;
}

const PageContext = createContext<PageContextValue>({
  title: "",
  setTitle: () => {},
  subtitle: "",
  setSubtitle: () => {},
  headerSlot: null,
  setHeaderSlot: () => {},
  scrollingDown: false,
  setScrollingDown: () => {},
});

export function PageProvider({ children }: { children: React.ReactNode }) {
  const [title, setTitle] = useState("");
  const [subtitle, setSubtitle] = useState("");
  const [headerSlot, setHeaderSlot] = useState<React.ReactNode>(null);
  const [scrollingDown, setScrollingDown] = useState(false);
  const lastScrollY = useRef(0);
  const cooldown = useRef(false);

  useEffect(() => {
    function onScroll(e: Event) {
      if (cooldown.current) return;
      const el = e.target === document ? null : (e.target as HTMLElement);
      const y = el ? el.scrollTop : window.scrollY;
      const delta = y - lastScrollY.current;
      if (Math.abs(delta) < 8) return;
      const down = delta > 0 && y > 10;
      setScrollingDown((prev) => {
        if (prev === down) return prev;
        cooldown.current = true;
        setTimeout(() => {
          cooldown.current = false;
        }, 300);
        return down;
      });
      lastScrollY.current = y;
    }
    window.addEventListener("scroll", onScroll, { passive: true });
    const main = document.querySelector("main");
    main?.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      main?.removeEventListener("scroll", onScroll);
    };
  }, []);

  return (
    <PageContext.Provider
      value={{
        title,
        setTitle,
        subtitle,
        setSubtitle,
        headerSlot,
        setHeaderSlot,
        scrollingDown,
        setScrollingDown,
      }}
    >
      {children}
    </PageContext.Provider>
  );
}

export function usePageContext() {
  return useContext(PageContext);
}

export function usePageTitle(title: string) {
  const { setTitle } = usePageContext();
  useEffect(() => {
    setTitle(title);
    return () => setTitle("");
  }, [title, setTitle]);
}

export function usePageSubtitle(subtitle: string) {
  const { setSubtitle } = usePageContext();
  useEffect(() => {
    setSubtitle(subtitle);
    return () => setSubtitle("");
  }, [subtitle, setSubtitle]);
}
