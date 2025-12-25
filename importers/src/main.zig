const std = @import("std");
const zeit = @import("zeit");
const importers = @import("importers");

fn printHeader(w: *std.io.Writer) !void {
    try w.print("ts,wave_height,wave_period,wave_direction,water_temp\n", .{});
}

fn rowsToCsv(w: *std.io.Writer, rows: *std.ArrayList(importers.Row)) !void {
    for (rows.items) |r| {
        try r.timestamp.time().strftime(w, "%Y-%m-%d %H:%M:%SZ,");
        try w.print("{},{},{},{}\n", .{ r.waveHeight.val, r.wavePeriod.val, r.waveDirection.val, r.waterTemp.val });
    }
}

pub fn main() !void {
    var gpa = std.heap.GeneralPurposeAllocator(.{}){};
    defer {
        _ = gpa.deinit();
    }
    const allocator = gpa.allocator();

    var args = std.process.argsAlloc(allocator) catch return;
    defer std.process.argsFree(allocator, args);

    var writer_buf: [128]u8 = undefined;
    var stdout = std.fs.File.stdout().writer(&writer_buf);
    var w = &stdout.interface;
    defer w.flush() catch unreachable;

    try printHeader(w);

    // read from stdin if no args
    if (args.len < 2) {
        var rows = try std.ArrayList(importers.Row).initCapacity(allocator, 2200);
        defer rows.deinit(allocator);
        var reader_buf: [128]u8 = undefined;
        var stdin = std.fs.File.stdin().reader(&reader_buf);
        try importers.parse_buoy(allocator, &stdin.interface, &rows);
        try rowsToCsv(w, &rows);
    }

    // Otherwise process all the args for multiple files
    for (args[1..]) |arg| {
        const rows = try importers.parse_buoy_file(allocator, arg);
        defer {
            rows.deinit(allocator);
            allocator.destroy(rows);
        }

        try rowsToCsv(w, rows);
    }
}
