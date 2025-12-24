//! By convention, root.zig is the root source file when making a library.
const std = @import("std");
const zeit = @import("zeit");

pub const ParseError = error{ ParseError, OutOfMemory };

pub const Unit = enum {
    year,
    month,
    day,
    hour,
    minute,
    degrees,
    meters_per_sec,
    meters,
    seconds,
    hecto_pascal,
    nautical_miles,
    miles,
    feet,
};

const unit_map = std.static_string_map.StaticStringMap(Unit).initComptime(&.{
    .{ "yr", .year },
    .{ "mo", .month },
    .{ "dy", .day },
    .{ "hr", .hour },
    .{ "mn", .minute },
    .{ "degT", .degrees },
    .{ "m/s", .meters_per_sec },
    .{ "m", .meters },
    .{ "sec", .seconds },
    .{ "hPa", .hecto_pascal },
    .{ "degC", .degrees },
    .{ "nmi", .nautical_miles },
    .{ "mi", .miles },
    .{ "ft", .feet },
    .{ "deg", .degrees },
});

fn parse_unit(t: []const u8) ?Unit {
    return unit_map.get(t);
}

test parse_unit {
    try std.testing.expectEqual(.year, parse_unit("yr"));
    try std.testing.expectEqual(.degrees, parse_unit("degT"));
    try std.testing.expectEqual(null, parse_unit("na"));
}

const HeaderItem = struct {
    name: []const u8,
    unit: Unit,
};

pub fn Reading(T: type) type {
    return struct {
        val: T,
        unit: Unit,
    };
}

pub const Row = struct {
    timestamp: zeit.Instant,
    waveHeight: Reading(f32),
    wavePeriod: Reading(f32),
    waveDirection: Reading(u10),
    waterTemp: Reading(f32),
};

fn mk_timestamp(alloc: std.mem.Allocator, fl: std.StringHashMap(u8), row: []const []const u8) !zeit.Instant {
    const yy = row[fl.get("YY").?];
    const mm = row[fl.get("MM").?];
    const dd = row[fl.get("DD").?];
    const HH = row[fl.get("hh").?];
    const MM = row[fl.get("mm").?];

    const iso = try std.fmt.allocPrint(alloc, "{s}-{s}-{s}T{s}:{s}:00-10:00", .{ yy, mm, dd, HH, MM });
    defer alloc.free(iso);

    return try zeit.instant(.{ .source = .{ .iso8601 = iso } });
}

pub fn parse_buoy(alloc: std.mem.Allocator, ri: *std.io.Reader, rows: *std.ArrayList(Row)) !void {
    const lineOne = try alloc.dupe(u8, (ri.takeDelimiterExclusive('\n') catch return error.ParseError));
    defer alloc.free(lineOne);
    _ = try ri.take(1);
    const lineTwo = try alloc.dupe(u8, (ri.takeDelimiterExclusive('\n') catch return error.ParseError));
    defer alloc.free(lineTwo);
    _ = try ri.take(1);

    var fieldLocations = std.StringHashMap(u8).init(alloc);
    defer fieldLocations.deinit();
    var locF = try std.ArrayList([]const u8).initCapacity(alloc, 20);
    defer locF.deinit(alloc);
    {
        var it = std.mem.tokenizeSequence(u8, lineOne[1..], " ");
        var pos: u8 = 0;
        while (it.next()) |f| : (pos += 1) {
            try fieldLocations.put(f, pos);
            try locF.append(alloc, f);
        }
    }

    var fieldUnits = std.StringHashMap(Unit).init(alloc);
    defer fieldUnits.deinit();
    {
        var it = std.mem.tokenizeSequence(u8, lineTwo[1..], " ");
        var pos: u8 = 0;
        while (it.next()) |f| : (pos += 1) {
            try fieldUnits.put(locF.items[pos], parse_unit(f).?);
        }
    }

    var lineNum: usize = 2;
    while (ri.takeDelimiterExclusive('\n')) |line| : ({
        lineNum += 1;
        _ = ri.take(1) catch 0;
    }) {
        var vals = try std.ArrayList([]const u8).initCapacity(alloc, fieldLocations.count());
        defer vals.deinit(alloc);
        var it = std.mem.tokenizeSequence(u8, line, " ");
        while (it.next()) |v| {
            try vals.append(alloc, v);
        }
        const v = vals.items;
        // std.debug.print("parsing mwd: {s} on line {d}\n", .{ v[fieldLocations.get("MWD").?], lineNum });
        // std.debug.print("parsing dpd: {s}\n", .{v[fieldLocations.get("DPD").?]});
        try rows.append(alloc, .{
            .timestamp = try mk_timestamp(alloc, fieldLocations, v),
            // TODO: handle MM
            .waveHeight = .{ .val = try std.fmt.parseFloat(f32, v[fieldLocations.get("WVHT").?]), .unit = fieldUnits.get("WVHT").? },
            .wavePeriod = .{ .val = try std.fmt.parseFloat(f32, v[fieldLocations.get("DPD").?]), .unit = fieldUnits.get("DPD").? },
            .waveDirection = .{ .val = try std.fmt.parseInt(u10, v[fieldLocations.get("MWD").?], 10), .unit = fieldUnits.get("MWD").? },
            .waterTemp = .{ .val = try std.fmt.parseFloat(f32, v[fieldLocations.get("WTMP").?]), .unit = fieldUnits.get("WTMP").? },
        });
    } else |err| {
        if (err == error.EndOfStream) {
            return {};
        } else {
            std.debug.print("error {} after {d} lines\n", .{ err, lineNum });
            return err;
        }
    }
}

pub fn parse_buoy_file(alloc: std.mem.Allocator, path: []const u8) !*std.ArrayList(Row) {
    const file = try std.fs.cwd().openFile(path, .{});
    defer file.close();
    var buffer: [4096]u8 = undefined;
    var reader = file.reader(buffer[0..]);

    const rv = try alloc.create(std.ArrayList(Row));
    rv.* = try std.ArrayList(Row).initCapacity(alloc, 2200);
    errdefer {
        rv.deinit(alloc);
        alloc.destroy(rv);
    }
    try parse_buoy(alloc, &reader.interface, rv);
    return rv;
}

test parse_buoy_file {
    const rows = try parse_buoy_file(std.testing.allocator, "examples/pauwela.txt");
    defer {
        rows.deinit(std.testing.allocator);
        std.testing.allocator.destroy(rows);
    }

    try std.testing.expectEqual(2188, rows.items.len);

    try std.testing.expectApproxEqRel(2.4, rows.items[1].waveHeight.val, 0.1);
    try std.testing.expectEqual(.meters, rows.items[1].waveHeight.unit);

    try std.testing.expectEqual(8, rows.items[1].wavePeriod.val);
    try std.testing.expectEqual(.seconds, rows.items[1].wavePeriod.unit);

    try std.testing.expectEqual(51, rows.items[1].waveDirection.val);
    try std.testing.expectEqual(.degrees, rows.items[1].waveDirection.unit);

    try std.testing.expectApproxEqRel(25.4, rows.items[1].waterTemp.val, 0.1);
    try std.testing.expectEqual(.degrees, rows.items[1].waterTemp.unit);
}
