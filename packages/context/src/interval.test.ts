import { describe, expect, it } from "vitest";
import { UNCERTAINTY_CODES } from "./types.js";
import { extractQueryConstraints } from "@opencompanyos/retrieval";
import { resolveContextWindow } from "./build.js";
import {
  abstentionForQuery,
  acceptTransitionEvidence,
  classifyAbstention,
  eventInRollingInterval,
  rollingSevenDayInterval,
} from "./interval.js";

const now = new Date(Date.UTC(2026, 9, 11, 15, 30, 0, 0));

describe("rolling seven-day interval", () => {
  it("ends at the supplied clock and starts exactly seven days earlier in UTC", () => {
    expect(rollingSevenDayInterval(now)).toEqual({
      timezone: "UTC",
      label: "rolling-seven-days",
      start: "2026-10-04T15:30:00.000Z",
      end: "2026-10-11T15:30:00.000Z",
    });
  });

  it("serializes both bounds with a Z suffix", () => {
    const interval = rollingSevenDayInterval(now);
    expect(interval.start.endsWith("Z")).toBe(true);
    expect(interval.end.endsWith("Z")).toBe(true);
    expect(Date.parse(interval.end) - Date.parse(interval.start)).toBe(7 * 24 * 60 * 60 * 1000);
  });

  it("includes an event exactly at start and excludes an event exactly at end", () => {
    const interval = rollingSevenDayInterval(now);
    expect(eventInRollingInterval(new Date(interval.start), interval)).toBe(true);
    expect(eventInRollingInterval(new Date(interval.end), interval)).toBe(false);
    expect(eventInRollingInterval(new Date(Date.parse(interval.end) - 1), interval)).toBe(true);
    expect(eventInRollingInterval(new Date(Date.parse(interval.start) - 1), interval)).toBe(false);
  });
});

describe("context window", () => {
  const clock = new Date("2026-10-11T15:30:00.000Z");

  it("reports the same rolling interval that retrieval uses", () => {
    const window = resolveContextWindow("What changed this week?", undefined, undefined, clock);
    const interval = rollingSevenDayInterval(clock);
    expect(window.interval).toEqual(interval);
    expect(window.from?.toISOString()).toBe(interval.start);
    expect(window.to?.toISOString()).toBe(interval.end);
  });

  it("leaves today on the existing constraint helper", () => {
    const query = "issues opened today";
    const window = resolveContextWindow(query, undefined, undefined, clock);
    expect(window.interval).toBeNull();
    expect(window.to).toBeNull();
    expect(window.from?.toISOString()).toBe(extractQueryConstraints(query, clock).since?.toISOString());
  });

  it("keeps an explicit caller window off the rolling interval", () => {
    const from = new Date("2026-10-02T04:34:43.000Z");
    const to = new Date("2026-10-02T04:34:43.000Z");
    const window = resolveContextWindow("What changed this week?", from, to, clock);
    expect(window).toEqual({ from, to, interval: null });
  });
});

describe("transition evidence", () => {
  const interval = rollingSevenDayInterval(now);

  it("includes an occurrence at the start and excludes a snapshot and the end instant", () => {
    expect(
      acceptTransitionEvidence({ recordKind: "occurrence", eventTime: interval.start }, interval),
    ).toBe(true);
    expect(
      acceptTransitionEvidence({ recordKind: "occurrence", eventTime: interval.end }, interval),
    ).toBe(false);
    expect(
      acceptTransitionEvidence({ recordKind: "snapshot", eventTime: interval.start }, interval),
    ).toBe(false);
    expect(
      acceptTransitionEvidence({ recordKind: "occurrence", eventTime: null }, interval),
    ).toBe(false);
  });
});

describe("abstention states", () => {
  it("keeps collected absence distinct from coverage that was not collected", () => {
    expect(classifyAbstention({ coverage: { status: "collected" }, supportingRecordCount: 0 })).toEqual({
      state: "no_relevant_evidence",
    });
    expect(
      classifyAbstention({ coverage: { status: "not_collected" }, supportingRecordCount: 0 }),
    ).toEqual({ state: "coverage_not_collected" });
    expect(UNCERTAINTY_CODES).toContain("insufficient_evidence");
    expect(UNCERTAINTY_CODES).toContain("model_unavailable");
    expect(UNCERTAINTY_CODES).not.toContain("no_relevant_evidence");
    expect(UNCERTAINTY_CODES).not.toContain("coverage_not_collected");
  });

  it("does not treat an empty result with untracked coverage as verified absence", () => {
    expect(classifyAbstention({ coverage: { status: "untracked" }, supportingRecordCount: 0 })).toEqual({
      state: "untracked_coverage",
    });
    expect(abstentionForQuery("What changed this week?")).toEqual({ state: "untracked_coverage" });
    expect(abstentionForQuery("What does an inline review comment on pull request #16468 say?")).toEqual({
      state: "coverage_not_collected",
    });
    expect(abstentionForQuery("What changed this week?").state).not.toBe("no_relevant_evidence");
  });
});
