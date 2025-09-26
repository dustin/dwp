import * as Plot from "npm:@observablehq/plot";

function regress(src, x, y) {
  return Plot.linearRegressionY(src, { x, y, stroke: "#808" })
}

function dots(src, obj) {
  return Plot.dot(src, { r: 5, opacity: 0.2, ...obj });
}

function line(src, obj) {
  return Plot.line(src, { opacity: 0.2, curve: "cardinal", ...obj });
}

export function tl(data, title, opts, xField, yField, lineOpts, dotOpts) {
  return (width => Plot.plot({
    title, width, ...opts, marks: [
      regress(data, xField, yField),
      line(data, { x: xField, y: yField, ...lineOpts }),
      dots(data, { x: xField, y: yField, ...dotOpts }),
    ]
  }));
}
