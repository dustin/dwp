import * as d3 from "npm:d3";
import * as d3h from "npm:d3-hexbin";
import * as d3t from "npm:d3-tile";

function tileURL(x, y, z) {
  const token = 'pk.eyJ1IjoiZGxzc3B5IiwiYSI6ImNtZzF2OG42cTBza3kybnB5YXd5OHY1ZWwifQ.EeGGfhgFW9amBAeiOEvbYw';
  // return `https://api.mapbox.com/styles/v1/mapbox/streets-v11/tiles/${z}/${x}/${y}${devicePixelRatio > 1 ? "@2x" : ""}?access_token=${token}`
  return `https://api.mapbox.com/styles/v1/mapbox/satellite-v9/tiles/${z}/${x}/${y}${devicePixelRatio > 1 ? "@2x" : ""}?access_token=${token}`
}

export function renderCrashes(width, data) {
  const height = width * 0.5;
  const svg = d3.create("svg")
    .attr("viewBox", [0, 0, width, height]);
  const projection = d3.geoMercator()
    .scale(1 / (2 * Math.PI))
    .translate([0, 0]);
  const tile = d3t.tile()
    .extent([[0, 0], [width, height]])
    .tileSize(512);
  const zoom = d3.zoom()
    .scaleExtent([1 << 10, 1 << 21])
    .extent([[0, 0], [width, height]])
    .on("zoom", ({ transform }) => zoomed(transform));
  let image = svg.append("g")
    .attr("pointer-events", "none")
    .selectAll("image");

  const crashG = svg.append("g").attr("pointer-events", "none");

  const hexbin = d3h.hexbin()
    .radius(20);

  const colorScale = d3.scaleSequential(d3.interpolateYlOrRd);

  let hexagons = crashG.selectAll(".hexagon");

  svg
    .call(zoom)
    .call(zoom.transform, d3.zoomIdentity
      .translate(width / 2, height / 2)
      .scale(-1));

  const fc = {
    type: "FeatureCollection",
    features: data.map(d => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: [+d.lon, +d.lat] }
    }))
  };

  const proj0 = d3.geoMercator();
  const pad = 24;
  proj0.fitExtent([[pad, pad], [width - pad, height - pad]], fc);
  const k = proj0.scale() * 2 * Math.PI;
  const [tx, ty] = proj0.translate();
  svg.call(zoom.transform, d3.zoomIdentity.translate(tx, ty).scale(k));

  function zoomed(transform) {
    const tiles = tile(transform);
    image = image.data(tiles, d => d).join("image")
      .attr("xlink:href", d => tileURL(...d))
      .attr("x", ([x]) => (x + tiles.translate[0]) * tiles.scale)
      .attr("y", ([, y]) => (y + tiles.translate[1]) * tiles.scale)
      .attr("width", tiles.scale)
      .attr("height", tiles.scale);

    projection
      .scale(transform.k / (2 * Math.PI))
      .translate([transform.x, transform.y]);

    const zoomLevel = Math.log2(transform.k);
    const scaledRadius = Math.max(5, 20 * Math.pow(0.8, zoomLevel - 12));

    hexbin
      .radius(scaledRadius)
      .extent([[0, 0], [width, height]]);

    const projectedData = data
      .map(d => {
        const p = projection([+d.lon, +d.lat]);
        return p && p[0] >= 0 && p[0] <= width && p[1] >= 0 && p[1] <= height
          ? [p[0], p[1], d]
          : null;
      })
      .filter(d => d !== null);

    if (projectedData.length > 0) {
      const hexbins = hexbin(projectedData);

      const maxDensity = d3.max(hexbins, d => d.length) || 1;
      colorScale.domain([0, maxDensity]);

      hexagons = hexagons
        .data(hexbins, d => `${Math.round(d.x)}-${Math.round(d.y)}`)
        .join(
          enter => enter.append("path")
            .attr("class", "hexagon")
            .attr("d", hexbin.hexagon())
            .attr("stroke", "#fff")
            .attr("stroke-width", 0.5)
            .attr("opacity", 0.8),
          update => update
            .attr("d", hexbin.hexagon())
            .attr("transform", d => `translate(${d.x},${d.y})`)
            .attr("title", d => `Crash density: ${d.length}`)
            .attr("fill", d => colorScale(d.length)),
          exit => exit
            .attr("opacity", 0)
            .remove()
        )
        .attr("transform", d => `translate(${d.x},${d.y})`)
        .attr("fill", d => colorScale(d.length));
    } else {
      hexagons = hexagons.data([]).join(
        enter => enter,
        update => update,
        exit => exit.remove()
      );
    }
  }

  return svg.node();
}
