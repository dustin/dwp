-- The last 6 hours of Pauwela's swell_partition as one JSON list, newest
-- first; update-buoys publishes it to MQTT ocean/buoy-update. Pauwela
-- only, as it was before Waimea joined swell_partition.
select to_json(list(reading order by ts desc))
from (
  select ts, {
    site: site, ts: ts, day: day,
    surfline_kj: any_value(surfline_kj),
    swells: list({rank: rank, height: height, period: period,
                  direction: direction, spread: spread, energy: energy} order by rank)
  } as reading
  from swell_partition
  where site = 'pauwela'
    and ts > current_timestamp - interval 6 hours
  group by site, ts, day
);
