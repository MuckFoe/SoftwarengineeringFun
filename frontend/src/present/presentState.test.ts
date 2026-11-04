import { describe, expect, it } from "vitest";
import {
  canLead,
  hostAway,
  hostName,
  initialPresentState,
  isHost,
  type PresentState,
  presentReducer,
} from "./presentState";
import type { Anchor, PresentWelcomeMessage, Stroke } from "./presentTypes";

const ANA = { id: "p-ana", name: "Ana", color: "#e6194b" };
const BEN = { id: "p-ben", name: "Ben", color: "#3cb44b" };
const CLEO = { id: "p-cleo", name: "Cleo", color: "#4363d8" };

const HEADING: Anchor = { path: [0, 2], fx: 0.5, fy: 0.5 };
const PARAGRAPH: Anchor = { path: [0, 3], fx: 0.25, fy: 0.1 };

function stroke(id: string, by = BEN, anchor: Anchor | null = HEADING): Stroke {
  return {
    id,
    participant_id: by.id,
    color: by.color,
    anchor,
    points: [
      [0.1, 0.1],
      [0.2, 0.2],
    ],
  };
}

function welcome(over: Partial<PresentWelcomeMessage> = {}): PresentWelcomeMessage {
  return {
    type: "welcome",
    you: { participant_id: BEN.id, rejoin_token: "tok", name: BEN.name },
    available: true,
    kind: "slides",
    slide_count: 4,
    host: { id: ANA.id, name: ANA.name, away: false },
    place: { slide: 1, anchor: null },
    participants: [ANA, BEN, CLEO],
    strokes: [],
    chat: [],
    ...over,
  };
}

function joined(over: Partial<PresentWelcomeMessage> = {}): PresentState {
  return presentReducer(initialPresentState, welcome(over));
}

describe("presentReducer", () => {
  it("starts empty, not host, not drawing", () => {
    expect(isHost(initialPresentState)).toBe(false);
    expect(hostName(initialPresentState)).toBeNull();
    expect(hostAway(initialPresentState)).toBe(false);
    expect(canLead(initialPresentState)).toBe(false);
    expect(initialPresentState.drawing).toBe(false);
    expect(initialPresentState.strokes).toEqual([]);
    expect(initialPresentState.cursor).toBeNull();
  });

  it("AC-8: welcome where you are the host gives isHost on slide 0", () => {
    const s = joined({
      you: { participant_id: ANA.id, rejoin_token: "t", name: ANA.name },
      place: { slide: 0, anchor: null },
      participants: [ANA],
    });
    expect(isHost(s)).toBe(true);
    expect(canLead(s)).toBe(true);
    expect(hostName(s)).toBe("Ana");
    expect(s.place).toEqual({ slide: 0, anchor: null });
    expect(s.kind).toBe("slides");
    expect(s.slideCount).toBe(4);
    expect(s.available).toBe(true);
  });

  it("welcome as a follower: not host, carries participants and existing strokes", () => {
    const s = joined({ strokes: [stroke("s1")] });
    expect(isHost(s)).toBe(false);
    expect(canLead(s)).toBe(false);
    expect(hostName(s)).toBe("Ana");
    expect(s.you).toEqual({ participant_id: BEN.id, name: "Ben" });
    expect(s.participants).toEqual([ANA, BEN, CLEO]);
    expect(s.strokes).toEqual([stroke("s1")]);
  });

  it("presence replaces the participant list", () => {
    const s = presentReducer(joined(), { type: "presence", participants: [ANA, BEN] });
    expect(s.participants).toEqual([ANA, BEN]);
  });

  it("AC-15b: host handover moves isHost and keeps the place", () => {
    const asAna = joined({
      you: { participant_id: ANA.id, rejoin_token: "t", name: ANA.name },
      place: { slide: 1, anchor: HEADING },
    });
    const asCleo = joined({
      you: { participant_id: CLEO.id, rejoin_token: "t", name: CLEO.name },
      place: { slide: 1, anchor: HEADING },
    });
    const handover = {
      type: "host" as const,
      host: { id: CLEO.id, name: CLEO.name, away: false },
      reason: "handover" as const,
    };
    const ana = presentReducer(asAna, handover);
    const cleo = presentReducer(asCleo, handover);
    expect(isHost(ana)).toBe(false);
    expect(canLead(ana)).toBe(false);
    expect(isHost(cleo)).toBe(true);
    expect(canLead(cleo)).toBe(true);
    expect(hostName(ana)).toBe("Cleo");
    expect(ana.place).toEqual({ slide: 1, anchor: HEADING });
    expect(cleo.place).toEqual({ slide: 1, anchor: HEADING });
  });

  it("AC-15: host away sets hostAway and keeps the place; return clears it", () => {
    const before = joined({ place: { slide: 1, anchor: PARAGRAPH } });
    const away = presentReducer(before, {
      type: "host",
      host: { id: ANA.id, name: ANA.name, away: true },
      reason: "away",
    });
    expect(hostAway(away)).toBe(true);
    expect(hostName(away)).toBe("Ana");
    expect(away.place).toEqual({ slide: 1, anchor: PARAGRAPH });
    const back = presentReducer(away, {
      type: "host",
      host: { id: ANA.id, name: ANA.name, away: false },
      reason: "returned",
    });
    expect(hostAway(back)).toBe(false);
    expect(back.place).toEqual({ slide: 1, anchor: PARAGRAPH });
  });

  it("AC-20: a place on a different slide clears every stroke", () => {
    const s = joined({ strokes: [stroke("s1"), stroke("s2", CLEO)] });
    const next = presentReducer(s, { type: "place", slide: 2, anchor: null });
    expect(next.place).toEqual({ slide: 2, anchor: null });
    expect(next.strokes).toEqual([]);
  });

  it("AC-20b: a same-slide anchor change (single page scroll) keeps strokes", () => {
    const s = joined({
      kind: "page",
      slide_count: 1,
      place: { slide: null, anchor: HEADING },
      strokes: [stroke("s1")],
    });
    const scrolled = presentReducer(s, { type: "place", slide: null, anchor: PARAGRAPH });
    const back = presentReducer(scrolled, { type: "place", slide: null, anchor: HEADING });
    expect(scrolled.place).toEqual({ slide: null, anchor: PARAGRAPH });
    expect(scrolled.strokes).toEqual([stroke("s1")]);
    expect(back.strokes).toEqual([stroke("s1")]);
  });

  it("AC-21: drawings_cleared empties strokes", () => {
    const s = joined({ strokes: [stroke("s1"), stroke("s2", CLEO)] });
    expect(presentReducer(s, { type: "drawings_cleared" }).strokes).toEqual([]);
  });

  it("stroke_start appends; stroke_points extends that stroke only", () => {
    let s = presentReducer(joined(), { type: "stroke_start", stroke: stroke("s1", CLEO) });
    s = presentReducer(s, { type: "stroke_start", stroke: stroke("s2", ANA) });
    s = presentReducer(s, {
      type: "stroke_points",
      id: "s1",
      points: [
        [0.3, 0.3],
        [0.4, 0.4],
      ],
    });
    expect(s.strokes.map((x) => x.id)).toEqual(["s1", "s2"]);
    expect(s.strokes[0]?.points).toEqual([
      [0.1, 0.1],
      [0.2, 0.2],
      [0.3, 0.3],
      [0.4, 0.4],
    ]);
    expect(s.strokes[1]?.points).toHaveLength(2);
  });

  it("stroke_points for an unknown stroke changes nothing", () => {
    const s = joined({ strokes: [stroke("s1")] });
    expect(presentReducer(s, { type: "stroke_points", id: "nope", points: [[1, 1]] })).toBe(s);
  });

  it("local stroke echo: your own stroke appears in your colour and grows", () => {
    let s = presentReducer(joined(), {
      type: "local_stroke_start",
      id: "mine",
      anchor: HEADING,
      points: [[0.5, 0.5]],
    });
    s = presentReducer(s, { type: "local_stroke_points", id: "mine", points: [[0.6, 0.6]] });
    expect(s.strokes).toEqual([
      {
        id: "mine",
        participant_id: BEN.id,
        color: BEN.color,
        anchor: HEADING,
        points: [
          [0.5, 0.5],
          [0.6, 0.6],
        ],
      },
    ]);
  });

  it("AC-12: pointer sets the host cursor; pointer null hides it", () => {
    const shown = presentReducer(joined(), { type: "pointer", anchor: HEADING });
    expect(shown.cursor).toEqual(HEADING);
    const hidden = presentReducer(shown, { type: "pointer", anchor: null });
    expect(hidden.cursor).toBeNull();
  });

  it("a change of host hides the previous host's cursor", () => {
    const shown = presentReducer(joined(), { type: "pointer", anchor: HEADING });
    const s = presentReducer(shown, {
      type: "host",
      host: { id: CLEO.id, name: CLEO.name, away: false },
      reason: "handover",
    });
    expect(s.cursor).toBeNull();
  });

  it("AC-12: the host going away hides their cursor", () => {
    const shown = presentReducer(joined(), { type: "pointer", anchor: HEADING });
    const s = presentReducer(shown, {
      type: "host",
      host: { id: ANA.id, name: ANA.name, away: true },
      reason: "away",
    });
    expect(s.cursor).toBeNull();
  });

  it("AC-5: presentation_removed sets available false and stops leading", () => {
    const asAna = joined({ you: { participant_id: ANA.id, rejoin_token: "t", name: ANA.name } });
    const s = presentReducer(asAna, { type: "presentation_removed" });
    expect(s.available).toBe(false);
    expect(isHost(s)).toBe(true);
    expect(canLead(s)).toBe(false);
  });

  it("welcome with available false is unavailable", () => {
    expect(joined({ available: false }).available).toBe(false);
  });

  it("AC-18: drawing_toggled flips local drawing only; server frames never touch it", () => {
    const on = presentReducer(joined(), { type: "drawing_toggled" });
    expect(on.drawing).toBe(true);
    expect(on.strokes).toEqual([]);
    expect(on.participants).toEqual([ANA, BEN, CLEO]);
    const afterFrames = [
      { type: "presence" as const, participants: [ANA] },
      { type: "place" as const, slide: 3, anchor: null },
      { type: "drawings_cleared" as const },
      {
        type: "host" as const,
        host: { id: BEN.id, name: BEN.name, away: false },
        reason: "handover" as const,
      },
    ].reduce(presentReducer, on);
    expect(afterFrames.drawing).toBe(true);
    expect(presentReducer(on, { type: "drawing_toggled" }).drawing).toBe(false);
  });

  it("error records the refusal code", () => {
    const s = presentReducer(joined(), { type: "error", code: "not_host" });
    expect(s.error).toBe("not_host");
  });

  it("chat and gif frames leave the presentation state alone", () => {
    const s = joined();
    expect(presentReducer(s, { type: "chat_removed", id: 1 })).toBe(s);
  });
});
