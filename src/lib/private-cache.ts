/** Wait for disk deletion, not just delivery of the sign-out message. */
export async function clearPrivateCache(): Promise<void> {
  if (!("serviceWorker" in navigator)) return;
  const workers = navigator.serviceWorker;
  const registration = await workers.getRegistration();
  const worker = workers.controller ?? registration?.active;
  if (!worker) {
    // An unregistered worker can leave disk entries for the next install.
    const names = await caches.keys();
    await Promise.all(names.filter(n => n.startsWith("tt-v") && n !== "tt-v3-assets").map(n => caches.delete(n)));
    return;
  }
  await new Promise<void>((resolve, reject) => {
    const channel = new MessageChannel();
    const finish = (error?: Error) => {
      clearTimeout(timeout);
      channel.port1.close();
      channel.port2.close();
      if (error) reject(error);
      else resolve();
    };
    const timeout = setTimeout(() => finish(new Error("private cache clear timed out")), 5000);
    channel.port1.onmessage = event => {
      finish(event.data === "CLEARED" ? undefined : new Error("private cache clear failed"));
    };
    try {
      worker.postMessage("CLEAR", [channel.port2]);
    } catch (error) {
      finish(error instanceof Error ? error : new Error("private cache clear failed"));
    }
  });
}
