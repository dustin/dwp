---
title: The downwind.pro bot
toc: true
---

# The downwind.pro bot

The bot lives in the downwind.pro Matrix rooms. It answers questions about
conditions and the forecast, tells the room when a run is shaping up, and
imports and fixes up your runs. Type `!help` in a room to see the commands you
can use there.

You don't have to type a whole command: any start of one that isn't shared
with another command works, so `!c` is `!conditions` and `!l` is `!last`. If
what you typed could be more than one (`!fo` is `!foil` or `!forecast`), the bot
says so.

Times are Hawaii time, 24-hour.

## Who can do what

- **Anyone in the room** can ask for conditions and the forecast, and see what
  the room gets.
- **Riders** (people Dustin has linked to their downwind.pro site) can also
  import and change their own runs.
- **Room admins** can do all of that for any rider, and choose what the room
  gets.

If you try a rider command without being set up as a rider, the bot reacts 🚫.

## Conditions and forecast

| Command | What you get |
| --- | --- |
| `!conditions` | The best bet and run scores, the latest wind at each station, the buoys, and what the Wailea cam sees (sea state and water motion), with the cam frame |
| `!conditions chart` | The same, plus each buoy's spectrum chart |
| `!forecast` | Forecast run picks: best now, best overall, Kīhei and Maliko, and the next few days |

Run scores are out of 10. The forecast looks for rideable daylight stretches
and ranks them by how far the wind is over what's needed for that spot, nudged
by what the stations are reading right now.

## What the room hears without asking

- **Run alerts.** During the day each side is rated about every 10 minutes. The
  room hears once as a side becomes worth considering, again when it's looking
  good, and again when it's really good, then once when everything drops off.
  Before 11:00 it only speaks up for a side that's already looking good.
- **New runs.** At 16:00, 18:00 and 23:00 the bot imports new runs from every
  rider's shared Drive folder and posts them.
- **Data sources.** If a wind station, buoy, cam or the run rating goes quiet
  during its usual hours, the room hears ⚠️ once (pinned until it's back) and ✅
  once it's back.
- **Pinned conditions.** A pinned message with the current conditions, updated
  quietly through the day, and a fresh one each day.

`!alerts` lists what this room gets and the command to flip each one. Room
admins can change them:

| Command | What it does |
| --- | --- |
| `!alerts ratings off` | Stop run alerts (`on` turns any of these back on) |
| `!alerts runs off` | Stop new-run posts from the scheduled syncs |
| `!alerts sources off` | Stop data source alerts |
| `!alerts pinned off` | Stop the pinned conditions message, and unpin it |
| `!alerts buoys pauwela barbers_point` | Which buoys this room's conditions show |
| `!alerts buoys default` | Back to Pauwela and Waimea |

## Adding your runs

### Send a GPX file

Attach a `.gpx` file in the room with the foil as its caption:

- `585`: import it as your run on foil 585.
- `585 board gator`: the same, on board gator. Without a board, it uses your
  latest run's board.
- No caption: the bot asks which foil. Answer with the foil, or `-` for the last
  one you rode from that beach.
- `new Axis Spitfire 1180`: a foil nobody has ridden yet, by its full name.

The bot replies with a summary of the run (see [`!last`](#your-runs)) and any
records it set: 🏆 a new best, 🤝 matching one, 🎉 events.

If an import fails, fix what it says and send `!retry`, or `!retry 685` to try
another foil. The file waits a day.

### Import a whole archive

`!import <url>` downloads a zip of GPX files (or one GPX) from a link and imports
every run in it. A foil and board can follow the URL, as in
`!import https://example.com/runs.zip 585 board gator`; otherwise each run gets
your usual foil for that beach. The bot posts progress as it goes. See
[Import your runs](./import) for getting a zip out of Waterspeed or Strava.

### From your Drive folder

If you share a Google Drive folder with your runs, new files are picked up by
the scheduled syncs. `!sync` picks them up right away.

## Your runs

Most of these work on your latest run. Put a run's link (from its page on your
site) first to work on another one.

| Command | What it does |
| --- | --- |
| `!last` | Your latest run: from → to, when, km and time on foil, foiling speed, best km, heart rate, dry or not, foil and board, and a link |
| `!last walter` | Someone else's latest run |
| `!foil 585` | Change your latest run's foil |
| `!foil <run link> 585` | Change that run's foil |
| `!board gator` | Change your latest run's board (`new <full name>` for a new one) |
| `!glitch` | Drop your latest run's top speed as a GPS glitch; again drops the next highest |
| `!glitch <run link> undo` | Put that run's readings back |
| `!trim start 10:42` | Count your latest run only from 10:42 (or `start 20m`: 20 minutes in) |
| `!trim end 12:05` | The same for its end (or `end 5m`: the last 5 minutes off) |
| `!trim undo` | Put the whole track back |
| `!split 12:45` | Split your latest run in two at 12:45 (or `40m`: 40 minutes in) |
| `!unsplit <run link>` | Join a split run back up (give the first half) |
| `!delete <run link>` | Delete that run for good; react 👍 to confirm |

## Ask in plain English

`!ask` answers questions about your runs, and can propose changes.

- `!ask how many km on Sundays?`
- `!ask when did I last go to Ulua?`
- `!ask walter's longest run this year` (name any rider to include them)
- `!ask the 2 runs with an unknown foil were the ART 999`

The bot reacts 👀 while it thinks. A change comes back as a preview of exactly
what it will do; a room admin reacts ✅ to apply it, and the bot shows its
progress on the preview: 👀 applying, 💾 saved, 🌐 published (❌ if it
stopped). Unapproved changes expire after a day.

## Room admins

Admins can do everything above for any rider by naming them first:

| Command | What it does |
| --- | --- |
| a `.gpx` captioned `walter 585` | Import it as Walter's run |
| `!import walter <url>` | Import a zip as Walter's runs |
| `!sync` | Sync every rider (`!sync walter` for one) |
| `!foil walter orca 685` | Change another rider's latest foil (`!board walter gator` too) |
| `!glitch walter` | Drop another rider's top speed |
| `!trim walter start 20m` | Trim another rider's latest run |
| `!split walter 12:45` | Split another rider's latest run |
| `!ask walter ...` | Ask about, or change, another rider's runs |
| `!publish` | Publish whatever changed (`--dry-run` to just look) |

In the main room admins also have `!rooms` (every room the bot is in, with what
each gets), `!room 2 sources off` (`!alerts` for another room, by its `!rooms`
number) and `!room 2 leave`. Inviting the bot to a new room asks the main room
first; an admin's ✅ there lets it join.

The bot can't read encrypted rooms.
