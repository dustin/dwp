import * as Plot from "npm:@observablehq/plot";

function regress(src, x, y) {
  return Plot.linearRegressionY(src, { x, y, stroke: "#808" })
}

function line(src, obj) {
  return Plot.line(src, { opacity: 0.2, curve: "cardinal", ...obj });
}

export function tl(data, title, opts, xField, yField, lineOpts, dotOpts) {
  return (width => Plot.plot({
    title, width, ...opts, marks: [
      regress(data, xField, yField),
      line(data, { x: xField, y: yField, ...lineOpts }),
      Plot.dot(data, {
        x: xField, y: yField,
        r: d => (d.dry ? 10 : 5),
        opacity: d => (d.dry ? 0.8 : 0.2),
        symbol: d => (d.dry ? "star" : "circle"),
        href: d => `/run.html?id=${encodeURIComponent(d.id)}`,
        ...dotOpts
      }),
    ]
  }));
}
