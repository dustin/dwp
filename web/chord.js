function renderChord(beaches) {
  const height = 800,
        width = height;

    var svg = d3.select("#chord").append("svg")
      .attr("viewBox", [-width / 2, -height / 2, width, height]);
    
  const g = svg.append('g');

  const innerR = 285;
  const outerR = 300;

  const popularity = d3.rollup(beaches, d => d.length, d => d.start_beach);
  const beachNames = Array.from(new Set(beaches.flatMap(d => [d.start_beach, d.end_beach]))).sort(
                          (a, b) => d3.descending(popularity[a], popularity[b]));
  const index = new Map(beachNames.map((name, i) => [name, i]));
  const matrix = Array.from(index, () => new Array(beachNames.length).fill(0));
  for (const {start_beach, end_beach} of beaches) matrix[index.get(start_beach)][index.get(end_beach)] += 1;

  const color = d3.scaleOrdinal(beachNames, d3.schemeCategory10);
    
  let chords = d3.chordDirected()
    .padAngle(10 / innerR)
    .sortSubgroups(d3.ascending)
    .sortChords(d3.ascending)
    (matrix);

  let textArc = d3.arc()
    .innerRadius(outerR)
    .outerRadius(outerR + 20)

    const sources = d3.rollup(chords, c => c.map(x => x.source.index), c => c.target.index);
    console.log(sources);

  const pluralize = (n,s,p) => n == 1 ? s : p;

  const lblTitle = d => {
    const launches = d3.sum(chords, c => (c.source.index === d.index) * c.source.value);
    const landings = d3.sum(chords, c => (c.target.index === d.index) * c.source.value);
    let parts = [];
    if (launches > 0) { parts.push([`${launches} ${pluralize(launches, "launch", "launches")}`]) };
    if (landings > 0) { parts.push([`${landings} ${pluralize(landings, "landing", "landings")}`])};
    return parts.join(' ');
  };
  
  g.selectAll('.labels')
    .data(chords.groups)
    .enter()
    .append('text')
    .attr("font-size", 10)
    .each(d => { d.angle = (d.startAngle + d.endAngle) / 2; })
    .attr('class', d => {
      const classes = ['labels'];
      const inbound = sources.get(d.index) || [];
      inbound.forEach(src => classes.push(`target-of-${src}`));
      return classes.join(' ');
    })
    .attr('id', d => `label-${d.index}`)
    .attr('text-anchor', d => { return d.angle > Math.PI ? 'end' : null; })
    .attr('transform', d => {
      let res = `rotate(${ d.angle * 180 / Math.PI - 90}) translate(${innerR + 30})`;
      res += d.angle > Math.PI ? 'rotate(180)' : '';

    	return res;
    })
    .text(d => beachNames[d.index])
    .append("title")
      .text(lblTitle);

  g.selectAll('.nodes')
    .data(chords.groups)
    .enter()
    .append('path')
    .attr('class', d => {
      const classes = ['nodes'];
      const inbound = sources.get(d.index) || [];
      inbound.forEach(src => classes.push(`target-of-${src}`));
      return classes.join(' ');
    })
    .attr('id', d => `node-${d.index}`)
    .attr('d', d3.arc()
      .innerRadius(innerR)
      .outerRadius(outerR)
    )
    .attr('fill', d => color(beachNames[d.index]))
    .attr('opacity', 0.8)
    .on('mouseover', (e, d) => {
      g.selectAll('.nodes')
        .attr('opacity', 0.2);

      g.selectAll('.links')
        .attr('opacity', 0.1);

      g.selectAll('.labels')
        .attr('opacity', 0.2);

      g.select(`#node-${d.index}`)
        .attr('opacity', 0.8);
      g.selectAll(`.target-of-${d.index}`)
        .attr('opacity', 0.8);

      g.selectAll(`.source-link-${d.index}`)
        .attr('opacity', 0.5);

      g.select(`#label-${d.index}`)
        .attr('opacity', 1);
    })
    .on('mouseout', (d) => {
      g.selectAll('.nodes')
        .attr('opacity', 0.8);

      g.selectAll('.links')
        .attr('opacity', 0.3);

       g.selectAll(`.labels`)
        .attr('opacity', 1);
    })
    .append("title")
      .text(lblTitle);  

  g.selectAll('links')
    .data(chords)
    .enter()
    .append('path')
    .attr('class', d => `links source-link-${d.source.index}`)
    .attr('d', d3.ribbon().radius(innerR))
    .attr("fill", d => color(beachNames[d.source.index]))
    .attr('opacity', 0.3);
}

async function doChord() {
    const data = await d3.csv("dwlist.csv");

    renderChord(data);
}
