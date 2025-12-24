const std = @import("std");

pub fn build(b: *std.Build) void {
    const target = b.standardTargetOptions(.{});

    const optimize = b.standardOptimizeOption(.{});

    const zeit = b.dependency("zeit", .{
        .target = target,
        .optimize = optimize,
    });

    const importers = b.addModule("importers", .{
        .root_source_file = b.path("src/root.zig"),
        .target = target,
        .optimize = optimize,
        .imports = &.{
            .{ .name = "zeit", .module = zeit.module("zeit") },
        },
    });

    const exe = b.addExecutable(.{
        .name = "import",
        .root_module = b.createModule(.{
            .root_source_file = b.path("src/main.zig"),
            .target = target,
            .optimize = optimize,
            .imports = &.{
                .{ .name = "importers", .module = importers },
                .{ .name = "zeit", .module = zeit.module("zeit") },
            },
        }),
    });

    b.installArtifact(exe);

    const unit_tests = b.addTest(.{ .root_module = importers });
    const run_unit_tests = b.addRunArtifact(unit_tests);

    const test_step = b.step("test", "Run unit tests");
    test_step.dependOn(&run_unit_tests.step);
}
