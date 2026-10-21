import { execFile } from "node:child_process";
import { connect } from "node:net";
import { promisify } from "node:util";
import { deadline } from "./browser-deadline.mjs";

const exec = promisify(execFile);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const connectionError = /(?:ERR_CONNECTION_(?:REFUSED|RESET|CLOSED|ABORTED|FAILED)|ERR_FAILED|ECONNREFUSED|ECONNRESET|EPIPE|socket hang up)/i;
const notReady = /page state did not become ready|readiness(?: sample)? timed out/;

/** Socket timeouts do not close sockets by themselves. Always destroy the probe. */
export function portAnswers(base) {
  const url = new URL(base);
  return new Promise(resolve => {
    const socket = connect({ host: url.hostname.replace(/^\[|\]$/g, ""), port: Number(url.port || (url.protocol === "https:" ? 443 : 80)) });
    const finish = answer => { socket.destroy(); resolve(answer); };
    socket.setTimeout(1000, () => finish(false));
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
  });
}

/** RSS belongs to the listener on this port; never sample another checkout. */
export async function listenerMemory(base, run = exec) {
  const url = new URL(base);
  if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) return { pids: "", rss: 0 };
  const options = { timeout: 1000, killSignal: "SIGKILL", encoding: "utf8" };
  try {
    const { stdout } = await run("lsof", ["-nP", `-iTCP:${url.port || (url.protocol === "https:" ? 443 : 80)}`, "-sTCP:LISTEN", "-t"], options);
    const ids = [...new Set(stdout.trim().split(/\s+/).filter(id => /^\d+$/.test(id)))].sort();
    if (!ids.length) return { pids: "", rss: 0 };
    const { stdout: memory } = await run("ps", ["-o", "pid=,rss=", "-p", ids.join(",")], options);
    const rows = memory.trim().split("\n").map(row => row.trim().split(/\s+/).map(Number));
    const [pid, rss] = rows.filter(([pid, rss]) => ids.includes(String(pid)) && Number.isFinite(rss))
      .sort((a, b) => b[1] - a[1])[0] ?? [0, 0];
    return { pids: ids.join(","), rss, pid };
  } catch { return { pids: "", rss: 0 }; }
}

/** Shared recovery barrier, plus restart evidence for readiness failures. */
export function monitorBrowserServer(base, {
  inspect = async () => {
    const [online, memory] = await Promise.all([portAnswers(base), listenerMemory(base)]);
    return { online, ...memory };
  },
  answers = async () => {
    try {
      const response = await fetch(`${base}/login`, { signal: AbortSignal.timeout(10000) });
      await response.body?.cancel();
      return response.status < 500;
    } catch { return false; }
  },
  interval = 1000, recoveryTimeout = 90000, log = console.log,
} = {}) {
  let epoch = 0;
  let previous;
  let peak = { rss: 0, pid: 0 };
  let checking;
  let recovering;
  let failure;
  let stopped = false;
  async function refresh() {
    return checking ??= deadline(3000, inspect, undefined, 5000, "server port sample").then(state => {
      if (previous && ((previous.online && !state.online) || (previous.pids && state.pids && previous.pids !== state.pids))) epoch++;
      if (state.rss > peak.rss) peak = { rss: state.rss, pid: state.pid };
      previous = state;
      return state;
    }).finally(() => { checking = undefined; });
  }
  const timer = setInterval(() => { if (!stopped) refresh().catch(error => { failure = error; }); }, interval);
  timer.unref();
  return {
    get epoch() { return epoch; },
    async beforeJob() {
      if (stopped) throw new Error("server monitor stopped");
      if (failure) throw failure;
      if (recovering) return recovering;
      const state = await refresh();
      if (state.online) return;
      return recovering ??= deadline(recoveryTimeout, async () => {
        log(`  PAUSE    ${base}: port unreachable; waiting at most ${recoveryTimeout}ms`);
        while (!stopped && !failure) {
          if ((await refresh()).online && await answers()) {
            log(`  RESUME   ${base}: server answers again`);
            return;
          }
          await sleep(interval);
        }
        throw new Error("server recovery stopped");
      }, undefined, 5000, "server recovery").catch(error => { failure = error; throw error; })
        .finally(() => { recovering = undefined; });
    },
    async canRetry(error, startedEpoch) {
      await refresh();
      return connectionError.test(error.message) || (notReady.test(error.message) && epoch !== startedEpoch);
    },
    stop() { stopped = true; clearInterval(timer); },
    report() {
      log(`  Peak server RSS (listener, sampled every ${interval}ms): ${peak.rss ? `${(peak.rss / 1024).toFixed(1)} MiB (pid ${peak.pid})` : "unavailable"}; restart events=${epoch}`);
    },
  };
}
