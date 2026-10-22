import { simulate, type Config } from "./solver";
self.onmessage = (event: MessageEvent<{ id: number; config: Config }>) => {
  try {
    self.postMessage({
      id: event.data.id,
      result: simulate(event.data.config),
    });
  } catch (error) {
    self.postMessage({
      id: event.data.id,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
