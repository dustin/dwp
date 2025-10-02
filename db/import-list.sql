-- Update the list from a Waterspeed export

merge into dwlist as l
  using (
    select
    strftime(make_timestamptz((d."Timestamp (from 1970)" * 1000000)::bigint), 'Waterspeed %Y-%m-%d %H.%M.%S') as filename,
    d."Timestamp (from 1970)" as ts, d.Date as date, d.Time as time,
    d."Max Speed (kmh)" as max_speed_kmh, d."Avg Speed (kmh)" as avg_speed_kmh,
    d.Name as name, D.Desc as description, d.Feeling as feeling,
    d."Duration (sec)" as duration_sec, d."Distance (km)" as distance_km,
    d."Equip 1" as equip_1, d."Equip 2" as equip_2, d."Equip 3" as equip_3
    from "~/Downloads/list.csv" as d
  ) as ups
  on (l.filename = ups.filename)
  when matched then update
    set ts = ups.ts,
        date = ups.date, time = ups.time,
        max_speed_kmh = ups.max_speed_kmh, avg_speed_kmh = ups.avg_speed_kmh,
        duration_sec = ups.duration_sec, distance_km = ups.distance_km,
        feeling = ups.feeling, equip_1 = ups.equip_1, equip_2 = ups.equip_2, equip_3 = ups.equip_3
  when not matched then insert (
    id, filename, sport, ts, date, time,
      max_speed_kmh, avg_speed_kmh, duration_sec, distance_km,
      feeling, equip_1, equip_2, equip_3
  ) VALUES ( uuidv7(), ups.filename, 'Downwind', ups.ts, ups.date, ups.time,
      ups.max_speed_kmh, ups.avg_speed_kmh, ups.duration_sec, ups.distance_km,
      ups.feeling, ups.equip_1, ups.equip_2, ups.equip_3
  )
