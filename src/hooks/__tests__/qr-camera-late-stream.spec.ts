import { afterEach, expect, it, vi } from "vitest";

// Audit N finding 5: a dialog closed while getUserMedia was pending left the
// late stream running, because cleanup ran before there was a stream to stop.
const { effects, video } = vi.hoisted(() => ({ effects: [] as (() => void | (() => void))[], video: { current: null as unknown } }));
vi.mock("react", () => ({
  useEffect: (effect: () => void | (() => void)) => { effects.push(effect); },
  useRef: (initial: unknown) => (initial === null ? video : { current: initial }),
  useState: <T,>(initial: T) => [initial, vi.fn()],
}));
const { useQrCamera } = await import("@/hooks/useQrCamera");

function lateCamera() {
  const stop = vi.fn();
  let grant!: (stream: unknown) => void;
  const pending = new Promise(resolve => { grant = resolve; });
  vi.stubGlobal("navigator", { mediaDevices: { getUserMedia: () => pending } });
  vi.stubGlobal("document", { createElement: () => ({}) });
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  return { stop, grant: () => grant({ getTracks: () => [{ stop }] }) };
}

afterEach(() => { effects.length = 0; video.current = null; vi.unstubAllGlobals(); });

it("stops a stream granted after the dialog closed", async () => {
  const camera = lateCamera();
  video.current = { play: vi.fn().mockResolvedValue(undefined) };
  useQrCamera(true, () => "keep-looking", vi.fn(), "no camera");
  const cleanup = effects[0]() as () => void;
  cleanup();
  camera.grant();
  await vi.waitFor(() => expect(camera.stop).toHaveBeenCalledTimes(1));
});

it("stops a stream granted after the video element went away", async () => {
  const camera = lateCamera();
  useQrCamera(true, () => "keep-looking", vi.fn(), "no camera");
  effects[0]();
  camera.grant();
  await vi.waitFor(() => expect(camera.stop).toHaveBeenCalledTimes(1));
});
