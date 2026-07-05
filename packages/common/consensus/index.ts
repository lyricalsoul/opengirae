import IORedis from "ioredis";
import { INTERNAL_KEY_PREFIX } from "../constants";
import { info } from "../logger";

export const connection = new IORedis({ maxRetriesPerRequest: null });

const useInternalKey = (key: string): string => `${INTERNAL_KEY_PREFIX}:${key}`;

// The commands the bot can handle.
export const getAvailableCommands = async (): Promise<string[]> => {
  return JSON.parse(await connection.get(useInternalKey("commands")) || "[]");
};

export const setAvailableCommands = async (commands: string[]): Promise<void> => {
  await connection.set(useInternalKey("commands"), JSON.stringify(commands));
};

export const onParameterRefresh = (cb: () => Promise<void>) => {
  connection.subscribe(useInternalKey("refresh-params")).then(() => {
    connection.on("message", async (channel, message) => {
      if (channel === useInternalKey("refresh-params")) {
        info("consensus", `Received parameter refresh order. Reason: ${message}`);
        await cb();
      }
    });
  })
};

export const publishParameterRefresh = async (message: string): Promise<void> => {
  await connection.publish(useInternalKey("refresh-params"), message);
};
