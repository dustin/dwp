import { resize } from 'observablehq:stdlib';

// Render `render()` only once its placeholder comes near the viewport, so a
// long page shows its top quickly instead of building every chart up front.
// `height` reserves roughly the rendered height to keep the page from jumping.
export function lazy(render, { height = 450 } = {}) {
  const div = document.createElement('div');
  div.style.minHeight = `${height}px`;
  const io = new IntersectionObserver(
    entries => {
      if (!entries.some(e => e.isIntersecting)) return;
      io.disconnect();
      div.style.minHeight = '';
      div.append(render());
    },
    { rootMargin: '800px 0px' }
  );
  io.observe(div);
  return div;
}

// Like Framework's resize(), but deferred until near the viewport.
export function lazyResize(render, options) {
  return lazy(() => resize(render), options);
}
