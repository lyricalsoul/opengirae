const ASCII = {
  FORMAT_BOLD: "\x1b[1m",
  FORMAT_RESET: "\x1b[0m",
  FORMAT_RED: "\x1b[31m",
  FORMAT_GREEN: "\x1b[32m",
  FORMAT_YELLOW: "\x1b[33m",
  FORMAT_BLUE: "\x1b[34m",
  FORMAT_MAGENTA: "\x1b[35m",
  FORMAT_CYAN: "\x1b[36m",
  FORMAT_WHITE: "\x1b[37m",
  FORMAT_GRAY: "\x1b[90m",
}

const log = (level: string, color: keyof typeof ASCII, namespace: string, message: string) => {
  const timestamp = new Date().toISOString();
  console.log(`${timestamp} ${ASCII.FORMAT_BOLD}${ASCII[color]}${level}${ASCII.FORMAT_RESET} ${ASCII.FORMAT_GRAY}[${namespace}]${ASCII.FORMAT_RESET} ${message}`);
};

export const error = (namespace: string, message: string) => {
  log("ERROR", "FORMAT_RED", namespace, message);
};

export const warn = (namespace: string, message: string) => {
  log("WARN", "FORMAT_YELLOW", namespace, message);
};

export const info = (namespace: string, message: string) => {
  log("INFO", "FORMAT_CYAN", namespace, message);
};

export const debug = (namespace: string, message: string) => {
  log("DEBUG", "FORMAT_MAGENTA", namespace, message);
};
